// src/components/client/PhoneInput.tsx
//
// Campo de telefone internacional: seletor de país (bandeira de verdade,
// via imagem — emoji de bandeira não renderiza no Windows/Chrome, só mostra
// as duas letras do código como texto) + número formatado automaticamente
// enquanto digita, conforme o país escolhido. Sempre entrega pro `onChange`
// o valor em E.164 (+5511999998888) — é isso que deve ser salvo no banco.
//
// <option> nativo não aceita imagem dentro, por isso o seletor de país é um
// dropdown customizado (botão + popover com busca, já que são ~193 países).
//
// País inicial: se já existe um valor salvo, deriva dele; senão, usa o
// idioma ativo do portal (PHONE_DEFAULT_COUNTRY). Trocar o seletor de
// idioma DEPOIS de já ter digitado o telefone não reseta o país escolhido.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { CountryCode } from 'libphonenumber-js'
import { getCountryOptions } from '../../lib/i18n/countries'
import type { Language } from '../../lib/i18n'
import {
  PHONE_DEFAULT_COUNTRY,
  dialCode,
  formatAsYouType,
  toE164,
  isValid,
  fromE164,
} from '../../lib/phone'

/** Imagem de bandeira via CDN público (flagcdn.com) — funciona em qualquer SO/navegador, ao contrário do emoji. */
function flagUrl(iso2: string): string {
  return `https://flagcdn.com/24x18/${iso2.toLowerCase()}.png`
}

interface PhoneInputProps {
  /** Valor controlado, em E.164 (ou string vazia). */
  value: string
  onChange: (e164: string) => void
  language: Language
  placeholder?: string
  /** Avisa quando o número digitado não bate com o formato do país selecionado (não bloqueia digitação). */
  onValidityChange?: (valid: boolean) => void
  disabled?: boolean
}

export function PhoneInput({
  value, onChange, language, placeholder, onValidityChange, disabled,
}: PhoneInputProps) {
  const countryOptions = React.useMemo(() => getCountryOptions(language), [language])

  const [country, setCountry] = useState<CountryCode>(() => {
    const fromValue = fromE164(value).country
    return (fromValue as CountryCode) || PHONE_DEFAULT_COUNTRY[language] || 'BR'
  })
  const [national, setNational] = useState(() => fromE164(value).national)

  // Se o valor externo mudar por fora (ex: carregou um cadastro existente
  // depois do primeiro render), re-sincroniza o país e o número exibido.
  useEffect(() => {
    const parsed = fromE164(value)
    if (parsed.national !== national) {
      setNational(parsed.national)
      if (parsed.country) setCountry(parsed.country as CountryCode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Idioma mudou ANTES da pessoa digitar algo → acompanha o país padrão.
  useEffect(() => {
    if (!national) setCountry(PHONE_DEFAULT_COUNTRY[language] || 'BR')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  const emitChange = (nat: string, c: CountryCode) => {
    if (!nat.trim()) {
      onChange('')
      onValidityChange?.(true)
      return
    }
    const e164 = toE164(nat, c)
    onChange(e164 || nat)
    onValidityChange?.(isValid(nat, c))
  }

  // ── Dropdown de país (bandeira + nome + DDI), com busca ──────────────
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return countryOptions
    return countryOptions.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      dialCode(c.code as CountryCode).includes(q)
    )
  }, [countryOptions, search])

  const selectCountry = (c: CountryCode) => {
    setCountry(c)
    emitChange(national, c)
    setOpen(false)
    setSearch('')
  }

  return (
    <div className="flex gap-2">
      <div className="relative flex-shrink-0" ref={wrapRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 h-full px-2.5 py-3 border border-gray-200 rounded-xl text-sm bg-white transition-all hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <img
            src={flagUrl(country)}
            alt=""
            className="w-5 h-[15px] rounded-[2px] object-cover flex-shrink-0"
            onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
          />
          <span className="whitespace-nowrap text-gray-700">{dialCode(country)}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-72 max-w-[85vw] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            <div className="p-2 border-b border-gray-100">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar país..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--client-accent-light)]"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-400 text-center">Nenhum país encontrado</p>
              ) : (
                filteredOptions.map(c => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => selectCountry(c.code as CountryCode)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 ${c.code === country ? 'bg-rose-50' : ''}`}
                  >
                    <img
                      src={flagUrl(c.code)}
                      alt=""
                      className="w-5 h-[15px] rounded-[2px] object-cover flex-shrink-0"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                    />
                    <span className="flex-1 truncate text-gray-700">{c.name}</span>
                    <span className="text-gray-400 flex-shrink-0">{dialCode(c.code as CountryCode)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <input
        type="tel"
        inputMode="tel"
        disabled={disabled}
        value={national}
        onChange={e => {
          const formatted = formatAsYouType(e.target.value, country)
          setNational(formatted)
          emitChange(formatted, country)
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--client-accent-light)] focus:border-transparent bg-white transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      />
    </div>
  )
}