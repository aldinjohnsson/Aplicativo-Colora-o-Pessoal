// src/components/client/LanguageSwitcher.tsx
import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useLanguage, Language } from '../../lib/i18n'

// ─── Bandeiras em SVG ─────────────────────────────────────────────────────
//
// Emoji de bandeira (🇧🇷 🇺🇸 🇬🇧) não renderiza em boa parte do Linux/Chrome
// (aparece como texto "BR"/"US" solto, sem fonte de emoji regional instalada).
// Por isso usamos SVGs próprios — sempre aparecem, em qualquer SO/navegador.

function FlagBR({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 16" className={className} aria-hidden="true">
      <rect width="24" height="16" rx="2" fill="#009739" />
      <polygon points="12,2.3 22,8 12,13.7 2,8" fill="#FEDD00" />
      <circle cx="12" cy="8" r="3.6" fill="#012169" />
    </svg>
  )
}

function FlagUS({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 16" className={className} aria-hidden="true">
      <rect width="24" height="16" rx="2" fill="#B22234" />
      {[0, 1, 2, 3, 4, 5].map(i => (
        <rect key={i} x="0" y={i * (16 / 13) * 2} width="24" height={16 / 13} fill="#FFFFFF" />
      ))}
      <rect width="10.5" height="8.6" fill="#3C3B6E" />
    </svg>
  )
}

function FlagGB({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 16" className={className} aria-hidden="true">
      <rect width="24" height="16" rx="2" fill="#012169" />
      <path d="M0,0 L24,16 M24,0 L0,16" stroke="#FFFFFF" strokeWidth="3.2" />
      <path d="M0,0 L24,16 M24,0 L0,16" stroke="#C8102E" strokeWidth="1.4" />
      <path d="M12,0 V16 M0,8 H24" stroke="#FFFFFF" strokeWidth="5.4" />
      <path d="M12,0 V16 M0,8 H24" stroke="#C8102E" strokeWidth="3.2" />
    </svg>
  )
}

const FLAGS: Record<Language, React.FC<{ className?: string }>> = {
  'pt-BR': FlagBR,
  'en-US': FlagUS,
  'en-GB': FlagGB,
}

interface LanguageSwitcherProps {
  /** 'header' pra usar em cabeçalhos com fundo claro/gradiente (padrão),
   *  'minimal' pra caber num header bem apertado (ainda com bandeira). */
  variant?: 'header' | 'minimal'
}

export function LanguageSwitcher({ variant = 'header' }: LanguageSwitcherProps) {
  const { language, setLanguage, languages, t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const current = languages.find(l => l.code === language) ?? languages[0]
  const CurrentFlag = FLAGS[current.code]

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={t('languageSwitcher.label')}
        aria-expanded={open}
        className={
          variant === 'minimal'
            ? 'flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full border border-rose-200 bg-white hover:bg-rose-50 hover:border-rose-300 shadow-sm transition-colors'
            : 'flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border border-rose-200 bg-white hover:bg-rose-50 hover:border-rose-300 shadow-sm transition-colors'
        }
      >
        <CurrentFlag className={variant === 'minimal' ? 'w-5 h-3.5 rounded-[2px] shadow-sm' : 'w-6 h-4 rounded-[2px] shadow-sm'} />
        <span className={variant === 'minimal' ? 'text-xs font-medium text-gray-700' : 'text-sm font-medium text-gray-700'}>
          {current.code}
        </span>
        <ChevronDown className={`text-rose-400 transition-transform ${open ? 'rotate-180' : ''} ${variant === 'minimal' ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200 py-1.5 z-[999]">
          <p className="px-3 pt-1.5 pb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            {t('languageSwitcher.label')}
          </p>
          {languages.map(lang => {
            const Flag = FLAGS[lang.code]
            const active = lang.code === language
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => { setLanguage(lang.code); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                  active ? 'bg-rose-50' : 'hover:bg-gray-50'
                }`}
              >
                <Flag className="w-6 h-4 rounded-[2px] shadow-sm flex-shrink-0" />
                <span className={`flex-1 ${active ? 'font-semibold text-rose-700' : 'text-gray-700'}`}>{lang.label}</span>
                {active && <Check className="h-4 w-4 text-rose-500 flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}