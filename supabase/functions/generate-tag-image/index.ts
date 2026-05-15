// supabase/functions/generate-tag-image/index.ts
//
// Edge Function: gera uma imagem para um client_tag_value usando OpenAI
// gpt-image-1 (endpoint /v1/images/edits) com base em um prompt salvo +
// uma foto da galeria do cliente.
//
// Deploy:
//   supabase functions deploy generate-tag-image
//
// Secrets necessárias (executar UMA vez no projeto):
//   supabase secrets set OPENAI_API_KEY=sk-...
//
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_ANON_KEY já são
// injetadas automaticamente pelo runtime das Functions.
//
// Auth: o caller precisa ser um admin (verificado contra admin_users).
//
// Fluxo:
//   1. Valida admin (JWT do header Authorization).
//   2. Carrega prompt (ai_image_prompts), foto (client_photos).
//   3. Baixa bytes da foto do bucket client-photos.
//   4. Manda pra OpenAI /v1/images/edits com gpt-image-1 + prompt.
//   5. Sobe o resultado em client-tag-images/{clientId}/{tagId}_ai_{ts}.png
//      (apagando o arquivo antigo da mesma tag, se houver).
//   6. Upserta client_tag_values com image_storage_path apontando pro novo.
//   7. Retorna { storagePath, size }.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"
import { decode, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts"

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

interface RequestBody {
  promptId: string
  clientId: string
  tagId:    string
  photoId:  string
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
    const { promptId, clientId, tagId, photoId } = body
    if (!promptId || !clientId || !tagId || !photoId) {
      return jsonRes({ error: 'Missing required fields: promptId, clientId, tagId, photoId' }, 400)
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
    if (pErr || !prompt)  return jsonRes({ error: 'Prompt not found' }, 404)
    if (!prompt.is_active) return jsonRes({ error: 'Prompt is inactive' }, 400)
    if (phErr || !photo)   return jsonRes({ error: 'Photo not found' }, 404)

    // ── 4. Baixa a foto do storage ──────────────────────────────────
    const { data: photoBlob, error: dlErr } = await admin.storage
      .from('client-photos')
      .download(photo.storage_path)
    if (dlErr || !photoBlob) {
      return jsonRes({ error: `Failed to download photo: ${dlErr?.message || 'unknown'}` }, 500)
    }

    // ── 5. Chama OpenAI images/edits ───────────────────────────────
    //
    //  A chave OpenAI vem das CONFIGURAÇÕES PESSOAIS do admin chamador
    //  (admin_content.content.openaiApiKey), pra cada admin usar o próprio
    //  crédito. Fallback: variável de ambiente OPENAI_API_KEY (caso a
    //  instalação tenha uma chave compartilhada configurada via Secrets).
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
        error: 'Chave da OpenAI não configurada. Vá em Configurações e cole sua chave em "Geração de Imagem OpenAI".'
      }, 400)
    }

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

    // ── 6. Decodifica base64 e sobe ─────────────────────────────────
    const binStr = atob(b64)
    const outBytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) outBytes[i] = binStr.charCodeAt(i)

    // Path: client-tag-images/{clientId}/{tagId}_ai_{timestamp}.png
    const ts = Date.now()
    const storagePath = `${clientId}/${tagId}_ai_${ts}.png`

    // Remove arquivo antigo se houver (mesma tag pra mesmo cliente)
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

    // ── 7. Upserta client_tag_values ───────────────────────────────
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
      // Tenta reverter o upload pra não deixar lixo
      await admin.storage.from('client-tag-images').remove([storagePath]).catch(() => {})
      return jsonRes({ error: `DB upsert failed: ${upsertErr.message}` }, 500)
    }

    return jsonRes({ success: true, storagePath, size: outBytes.length, promptName: prompt.name })

  } catch (err) {
    console.error('Edge function error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return jsonRes({ error: msg }, 500)
  }
})