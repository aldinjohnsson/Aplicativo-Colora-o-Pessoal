// src/lib/geminiService.ts
// GEMINI ONLY

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const GEMINI_MODELS = {
  IMAGE_GEN: 'gemini-2.5-flash-image',
  TEXT_ONLY: 'gemini-2.5-flash',
} as const

export interface GeminiMessage { role: 'user' | 'model'; text: string }
export interface GeminiResponsePart { type: 'text' | 'image'; text?: string; imageBase64?: string; imageMimeType?: string }
export interface GeminiResponse { parts: GeminiResponsePart[]; raw: any; imageGenerationFailed: boolean }
export interface MaterialData { base64: string; mimeType: string }

export function getGeminiApiKey(): string {
  try { return JSON.parse(localStorage.getItem('app-settings') || '{}')?.geminiApiKey || '' } catch { return '' }
}

export async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ base64: (r.result as string).split(',')[1], mimeType: file.type || 'image/jpeg' }); r.onerror = rej; r.readAsDataURL(file) })
}

export async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try { const blob = await (await fetch(url)).blob(); return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ base64: (r.result as string).split(',')[1], mimeType: blob.type || 'image/jpeg' }); r.onerror = rej; r.readAsDataURL(blob) }) } catch { return null }
}

export async function chatWithGemini({ apiKey, systemPrompt, history, userText, userImageBase64, userImageMimeType = 'image/jpeg', referencePhotoBase64, referencePhotoMimeType = 'image/jpeg', materials = [], forceImage = false, clientFirst = false }: {
  apiKey: string; systemPrompt?: string; history: GeminiMessage[]; userText: string; userImageBase64?: string; userImageMimeType?: string; referencePhotoBase64?: string; referencePhotoMimeType?: string; materials?: MaterialData[]; forceImage?: boolean; clientFirst?: boolean
}): Promise<GeminiResponse> {
  if (!apiKey) throw new Error('Chave da API Gemini não configurada.')

  // forceImage = true quando vem do menu de opções (sempre gera imagem)
  // forceImage = false quando é texto digitado (nunca gera imagem, só responde)
  const wantsImage = forceImage

  const contents: any[] = history.map(m => ({ role: m.role, parts: [{ text: m.text || ' ' }] }))
  const userParts: any[] = []

  if (clientFirst && wantsImage) {
    // Referência e materiais PRIMEIRO (o que aplicar), cliente POR ÚLTIMO (base a preservar)
    if (referencePhotoBase64) userParts.push({ inline_data: { mime_type: referencePhotoMimeType, data: referencePhotoBase64 } })
    for (const mat of materials) userParts.push({ inline_data: { mime_type: mat.mimeType, data: mat.base64 } })
    if (userImageBase64) userParts.push({ inline_data: { mime_type: userImageMimeType, data: userImageBase64 } })
  } else {
    // Default: materials first, then client photo
    if (materials.length > 0) {
      for (const mat of materials) userParts.push({ inline_data: { mime_type: mat.mimeType, data: mat.base64 } })
    }
    if (wantsImage && referencePhotoBase64) userParts.push({ inline_data: { mime_type: referencePhotoMimeType, data: referencePhotoBase64 } })
    if (userImageBase64) userParts.push({ inline_data: { mime_type: userImageMimeType, data: userImageBase64 } })
  }

  let finalText = userText
  if (materials.length > 0) finalText += '\n\n[INSTRUÇÃO: Use os materiais anexados como base para sua resposta.]'
  if (wantsImage && referencePhotoBase64) finalText += '\n\n[INSTRUÇÃO: A ÚLTIMA imagem enviada é a foto da cliente — ela é a BASE OBRIGATÓRIA. Preserve o rosto, feições, tom de pele e EXATAMENTE o mesmo enquadramento, zoom e composição. NÃO recorte o busto. NÃO reposicione a cliente. Aplique SOMENTE o acessório/alteração descrito. GERE IMAGEM.]'

  userParts.push({ text: finalText })
  contents.push({ role: 'user', parts: userParts })

  const sys = systemPrompt?.trim() ? { parts: [{ text: systemPrompt }] } : undefined
  // For image generation, prepend a face-preservation directive.
  // IMPORTANT: must NOT say "sem nenhuma alteração no rosto" because that blocks
  // accessories (glasses, earrings, etc.) from being placed on the face.
  const imgSys = {
    parts: [{
      text: `REGRA CRÍTICA DE GERAÇÃO DE IMAGEM: Use a foto da cliente como base obrigatória. Preserve a identidade facial da pessoa — mantenha o rosto real, feições, tom de pele, olhos e expressão. Aplique SOMENTE o que for descrito no prompt (cabelo, roupa, acessório, etc.). Nunca substitua ou idealize o rosto da cliente — use sempre a foto real fornecida como base.\n\nREGRA DE COMPOSIÇÃO OBRIGATÓRIA: Mantenha EXATAMENTE o mesmo enquadramento, recorte, zoom e composição da foto original da cliente. NÃO altere a posição da cliente na imagem. NÃO aproxime o zoom. NÃO recorte o corpo ou busto. A imagem gerada deve ter a mesma composição da foto de entrada — apenas aplique o acessório/alteração solicitada.\n\n${systemPrompt || ''}`
    }]
  }
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const isOvl = (s: number) => s === 429 || s === 503
  let imgFailed = false

  // ── GERAR IMAGEM (só se forceImage) ────────────────────────
  if (wantsImage) {
    const body: any = { contents, generation_config: { response_modalities: ['IMAGE', 'TEXT'], temperature: 0.1, max_output_tokens: 8192 } }
    if (imgSys) body.system_instruction = imgSys

    for (let a = 0; a < 4; a++) {
      if (a > 0) await sleep(Math.min(2000 * Math.pow(2, a), 12000))
      try {
        const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODELS.IMAGE_GEN}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (res.ok) { const data = await res.json(); const parts = parseResp(data); if (parts.some(p => p.type === 'image' && p.imageBase64)) return { parts, raw: data, imageGenerationFailed: false }; continue }
        if (isOvl(res.status)) continue; break
      } catch {}
    }
    imgFailed = true
  }

  // ── TEXTO PURO ─────────────────────────────────────────────
  const tc = contents.map((c, i) => {
    if (i < contents.length - 1) return c
    return { ...c, parts: c.parts.map((p: any) => {
      if (!p.text) return p
      let t = p.text.replace(/\[INSTRUÇÃO[^\]]*\]/g, '').trim()
      if (imgFailed) t += '\n\n[SISTEMA: Imagem indisponível. Responda com texto. Avise: "⚠️ Geração de imagem indisponível."]'
      // Para perguntas de texto, reforçar que use só os materiais
      if (!wantsImage) t += '\n\n[SISTEMA: Responda EXCLUSIVAMENTE com base nos materiais da consultoria, cartela de cores, documentos e observações da cliente. NÃO use conhecimento externo. Se a informação não estiver nos materiais, diga que precisa consultar a consultora Marília.]'
      return { ...p, text: t }
    })}
  })

  const tb: any = { contents: tc, generation_config: { temperature: 0.5, max_output_tokens: 8192 } }
  if (sys) tb.system_instruction = sys

  let res: Response | null = null
  for (let a = 0; a < 3; a++) {
    if (a > 0) await sleep(a * 3000)
    try {
      res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODELS.TEXT_ONLY}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tb) })
      if (res.ok || !isOvl(res.status)) break
    } catch { if (a === 2) throw new Error('Erro de conexão.') }
  }

  if (!res || !res.ok) {
    let e: any = {}; try { if (res) e = await res.json() } catch {}
    if (res && isOvl(res.status)) throw new Error('IA sobrecarregada.')
    throw new Error(e?.error?.message || `Erro ${res?.status}`)
  }

  const data = await res.json()
  const parts = parseResp(data)
  return { parts: imgFailed ? addNotice(parts) : parts, raw: data, imageGenerationFailed: imgFailed }
}

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
  const cleaned = parts.map(p => {
    if (p.type !== 'text' || !p.text) return p
    let t = p.text
    for (const r of [/aqui est[áa] a (visualiza[çc][ãa]o|imagem|foto)[^.]*[.:!]?\s*/gi, /preparei uma imagem[^.]*[.!]?\s*/gi])
      t = t.replace(r, '')
    return { ...p, text: t.trim() }
  }).filter(p => p.type !== 'text' || p.text?.trim())
  if (!cleaned.some(p => p.text?.includes('⚠️'))) cleaned.push({ type: 'text', text: '\n\n⚠️ Geração de imagem indisponível. Tente novamente.' })
  return cleaned
}