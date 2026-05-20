// src/components/admin/documents/lib/promptVars.ts
//
// Substituição de variáveis em prompts de IA.
//
// Sintaxe: {{Label}} no texto do prompt → valor real da cliente.
// Fonte: apenas `ai_info_templates` (Informações da análise) — definidas em
//         Configurações e preenchidas por cliente em ClientsManager.
// Match:  case-insensitive, ignora acentos. `{{Subtom}}` casa com a tag "Subtom".
// Sem valor: substitui por string vazia (silenciosamente).

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Normaliza pra comparação: minúsculas, sem acento, trim. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export interface PromptVarSource {
  /** Label visível pra admin — ex: "Subtom", "Temperatura". */
  label: string
  /** Valor preenchido pra cliente atual. null/'' → substituirá por vazio. */
  value: string | null
}

/**
 * Substitui `{{Label}}` pelos valores correspondentes dos sources.
 * Placeholders sem match (ou com valor vazio) são trocados por string vazia.
 */
export function substitutePromptVars(
  text: string,
  sources: PromptVarSource[],
): string {
  if (!text) return text
  const map = new Map<string, string>()
  for (const s of sources) {
    const v = (s.value ?? '').trim()
    if (v) map.set(normalize(s.label), v)
  }
  return text.replace(PLACEHOLDER_RE, (_full, name) => {
    return map.get(normalize(String(name))) ?? ''
  })
}

/** Lista todos os placeholders únicos do texto (na forma como o admin escreveu). */
export function extractPromptVars(text: string): string[] {
  if (!text) return []
  const found = new Set<string>()
  let m: RegExpExecArray | null
  PLACEHOLDER_RE.lastIndex = 0
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    found.add(m[1].trim())
  }
  return [...found]
}
