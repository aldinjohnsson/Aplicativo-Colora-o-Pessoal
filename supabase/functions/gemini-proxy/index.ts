// supabase/functions/gemini-proxy/index.ts
//
// Edge Function que faz proxy de TODAS as chamadas ao Gemini, mantendo a
// API key 100% no servidor. O navegador (admin ou portal da cliente) nunca
// mais recebe a chave.
//
// ════════════════════════════════════════════════════════════════════════
// COMO RESOLVE A CHAVE (multi-tenant, sem migração de dados)
// ════════════════════════════════════════════════════════════════════════
// A chave continua exatamente onde sempre esteve: admin_content
// (type='settings', content.geminiApiKey), uma por admin. Esta função lê
// a MESMA chave com service role. Nenhum admin precisa reconfigurar nada.
//
//   • Contexto ADMIN  → resolve admin_id pelo JWT (Authorization header).
//   • Contexto CLIENTE → resolve admin_id via clients.admin_id usando o
//                        portalToken enviado pelo front.
//
// ════════════════════════════════════════════════════════════════════════
// CONTRATO (POST /functions/v1/gemini-proxy)
// ════════════════════════════════════════════════════════════════════════
//   body: {
//     action: 'chat' | 'translate' | 'translateBatch',
//     portalToken?: string,          // presente => contexto cliente
//     payload: { ... }               // específico por action
//   }
//
//   action 'chat'         → payload = params de chatWithGemini (sem apiKey)
//                           resposta: { parts, raw, imageGenerationFailed, modelUsed }
//   action 'translate'    → payload = { text, targetLanguage }
//                           resposta: { text }
//   action 'translateBatch' → payload = { texts: string[], targetLanguage }
//                           resposta: { texts: string[] }
//
// Deploy:
//   supabase functions deploy gemini-proxy
//
// Secrets necessários (já existem no projeto Supabase por padrão):
//   SUPABASE_URL              (auto)
//   SUPABASE_SERVICE_ROLE_KEY (auto)
// ════════════════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ──────────────────────────────────────────────────────────────
// Config (espelha geminiService.ts)
// ──────────────────────────────────────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const GEMINI_MODELS = {
  IMAGE_GEN: 'gemini-2.5-flash-image',
  IMAGE_GEN_FALLBACK: 'gemini-3.1-flash-image-preview',
  TEXT_ONLY: 'gemini-2.5-flash',
} as const

const TRANSLATE_MAX_OUTPUT_TOKENS = 8192
const BATCH_SEPARATOR = '===BLOCK#7K9X==='
const BATCH_SEPARATOR_RE = /\n*===BLOCK#7K9X===\n*/g

const FETCH_TIMEOUT_MS = 60_000
const NO_RETRY_FINISH_REASONS = new Set(['IMAGE_SAFETY', 'SAFETY', 'RECITATION', 'OTHER'])

// Logs server-side só quando explicitamente ligado via secret DEBUG_GEMINI=true.
// Nunca loga a chave.
const DEBUG = Deno.env.get('DEBUG_GEMINI') === 'true'

// ──────────────────────────────────────────────────────────────
// CORS — restrinja em produção trocando '*' pelo seu domínio.
// Mantido permissivo aqui porque o portal da cliente é público;
// a autorização real é feita pelo portalToken / JWT, não pela origem.
// ──────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  // Produção — adicione AQUI todo domínio que serve o app:
  'https://www.iacolor.online',
  'https://iacolor.online',
  'https://painel.mariliasantoscolor.com.br',
  // 'https://OUTRO_DOMINIO.com.br',   // ← descomente/adicione se houver mais

  // Desenvolvimento local (Vite). Ajuste a porta se a sua for diferente.
  'http://localhost:5173',
  'http://localhost:3000',
]

function corsHeaders(origin: string | null) {
  // Ecoa a origem se estiver na allowlist; senão usa o domínio principal.
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

// ──────────────────────────────────────────────────────────────
// Tipos (espelham geminiService.ts)
// ──────────────────────────────────────────────────────────────

interface GeminiMessage { role: 'user' | 'model'; text: string }
interface GeminiResponsePart { type: 'text' | 'image'; text?: string; imageBase64?: string; imageMimeType?: string }
interface MaterialData { base64: string; mimeType: string }

// ──────────────────────────────────────────────────────────────
// Helpers de infra
// ──────────────────────────────────────────────────────────────

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function adminSb(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const jitter = () => Math.random() * 800

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// ──────────────────────────────────────────────────────────────
// Resolução da chave (service role) — mesma chave dos admins atuais
// ──────────────────────────────────────────────────────────────

async function getAuthUserId(req: Request, sb: SupabaseClient): Promise<string | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user.id
}

async function resolveGeminiKey(req: Request, portalToken: string | undefined): Promise<string> {
  const sb = adminSb()

  let adminId: string | null = null

  if (portalToken) {
    // Contexto cliente: resolve o admin dono via clients.admin_id.
    const { data: client } = await sb
      .from('clients')
      .select('admin_id')
      .eq('token', portalToken)
      .maybeSingle()
    if (!client?.admin_id) throw new Error('Token de portal inválido.')
    adminId = client.admin_id as string
  } else {
    // Contexto admin: resolve pelo JWT.
    adminId = await getAuthUserId(req, sb)
    if (!adminId) throw new Error('Não autenticado.')
  }

  const { data: row } = await sb
    .from('admin_content')
    .select('content')
    .eq('admin_id', adminId)
    .eq('type', 'settings')
    .maybeSingle()

  const key = (row?.content as any)?.geminiApiKey || ''
  if (!key) throw new Error('Chave da API Gemini não configurada para este admin.')
  return key
}

// ──────────────────────────────────────────────────────────────
// Parsing de erro (espelha geminiService.ts)
// ──────────────────────────────────────────────────────────────

interface ParsedError {
  status: number
  message: string
  retryAfterSec?: number
  isDailyQuota: boolean
  isSafetyBlock: boolean
  isFreeTierBug: boolean
}

async function parseError(res: Response): Promise<ParsedError> {
  const status = res.status
  const retryAfterHeader = res.headers.get('Retry-After')
  const retryAfterSec = retryAfterHeader ? (parseInt(retryAfterHeader, 10) || undefined) : undefined

  let body: any = {}
  try { body = await res.clone().json() } catch {}

  const message = body?.error?.message || `HTTP ${status}`
  const details: any[] = body?.error?.details || []
  const quotaFailure = details.find(d => d['@type']?.includes('QuotaFailure'))
  const quotaMetric = quotaFailure?.violations?.[0]?.quotaMetric as string | undefined

  const isDailyQuota = !!quotaMetric?.includes('per_day') || !!quotaMetric?.includes('per_day_per_model')
  const isFreeTierBug = !!quotaMetric?.includes('free_tier')
  const isSafetyBlock = /safety|blocked|recitation/i.test(message)

  if (DEBUG && status >= 400) console.error('[Gemini error]', { status, quotaMetric, retryAfterSec, message })

  return { status, message, retryAfterSec, isDailyQuota, isSafetyBlock, isFreeTierBug }
}

// ──────────────────────────────────────────────────────────────
// Parsing de resposta (espelha geminiService.ts)
// ──────────────────────────────────────────────────────────────

function parseResp(data: any): GeminiResponsePart[] {
  const parts: GeminiResponsePart[] = []
  for (const c of data?.candidates || []) {
    for (const p of c?.content?.parts || []) {
      if (p.text) parts.push({ type: 'text', text: p.text })
      const d = p.inline_data || p.inlineData
      if (d) parts.push({ type: 'image', imageBase64: d.data, imageMimeType: d.mime_type || d.mimeType })
    }
  }
  return parts
}

function addNotice(parts: GeminiResponsePart[]): GeminiResponsePart[] {
  if (parts.some(p => p.type === 'image')) return parts
  const cleaned = parts
    .map(p => {
      if (p.type !== 'text' || !p.text) return p
      let t = p.text
      for (const r of [/aqui est[áa] a (visualiza[çc][ãa]o|imagem|foto)[^.]*[.:!]?\s*/gi, /preparei uma imagem[^.]*[.!]?\s*/gi]) {
        t = t.replace(r, '')
      }
      return { ...p, text: t.trim() }
    })
    .filter(p => p.type !== 'text' || p.text?.trim())
  if (!cleaned.some(p => p.text?.includes('⚠️'))) {
    cleaned.push({ type: 'text', text: '\n\n⚠️ Geração de imagem indisponível. Tente novamente.' })
  }
  return cleaned
}

// Remove o base64 das imagens do `raw` antes de devolver pro front —
// o front só usa raw.candidates[0].finishReason (debug). Evita trafegar
// a imagem duplicada (uma vez em parts, outra em raw).
function lightRaw(data: any): any {
  try {
    return {
      candidates: (data?.candidates || []).map((c: any) => ({
        finishReason: c?.finishReason,
      })),
    }
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────────────────────
// Geração de imagem com retry/fallback (espelha callImageModel)
// ──────────────────────────────────────────────────────────────

async function callImageModel(
  model: string,
  apiKey: string,
  body: any,
  maxAttempts = 3,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<{ parts: GeminiResponsePart[]; raw: any } | null> {
  const BASE_DELAY = 1500
  let okButNoImageCount = 0

  for (let a = 0; a < maxAttempts; a++) {
    if (a > 0) {
      const delay = Math.min(BASE_DELAY * Math.pow(2, a - 1), 6000) + jitter()
      await sleep(delay)
    }

    try {
      const res = await fetchWithTimeout(
        `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        timeoutMs,
      )

      if (res.ok) {
        const data = await res.json()
        const finishReason = data?.candidates?.[0]?.finishReason as string | undefined

        if (finishReason && NO_RETRY_FINISH_REASONS.has(finishReason)) {
          if (DEBUG) console.warn(`[${model}] finishReason=${finishReason} — abortando`)
          return null
        }

        const parts = parseResp(data)
        if (parts.some(p => p.type === 'image' && p.imageBase64)) {
          return { parts, raw: data }
        }

        okButNoImageCount++
        if (DEBUG) console.warn(`[${model}] 200 OK sem imagem (tentativa ${a + 1}, finishReason=${finishReason || 'none'})`)
        if (okButNoImageCount >= 2) return null
        continue
      }

      const err = await parseError(res)
      if (err.isDailyQuota) { if (DEBUG) console.warn(`[${model}] quota diária estourada`); return null }
      if (err.isFreeTierBug) { if (DEBUG) console.warn(`[${model}] free_tier quota`); return null }
      if (res.status === 429 && err.retryAfterSec) { await sleep(err.retryAfterSec * 1000 + jitter()); continue }
      if (res.status === 429 || res.status === 503) continue

      if (DEBUG) console.error(`[${model}] erro fatal ${res.status}: ${err.message}`)
      return null
    } catch (e: any) {
      if (DEBUG) console.warn(`[${model}] erro de rede/timeout (tentativa ${a + 1}):`, e?.message || e)
    }
  }

  return null
}

// ──────────────────────────────────────────────────────────────
// CHAT (espelha chatWithGemini)
// ──────────────────────────────────────────────────────────────

interface ChatParams {
  systemPrompt?: string
  history: GeminiMessage[]
  userText: string
  userImageBase64?: string
  userImageMimeType?: string
  referencePhotoBase64?: string
  referencePhotoMimeType?: string
  materials?: MaterialData[]
  forceImage?: boolean
  clientFirst?: boolean
}

async function doChat(apiKey: string, p: ChatParams) {
  const {
    systemPrompt, history, userText,
    userImageBase64, userImageMimeType = 'image/jpeg',
    referencePhotoBase64, referencePhotoMimeType = 'image/jpeg',
    materials = [], forceImage = false, clientFirst = false,
  } = p

  const wantsImage = forceImage

  const contents: any[] = history.map(m => ({ role: m.role, parts: [{ text: m.text || ' ' }] }))
  const userParts: any[] = []

  if (clientFirst && wantsImage) {
    if (referencePhotoBase64) userParts.push({ inline_data: { mime_type: referencePhotoMimeType, data: referencePhotoBase64 } })
    for (const mat of materials) userParts.push({ inline_data: { mime_type: mat.mimeType, data: mat.base64 } })
    if (userImageBase64) userParts.push({ inline_data: { mime_type: userImageMimeType, data: userImageBase64 } })
  } else {
    for (const mat of materials) userParts.push({ inline_data: { mime_type: mat.mimeType, data: mat.base64 } })
    if (wantsImage && referencePhotoBase64) userParts.push({ inline_data: { mime_type: referencePhotoMimeType, data: referencePhotoBase64 } })
    if (userImageBase64) userParts.push({ inline_data: { mime_type: userImageMimeType, data: userImageBase64 } })
  }

  let finalText = userText
  if (materials.length > 0) finalText += '\n\n[INSTRUÇÃO: Use os materiais anexados como base para sua resposta.]'
  if (wantsImage && referencePhotoBase64) finalText += '\n\n[INSTRUÇÃO: A ÚLTIMA imagem enviada é a foto da cliente — ela é a BASE OBRIGATÓRIA. Preserve o rosto, feições, tom de pele e EXATAMENTE o mesmo enquadramento, zoom e composição. NÃO recorte o busto. NÃO reposicione a cliente. Aplique SOMENTE o acessório/alteração descrito. GERE IMAGEM.]'

  userParts.push({ text: finalText })
  contents.push({ role: 'user', parts: userParts })

  const sys = systemPrompt?.trim() ? { parts: [{ text: systemPrompt }] } : undefined

  const imgSys = {
    parts: [{
      text: `TAREFA: GERAÇÃO DE IMAGEM. Você é um modelo de edição de imagem. Sua única saída deve ser uma imagem gerada — NÃO escreva texto descritivo, NÃO comente, NÃO se apresente. Apenas gere a imagem solicitada.

REGRA DE IDENTIDADE: Use a foto da cliente como base obrigatória. Preserve o rosto real, feições, tom de pele, olhos e expressão. Aplique SOMENTE o que for descrito no prompt (cabelo, roupa, acessório, etc.). Nunca substitua ou idealize o rosto.

REGRA DE COMPOSIÇÃO: Mantenha EXATAMENTE o mesmo enquadramento, recorte, zoom e composição da foto original. NÃO aproxime o zoom. NÃO recorte o busto. NÃO reposicione a cliente.`,
    }],
  }

  let imgFailed = false

  // ── GERAR IMAGEM ───────────────────────────────────────────
  if (wantsImage) {
    const imgUserParts: any[] = []
    if (clientFirst) {
      if (referencePhotoBase64) imgUserParts.push({ inline_data: { mime_type: referencePhotoMimeType, data: referencePhotoBase64 } })
      for (const mat of materials) imgUserParts.push({ inline_data: { mime_type: mat.mimeType, data: mat.base64 } })
      if (userImageBase64) imgUserParts.push({ inline_data: { mime_type: userImageMimeType, data: userImageBase64 } })
    } else {
      for (const mat of materials) imgUserParts.push({ inline_data: { mime_type: mat.mimeType, data: mat.base64 } })
      if (referencePhotoBase64) imgUserParts.push({ inline_data: { mime_type: referencePhotoMimeType, data: referencePhotoBase64 } })
      if (userImageBase64) imgUserParts.push({ inline_data: { mime_type: userImageMimeType, data: userImageBase64 } })
    }

    const imperative = `GERE A IMAGEM aplicando o seguinte na foto da cliente (a foto da cliente é a ${clientFirst ? 'PRIMEIRA' : 'ÚLTIMA'} imagem enviada):

${userText}

NÃO escreva texto. NÃO comente. NÃO se apresente. Apenas devolva a IMAGEM gerada.`
    imgUserParts.push({ text: imperative })

    const imgContents = [{ role: 'user', parts: imgUserParts }]

    // camelCase OBRIGATÓRIO dentro de generationConfig (snake_case é ignorado).
    const imgBody: any = {
      contents: imgContents,
      systemInstruction: imgSys,
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        temperature: 0.4,
        maxOutputTokens: 8192,
        candidateCount: 1,
        imageConfig: { imageSize: '2K', aspectRatio: '3:4' },
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }

    // Nota: a fila global (queueImageRequest) do front serializa requests
    // numa mesma aba. No servidor cada invocação é isolada; o controle de
    // rate fica por conta do retry/backoff em 429 abaixo.
    let imgResult = await callImageModel(GEMINI_MODELS.IMAGE_GEN, apiKey, imgBody, 3, 60_000)
    let modelUsed: string = GEMINI_MODELS.IMAGE_GEN
    if (!imgResult) {
      if (DEBUG) console.warn(`[Gemini] principal falhou, fallback ${GEMINI_MODELS.IMAGE_GEN_FALLBACK}`)
      imgResult = await callImageModel(GEMINI_MODELS.IMAGE_GEN_FALLBACK, apiKey, imgBody, 2, 90_000)
      modelUsed = GEMINI_MODELS.IMAGE_GEN_FALLBACK
    }

    if (imgResult) {
      return {
        parts: imgResult.parts,
        raw: lightRaw(imgResult.raw),
        imageGenerationFailed: false,
        modelUsed,
      }
    }

    imgFailed = true
  }

  // ── TEXTO PURO ─────────────────────────────────────────────
  const tc = contents.map((c, i) => {
    if (i < contents.length - 1) return c
    return {
      ...c,
      parts: c.parts.map((part: any) => {
        if (!part.text) return part
        let t = part.text.replace(/\[INSTRUÇÃO[^\]]*\]/g, '').trim()
        if (imgFailed) t += '\n\n[SISTEMA: Imagem indisponível. Responda com texto. Avise: "⚠️ Geração de imagem indisponível."]'
        if (!wantsImage) t += `\n\n[SISTEMA: Responda EXCLUSIVAMENTE com base nos materiais da consultoria, cartela de cores, documentos e observações da cliente. NÃO use conhecimento externo. Se a informação não estiver nos materiais, diga que precisa consultar a consultora Marília.
      REGRA DE FORMATAÇÃO CRÍTICA: Quando apresentar conteúdo de documentos como dossiês, referências de tinta, fichas técnicas ou listas — reproduza a estrutura e formatação EXATAMENTE como está no documento original. Preserve emojis, quebras de linha, marcadores (•, ✔, 🎯, 📌 etc.), hierarquia e espaçamentos. NÃO reformule em parágrafos corridos. NÃO parafraseie. Copie a estrutura fiel.]`
        return { ...part, text: t }
      }),
    }
  })

  const tb: any = {
    contents: tc,
    generationConfig: { temperature: 0.5, maxOutputTokens: 8192 },
  }
  if (sys) tb.systemInstruction = sys

  let res: Response | null = null
  for (let a = 0; a < 3; a++) {
    if (a > 0) await sleep(Math.min(1500 * Math.pow(2, a - 1), 6000) + jitter())
    try {
      res = await fetchWithTimeout(
        `${GEMINI_BASE}/models/${GEMINI_MODELS.TEXT_ONLY}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tb) },
        FETCH_TIMEOUT_MS,
      )
      if (res.ok) break
      if (res.status !== 429 && res.status !== 503) break
    } catch {
      if (a === 2) throw new Error('Erro de conexão com a IA.')
    }
  }

  if (!res || !res.ok) {
    const err = res ? await parseError(res) : null
    if (err?.isDailyQuota) throw new Error('Cota diária da IA atingida. Tente amanhã.')
    if (err?.isFreeTierBug) throw new Error('Chave da API sem billing ativo ou cota free_tier. Verifique a configuração.')
    if (err && (err.status === 429 || err.status === 503)) throw new Error('IA sobrecarregada. Aguarde um momento.')
    throw new Error(err?.message || 'Erro ao contatar a IA.')
  }

  const data = await res.json()
  const parts = parseResp(data)
  return {
    parts: imgFailed ? addNotice(parts) : parts,
    raw: lightRaw(data),
    imageGenerationFailed: imgFailed,
    modelUsed: GEMINI_MODELS.TEXT_ONLY,
  }
}

// ──────────────────────────────────────────────────────────────
// TRADUÇÃO (espelha translateText / translateTexts)
// ──────────────────────────────────────────────────────────────

async function doTranslateText(apiKey: string, text: string, targetLanguage: string): Promise<string> {
  if (!text?.trim() || targetLanguage === 'pt-BR') return text
  try {
    const body = {
      contents: [{ role: 'user', parts: [{ text: `Translate the following text to ${targetLanguage}.\nReturn ONLY the translated text — no explanations, no quotes, no preamble. Preserve line breaks and punctuation exactly.\n\n${text}` }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: TRANSLATE_MAX_OUTPUT_TOKENS },
    }
    const res = await fetchWithTimeout(
      `${GEMINI_BASE}/models/${GEMINI_MODELS.TEXT_ONLY}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      30_000,
    )
    if (!res.ok) return text
    const data = await res.json()
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    const finishReason: string | undefined = data?.candidates?.[0]?.finishReason

    if (finishReason === 'MAX_TOKENS' && text.length > 240) {
      const mid = Math.floor(text.length / 2)
      const nlIdx = text.lastIndexOf('\n', mid)
      const splitAt = nlIdx > text.length * 0.2 ? nlIdx : mid
      const [aRaw, bRaw] = [text.slice(0, splitAt), text.slice(splitAt)]
      const [a, b] = await Promise.all([
        doTranslateText(apiKey, aRaw, targetLanguage),
        doTranslateText(apiKey, bRaw, targetLanguage),
      ])
      return aRaw.endsWith('\n') || bRaw.startsWith('\n') ? `${a}\n${b.replace(/^\n+/, '')}` : `${a}${b}`
    }
    return out || text
  } catch {
    return text
  }
}

async function doTranslateTexts(apiKey: string, texts: string[], targetLanguage: string): Promise<string[]> {
  if (targetLanguage === 'pt-BR' || texts.length === 0) return [...texts]
  if (texts.length === 1) return [await doTranslateText(apiKey, texts[0] ?? '', targetLanguage)]

  const live = texts.map((t, i) => ({ t: t ?? '', i })).filter(x => x.t.trim().length > 0)
  if (live.length === 0) return [...texts]
  if (live.length === 1) {
    const out = [...texts]
    out[live[0].i] = await doTranslateText(apiKey, live[0].t, targetLanguage)
    return out
  }

  const sep = `\n${BATCH_SEPARATOR}\n`
  const joined = live.map(x => x.t).join(sep)

  const fallback = async (): Promise<string[]> => {
    const out = [...texts]
    await Promise.all(live.map(async x => { out[x.i] = await doTranslateText(apiKey, x.t, targetLanguage) }))
    return out
  }

  try {
    const promptText =
      `Translate each of the ${live.length} text blocks below to ${targetLanguage}.\n` +
      `The blocks are separated by a line containing exactly "${BATCH_SEPARATOR}".\n` +
      `Return ONLY the translations, in the SAME ORDER, separated by the EXACT SAME line "${BATCH_SEPARATOR}".\n` +
      `Preserve line breaks and punctuation WITHIN each block. Do not add explanations, quotes, or preamble.\n` +
      `Do not merge blocks. Do not skip blocks. The number of separators in your output must be exactly ${live.length - 1}.\n\n` +
      joined

    const body = {
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: TRANSLATE_MAX_OUTPUT_TOKENS },
    }
    const res = await fetchWithTimeout(
      `${GEMINI_BASE}/models/${GEMINI_MODELS.TEXT_ONLY}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      45_000,
    )
    if (!res.ok) return fallback()
    const data = await res.json()
    const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    const finishReason: string | undefined = data?.candidates?.[0]?.finishReason
    if (!raw || finishReason === 'MAX_TOKENS') return fallback()

    const parts = raw.split(BATCH_SEPARATOR_RE).map(p => p.trim()).filter(p => p.length > 0)
    if (parts.length !== live.length) return fallback()

    const out = [...texts]
    live.forEach((x, k) => { out[x.i] = parts[k] || x.t })
    return out
  } catch {
    return fallback()
  }
}

// ──────────────────────────────────────────────────────────────
// HANDLER
// ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido' }, 405, origin)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400, origin)
  }

  const action: string = body?.action
  const portalToken: string | undefined = body?.portalToken || undefined
  const payload: any = body?.payload ?? {}

  if (!action) return json({ error: 'action obrigatório' }, 400, origin)

  // Resolve a chave do admin dono (JWT ou portalToken).
  let apiKey: string
  try {
    apiKey = await resolveGeminiKey(req, portalToken)
  } catch (e: any) {
    // 401 pra auth/token, mantém a mensagem clara pro front exibir.
    const msg = e?.message || 'Falha ao resolver credenciais.'
    const status = /não autenticado|inválido/i.test(msg) ? 401 : 412
    return json({ error: msg }, status, origin)
  }

  try {
    if (action === 'chat') {
      const result = await doChat(apiKey, payload as ChatParams)
      return json(result, 200, origin)
    }
    if (action === 'translate') {
      const out = await doTranslateText(apiKey, payload.text ?? '', payload.targetLanguage ?? 'pt-BR')
      return json({ text: out }, 200, origin)
    }
    if (action === 'translateBatch') {
      const out = await doTranslateTexts(apiKey, payload.texts ?? [], payload.targetLanguage ?? 'pt-BR')
      return json({ texts: out }, 200, origin)
    }
    return json({ error: `action desconhecida: ${action}` }, 400, origin)
  } catch (e: any) {
    return json({ error: e?.message || 'Erro interno no proxy Gemini.' }, 500, origin)
  }
})