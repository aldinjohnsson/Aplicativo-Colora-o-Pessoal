// supabase/functions/generate-tag-image/index.ts
//
// Edge Function: gera uma imagem usando OpenAI gpt-image-1 (/v1/images/edits)
// com base em um prompt salvo + uma foto da galeria do cliente.
//
// Dois modos de uso:
//
//   ┌─ Modo TAG (existente, compatibilidade total) ──────────────────────
//   │  body: { promptId, clientId, tagId, photoId }
//   │  → faz tudo que fazia antes: salva o resultado em
//   │    client-tag-images/{clientId}/{tagId}_ai_{ts}.png e upserta em
//   │    client_tag_values.
//   │  → resposta: { success, storagePath, size, promptName }
//   └────────────────────────────────────────────────────────────────────
//
//   ┌─ Modo COMPOSITION (novo destino: Google Drive) ───────────────────
//   │  body: { promptId, clientId, photoId, composition: { compositionId, index } }
//   │  → NÃO toca em client_tag_values
//   │  → Chama internamente /functions/v1/drive/upload com kind=composition,
//   │    que sobe o PNG em "Composições IA" dentro da pasta do cliente
//   │    no Google Drive.
//   │  → resposta: { success, driveFileId, driveFolderId, url, downloadUrl,
//   │               photoName, size, promptName }
//   │
//   │  Antes esse caminho gravava em client-tag-images/{clientId}/compositions/…
//   │  com signed URL de 1h, que expirava no localStorage e quebrava ao reabrir.
//   │  Migrado pro Drive pra consistência com o resto do app (todas as fotos
//   │  já vão pro Drive) e pra eliminar a expiração da URL.
//   └────────────────────────────────────────────────────────────────────
//
// Deploy:
//   supabase functions deploy generate-tag-image
//
// Secrets:
//   OPENAI_API_KEY=... (ou cada admin configura sua própria via
//   admin_content.content.openaiApiKey — preferência sobre a env)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

interface CompositionRef {
  compositionId: string
  index:         number
}

interface RequestBody {
  promptId:        string
  clientId:        string
  photoId:         string
  // Texto do prompt já resolvido pelo frontend (ex: texto da Parte N dentro
  // do array parts). Sobrescreve prompt.prompt do banco, que pode estar vazio
  // quando o texto real fica dentro do array parts de cada prompt composto.
  promptOverride?: string
  // Modo TAG (existente). Se vier, escreve em client_tag_values.
  tagId?:          string
  // Modo COMPOSITION. Se vier (e tagId NÃO vier), sobe a imagem pro Google
  // Drive (sem escrever em DB) e devolve { driveFileId, url, downloadUrl }.
  composition?:    CompositionRef
}

// Sanitiza string pra uso seguro em path de storage
function safeSlug(s: string, max = 60): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, max) || 'x'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return jsonRes({ error: 'Method not allowed' }, 405)

  try {
    // ── 1. Verifica admin ────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonRes({ error: 'Missing Authorization header' }, 401)

    const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
    const supabaseAnon    = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
      auth:   { persistSession: false },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return jsonRes({ error: 'Unauthorized' }, 401)

    const admin = createClient(supabaseUrl, supabaseService, { auth: { persistSession: false } })
    const { data: adm } = await admin.from('admin_users').select('id').eq('id', user.id).maybeSingle()
    if (!adm) return jsonRes({ error: 'Admin access required' }, 403)

    // ── 2. Parse body ───────────────────────────────────────────────
    const body: Partial<RequestBody> = await req.json().catch(() => ({}))
    const { promptId, clientId, photoId, promptOverride, tagId, composition } = body

    if (!promptId || !clientId || !photoId) {
      return jsonRes({ error: 'Missing required fields: promptId, clientId, photoId' }, 400)
    }

    // Determina o modo
    const isTagMode = typeof tagId === 'string' && tagId.length > 0
    const isCompositionMode = !isTagMode && composition && typeof composition.compositionId === 'string'

    if (!isTagMode && !isCompositionMode) {
      return jsonRes({
        error: 'Provide either tagId (tag mode) or composition: { compositionId, index } (composition mode)',
      }, 400)
    }

    // ── 3. Carrega prompt + foto ────────────────────────────────────
    const [{ data: prompt, error: pErr }, { data: photo, error: phErr }] = await Promise.all([
      admin.from('ai_image_prompts')
        .select('id, name, prompt, model, size, quality, is_active, reference_image_path')
        .eq('id', promptId).single(),
      admin.from('client_photos')
        .select('id, storage_path, photo_name, photo_type, client_id, drive_file_id')
        .eq('id', photoId).single(),
    ])
    if (pErr || !prompt)   return jsonRes({ error: 'Prompt not found' }, 404)
    if (!prompt.is_active) return jsonRes({ error: 'Prompt is inactive' }, 400)

    // Valida depois de resolver promptOverride — o campo prompt.prompt pode estar
    // vazio intencionalmente quando o texto real vem no array parts (enviado
    // pelo frontend como promptOverride). Só bloqueia se ambos estiverem vazios.
    const resolvedPromptText = (promptOverride && promptOverride.trim())
      ? promptOverride.trim()
      : (prompt.prompt || '').trim()

    if (!resolvedPromptText) {
      console.error('Empty prompt debug', JSON.stringify({
        promptName:      prompt.name,
        promptDotPrompt: prompt.prompt,
        promptOverride:  promptOverride ?? null,
        bodyKeys:        Object.keys(body),
      }))
      return jsonRes({
        error:
          `O texto da parte está vazio. ` +
          `Vá em Prompts IA → edite "${prompt.name}" → preencha o textarea de cada parte. ` +
          `(prompt.prompt="${prompt.prompt}", promptOverride="${promptOverride ?? ''}")`,
      }, 400)
    }
    if (phErr || !photo)   return jsonRes({ error: 'Photo not found' }, 404)

    // ── 4. Baixa a foto da galeria (Drive → Supabase Storage como fallback) ────
    let photoBlob: Blob | null = null
    let photoMime = photo.photo_type || 'image/jpeg'

    if (photo.drive_file_id) {
      const driveUrl = `https://drive.google.com/uc?export=download&id=${photo.drive_file_id}`
      try {
        const driveRes = await fetch(driveUrl)
        if (driveRes.ok) {
          photoBlob = await driveRes.blob()
          photoMime = driveRes.headers.get('content-type') || photoMime
        } else {
          console.warn(`Drive download failed (HTTP ${driveRes.status}), trying Supabase Storage…`)
        }
      } catch (e) {
        console.warn('Drive download threw, trying Supabase Storage…', e)
      }
    }

    if (!photoBlob && photo.storage_path) {
      const { data: sb, error: dlErr } = await admin.storage
        .from('client-photos')
        .download(photo.storage_path)
      if (dlErr || !sb) {
        return jsonRes({
          error: `Failed to download photo: ${dlErr?.message || 'Object not found'}. ` +
                 `A foto pode não estar mais disponível no storage. ` +
                 `Verifique se o Google Drive está conectado e a foto foi enviada corretamente.`,
        }, 500)
      }
      photoBlob = sb
      photoMime = photo.photo_type || sb.type || 'image/jpeg'
    }

    if (!photoBlob) {
      return jsonRes({
        error: 'Não foi possível baixar a foto. Verifique se o Google Drive está conectado.',
      }, 500)
    }

    // ── 4b. Baixa a imagem de referência do prompt (se houver) ──────
    let refBlob: Blob | null = null

    if (prompt.reference_image_path) {
      const { data: refData, error: refErr } = await admin.storage
        .from('ai-prompt-references')
        .download(prompt.reference_image_path)

      if (refErr || !refData) {
        console.warn(
          `Imagem de referência do prompt não encontrada (${prompt.reference_image_path}): ` +
          `${refErr?.message ?? 'objeto não encontrado'}. Gerando sem ela.`
        )
      } else {
        refBlob = refData
      }
    }

    // ── 5. Resolve OpenAI key (per-admin, fallback env) ─────────────
    let openaiKey: string | null = null
    const { data: settingsRow } = await admin
      .from('admin_content')
      .select('content')
      .eq('admin_id', user.id)
      .eq('type', 'settings')
      .maybeSingle()

    const fromDb = (settingsRow?.content as any)?.openaiApiKey
    if (typeof fromDb === 'string' && fromDb.trim()) {
      openaiKey = fromDb.trim()
    } else {
      const envKey = Deno.env.get('OPENAI_API_KEY')
      if (envKey && envKey.trim()) openaiKey = envKey.trim()
    }
    if (!openaiKey) {
      return jsonRes({
        error: 'Chave da OpenAI não configurada. Vá em Configurações e cole sua chave em "Geração de Imagem OpenAI".',
      }, 400)
    }

    // ── 6. Chama OpenAI images/edits ────────────────────────────────
    const photoBytes = new Uint8Array(await photoBlob.arrayBuffer())
    const photoFile  = new Blob([photoBytes], { type: photoMime })

    const form = new FormData()
    form.append('model',   prompt.model   || 'gpt-image-1')
    form.append('prompt',  resolvedPromptText)
    form.append('size',    prompt.size    || '1024x1024')
    form.append('quality', prompt.quality || 'medium')
    form.append('n',       '1')

    if (refBlob) {
      const refBytes = new Uint8Array(await refBlob.arrayBuffer())
      const refFile  = new Blob([refBytes], { type: 'image/jpeg' })
      form.append('image[]', refFile,    'reference.jpg')
      form.append('image[]', photoFile,  photo.photo_name || 'client.jpg')
      console.log(`Gerando com imagem de referência: ${prompt.reference_image_path}`)
    } else {
      form.append('image', photoFile, photo.photo_name || 'input.jpg')
    }

    const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body:    form,
    })

    if (!openaiRes.ok) {
      const errText = await openaiRes.text()
      console.error('OpenAI error', openaiRes.status, errText)
      return jsonRes({
        error: `OpenAI API error (${openaiRes.status}): ${errText.slice(0, 400)}`,
      }, 502)
    }

    const data = await openaiRes.json()
    const b64 = data?.data?.[0]?.b64_json
    if (!b64 || typeof b64 !== 'string') {
      return jsonRes({ error: 'OpenAI returned no image' }, 502)
    }

    // ── 7. Decodifica base64 ────────────────────────────────────────
    const binStr = atob(b64)
    const outBytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) outBytes[i] = binStr.charCodeAt(i)

    const ts = Date.now()

    // ═══════════════════════════════════════════════════════════════════
    //   Caminho TAG MODE — comportamento legado (Supabase Storage)
    // ═══════════════════════════════════════════════════════════════════
    if (isTagMode) {
      const storagePath = `${clientId}/${tagId}_ai_${ts}.png`

      const { data: existing } = await admin
        .from('client_tag_values')
        .select('image_storage_path')
        .eq('client_id', clientId)
        .eq('tag_id', tagId)
        .maybeSingle()
      if (existing?.image_storage_path && existing.image_storage_path !== storagePath) {
        await admin.storage.from('client-tag-images').remove([existing.image_storage_path]).catch(() => {})
      }

      const { error: upErr } = await admin.storage
        .from('client-tag-images')
        .upload(storagePath, outBytes, { contentType: 'image/png', upsert: true })
      if (upErr) return jsonRes({ error: `Upload failed: ${upErr.message}` }, 500)

      const { error: upsertErr } = await admin
        .from('client_tag_values')
        .upsert({
          client_id:          clientId,
          tag_id:             tagId,
          text_value:         null,
          photo_id:           null,
          image_storage_path: storagePath,
          image_size:         outBytes.length,
          image_mime:         'image/png',
          updated_at:         new Date().toISOString(),
        }, { onConflict: 'client_id,tag_id' })

      if (upsertErr) {
        await admin.storage.from('client-tag-images').remove([storagePath]).catch(() => {})
        return jsonRes({ error: `DB upsert failed: ${upsertErr.message}` }, 500)
      }

      return jsonRes({
        success:           true,
        mode:              'tag',
        storagePath,
        size:              outBytes.length,
        promptName:        prompt.name,
        usedReferenceImage: !!refBlob,
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    //   Caminho COMPOSITION MODE — upload para Google Drive
    // ═══════════════════════════════════════════════════════════════════
    //
    // Antes: upload em client-tag-images/{clientId}/compositions/… com signed
    //        URL de 1h. URL expirava no localStorage e quebrava ao reabrir.
    // Agora: chama internamente /drive/upload com kind='composition', que
    //        sobe em "Composições IA" dentro da pasta do cliente no Drive,
    //        SEM insert em client_photos. URL é estática (sem TTL).
    const compId   = safeSlug(composition!.compositionId, 80)
    const idx      = Number.isFinite(composition!.index) ? Math.max(0, Math.floor(composition!.index)) : 0
    const idxStr   = String(idx).padStart(3, '0')
    const safeName = `${safeSlug(prompt.name, 40)}_${compId}_${idxStr}_${ts}.png`

    const driveForm = new FormData()
    driveForm.append('kind', 'composition')
    driveForm.append('client_id', clientId)
    driveForm.append('composition_index', String(idx))
    driveForm.append('file', new Blob([outBytes], { type: 'image/png' }), safeName)

    // Repassa o JWT do admin pra função `drive` autenticar.
    const driveRes = await fetch(`${supabaseUrl}/functions/v1/drive/upload`, {
      method: 'POST',
      headers: { Authorization: authHeader },
      body:    driveForm,
    })

    if (!driveRes.ok) {
      const errJson = await driveRes.json().catch(() => ({}))
      const errMsg  = (errJson as any)?.error ?? `HTTP ${driveRes.status}`
      console.error(`Drive upload failed (composition): ${errMsg}`)
      return jsonRes({ error: `Drive upload failed: ${errMsg}` }, 500)
    }

    const driveData = await driveRes.json() as {
      ok:            boolean
      driveFileId:   string
      driveFolderId: string
      photoName:     string
      url:           string
      downloadUrl:   string
    }

    return jsonRes({
      success:            true,
      mode:               'composition',
      driveFileId:        driveData.driveFileId,
      driveFolderId:      driveData.driveFolderId,
      photoName:          driveData.photoName,
      url:                driveData.url,
      downloadUrl:        driveData.downloadUrl,
      size:               outBytes.length,
      promptName:         prompt.name,
      usedReferenceImage: !!refBlob,
    })

  } catch (err) {
    console.error('Edge function error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return jsonRes({ error: msg }, 500)
  }
})