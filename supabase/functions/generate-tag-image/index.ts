// supabase/functions/generate-tag-image/index.ts
//
// Edge Function: gera uma imagem usando OpenAI gpt-image-1 (/v1/images/edits)
// com base em um prompt salvo + uma foto da galeria do cliente.
//
// COBRANÇA (novo): toda imagem aqui é OpenAI. O guard de billing decide:
//   • super_admin → SEMPRE usa a CHAVE GERAL (secret), sem cota, sem linha
//                    em admin_billing e sem precisar de chave própria.
//   • prepaid  → reserva 1 crédito na cota e usa a CHAVE GERAL (secret).
//                A chave nunca vai pro front; se a cota acabou → 402.
//   • postpaid → não consome cota e usa a chave do próprio admin (como hoje).
//   • Falha na geração depois da reserva → estorna o crédito (conta exata).
//
// Modos de uso (inalterados):
//   ┌─ Modo TAG: body { promptId, clientId, tagId, photoId } → client_tag_values
//   └─ Modo COMPOSITION: body { ..., composition:{compositionId,index} } → Drive
//
// Secrets:
//   OPENAI_API_KEY           (fallback p/ postpaid sem chave própria — legado)
//   GENERAL_OPENAI_API_KEY   (chave geral usada no PREPAID; cai pra OPENAI_API_KEY)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

// ─── Billing helper (embutido — antes em _shared/billing.ts) ───────────
export type Provider = 'openai' | 'gemini'

export class QuotaError extends Error {
  constructor() { super('QUOTA_EXCEEDED'); this.name = 'QuotaError' }
}

export interface BillingDecision {
  /** 'unmetered' = super_admin: chave geral, sem cota, sem reserva/estorno. */
  mode: 'prepaid' | 'postpaid' | 'unmetered'
  remaining?: number
  /** Chave a usar na chamada ao provedor. */
  apiKey: string
  keySource: 'general' | 'admin' | 'env'
}

/**
 * Reserva `count` crédito(s) ANTES de gerar e resolve qual chave usar.
 *  • super_admin → sempre chave geral, sem RPC de cota (não tem linha em
 *                  admin_billing — o próprio SuperAdminPanel esconde esse
 *                  controle pra esse role).
 *  • prepaid  → consome cota + chave geral (secret da edge)
 *  • postpaid → não consome cota + chave do próprio admin (admin_content)
 * Lança QuotaError se a cota pré-paga estourou.
 *
 * @param admin  cliente service_role JÁ existente na edge
 * @param adminId  user.id JÁ verificado pela edge
 * @param role  role do admin (admin_users.role) — usado só pro atalho do super_admin
 */
export async function reserveAndResolveKey(opts: {
  admin: SupabaseClient
  adminId: string
  provider: Provider
  role?: string
  count?: number
}): Promise<BillingDecision> {
  const { admin, adminId, provider, role } = opts
  const count = opts.count ?? 1

  // ── Super admin: sempre chave geral, sem cota, sem chave própria ──────
  if (role === 'super_admin') {
    const general = generalKey(provider)
    if (!general) throw new Error('GENERAL_KEY_NOT_CONFIGURED')
    return { mode: 'unmetered', apiKey: general, keySource: 'general' }
  }

  const { data, error } = await admin.rpc('consume_generation_quota', {
    p_admin_id: adminId, p_provider: provider, p_count: count,
  })
  if (error) {
    if ((error.message || '').includes('QUOTA_EXCEEDED')) throw new QuotaError()
    throw error
  }

  const mode = (data as { mode: 'prepaid' | 'postpaid' }).mode

  if (mode === 'prepaid') {
    const general = generalKey(provider)
    if (!general) throw new Error('GENERAL_KEY_NOT_CONFIGURED')
    return { mode, remaining: (data as any).remaining, apiKey: general, keySource: 'general' }
  }

  // postpaid → chave do próprio admin. Vive no row 'api_keys' (separado do
  // 'settings' por segurança); fallback pro 'settings' durante a transição,
  // e fallback env só pro OpenAI (mantém o comportamento atual).
  const field = provider === 'openai' ? 'openaiApiKey' : 'geminiApiKey'
  let own: unknown
  {
    const { data: kRow } = await admin.from('admin_content').select('content')
      .eq('admin_id', adminId).eq('type', 'api_keys').maybeSingle()
    own = (kRow?.content as any)?.[field]
    if (!(typeof own === 'string' && own.trim())) {
      const { data: sRow } = await admin.from('admin_content').select('content')
        .eq('admin_id', adminId).eq('type', 'settings').maybeSingle()
      own = (sRow?.content as any)?.[field]
    }
  }
  if (typeof own === 'string' && own.trim()) {
    return { mode, apiKey: own.trim(), keySource: 'admin' }
  }
  const env = ownEnvFallback(provider)
  if (env) return { mode, apiKey: env, keySource: 'env' }
  throw new Error('ADMIN_KEY_NOT_CONFIGURED')
}

/** Estorna crédito(s) reservado(s) quando a geração falha. Best-effort. */
export async function refund(opts: {
  admin: SupabaseClient; adminId: string; provider: Provider; count?: number
}): Promise<void> {
  try {
    await opts.admin.rpc('refund_generation_quota', {
      p_admin_id: opts.adminId, p_provider: opts.provider, p_count: opts.count ?? 1,
    })
  } catch { /* não derruba a resposta por causa do estorno */ }
}

function generalKey(p: Provider): string | undefined {
  if (p === 'openai')
    return Deno.env.get('GENERAL_OPENAI_API_KEY')?.trim() || Deno.env.get('OPENAI_API_KEY')?.trim()
  return Deno.env.get('GENERAL_GEMINI_API_KEY')?.trim() || Deno.env.get('GEMINI_API_KEY')?.trim()
}

function ownEnvFallback(_p: Provider): string | undefined {
  // Postpaid sem chave própria → erro explícito (ADMIN_KEY_NOT_CONFIGURED).
  // Sem fallback silencioso pra chave geral — o admin precisa configurar a dele.
  return undefined
}
// ───────────────────────────────────────────────────────────────────────

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
  photoId?:        string
  promptOverride?: string
  tagId?:          string
  composition?:    CompositionRef
  uploadedImage?: {
    base64: string
    mime:   string
  }
}

function safeSlug(s: string, max = 60): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, max) || 'x'
}

// ─── Sniff de formato real da imagem (magic bytes) ──────────────────────
// A OpenAI (/v1/images/edits) devolve "invalid_image_file" tanto para HEIC
// quanto para qualquer imagem cujo conteúdo real não bate com o que foi
// declarado (mime/extensão). Aqui detectamos pelos bytes reais em vez de
// confiar no photo_type do banco ou em valores hardcoded.
type ImgFmt = 'png' | 'jpeg' | 'webp' | 'gif' | 'heic' | 'unknown'

function sniffImageFormat(bytes: Uint8Array): ImgFmt {
  if (bytes.length < 12) return 'unknown'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'webp'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif'
  // ISOBMFF 'ftyp' box no offset 4 + brand heic/heif/mif1/...
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase()
    if (/hei|mif1|msf1|heic|heix|hevc|heim|heis|hevm|hevs/.test(brand)) return 'heic'
  }
  return 'unknown'
}

/**
 * Decodifica e reconstrói a imagem como PNG "de verdade" via imagescript.
 * Isso resolve casos que o sniff de magic bytes não pega: JPEG em CMYK
 * (a OpenAI só aceita RGB), perfis de cor incomuns, ou arquivo com header
 * válido mas conteúdo corrompido no meio. Devolve null se não conseguir
 * decodificar de jeito nenhum (arquivo realmente inválido/corrompido).
 */
async function normalizeToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { Image } = await import('https://deno.land/x/imagescript@1.2.15/mod.ts')
    const img = await Image.decode(bytes)
    return await img.encode() // PNG por padrão — sempre RGB(A) válido
  } catch (err) {
    console.warn('normalizeToPng: falha ao decodificar/reencodar imagem:', err)
    return null
  }
}

async function compositeLogoBottomRight(
  baseBytes: Uint8Array,
  logoBytes: Uint8Array,
): Promise<Uint8Array> {
  try {
    const { Image } = await import('https://deno.land/x/imagescript@1.2.15/mod.ts')
    const baseImg = await Image.decode(baseBytes)
    const logoImg = await Image.decode(logoBytes)
    const maxLogoW = Math.floor(baseImg.width * 0.18)
    if (logoImg.width > maxLogoW) {
      const ratio = maxLogoW / logoImg.width
      logoImg.resize(maxLogoW, Math.max(1, Math.round(logoImg.height * ratio)))
    }
    const padding = 24
    const x = baseImg.width  - logoImg.width  - padding
    const y = baseImg.height - logoImg.height - padding
    baseImg.composite(logoImg, x, y)
    const result = await baseImg.encode()
    console.log(`Logo composto em (${x}, ${y}), ${logoImg.width}x${logoImg.height}px`)
    return result
  } catch (err) {
    console.warn('compositeLogoBottomRight falhou, usando imagem original:', err)
    return baseBytes
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return jsonRes({ error: 'Method not allowed' }, 405)

  // Estorno em caso de exceção pós-reserva (preenchido depois do billing guard).
  let onErrorRefund: null | (() => Promise<void>) = null

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
    const { data: adm } = await admin.from('admin_users').select('id, role').eq('id', user.id).maybeSingle()
    if (!adm) return jsonRes({ error: 'Admin access required' }, 403)

    // ── 2. Parse body ───────────────────────────────────────────────
    const body: Partial<RequestBody> = await req.json().catch(() => ({}))
    const { promptId, clientId, photoId, promptOverride, tagId, composition, uploadedImage } = body

    if (!promptId || !clientId || (!photoId && !uploadedImage?.base64)) {
      return jsonRes({ error: 'Missing required fields: promptId, clientId, and either photoId or uploadedImage' }, 400)
    }

    const isTagMode = typeof tagId === 'string' && tagId.length > 0
    const isCompositionMode = !isTagMode && composition && typeof composition.compositionId === 'string'

    if (!isTagMode && !isCompositionMode) {
      return jsonRes({ error: 'Provide either tagId (tag mode) or composition: { compositionId, index } (composition mode)' }, 400)
    }

    // ── 3. Carrega prompt + foto ────────────────────────────────────
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

    const resolvedPromptText = (promptOverride && promptOverride.trim())
      ? promptOverride.trim()
      : (prompt.prompt || '').trim()

    if (!resolvedPromptText) {
      return jsonRes({
        error: `O texto da parte está vazio. Vá em Prompts IA → edite "${prompt.name}" → preencha o textarea de cada parte.`,
      }, 400)
    }

    if (photoId && (phErr || !photo)) {
      return jsonRes({ error: 'Photo not found' }, 404)
    }

    // ── 4. Obtém a foto como Blob ───────────────────────────────────
    let photoBlob: Blob | null = null
    let photoMime: string = photo?.photo_type || uploadedImage?.mime || 'image/png'
    const photoFileName: string = photo?.photo_name || 'client.png'

    if (uploadedImage?.base64) {
      try {
        const binStr = atob(uploadedImage.base64)
        const bytes  = new Uint8Array(binStr.length)
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
        photoBlob = new Blob([bytes], { type: uploadedImage.mime || 'image/png' })
        photoMime = uploadedImage.mime || 'image/png'
      } catch (decodeErr) {
        return jsonRes({ error: `Falha ao decodificar uploadedImage.base64: ${decodeErr}` }, 400)
      }
    } else if (photo?.storage_path) {
      const { data: sb, error: dlErr } = await admin.storage.from('client-photos').download(photo.storage_path)
      if (dlErr || !sb) {
        return jsonRes({ error: `Failed to download photo: ${dlErr?.message || 'Object not found'}.` }, 500)
      }
      photoBlob = sb
      photoMime = photo.photo_type || sb.type || 'image/jpeg'
    }

    if (!photoBlob) {
      return jsonRes({ error: 'Não foi possível obter a foto.' }, 500)
    }

    // ── 4b. Imagem de referência do prompt (se houver) ──────────────
    let refBlob: Blob | null = null
    if (prompt.reference_image_path) {
      const { data: refData, error: refErr } = await admin.storage
        .from('ai-prompt-references').download(prompt.reference_image_path)
      if (refErr || !refData) {
        console.warn(`Ref do prompt não encontrada (${prompt.reference_image_path}). Gerando sem ela.`)
      } else {
        refBlob = refData
      }
    }

    // ── 4c. Normaliza formato de verdade (decode + reencode) ─────────
    // O sniff de magic bytes só pega HEIC/lixo no header. JPEG em CMYK
    // (comum em fotos de câmera profissional/estúdio — a OpenAI só aceita
    // RGB) ou corrupção no meio do arquivo passam pelo sniff mas ainda
    // quebram na OpenAI com "invalid_image_file". Por isso decodificamos
    // de verdade e reencodamos como PNG antes de enviar.
    const photoSniffBytes = new Uint8Array(await photoBlob.slice(0, 16).arrayBuffer())
    const photoFmt = sniffImageFormat(photoSniffBytes)
    console.log(`[generate-tag-image] foto principal — mime declarado=${photoMime} formato real=${photoFmt} tamanho=${photoBlob.size}`)

    const photoRawBytes = new Uint8Array(await photoBlob.arrayBuffer())
    let photoPngBytes: Uint8Array | null = photoFmt === 'heic' ? null : await normalizeToPng(photoRawBytes)
    console.log(`[generate-tag-image] foto principal — normalização ${photoPngBytes ? 'OK' : 'FALHOU'}${photoFmt === 'heic' ? ' (HEIC, nem tentou)' : ''}`)
    if (!photoPngBytes) {
      return jsonRes({
        error: photoFmt === 'heic'
          ? 'Esta foto está em formato HEIC (comum em fotos de iPhone) e a IA não consegue processá-la. Converta a foto para JPEG ou PNG e tente novamente.'
          : 'Não foi possível processar esta foto (o arquivo pode estar corrompido, incompleto, ou em um modo de cor não suportado como CMYK). Tente reenviar a foto em JPEG ou PNG comum (RGB).',
      }, 400)
    }

    let refPngBytes: Uint8Array | null = null
    if (refBlob) {
      const refSniffBytes = new Uint8Array(await refBlob.slice(0, 16).arrayBuffer())
      const refFmt = sniffImageFormat(refSniffBytes)
      const refRawBytes = new Uint8Array(await refBlob.arrayBuffer())
      refPngBytes = refFmt === 'heic' ? null : await normalizeToPng(refRawBytes)
      console.log(`[generate-tag-image] imagem de referência — path=${prompt.reference_image_path} formato real=${refFmt} normalização ${refPngBytes ? 'OK' : 'FALHOU'}`)
      if (!refPngBytes) {
        console.warn(`Ref do prompt (${prompt.reference_image_path}) inválida/não decodificável. Gerando sem ela.`)
        refBlob = null
      }
    }

    // settingsRow: usado adiante pra pegar o logo (tag mode).
    const { data: settingsRow } = await admin
      .from('admin_content').select('content')
      .eq('admin_id', user.id).eq('type', 'settings').maybeSingle()

    // ── 5. BILLING GUARD (OpenAI) — reserva crédito + resolve chave ──
    let decision
    try {
      decision = await reserveAndResolveKey({ admin, adminId: user.id, provider: 'openai', role: adm.role })
    } catch (e) {
      if (e instanceof QuotaError)
        return jsonRes({ error: 'QUOTA_EXCEEDED', message: 'Seu limite de imagens deste período acabou. Fale com o suporte para liberar mais.' }, 402)
      if (e instanceof Error && e.message === 'ADMIN_KEY_NOT_CONFIGURED')
        return jsonRes({ error: 'Chave da OpenAI não configurada. Vá em Configurações e cole sua chave em "Geração de Imagem OpenAI".' }, 400)
      if (e instanceof Error && e.message === 'GENERAL_KEY_NOT_CONFIGURED')
        return jsonRes({ error: 'Chave geral de geração não configurada no servidor.' }, 500)
      throw e
    }
    const openaiKey = decision.apiKey

    // Estorno (uma única vez) em caso de falha após a reserva.
    // 'unmetered' (super_admin) nunca reservou crédito — nunca estorna.
    let settled = false
    const settleRefund = async () => {
      if (decision!.mode === 'prepaid' && !settled) {
        settled = true
        await refund({ admin, adminId: user.id, provider: 'openai' })
      }
    }
    onErrorRefund = settleRefund
    const bail = async (payload: Record<string, unknown>, status: number) => {
      await settleRefund()
      return jsonRes(payload, status)
    }

    // ── 5b. Logo do admin (SOMENTE em tag mode) ─────────────────────
    let logoBytes: Uint8Array | null = null
    if (isTagMode) {
      const logoPath: string | undefined = (settingsRow?.content as any)?.logoStoragePath
      if (logoPath?.trim()) {
        const { data: logoData, error: logoErr } = await admin.storage
          .from('admin-logos').download(logoPath.trim())
        if (logoErr || !logoData) {
          console.warn(`Logo não encontrado em admin-logos/${logoPath}. Gerando sem ele.`)
        } else {
          logoBytes = new Uint8Array(await logoData.arrayBuffer())
        }
      }
    }

    const finalPromptText = resolvedPromptText
      .split('\n').filter(line => !line.includes('{{Logo}}')).join('\n').trim()

    // ── 6. Chama OpenAI images/edits ────────────────────────────────
    // photoPngBytes/refPngBytes já são PNG normalizado (decode+reencode
    // feito no passo 4c) — sempre RGB(A) válido, sem risco de CMYK/HEIC.
    const photoNameFinal = (photoFileName.replace(/\.[a-zA-Z0-9]+$/, '') || 'client') + '.png'
    const photoFile = new Blob([photoPngBytes], { type: 'image/png' })

    const form = new FormData()
    form.append('model',   prompt.model   || 'gpt-image-1')
    form.append('prompt',  finalPromptText)
    form.append('size',    prompt.size    || '1024x1024')
    form.append('quality', prompt.quality || 'medium')
    form.append('n',       '1')

    if (refBlob && refPngBytes) {
      form.append('image[]', new Blob([refPngBytes], { type: 'image/png' }), 'reference.png')
      form.append('image[]', photoFile, photoNameFinal)
    } else {
      form.append('image', photoFile, photoNameFinal)
    }

    const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body:    form,
    })

    if (!openaiRes.ok) {
      const errText = await openaiRes.text()
      console.error('OpenAI error', openaiRes.status, errText)
      return await bail({ error: `OpenAI API error (${openaiRes.status}): ${errText.slice(0, 400)}` }, 502)
    }

    const aiData = await openaiRes.json()
    const b64 = aiData?.data?.[0]?.b64_json
    if (!b64 || typeof b64 !== 'string') {
      return await bail({ error: 'OpenAI returned no image' }, 502)
    }

    // ── 7. Decodifica base64 ────────────────────────────────────────
    const binStr = atob(b64)
    let outBytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) outBytes[i] = binStr.charCodeAt(i)

    // ── 7b. Compositing do logo (tag mode) ──────────────────────────
    if (logoBytes) {
      outBytes = await compositeLogoBottomRight(outBytes, logoBytes)
    }

    const ts = Date.now()

    // ═══ TAG MODE — Supabase Storage + client_tag_values ═══
    if (isTagMode) {
      const storagePath = `${clientId}/${tagId}_ai_${ts}.png`

      const { data: existing } = await admin
        .from('client_tag_values').select('image_storage_path')
        .eq('client_id', clientId).eq('tag_id', tagId).maybeSingle()
      if (existing?.image_storage_path && existing.image_storage_path !== storagePath) {
        await admin.storage.from('client-tag-images').remove([existing.image_storage_path]).catch(() => {})
      }

      const { error: upErr } = await admin.storage
        .from('client-tag-images')
        .upload(storagePath, outBytes, { contentType: 'image/png', upsert: true })
      if (upErr) return await bail({ error: `Upload failed: ${upErr.message}` }, 500)

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
        return await bail({ error: `DB upsert failed: ${upsertErr.message}` }, 500)
      }

      return jsonRes({
        success: true, mode: 'tag', storagePath,
        size: outBytes.length, promptName: prompt.name,
        usedReferenceImage: !!refBlob, usedLogo: !!logoBytes,
        billing: { mode: decision.mode, remaining: decision.remaining },
      })
    }

    // ═══ COMPOSITION MODE ═══
    if (!photoId) {
      // Sub-modo A: standalone — devolve base64 (sem Drive)
      let b64out = ''
      const chunk = 8192
      for (let i = 0; i < outBytes.length; i += chunk) {
        b64out += String.fromCharCode(...outBytes.subarray(i, i + chunk))
      }
      b64out = btoa(b64out)
      return jsonRes({
        success: true, mode: 'composition_standalone',
        imageBase64: b64out, imageMime: 'image/png',
        size: outBytes.length, promptName: prompt.name,
        usedReferenceImage: !!refBlob,
        billing: { mode: decision.mode, remaining: decision.remaining },
      })
    }

    // Sub-modo B: galeria — upload pro Google Drive
    const compId   = safeSlug(composition!.compositionId, 80)
    const idx      = Number.isFinite(composition!.index) ? Math.max(0, Math.floor(composition!.index)) : 0
    const idxStr   = String(idx).padStart(3, '0')
    const safeName = `${safeSlug(prompt.name, 40)}_${compId}_${idxStr}_${ts}.png`

    const driveForm = new FormData()
    driveForm.append('kind', 'composition')
    driveForm.append('client_id', clientId)
    driveForm.append('composition_index', String(idx))
    driveForm.append('file', new Blob([outBytes], { type: 'image/png' }), safeName)

    const driveRes = await fetch(`${supabaseUrl}/functions/v1/drive/upload`, {
      method: 'POST',
      headers: { Authorization: authHeader },
      body:    driveForm,
    })

    if (!driveRes.ok) {
      const errJson = await driveRes.json().catch(() => ({}))
      const errMsg  = (errJson as any)?.error ?? `HTTP ${driveRes.status}`
      console.error(`Drive upload failed (composition): ${errMsg}`)
      return await bail({ error: `Drive upload failed: ${errMsg}` }, 500)
    }

    const driveData = await driveRes.json() as {
      ok: boolean; driveFileId: string; driveFolderId: string
      photoName: string; url: string; downloadUrl: string
    }

    return jsonRes({
      success: true, mode: 'composition',
      driveFileId: driveData.driveFileId, driveFolderId: driveData.driveFolderId,
      photoName: driveData.photoName, url: driveData.url, downloadUrl: driveData.downloadUrl,
      size: outBytes.length, promptName: prompt.name,
      usedReferenceImage: !!refBlob, usedLogo: !!logoBytes,
      billing: { mode: decision.mode, remaining: decision.remaining },
    })

  } catch (err) {
    console.error('Edge function error:', err)
    if (onErrorRefund) { try { await onErrorRefund() } catch { /* ignore */ } }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return jsonRes({ error: msg }, 500)
  }
})