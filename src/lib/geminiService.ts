// src/lib/geminiService.ts
// GEMINI ONLY — refatorado com:
//   • Fila global para requisições de imagem (evita picos simultâneos)
//   • Retry com backoff exponencial + jitter + respeito ao Retry-After
//   • Parsing do motivo REAL do 429 (quotaMetric) para log e decisão
//   • Fallback automático para modelo de imagem alternativo quando o principal falha
//   • Cache de API key com TTL de 5min

import { supabase } from './supabase'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const GEMINI_MODELS = {
  IMAGE_GEN: 'gemini-2.0-flash-preview-image-generation',
  IMAGE_GEN_FALLBACK: 'gemini-2.5-flash-preview-04-17', // fallback real com suporte a imagem
  TEXT_ONLY: 'gemini-2.5-flash',
} as const

// Flag para ligar/desligar logs detalhados em produção
const DEBUG = false

export interface GeminiMessage { role: 'user' | 'model'; text: string }
export interface GeminiResponsePart { type: 'text' | 'image'; text?: string; imageBase64?: string; imageMimeType?: string }
export interface GeminiResponse { parts: GeminiResponsePart[]; raw: any; imageGenerationFailed: boolean; modelUsed?: string }
export interface MaterialData { base64: string; mimeType: string }

// ──────────────────────────────────────────────────────────────
// 1. CACHE DA API KEY (inalterado)
// ──────────────────────────────────────────────────────────────

let _cachedApiKey: string | null = null
let _cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

export async function getGeminiApiKey(): Promise<string> {
  if (_cachedApiKey !== null && Date.now() - _cacheTime < CACHE_TTL) return _cachedApiKey

  try {
    const { data } = await supabase.from('admin_content').select('content').eq('type', 'settings').maybeSingle()
    const key = (data?.content as any)?.geminiApiKey || ''
    if (key) { _cachedApiKey = key; _cacheTime = Date.now(); return key }
  } catch {}

  try {
    const key = JSON.parse(localStorage.getItem('app-settings') || '{}')?.geminiApiKey || ''
    _cachedApiKey = key; _cacheTime = Date.now()
    return key
  } catch { return '' }
}

export function invalidateGeminiKeyCache() { _cachedApiKey = null; _cacheTime = 0 }

// ──────────────────────────────────────────────────────────────
// 2. HELPERS DE ARQUIVO (inalterados)
// ──────────────────────────────────────────────────────────────

export async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ base64: (r.result as string).split(',')[1], mimeType: file.type || 'image/jpeg' }); r.onerror = rej; r.readAsDataURL(file) })
}

export async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try { const blob = await (await fetch(url)).blob(); return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ base64: (r.result as string).split(',')[1], mimeType: blob.type || 'image/jpeg' }); r.onerror = rej; r.readAsDataURL(blob) }) } catch { return null }
}

// ──────────────────────────────────────────────────────────────
// 3. FILA GLOBAL DE IMAGEM
// Serializa requisições de geração de imagem para evitar picos
// que disparam o bug esporádico de 429 no Paid Tier 1.
// ──────────────────────────────────────────────────────────────

let _imgQueue: Promise<any> = Promise.resolve()
const IMG_MIN_GAP_MS = 6000 // ~10 imgs/min — margem segura para evitar 429 em rajadas

function queueImageRequest<T>(fn: () => Promise<T>): Promise<T> {
  const run = _imgQueue.then(async () => {
    const start = Date.now()
    try { return await fn() }
    finally {
      const elapsed = Date.now() - start
      if (elapsed < IMG_MIN_GAP_MS) await new Promise(r => setTimeout(r, IMG_MIN_GAP_MS - elapsed))
    }
  })
  _imgQueue = run.catch(() => {}) // fila não quebra em erro
  return run
}

// ──────────────────────────────────────────────────────────────
// 4. PARSING INTELIGENTE DE ERRO
// Extrai o motivo real do 429/5xx para decidir se vale retry
// ──────────────────────────────────────────────────────────────

interface ParsedError {
  status: number
  message: string
  quotaMetric?: string    // ex: "generativelanguage.googleapis.com/generate_requests_per_model_per_day"
  retryAfterSec?: number  // segundos sugeridos pelo servidor
  finishReason?: string   // IMAGE_SAFETY, SAFETY, etc.
  isDailyQuota: boolean   // true se estourou RPD (não adianta retry)
  isSafetyBlock: boolean  // true se foi bloqueio de segurança
  isFreeTierBug: boolean  // true se Tier 1 foi roteado como free_tier (bug conhecido)
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
  const isFreeTierBug = !!quotaMetric?.includes('free_tier') // bug conhecido de Paid Tier 1
  const isSafetyBlock = /safety|blocked|recitation/i.test(message)

  if (DEBUG && status >= 400) {
    console.error('[Gemini error]', { status, quotaMetric, retryAfterSec, message })
  }

  return { status, message, quotaMetric, retryAfterSec, isDailyQuota, isSafetyBlock, isFreeTierBug }
}

// ──────────────────────────────────────────────────────────────
// 5. CHAMADA ÚNICA DE GERAÇÃO DE IMAGEM (com retry)
// ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const jitter = () => Math.random() * 1500

const NO_RETRY_FINISH_REASONS = new Set(['IMAGE_SAFETY', 'SAFETY', 'RECITATION', 'OTHER'])

async function callImageModel(
  model: string,
  apiKey: string,
  body: any,
  maxAttempts = 6,
): Promise<{ parts: GeminiResponsePart[]; raw: any } | null> {
  const BASE_DELAY = 5000

  for (let a = 0; a < maxAttempts; a++) {
    if (a > 0) {
      const delay = Math.min(BASE_DELAY * Math.pow(2, a - 1), 30000) + jitter()
      await sleep(delay)
    }

    try {
      const res = await fetch(
        `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      )

      if (res.ok) {
        const data = await res.json()
        const finishReason = data?.candidates?.[0]?.finishReason as string | undefined

        // Bloqueio definitivo (safety, etc) — não adianta tentar de novo
        if (finishReason && NO_RETRY_FINISH_REASONS.has(finishReason)) return null

        const parts = parseResp(data)
        if (parts.some(p => p.type === 'image' && p.imageBase64)) {
          return { parts, raw: data }
        }
        // 200 OK mas sem imagem — tenta de novo
        continue
      }

      const err = await parseError(res)

      // Quota diária estourada — retry não resolve
      if (err.isDailyQuota) {
        if (DEBUG) console.warn(`[${model}] quota diária estourada — abortando retry`)
        return null
      }

      // Bug de free_tier em Paid Tier 1 — vale tentar mais uma vez,
      // mas se persistir em várias chamadas, o fallback vai assumir
      if (err.isFreeTierBug && DEBUG) {
        console.warn(`[${model}] free_tier_requests bug detectado — aguardando backoff`)
      }

      // 429: respeita Retry-After se veio no header
      if (res.status === 429 && err.retryAfterSec) {
        await sleep(err.retryAfterSec * 1000 + jitter())
        continue
      }

      // 429 ou 503 sem header — continua com o backoff exponencial do topo do loop
      if (res.status === 429 || res.status === 503) continue

      // Outros 4xx são fatais
      return null
    } catch {
      // Erro de rede — continua tentando
    }
  }

  return null
}

// ──────────────────────────────────────────────────────────────
// 6. FUNÇÃO PRINCIPAL (mesma assinatura de antes)
// ──────────────────────────────────────────────────────────────

export async function chatWithGemini({
  apiKey, systemPrompt, history, userText,
  userImageBase64, userImageMimeType = 'image/jpeg',
  referencePhotoBase64, referencePhotoMimeType = 'image/jpeg',
  materials = [], forceImage = false, clientFirst = false,
}: {
  apiKey: string; systemPrompt?: string; history: GeminiMessage[]; userText: string
  userImageBase64?: string; userImageMimeType?: string
  referencePhotoBase64?: string; referencePhotoMimeType?: string
  materials?: MaterialData[]; forceImage?: boolean; clientFirst?: boolean
}): Promise<GeminiResponse> {
  if (!apiKey) throw new Error('Chave da API Gemini não configurada.')

  const wantsImage = forceImage

  // Montagem do payload (mesma lógica do código original)
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
      text: `REGRA CRÍTICA DE GERAÇÃO DE IMAGEM: Use a foto da cliente como base obrigatória. Preserve a identidade facial da pessoa — mantenha o rosto real, feições, tom de pele, olhos e expressão. Aplique SOMENTE o que for descrito no prompt (cabelo, roupa, acessório, etc.). Nunca substitua ou idealize o rosto da cliente — use sempre a foto real fornecida como base.\n\nREGRA DE COMPOSIÇÃO OBRIGATÓRIA: Mantenha EXATAMENTE o mesmo enquadramento, recorte, zoom e composição da foto original da cliente. NÃO altere a posição da cliente na imagem. NÃO aproxime o zoom. NÃO recorte o corpo ou busto. A imagem gerada deve ter a mesma composição da foto de entrada — apenas aplique o acessório/alteração solicitada.\n\nREGRA DE FORMATAÇÃO CRÍTICA: Quando a resposta incluir conteúdo de documentos como dossiês, referências de tinta, fichas técnicas ou listas — reproduza a estrutura e formatação EXATAMENTE como está no documento original. Preserve emojis, quebras de linha, marcadores (•, ✔, 🎯, 📌 etc.), hierarquia e espaçamentos. NÃO reformule em parágrafos corridos. NÃO parafraseie. Copie a estrutura fiel.\n\n${systemPrompt || ''}`
    }]
  }

  let imgFailed = false
  let modelUsed: string | undefined

  // ── GERAR IMAGEM (dentro da fila) ─────────────────────────
  if (wantsImage) {
    const imgBody: any = {
      contents,
      system_instruction: imgSys,
      generation_config: { response_modalities: ['IMAGE', 'TEXT'], temperature: 0.1, max_output_tokens: 8192 },
    }

    const imgResult = await queueImageRequest(async () => {
      // 1ª tentativa: modelo principal
      const primary = await callImageModel(GEMINI_MODELS.IMAGE_GEN, apiKey, imgBody, 3)
      if (primary) return { ...primary, model: GEMINI_MODELS.IMAGE_GEN as string }

      // Fallback: modelo alternativo (cota separada)
      if (DEBUG) console.warn(`[Gemini] modelo principal falhou, tentando fallback ${GEMINI_MODELS.IMAGE_GEN_FALLBACK}`)
      const fallback = await callImageModel(GEMINI_MODELS.IMAGE_GEN_FALLBACK, apiKey, imgBody, 2)
      if (fallback) return { ...fallback, model: GEMINI_MODELS.IMAGE_GEN_FALLBACK as string }

      return null
    })

    if (imgResult) {
      return { parts: imgResult.parts, raw: imgResult.raw, imageGenerationFailed: false, modelUsed: imgResult.model }
    }

    imgFailed = true
  }

  // ── TEXTO PURO (fluxo original com pequenas melhorias) ────
  const tc = contents.map((c, i) => {
    if (i < contents.length - 1) return c
    return {
      ...c,
      parts: c.parts.map((p: any) => {
        if (!p.text) return p
        let t = p.text.replace(/\[INSTRUÇÃO[^\]]*\]/g, '').trim()
        if (imgFailed) t += '\n\n[SISTEMA: Imagem indisponível. Responda com texto. Avise: "⚠️ Geração de imagem indisponível."]'
        if (!wantsImage) t += `\n\n[SISTEMA: Responda EXCLUSIVAMENTE com base nos materiais da consultoria, cartela de cores, documentos e observações da cliente. NÃO use conhecimento externo. Se a informação não estiver nos materiais, diga que precisa consultar a consultora Marília.
      REGRA DE FORMATAÇÃO CRÍTICA: Quando apresentar conteúdo de documentos como dossiês, referências de tinta, fichas técnicas ou listas — reproduza a estrutura e formatação EXATAMENTE como está no documento original. Preserve emojis, quebras de linha, marcadores (•, ✔, 🎯, 📌 etc.), hierarquia e espaçamentos. NÃO reformule em parágrafos corridos. NÃO parafraseie. Copie a estrutura fiel.]`
        return { ...p, text: t }
      }),
    }
  })

  const tb: any = { contents: tc, generation_config: { temperature: 0.5, max_output_tokens: 8192 } }
  if (sys) tb.system_instruction = sys

  let res: Response | null = null
  for (let a = 0; a < 4; a++) {
    if (a > 0) await sleep(Math.min(2000 * Math.pow(2, a - 1), 15000) + jitter())
    try {
      res = await fetch(
        `${GEMINI_BASE}/models/${GEMINI_MODELS.TEXT_ONLY}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tb) }
      )
      if (res.ok) break
      if (res.status !== 429 && res.status !== 503) break
    } catch {
      if (a === 3) throw new Error('Erro de conexão.')
    }
  }

  if (!res || !res.ok) {
    const err = res ? await parseError(res) : null
    if (err?.isDailyQuota) throw new Error('Cota diária da IA atingida. Tente amanhã.')
    if (err && (err.status === 429 || err.status === 503)) throw new Error('IA sobrecarregada. Aguarde um momento.')
    throw new Error(err?.message || 'Erro ao contatar a IA.')
  }

  const data = await res.json()
  modelUsed = GEMINI_MODELS.TEXT_ONLY
  const parts = parseResp(data)
  return {
    parts: imgFailed ? addNotice(parts) : parts,
    raw: data,
    imageGenerationFailed: imgFailed,
    modelUsed,
  }
}

// ──────────────────────────────────────────────────────────────
// 7. HELPERS DE PARSING DE RESPOSTA (inalterados)
// ──────────────────────────────────────────────────────────────

function parseResp(data: any): GeminiResponsePart[] {
  const parts: GeminiResponsePart[] = []
  for (const c of data?.candidates || [])
    for (const p of c?.content?.parts || []) {
      if (p.text) parts.push({ type: 'text', text: p.text })
      const d = p.inline_data || p.inlineData
      if (d) parts.push({ type: 'image', imageBase64: d.data, imageMimeType: d.mime_type || d.mimeType })
    }
  return parts
}

function addNotice(parts: GeminiResponsePart[]): GeminiResponsePart[] {
  if (parts.some(p => p.type === 'image')) return parts
  const cleaned = parts
    .map(p => {
      if (p.type !== 'text' || !p.text) return p
      let t = p.text
      for (const r of [/aqui est[áa] a (visualiza[çc][ãa]o|imagem|foto)[^.]*[.:!]?\s*/gi, /preparei uma imagem[^.]*[.!]?\s*/gi])
        t = t.replace(r, '')
      return { ...p, text: t.trim() }
    })
    .filter(p => p.type !== 'text' || p.text?.trim())
  if (!cleaned.some(p => p.text?.includes('⚠️'))) {
    cleaned.push({ type: 'text', text: '\n\n⚠️ Geração de imagem indisponível. Tente novamente.' })
  }
  return cleaned
}
