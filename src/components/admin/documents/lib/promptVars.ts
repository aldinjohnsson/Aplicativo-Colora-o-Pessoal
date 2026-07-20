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

// Conectivos removidos automaticamente quando ficam colados a um campo
// vazio (só quando SEPARADOS por espaço do placeholder — não mexe em nada
// que não esteja diretamente ao lado de um valor não preenchido).
// Ex.: "Subtom:{{Subtom}} e {{Subtom Secundário}}" com os dois vazios →
// sem isso sobrava "Subtom: e " (o "e" solto), que o modelo de geração de
// imagem às vezes desenha literalmente como texto na imagem.
const CONNECTORS = 'e|and|y|et|und|ou|or'
const CONNECTOR_BEFORE_EMPTY_RE = (marker: string) =>
  new RegExp(`\\s*\\b(?:${CONNECTORS})\\b\\s*${marker}`, 'gi')
const CONNECTOR_AFTER_EMPTY_RE = (marker: string) =>
  new RegExp(`${marker}\\s*\\b(?:${CONNECTORS})\\b\\s*`, 'gi')

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

/** Substitui os placeholders de uma linha (já sabendo que ao menos um tem valor). */
function substituteLineContent(line: string, map: Map<string, string>): string {
  const EMPTY = '\u0000EMPTY\u0000'
  let out = line.replace(PLACEHOLDER_RE, (_full, name) => {
    const v = map.get(normalize(String(name)))
    return v !== undefined ? v : EMPTY
  })

  let prev: string
  do {
    prev = out
    out = out
      .replace(CONNECTOR_BEFORE_EMPTY_RE(EMPTY), EMPTY)
      .replace(CONNECTOR_AFTER_EMPTY_RE(EMPTY), EMPTY)
  } while (out !== prev)

  out = out.split(EMPTY).join('')
  out = out.replace(/[ \t]{2,}/g, ' ')
  return out
}

/**
 * Substitui `{{Label}}` pelos valores correspondentes dos sources.
 *
 * Duas camadas de limpeza pra campo vazio:
 *  1. Conectivo colado (e/and/y/...) é removido junto — ver
 *     substituteLineContent.
 *  2. Se uma LINHA inteira depende só de placeholders e NENHUM deles foi
 *     preenchido, a linha inteira some — inclusive o rótulo estático
 *     (ex: "Subtom:{{Subtom}} e {{Subtom Secundário}}" com os dois vazios
 *     não vira "Subtom:" pendurado; a linha desaparece por completo).
 *     Linhas com pelo menos um valor preenchido são mantidas normalmente.
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

  const outLines: string[] = []
  for (const line of text.split('\n')) {
    const placeholders = [...line.matchAll(PLACEHOLDER_RE)]
    if (placeholders.length > 0) {
      const anyFilled = placeholders.some(m => map.has(normalize(m[1].trim())))
      if (!anyFilled) continue // linha inteira some
    }
    outLines.push(substituteLineContent(line, map))
  }

  return outLines.join('\n')
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