// src/lib/i18n/countries.ts
//
// Lista de países pra selects (ex: "país de residência" no contrato).
// Em vez de manter 3 listas de ~190 nomes traduzidos manualmente (e ficarem
// desatualizadas), usamos Intl.DisplayNames — API nativa do navegador que já
// traz os nomes dos países em qualquer idioma, com o mesmo dado que o próprio
// SO usa. Suporte: todos os browsers modernos (Safari 14.1+, Chrome 81+).

import type { Language } from './translations'

// Mesmos 193 países que já existiam na lista em português do ClientPortal,
// como códigos ISO 3166-1 alpha-2. Manter esta lista é só adicionar/remover
// um código — o nome exibido vem sempre do Intl.DisplayNames.
export const COUNTRY_CODES: string[] = [
  'BR','AF','ZA','AL','DE','AD','AO','AG','SA','DZ','AR','AM','AU','AT','AZ','BS','BD','BB','BH','BE','BZ',
  'BJ','BY','BO','BA','BW','BN','BG','BF','BI','BT','CV','CM','KH','CA','QA','KZ','TD','CL','CN','CY','CO',
  'KM','CG','KP','KR','CI','CR','HR','CU','DK','DJ','DM','EG','SV','AE','EC','ER','SK','SI','ES','SZ','PS',
  'US','EE','ET','FJ','PH','FI','FR','GA','GM','GH','GE','GD','GR','GT','GY','GN','GQ','GW','HT','HN','HU',
  'YE','MH','SB','IN','ID','IR','IQ','IE','IS','IL','IT','JM','JP','JO','KI','KW','LA','LS','LV','LB','LR',
  'LY','LI','LT','LU','MK','MG','MY','MW','MV','ML','MT','MA','MU','MR','MX','FM','MZ','MD','MC','MN','ME',
  'MM','NA','NR','NP','NI','NE','NG','NO','NZ','OM','NL','PK','PW','PA','PG','PY','PE','PL','PT','KE','KG',
  'CF','CZ','CD','DO','RO','RW','RU','WS','SM','LC','KN','ST','VC','SN','SL','RS','SC','SG','SY','SO','LK',
  'SD','SS','SE','CH','SR','TH','TZ','TL','TG','TO','TT','TN','TM','TR','TV','UA','UG','UY','UZ','VU','VA',
  'VE','VN','ZM','ZW',
]

/** País que aparece primeiro na lista (mais provável pra quem fala o idioma). */
const PRIORITY_CODE: Record<Language, string> = {
  'pt-BR': 'BR',
  'en-US': 'US',
  'en-GB': 'GB', // GB não está na lista original de 193 — ver nota abaixo
  'es-ES': 'ES',
  'fr-FR': 'FR',
  'it-IT': 'IT',
  'de-DE': 'DE',
}

export interface CountryOption {
  code: string
  name: string
}

/**
 * Retorna a lista de países com nome já traduzido pro idioma pedido, com o
 * país "prioritário" (Brasil/EUA/Reino Unido) no topo e o resto em ordem
 * alfabética (na língua escolhida — 'ordena' certo até com acento).
 *
 * Fallback: se o browser não suportar Intl.DisplayNames (muito raro hoje em
 * dia), devolve o próprio código ISO como nome, pra nunca quebrar o select.
 */
export function getCountryOptions(language: Language): CountryOption[] {
  let codes = COUNTRY_CODES
  // en-GB: garante Reino Unido na lista (não fazia parte do cadastro original,
  // que era focado em clientes BR — mas faz sentido oferecer pra quem usa en-GB).
  if (language === 'en-GB' && !codes.includes('GB')) codes = [...codes, 'GB']

  let displayNames: Intl.DisplayNames | null = null
  try {
    displayNames = new Intl.DisplayNames([language], { type: 'region' })
  } catch {
    displayNames = null
  }

  const options: CountryOption[] = codes.map(code => ({
    code,
    name: displayNames ? (displayNames.of(code) ?? code) : code,
  }))

  const priority = PRIORITY_CODE[language]
  const priorityOption = options.find(o => o.code === priority)
  const rest = options
    .filter(o => o.code !== priority)
    .sort((a, b) => a.name.localeCompare(b.name, language))

  return priorityOption ? [priorityOption, ...rest] : rest
}

/** Nome traduzido de um único país pelo código — útil pra exibir o valor já salvo. */
export function getCountryName(code: string, language: Language): string {
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}