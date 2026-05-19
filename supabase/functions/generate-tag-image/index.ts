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
//   ┌─ Modo COMPOSITION (novo) ─────────────────────────────────────────
//   │  body: { promptId, clientId, photoId, composition: { compositionId, index } }
//   │  → NÃO toca em client_tag_values
//   │  → sobe em
//   │    client-tag-images/{clientId}/compositions/{compositionId}/{index}_{ts}.png
//   │  → resposta: { success, storagePath, size, promptName }
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
  promptId:     string
  clientId:     string
  photoId:      string
  // Modo TAG (existente). Se vier, escreve em client_tag_values.
  tagId?:       string
  // Modo COMPOSITION (novo). Se vier (e tagId NÃO vier), só sobe arquivo
  // numa pasta separada e devolve o storagePath, sem mexer em DB.
  composition?: CompositionRef
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
    const { promptId, clientId, photoId, tagId, composition } = body

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
        .select('id, name, prompt, model, size, quality, is_active')
        .eq('id', promptId).single(),
      admin.from('client_photos')
        .select('id, storage_path, photo_name, photo_type, client_id')
        .eq('id', photoId).single(),
    ])
    if (pErr || !prompt)   return jsonRes({ error: 'Prompt not found' }, 404)
    if (!prompt.is_active) return jsonRes({ error: 'Prompt is inactive' }, 400)
    if (phErr || !photo)   return jsonRes({ error: 'Photo not found' }, 404)

    // ── 4. Baixa a foto do storage ──────────────────────────────────
    const { data: photoBlob, error: dlErr } = await admin.storage
      .from('client-photos')
      .download(photo.storage_path)
    if (dlErr || !photoBlob) {
      return jsonRes({ error: `Failed to download photo: ${dlErr?.message || 'unknown'}` }, 500)
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
    const photoMime  = photo.photo_type || photoBlob.type || 'image/jpeg'
    const photoFile  = new Blob([photoBytes], { type: photoMime })

    const form = new FormData()
    form.append('model',   prompt.model   || 'gpt-image-1')
    form.append('prompt',  prompt.prompt)
    form.append('size',    prompt.size    || '1024x1024')
    form.append('quality', prompt.quality || 'medium')
    form.append('n',       '1')
    form.append('image',   photoFile, photo.photo_name || 'input.jpg')

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
    //   Caminho TAG MODE — comportamento legado
    // ═══════════════════════════════════════════════════════════════════
    if (isTagMode) {
      const storagePath = `${clientId}/${tagId}_ai_${ts}.png`

      // Remove arquivo antigo se houver
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
        success:    true,
        mode:       'tag',
        storagePath,
        size:       outBytes.length,
        promptName: prompt.name,
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    //   Caminho COMPOSITION MODE — sobe arquivo soltinho, sem DB write
    // ═══════════════════════════════════════════════════════════════════
    const compId  = safeSlug(composition!.compositionId, 80)
    const idx     = Number.isFinite(composition!.index) ? Math.max(0, Math.floor(composition!.index)) : 0
    const idxStr  = String(idx).padStart(3, '0')
    const storagePath = `${clientId}/compositions/${compId}/${idxStr}_${ts}.png`

    const { error: upErr } = await admin.storage
      .from('client-tag-images')
      .upload(storagePath, outBytes, { contentType: 'image/png', upsert: true })
    if (upErr) return jsonRes({ error: `Upload failed: ${upErr.message}` }, 500)

    return jsonRes({
      success:    true,
      mode:       'composition',
      storagePath,
      size:       outBytes.length,
      promptName: prompt.name,
    })

  } catch (err) {
    console.error('Edge function error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return jsonRes({ error: msg }, 500)
  }
})