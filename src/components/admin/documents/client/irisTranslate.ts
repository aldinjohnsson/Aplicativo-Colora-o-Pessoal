// src/components/admin/documents/client/irisTranslate.ts
//
// Tradução do texto do card da Análise da Íris (título + corpo) para os
// idiomas do portal (os mesmos de LANGUAGES / translations.ts), usando o
// Gemini com a chave que o admin já cadastrou em Configurações
// (admin_content, type = 'api_keys').

import { supabase } from '../../../../lib/supabase'

// Troque aqui se quiser outro modelo do Gemini.
const GEMINI_MODEL = 'gemini-2.5-flash'

export interface TranslateTarget { code: string; label: string }
export type TranslatedText = { title: string; body: string }

async function getGeminiKey(): Promise<string> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth?.user?.id
  if (!uid) throw new Error('Sessão expirada — entre novamente.')

  const { data } = await supabase
    .from('admin_content')
    .select('content')
    .eq('admin_id', uid)
    .eq('type', 'api_keys')
    .maybeSingle()

  const key = (data?.content as { geminiApiKey?: string } | null)?.geminiApiKey
  if (!key) throw new Error('Chave do Gemini não encontrada. Cadastre em Configurações → Chaves de API.')
  return key
}

/**
 * Traduz título e corpo para todos os idiomas pedidos numa única chamada.
 * Retorna um objeto { [codigoIdioma]: { title, body } }.
 */
export async function translateIrisText(input: {
  title: string
  body: string
  targets: TranslateTarget[]
}): Promise<Record<string, TranslatedText>> {
  const { title, body, targets } = input
  if (!targets.length) return {}

  const apiKey = await getGeminiKey()

  const prompt = [
    'Você é tradutor profissional de textos de consultoria de coloração pessoal (análise de íris).',
    'Detecte automaticamente o idioma do texto de origem e traduza o TÍTULO e o CORPO para cada idioma de destino.',
    'Regras: mantenha o sentido, o tom acolhedor e as quebras de linha; não adicione nem remova informações;',
    'não explique nada. Se o idioma de destino for o mesmo do texto, devolva o texto original sem alterar.',
    '',
    `Idiomas de destino (código — nome): ${targets.map(t => `${t.code} — ${t.label}`).join('; ')}`,
    '',
    'Responda SOMENTE com um JSON no formato:',
    '{ "<codigo>": { "title": "...", "body": "..." }, ... } com uma chave para cada código de destino.',
    '',
    `TÍTULO: ${title}`,
    `CORPO: ${body}`,
  ].join('\n')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          // Tradução não precisa "pensar": zera os tokens de raciocínio (cobrados como saída)
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  )
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j?.error?.message || `Falha na tradução: HTTP ${res.status}`)
  }

  const json = await res.json()
  const raw: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''
  let parsed: any
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
  } catch {
    throw new Error('A resposta da tradução veio em formato inesperado. Tente novamente.')
  }

  const out: Record<string, TranslatedText> = {}
  for (const t of targets) {
    const item = parsed?.[t.code]
    if (item && typeof item.title === 'string' && typeof item.body === 'string') {
      out[t.code] = { title: item.title, body: item.body }
    }
  }
  if (!Object.keys(out).length) throw new Error('Nenhuma tradução retornada. Tente novamente.')
  return out
}