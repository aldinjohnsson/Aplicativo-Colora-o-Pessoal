// src/lib/phone.ts
//
// Utilitários de telefone internacional. Usa libphonenumber-js (a mesma
// biblioteca que grandes players usam pra isso) pra formatar e validar o
// número CONFORME o país escolhido, e pra sempre gravar em E.164
// (+5511999998888) — é esse o formato que a API do WhatsApp exige, e
// funciona pra qualquer país sem precisar manter um mapa manual de DDI.
//
// Requer: npm install libphonenumber-js

import {
  AsYouType,
  parsePhoneNumberFromString,
  getCountryCallingCode,
  isValidPhoneNumber,
  CountryCode,
} from 'libphonenumber-js'
import type { Language } from './i18n'

/** País padrão do seletor de telefone, com base no idioma ativo do portal. */
export const PHONE_DEFAULT_COUNTRY: Record<Language, CountryCode> = {
  'pt-BR': 'BR',
  'en-US': 'US',
  'en-GB': 'GB',
  'es-ES': 'ES',
  'fr-FR': 'FR',
  'it-IT': 'IT',
  'de-DE': 'DE',
}

/** 🇧🇷 a partir de 'BR' — sem precisar de imagens/ícones de bandeira. */
export function isoToFlagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)))
}

/** "+55", "+1", "+351"... */
export function dialCode(country: CountryCode): string {
  try {
    return `+${getCountryCallingCode(country)}`
  } catch {
    return ''
  }
}

/** Formata o número NACIONAL enquanto a pessoa digita (ex: "(11) 99999-8888"). */
export function formatAsYouType(national: string, country: CountryCode): string {
  return new AsYouType(country).input(national)
}

/** País + número digitado → E.164 pra salvar no banco. `null` se ainda não deu pra reconhecer (número incompleto). */
export function toE164(national: string, country: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(national, country)
  return parsed ? parsed.number : null
}

/** Campo vazio conta como válido (telefone é opcional no cadastro). */
export function isValid(national: string, country: CountryCode): boolean {
  if (!national.trim()) return true
  return isValidPhoneNumber(national, country)
}

/**
 * Extrai país + número nacional formatado de um valor já salvo em E.164 —
 * usado pra inicializar o seletor quando já existe um telefone.
 *
 * Também cobre o formato ANTIGO (sem "+", ex: "11999998888" — como estava
 * sendo salvo antes desta melhoria, sempre assumido Brasil pelo link de
 * WhatsApp no painel): se não começar com "+", tenta interpretar como
 * número nacional brasileiro antes de desistir.
 */
export function fromE164(value: string): { country: CountryCode | null; national: string } {
  if (!value) return { country: null, national: '' }

  if (value.trim().startsWith('+')) {
    const parsed = parsePhoneNumberFromString(value)
    if (parsed) return { country: (parsed.country as CountryCode) ?? null, national: parsed.formatNational() }
    return { country: null, national: value }
  }

  // Formato antigo (cadastros feitos antes desta melhoria): sem "+", sem
  // país. Tenta como número nacional brasileiro — mesma suposição que o
  // link de WhatsApp do painel já fazia.
  const asBr = parsePhoneNumberFromString(value, 'BR')
  if (asBr) return { country: 'BR', national: asBr.formatNational() }

  return { country: null, national: value }
}
