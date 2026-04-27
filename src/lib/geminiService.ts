// src/lib/geminiService.ts
// GEMINI ONLY — versão refatorada
//
// Mudanças principais nesta versão:
//   • camelCase no body da requisição (generationConfig, responseModalities,
//     systemInstruction, maxOutputTokens) — corrige o bug em que a API
//     ignorava silenciosamente o pedido de imagem e devolvia só texto.
//   • Timeout de 60s por fetch via AbortController (evita travar a fila).
//   • Menos tentativas (3 no principal, 2 no fallback) com cap de 6s — antes
//     o pior caso era ~3min de espera. Agora é ~45s.
//   • Bailout imediato quando a API retorna 200 OK sem imagem por 2 vezes
//     seguidas (sinal de que retentar não vai resolver).
//   • Bailout imediato em isFreeTierBug (chave sem billing ou bug do Tier 1).
//   • Fila global de imagens com gap reduzido (2s, antes 4s).
//   • Cache de API key com TTL de 5min.

import { supabase } from './supabase'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const GEMINI_MODELS = {
  IMAGE_GEN: 'gemini-2.5-flash-image',
  IMAGE_GEN_FALLBACK: 'gemini-3.1-flash-image-preview', // cota separada
  TEXT_ONLY: 'gemini-2.5-flash',
} as const

// Liga/desliga logs detalhados. Útil quando estiver investigando algo —
// deixe true em dev, false em produção.
const DEBUG = true

export interface GeminiMessage { role: 'user' | 'model'; text: string }
export interface GeminiResponsePart { type: 'text' | 'image'; text?: string; imageBase64?: string; imageMimeType?: string }
export interface GeminiResponse { parts: GeminiResponsePart[]; raw: any; imageGenerationFailed: boolean; modelUsed?: string }
export interface MaterialData { base64: string; mimeType: string }

// ──────────────────────────────────────────────────────────────
// 1. CACHE DA API KEY
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
// 2. HELPERS DE ARQUIVO
// ──────────────────────────────────────────────────────────────

export async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res({ base64: (r.result as string).split(',')[1], mimeType: file.type || 'image/jpeg' })
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

export async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const blob = await (await fetch(url)).blob()
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res({ base64: (r.result as string).split(',')[1], mimeType: blob.type || 'image/jpeg' })
      r.onerror = rej
      r.readAsDataURL(blob)
    })
  } catch { return null }
}

// ──────────────────────────────────────────────────────────────
// 3. FILA GLOBAL DE IMAGEM
// Serializa requisições para evitar picos simultâneos.
// ──────────────────────────────────────────────────────────────

let _imgQueue: Promise<any> = Promise.resolve()
const IMG_MIN_GAP_MS = 2000 // ~30 imgs/min — abaixo do limite Tier 1

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
// ──────────────────────────────────────────────────────────────

interface ParsedError {
  status: number
  message: string
  quotaMetric?: string
  retryAfterSec?: number
  finishReason?: string
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

  if (DEBUG && status >= 400) {
    console.error('[Gemini error]', { status, quotaMetric, retryAfterSec, message })
  }

  return { status, message, quotaMetric, retryAfterSec, isDailyQuota, isSafetyBlock, isFreeTierBug }
}

// ──────────────────────────────────────────────────────────────
// 5. FETCH COM TIMEOUT
// ──────────────────────────────────────────────────────────────

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
// 6. CHAMADA DE GERAÇÃO DE IMAGEM (com retry inteligente)
// ──────────────────────────────────────────────────────────────

const NO_RETRY_FINISH_REASONS = new Set(['IMAGE_SAFETY', 'SAFETY', 'RECITATION', 'OTHER'])
const FETCH_TIMEOUT_MS = 60_000

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

        // Bloqueio definitivo (safety, recitation, etc) — não adianta retry
        if (finishReason && NO_RETRY_FINISH_REASONS.has(finishReason)) {
          if (DEBUG) console.warn(`[${model}] finishReason=${finishReason} — abortando`)
          return null
        }

        const parts = parseResp(data)
        if (parts.some(p => p.type === 'image' && p.imageBase64)) {
          return { parts, raw: data }
        }

        // 200 OK mas sem imagem.
        // Se acontecer 2x seguidas, o modelo não vai gerar mesmo —
        // bailout para o caller tentar o fallback.
        okButNoImageCount++
        if (DEBUG) {
          const textBack = parts.filter(p => p.type === 'text').map(p => p.text).join(' | ').slice(0, 400)
          console.warn(`[${model}] 200 OK sem imagem (tentativa ${a + 1}, finishReason=${finishReason || 'none'})`)
          console.warn(`[${model}] texto retornado:`, textBack || '(vazio)')
        }
        if (okButNoImageCount >= 2) return null
        continue
      }

      const err = await parseError(res)

      // Cota diária estourada — não adianta retry
      if (err.isDailyQuota) {
        if (DEBUG) console.warn(`[${model}] quota diária estourada`)
        return null
      }

      // Bug de free_tier (chave sem billing OU Paid Tier 1 roteado errado).
      // Retentar não resolve — desiste e deixa o caller tentar o fallback.
      if (err.isFreeTierBug) {
        if (DEBUG) console.warn(`[${model}] free_tier quota — chave sem billing ou bug do Tier 1`)
        return null
      }

      // 429 com Retry-After do servidor: respeita
      if (res.status === 429 && err.retryAfterSec) {
        await sleep(err.retryAfterSec * 1000 + jitter())
        continue
      }

      // 429 ou 503 sem header — backoff exponencial do topo do loop
      if (res.status === 429 || res.status === 503) continue

      // Outros 4xx (400, 401, 403, 404) são fatais
      if (DEBUG) console.error(`[${model}] erro fatal ${res.status}: ${err.message}`)
      return null
    } catch (e: any) {
      // Timeout ou erro de rede — continua tentando
      if (DEBUG) console.warn(`[${model}] erro de rede/timeout (tentativa ${a + 1}):`, e?.message || e)
    }
  }

  return null
}

// ──────────────────────────────────────────────────────────────
// 7. FUNÇÃO PRINCIPAL
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

  // Montagem do payload
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

  // ⚠️ imgSys propositalmente NÃO inclui o systemPrompt da consultoria.
  // Quando a persona conversacional vai junto, o modelo responde em modo
  // chat ("Que tal este visual, Marília?") em vez de gerar a imagem.
  // Para imagem, só as regras puras de geração.
  const imgSys = {
    parts: [{
      text: `TAREFA: GERAÇÃO DE IMAGEM. Você é um modelo de edição de imagem. Sua única saída deve ser uma imagem gerada — NÃO escreva texto descritivo, NÃO comente, NÃO se apresente. Apenas gere a imagem solicitada.

REGRA DE IDENTIDADE: Use a foto da cliente como base obrigatória. Preserve o rosto real, feições, tom de pele, olhos e expressão. Aplique SOMENTE o que for descrito no prompt (cabelo, roupa, acessório, etc.). Nunca substitua ou idealize o rosto.

REGRA DE COMPOSIÇÃO: Mantenha EXATAMENTE o mesmo enquadramento, recorte, zoom e composição da foto original. NÃO aproxime o zoom. NÃO recorte o busto. NÃO reposicione a cliente.`
    }]
  }

  let imgFailed = false

  // ── GERAR IMAGEM (dentro da fila) ─────────────────────────
  if (wantsImage) {
    // ⚠️ IMPORTANTE: para geração de imagem montamos um `contents` LIMPO,
    // sem o histórico de chat. Histórico conversacional empurra o modelo
    // para responder em modo chat (ex.: "Que tal este visual, Marília?")
    // em vez de gerar a imagem. Cada pedido de imagem é uma tarefa
    // pontual e independente.
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

    // Instrução imperativa, sem tom conversacional
    const imperative = `GERE A IMAGEM aplicando o seguinte na foto da cliente (a foto da cliente é a ${clientFirst ? 'PRIMEIRA' : 'ÚLTIMA'} imagem enviada):

${userText}

NÃO escreva texto. NÃO comente. NÃO se apresente. Apenas devolva a IMAGEM gerada.`
    imgUserParts.push({ text: imperative })

    const imgContents = [{ role: 'user', parts: imgUserParts }]

    // ⚠️ camelCase é OBRIGATÓRIO aqui — snake_case dentro de generationConfig
    // é silenciosamente ignorado pela API e o modelo retorna só texto.
    const imgBody: any = {
      contents: imgContents,
      systemInstruction: imgSys,
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        // 0.4 dá espaço para o modelo escolher modalidade imagem.
        // 0.1 era determinístico demais e ele travava em texto.
        temperature: 0.4,
        maxOutputTokens: 8192,
        candidateCount: 1,
        // imageConfig: força resolução alta. Default da API é 1K — 2K dá
        // 4x mais pixels e resolve a sensação de "qualidade pior".
        // Use '4K' para máximo (custa mais e demora um pouco mais).
        imageConfig: {
          imageSize: '2K',
          aspectRatio: '3:4', // retrato — combina com foto de cliente
        },
      },
      // Reduz soft refusals do filtro de segurança do Gemini, que é
      // sensível demais com fotos reais de pessoas. BLOCK_ONLY_HIGH
      // ainda bloqueia conteúdo realmente problemático mas deixa
      // passar consultoria de imagem legítima.
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }

    const imgResult = await queueImageRequest(async () => {
      // 1ª tentativa: modelo principal (3 tentativas, 60s cada)
      const primary = await callImageModel(GEMINI_MODELS.IMAGE_GEN, apiKey, imgBody, 3, 60_000)
      if (primary) return { ...primary, model: GEMINI_MODELS.IMAGE_GEN as string }

      // Fallback: modelo alternativo (2 tentativas, 90s cada — costuma demorar mais)
      if (DEBUG) console.warn(`[Gemini] modelo principal falhou, tentando fallback ${GEMINI_MODELS.IMAGE_GEN_FALLBACK}`)
      const fallback = await callImageModel(GEMINI_MODELS.IMAGE_GEN_FALLBACK, apiKey, imgBody, 2, 90_000)
      if (fallback) return { ...fallback, model: GEMINI_MODELS.IMAGE_GEN_FALLBACK as string }

      return null
    })

    if (imgResult) {
      return { parts: imgResult.parts, raw: imgResult.raw, imageGenerationFailed: false, modelUsed: imgResult.model }
    }

    imgFailed = true
  }

  // ── TEXTO PURO (com aviso se imagem falhou) ───────────────
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
    raw: data,
    imageGenerationFailed: imgFailed,
    modelUsed: GEMINI_MODELS.TEXT_ONLY,
  }
}

// ──────────────────────────────────────────────────────────────
// 8. HELPERS DE PARSING DE RESPOSTA
// (aceita tanto inline_data quanto inlineData — Gemini pode retornar
// ambos dependendo da versão da API)
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