// src/lib/i18n/LanguageContext.tsx
//
// Provider único usado em todo o portal do cliente (login, dashboard,
// contrato, formulário, fotos, finalização).
//
// Prioridade de resolução do idioma inicial:
//   1. Idioma já salvo no navegador para ESTE cliente (localStorage, chave por token)
//   2. `initialLanguage` (normalmente vindo de portalData.client.language, se o
//      cliente já tinha escolhido antes em outro dispositivo)
//   3. `fallbackLanguage` (o "idioma padrão" configurado pelo admin em Settings)
//   4. Idioma do navegador (navigator.language), se bater com um suportado
//   5. 'pt-BR'
//
// Uso típico em ClientDashboard.tsx / ClientPortal.tsx:
//
//   <LanguageProvider
//     persistKey={token}
//     initialLanguage={portalData?.client?.language}
//     fallbackLanguage={adminDefaultLanguage}
//     onLanguageChange={(lang) => clientService.updateClientLanguage(token, lang)}
//   >
//     <ClientDashboard ... />
//   </LanguageProvider>

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { translations, Language, TranslationDict } from './translations'

export const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'en-US', label: 'English (US)',        flag: '🇺🇸' },
  { code: 'en-GB', label: 'English (UK)',         flag: '🇬🇧' },
  { code: 'es-ES', label: 'Español',              flag: '🇪🇸' },
  { code: 'fr-FR', label: 'Français',             flag: '🇫🇷' },
  { code: 'it-IT', label: 'Italiano',             flag: '🇮🇹' },
  { code: 'de-DE', label: 'Deutsch',              flag: '🇩🇪' },
  // Pra adicionar mais um idioma: acrescente aqui + o bloco correspondente em
  // translations.ts, com as mesmas 292 chaves dos outros idiomas.
]

const STORAGE_PREFIX = 'client-portal-lang'

function readStoredLanguage(persistKey?: string): Language | null {
  if (typeof window === 'undefined') return null
  try {
    const key = persistKey ? `${STORAGE_PREFIX}:${persistKey}` : STORAGE_PREFIX
    const raw = window.localStorage.getItem(key)
    return raw && raw in translations ? (raw as Language) : null
  } catch {
    return null
  }
}

export function writeStoredLanguage(lang: Language, persistKey?: string) {
  if (typeof window === 'undefined') return
  try {
    const key = persistKey ? `${STORAGE_PREFIX}:${persistKey}` : STORAGE_PREFIX
    window.localStorage.setItem(key, lang)
  } catch {
    // localStorage indisponível (modo privado etc.) — sem problema, cai no padrão na próxima visita
  }
}

function detectBrowserLanguage(): Language | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator.language || (navigator as any).userLanguage || ''
  if (nav.toLowerCase().startsWith('pt')) return 'pt-BR'
  if (nav.toLowerCase() === 'en-gb') return 'en-GB'
  if (nav.toLowerCase().startsWith('en')) return 'en-US'
  return null
}

function resolveInitialLanguage(
  persistKey?: string,
  initialLanguage?: string | null,
  fallbackLanguage?: string | null
): Language {
  const stored = readStoredLanguage(persistKey)
  if (stored) return stored

  if (initialLanguage && initialLanguage in translations) return initialLanguage as Language

  if (fallbackLanguage && fallbackLanguage in translations) return fallbackLanguage as Language

  const browser = detectBrowserLanguage()
  if (browser) return browser

  return 'pt-BR'
}

/** `initialLanguage`/`fallbackLanguage` sozinhos, sem cair pro navegador/pt-BR
 *  — usado para saber se já existe uma fonte "real" (banco) disponível. */
function resolveRealLanguage(
  initialLanguage?: string | null,
  fallbackLanguage?: string | null
): Language | null {
  if (initialLanguage && initialLanguage in translations) return initialLanguage as Language
  if (fallbackLanguage && fallbackLanguage in translations) return fallbackLanguage as Language
  return null
}

/** Busca aninhada por dot-path (ex: 'login.emailLabel') com fallback pt-BR e depois a própria chave. */
function lookup(dict: TranslationDict | Record<string, any>, path: string): string | undefined {
  const parts = path.split('.')
  let node: any = dict
  for (const p of parts) {
    if (node == null) return undefined
    node = node[p]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? String(vars[key]) : `{${key}}`))
}

interface LanguageContextValue {
  language: Language
  setLanguage: (lang: Language) => void
  /** Traduz uma chave dot-path. Passe `count` pra escolher automaticamente _one/_other. */
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Locale pronto pra usar em toLocaleDateString/toLocaleTimeString (ex: 'en-GB'). */
  locale: string
  languages: typeof LANGUAGES
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({
  children,
  persistKey,
  initialLanguage,
  fallbackLanguage,
  onLanguageChange,
}: {
  children: React.ReactNode
  /** Geralmente o `token` do portal — isola a preferência de idioma por cliente no localStorage. */
  persistKey?: string
  /** Idioma já salvo pro cliente no banco (portalData.client.language), se houver. */
  initialLanguage?: string | null
  /** Idioma padrão global definido pelo admin em Configurações. */
  fallbackLanguage?: string | null
  /** Chamado quando o cliente troca de idioma — plugue aqui a persistência no Supabase. */
  onLanguageChange?: (lang: Language) => void
}) {
  const [language, setLanguageState] = useState<Language>(() =>
    resolveInitialLanguage(persistKey, initialLanguage, fallbackLanguage)
  )

  // ── Corrige uma condição de corrida comum: no ClientPortal.tsx (e no
  // ClientSignup.tsx), os dados vindos do servidor (client.language,
  // admin_default_language) chegam de forma assíncrona — no primeiro
  // render, `initialLanguage`/`fallbackLanguage` ainda são `undefined`
  // porque o fetch nem terminou. Como `useState(() => ...)` só roda a
  // função UMA VEZ (no mount), o Provider "decidia" o idioma antes mesmo
  // dos dados chegarem — e como não recalculava depois, o idioma padrão
  // configurado pelo admin em Settings nunca era aplicado (ficava sempre
  // em pt-BR ou no idioma detectado do navegador).
  //
  // Este efeito observa quando uma fonte "real" (banco) passa a existir e
  // aplica ela — mas só enquanto isso ainda não tiver acontecido antes, pra
  // nunca sobrescrever uma escolha que o próprio usuário já fez no seletor.
  const appliedRealSourceRef = useRef(
    !!readStoredLanguage(persistKey) || resolveRealLanguage(initialLanguage, fallbackLanguage) !== null
  )
  useEffect(() => {
    if (appliedRealSourceRef.current) return
    const real = resolveRealLanguage(initialLanguage, fallbackLanguage)
    if (real) {
      appliedRealSourceRef.current = true
      setLanguageState(real)
      // Diferente da versão anterior: agora também grava no localStorage
      // (sob a chave atual, ex: o token do cliente) e chama onLanguageChange
      // — assim, tanto uma navegação/remontagem futura na MESMA página
      // quanto os e-mails automáticos (que leem clients.language) já
      // refletem o idioma que está sendo mostrado, mesmo que a cliente
      // nunca tenha clicado no seletor manualmente.
      writeStoredLanguage(real, persistKey)
      onLanguageChange?.(real)
    }
  }, [initialLanguage, fallbackLanguage, persistKey, onLanguageChange])

  // ── Mantém o atributo `lang` do HTML em dia com o idioma ativo ─────────
  //
  // Isso não é só semântica/acessibilidade: vários elementos NATIVOS do
  // navegador (o placeholder do <input type="date"> — "dd/mm/aaaa" vs
  // "dd/mm/yyyy" —, o corretor ortográfico, leitores de tela) seguem o
  // `lang` da página, não o idioma que a gente escolhe internamente no
  // React. Sem isso, o `index.html` fica travado em `lang="pt-BR"` pra
  // sempre, e esses elementos nativos nunca acompanham o seletor.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
    }
  }, [language])

  const setLanguage = useCallback(
    (lang: Language) => {
      appliedRealSourceRef.current = true
      setLanguageState(lang)
      writeStoredLanguage(lang, persistKey)
      onLanguageChange?.(lang)
    },
    [persistKey, onLanguageChange]
  )

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = translations[language] ?? translations['pt-BR']

      // Suporte simples a plural: se vars.count existir e a chave base não for
      // encontrada, tenta `${key}_one` / `${key}_other`.
      if (vars && typeof vars.count === 'number') {
        const suffixed = vars.count === 1 ? `${key}_one` : `${key}_other`
        const pluralValue = lookup(dict, suffixed) ?? lookup(translations['pt-BR'], suffixed)
        if (pluralValue) return interpolate(pluralValue, vars)
      }

      const value = lookup(dict, key) ?? lookup(translations['pt-BR'], key) ?? key
      return interpolate(value, vars)
    },
    [language]
  )

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t, locale: language, languages: LANGUAGES }),
    [language, setLanguage, t]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error('useLanguage() precisa estar dentro de um <LanguageProvider>')
  }
  return ctx
}

// Alias mais descritivo pra quem só quer o `t`.
export const useTranslation = useLanguage