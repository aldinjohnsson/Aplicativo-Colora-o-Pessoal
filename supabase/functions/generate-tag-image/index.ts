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
//   │  → LOGO: compositing automático no canto inferior direito (legado).
//   │    Necessário porque tag values aparecem isoladas em outras UIs
//   │    do app, sem capa/contracapa de PDF pra carregar o branding.
//   └────────────────────────────────────────────────────────────────────
//
//   ┌─ Modo COMPOSITION (destino: Google Drive) ─────────────────────────
//   │  body: { promptId, clientId, photoId, composition: { compositionId, index } }
//   │  → NÃO toca em client_tag_values
//   │  → Chama internamente /functions/v1/drive/upload com kind=composition,
//   │    que sobe o PNG em "Composições IA" dentro da pasta do cliente
//   │    no Google Drive.
//   │  → resposta: { success, driveFileId, driveFolderId, url, downloadUrl,
//   │               photoName, size, promptName }
//   │  → LOGO: NÃO embute. Branding vem da capa/contracapa (PDFs vetoriais)
//   │    que o admin configura em Settings → Branding de Composições IA.
//   │    As imagens IA ficam limpas e o PDF final concatena
//   │    [capa] + [imagens IA] + [contracapa] no frontend.
//   └────────────────────────────────────────────────────────────────────
//
// Tag {{Logo}}:
//   Tag legada — se ainda existir no texto do prompt, a linha inteira é
//   removida antes de enviar pra OpenAI. Em tag mode, o logo entra via
//   compositing determinístico (não via IA, que não posiciona logo de
//   forma confiável). Em composition mode, a linha simplesmente some.
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
  /** ID da foto na galeria do cliente. Obrigatório no modo TAG e no modo
   *  COMPOSITION com galeria. Omitido no modo COMPOSITION standalone
   *  (quando a foto vem via uploadedImage). */
  photoId?:        string
  // Texto do prompt já resolvido pelo frontend (ex: texto da Parte N dentro
  // do array parts). Sobrescreve prompt.prompt do banco, que pode estar vazio
  // quando o texto real fica dentro do array parts de cada prompt composto.
  promptOverride?: string
  // Modo TAG (existente). Se vier, escreve em client_tag_values.
  tagId?:          string
  // Modo COMPOSITION. Se vier (e tagId NÃO vier), sobe a imagem pro Google
  // Drive (sem escrever em DB) e devolve { driveFileId, url, downloadUrl }.
  composition?:    CompositionRef
  /** Foto base enviada diretamente pelo frontend (modo standalone, sem galeria).
   *  base64 puro sem prefixo "data:…". Usado em vez de photoId. */
  uploadedImage?: {
    base64: string
    mime:   string
  }
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

// ── Compositing do logo sobre a imagem gerada ────────────────────────────────
//
// Usa ImageScript (pure Deno/TS, sem deps nativas).
// Posiciona o logo no canto inferior direito com padding de 24px.
// Redimensiona o logo para no máximo 18% da largura da imagem base.
// Se o compositing falhar por qualquer motivo (logo corrompido, formato
// não suportado etc.), retorna os bytes originais sem quebrar a geração.
// NOTA: ImageScript é importado APENAS aqui (um único import), nunca
// dentro de outras funções, pra evitar carregar o módulo duas vezes.
//
async function compositeLogoBottomRight(
  baseBytes: Uint8Array,
  logoBytes: Uint8Array,
): Promise<Uint8Array> {
  try {
    const { Image } = await import('https://deno.land/x/imagescript@1.2.15/mod.ts')

    const baseImg = await Image.decode(baseBytes)
    const logoImg = await Image.decode(logoBytes)

    // Redimensiona o logo: máximo 18% da largura da imagem gerada,
    // preservando a proporção.
    const maxLogoW = Math.floor(baseImg.width * 0.18)
    if (logoImg.width > maxLogoW) {
      const ratio   = maxLogoW / logoImg.width
      const newW    = maxLogoW
      const newH    = Math.max(1, Math.round(logoImg.height * ratio))
      logoImg.resize(newW, newH)
    }

    // Posição: canto inferior direito, 24px de margem
    const padding = 24
    const x = baseImg.width  - logoImg.width  - padding
    const y = baseImg.height - logoImg.height - padding

    baseImg.composite(logoImg, x, y)

    const result = await baseImg.encode()
    console.log(`Logo composto em (${x}, ${y}), tamanho final ${logoImg.width}×${logoImg.height}px`)
    return result

  } catch (err) {
    // Não quebra a geração — loga e devolve imagem original
    console.warn('compositeLogoBottomRight falhou, usando imagem original:', err)
    return baseBytes
  }
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
    const { promptId, clientId, photoId, promptOverride, tagId, composition, uploadedImage } = body

    // photoId é obrigatório no modo TAG e no modo COMPOSITION com galeria.
    // No modo COMPOSITION standalone (StandaloneAiGenerationPage), a foto
    // chega como uploadedImage.base64 — photoId pode estar ausente.
    if (!promptId || !clientId || (!photoId && !uploadedImage?.base64)) {
      return jsonRes({ error: 'Missing required fields: promptId, clientId, and either photoId or uploadedImage' }, 400)
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
    // A query de client_photos só é feita quando photoId está presente.
    // No modo standalone (uploadedImage), pulamos o banco.
    const [{ data: prompt, error: pErr }, photoResult] = await Promise.all([
      admin.from('ai_image_prompts')
        .select('id, name, prompt, model, size, quality, is_active, reference_image_path')
        .eq('id', promptId).single(),
      photoId
        ? admin.from('client_photos')
            .select('id, storage_path, photo_name, photo_type, client_id, drive_file_id')
            .eq('id', photoId).single()
        : Promise.resolve({ data: null, error: null }),
    ])
    const { data: photo, error: phErr } = photoResult as { data: any; error: any }

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

    // Só valida foto do banco quando photoId foi fornecido
    if (photoId && (phErr || !photo)) {
      return jsonRes({ error: 'Photo not found' }, 404)
    }

    // ── 4. Obtém a foto como Blob ───────────────────────────────────
    //
    // A conversão JPEG → PNG acontece AGORA no frontend (documentsService.ts),
    // então a edge sempre recebe a foto já como PNG via uploadedImage.base64.
    //
    // O caminho "galeria via Drive" foi removido daqui: o frontend busca o blob
    // (driveStorage.fetchPhotoBlob), converte pra PNG com OffscreenCanvas e envia
    // como uploadedImage — a edge não precisa mais fazer fetch no Drive.
    //
    // O único fallback legado mantido é o Supabase Storage (photoId sem driveFileId),
    // que cobre fotos antigas migradas antes da integração com o Drive.
    //
    let photoBlob: Blob | null = null
    let photoMime: string = photo?.photo_type || uploadedImage?.mime || 'image/png'
    const photoFileName: string = photo?.photo_name || 'client.png'

    if (uploadedImage?.base64) {
      // Caminho principal: foto já convertida pra PNG no frontend
      try {
        const binStr = atob(uploadedImage.base64)
        const bytes  = new Uint8Array(binStr.length)
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
        photoBlob = new Blob([bytes], { type: uploadedImage.mime || 'image/png' })
        photoMime = uploadedImage.mime || 'image/png'
        console.log(`Foto recebida via uploadedImage (${bytes.length} bytes, ${photoMime})`)
      } catch (decodeErr) {
        return jsonRes({ error: `Falha ao decodificar uploadedImage.base64: ${decodeErr}` }, 400)
      }
    } else if (photo?.storage_path) {
      // Fallback legado: foto antiga no Supabase Storage (sem Drive).
      // Raro — apenas fotos enviadas antes da integração com o Google Drive.
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
        error: 'Não foi possível obter a foto. Envie a foto via uploadedImage ou verifique o storage.',
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

    // ── 5b. Baixa o logo do admin (SOMENTE em tag mode) ─────────────
    //
    // Tag mode: logo é embutido no canto inferior direito da imagem
    // gerada via compositing determinístico (não via IA). Necessário
    // porque tag values aparecem isoladas em outras UIs do app.
    //
    // Composition mode: NÃO embute logo. Branding vem da capa e da
    // contracapa (PDFs vetoriais) que o admin configura em
    // Settings → Branding de Composições IA. As imagens geradas
    // ficam limpas; o PDF final concatena
    // [capa] + [imagens IA] + [contracapa] no frontend.
    //
    // Se {{Logo}} ainda existir no prompt (legado), a linha inteira é
    // removida antes de enviar pra OpenAI nos dois modos.
    //
    let logoBytes: Uint8Array | null = null

    if (isTagMode) {
      const logoPath: string | undefined = (settingsRow?.content as any)?.logoStoragePath

      if (logoPath?.trim()) {
        const { data: logoData, error: logoErr } = await admin.storage
          .from('admin-logos')
          .download(logoPath.trim())
        if (logoErr || !logoData) {
          console.warn(`Logo não encontrado em admin-logos/${logoPath}: ${logoErr?.message ?? 'objeto não encontrado'}. Gerando sem ele.`)
        } else {
          logoBytes = new Uint8Array(await logoData.arrayBuffer())
          console.log(`Logo carregado para compositing (tag mode): ${logoPath}`)
        }
      }
    } else {
      console.log('Composition mode: pulando logo compositing (branding via capa/contracapa do PDF).')
    }

    // Remove linhas com {{Logo}} do prompt (legado) e instrução de canto
    // que ficaria truncada — o logo entra via compositing em tag mode,
    // ou simplesmente não entra em composition mode.
    const finalPromptText = resolvedPromptText
      .split('\n')
      .filter(line => !line.includes('{{Logo}}'))
      .join('\n')
      .trim()

    // ── 6. Chama OpenAI images/edits ────────────────────────────────
    //
    // O logo NÃO entra no array image[] — apenas a imagem de referência
    // do prompt (card da estação) e a foto da cliente.
    //
    const photoBytes = new Uint8Array(await photoBlob.arrayBuffer())
    const photoFile  = new Blob([photoBytes], { type: photoMime })

    const form = new FormData()
    form.append('model',   prompt.model   || 'gpt-image-1')
    form.append('prompt',  finalPromptText)
    form.append('size',    prompt.size    || '1024x1024')
    form.append('quality', prompt.quality || 'medium')
    form.append('n',       '1')

    // Monta o array de imagens: ref do prompt (se houver) + foto do cliente
    if (refBlob) {
      const refBytes = new Uint8Array(await refBlob.arrayBuffer())
      form.append('image[]', new Blob([refBytes], { type: 'image/jpeg' }), 'reference.jpg')
      form.append('image[]', photoFile, photoFileName)
      console.log(`Usando imagem de referência: ${prompt.reference_image_path}`)
    } else {
      form.append('image', photoFile, photoFileName)
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

    const aiData = await openaiRes.json()
    const b64 = aiData?.data?.[0]?.b64_json
    if (!b64 || typeof b64 !== 'string') {
      return jsonRes({ error: 'OpenAI returned no image' }, 502)
    }

    // ── 7. Decodifica base64 ────────────────────────────────────────
    const binStr = atob(b64)
    let outBytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) outBytes[i] = binStr.charCodeAt(i)

    // ── 7b. Compositing do logo (canto inferior direito) ────────────
    //
    // Em composition mode, logoBytes é sempre null (skipped no bloco 5b),
    // então esse if não executa. Em tag mode, executa se o admin tem
    // logo configurado em admin-logos/.
    //
    if (logoBytes) {
      outBytes = await compositeLogoBottomRight(outBytes, logoBytes)
    }

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
        success:            true,
        mode:               'tag',
        storagePath,
        size:               outBytes.length,
        promptName:         prompt.name,
        usedReferenceImage: !!refBlob,
        usedLogo:           !!logoBytes,
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    //   Caminho COMPOSITION MODE — dois sub-modos:
    //
    //   A) STANDALONE (uploadedImage presente, sem photoId de galeria):
    //      Não sobe pro Drive — não há pasta de cliente associada.
    //      Retorna a imagem como base64 diretamente na resposta.
    //      O frontend (StandaloneAiGenerationPage) guarda em memória e
    //      monta o PDF sem nenhuma chamada de storage.
    //
    //   B) GALERIA (photoId presente, sem uploadedImage):
    //      Comportamento original: sobe pra pasta do cliente no Google Drive.
    //      AiCompositionsManager continua funcionando sem alteração.
    // ═══════════════════════════════════════════════════════════════════

    if (!photoId) {
      // ── Sub-modo A: standalone — sem photoId de galeria, devolve base64 ──
      // Ativado quando a foto veio como uploadedImage sem photoId associado
      // (ex: StandaloneAiGenerationPage, ou upload direto sem galeria).
      // A foto de galeria com driveFileId também chega como uploadedImage
      // (convertida pra PNG no frontend), mas SEMPRE envia photoId junto —
      // por isso essa condição discrimina corretamente os dois casos.
      let b64out = ''
      const chunk = 8192
      for (let i = 0; i < outBytes.length; i += chunk) {
        b64out += String.fromCharCode(...outBytes.subarray(i, i + chunk))
      }
      b64out = btoa(b64out)
      console.log(`Composition standalone: retornando base64 (${outBytes.length} bytes), sem Drive.`)
      return jsonRes({
        success:            true,
        mode:               'composition_standalone',
        imageBase64:        b64out,
        imageMime:          'image/png',
        size:               outBytes.length,
        promptName:         prompt.name,
        usedReferenceImage: !!refBlob,
      })
    }

    // ── Sub-modo B: galeria — upload para Google Drive (fluxo original) ─
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
      usedLogo:           !!logoBytes,
    })

  } catch (err) {
    console.error('Edge function error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return jsonRes({ error: msg }, 500)
  }
})