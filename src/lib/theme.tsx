// src/lib/theme.tsx
//
// Sistema de tema global do painel admin.
//
// - THEMES:                paletas de cores pré-definidas
// - ThemeProvider:         envolve o app, persiste em localStorage, injeta CSS vars em :root
// - useTheme():            hook que retorna { theme, themeName, setThemeName }
// - Dark-mode overrides:   CSS global que adapta classes Tailwind neutras (bg-white,
//                          text-gray-*, border-gray-*, etc.) quando um tema escuro
//                          está ativo. Temas claros ficam 100% intocados.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// ─── Themes ────────────────────────────────────────────────────────────────

export const THEMES = {
  rose: {
    name: 'Rosa', icon: '🌸',
    bg: '#fff5f7', surface: '#ffffff', surface2: '#fff0f3',
    border: '#fbc8d4', text: '#3d0c17', text2: '#9f4053', text3: '#d4899f',
    colBg: '#fce8ed', cardBg: '#ffffff', cardBorder: '#fbc8d4', cardHover: '#fff5f7',
    accent: '#e91e63', accentFg: '#ffffff', accentLight: '#fce4ec',
    sidebar: '#ffffff',
    header: '#2c0a16', headerText: '#ffffff', headerTextDim: 'rgba(255,255,255,0.45)',
  },
  light: {
    name: 'Claro', icon: '☀️',
    bg: '#f4f5f7', surface: '#ffffff', surface2: '#f0f1f3',
    border: '#dfe1e6', text: '#172b4d', text2: '#5e6c84', text3: '#97a0af',
    colBg: '#ebecf0', cardBg: '#ffffff', cardBorder: '#dfe1e6', cardHover: '#f4f5f7',
    accent: '#e91e63', accentFg: '#ffffff', accentLight: '#fce4ec',
    sidebar: '#ffffff',
    header: '#1a1a2e', headerText: '#ffffff', headerTextDim: 'rgba(255,255,255,0.45)',
  },
  dark: {
    name: 'Escuro', icon: '🌙',
    bg: '#0d1117', surface: '#161b22', surface2: '#21262d',
    border: '#30363d', text: '#e6edf3', text2: '#b1bac4', text3: '#6e7681',
    colBg: '#161b22', cardBg: '#161b22', cardBorder: '#30363d', cardHover: '#21262d',
    accent: '#f78166', accentFg: '#ffffff', accentLight: '#3d1c18',
    sidebar: '#161b22',
    header: '#010409', headerText: '#e6edf3', headerTextDim: 'rgba(230,237,243,0.55)',
  },
  violet: {
    name: 'Violeta', icon: '💜',
    bg: '#f5f3ff', surface: '#ffffff', surface2: '#ede9fe',
    border: '#ddd6fe', text: '#1e0a3c', text2: '#6d28d9', text3: '#a78bfa',
    colBg: '#ede9fe', cardBg: '#ffffff', cardBorder: '#ddd6fe', cardHover: '#f5f3ff',
    accent: '#7c3aed', accentFg: '#ffffff', accentLight: '#ede9fe',
    sidebar: '#ffffff',
    header: '#1e0a3c', headerText: '#ffffff', headerTextDim: 'rgba(255,255,255,0.45)',
  },
  slate: {
    name: 'Grafite', icon: '⚫',
    bg: '#0f172a', surface: '#1e293b', surface2: '#334155',
    border: '#475569', text: '#f1f5f9', text2: '#cbd5e1', text3: '#94a3b8',
    colBg: '#1e293b', cardBg: '#1e293b', cardBorder: '#334155', cardHover: '#334155',
    accent: '#38bdf8', accentFg: '#0c4a6e', accentLight: '#075985',
    sidebar: '#1e293b',
    header: '#020617', headerText: '#f1f5f9', headerTextDim: 'rgba(241,245,249,0.55)',
  },
  mint: {
    name: 'Mint', icon: '🌿',
    bg: '#f0fdf4', surface: '#ffffff', surface2: '#dcfce7',
    border: '#bbf7d0', text: '#052e16', text2: '#166534', text3: '#4ade80',
    colBg: '#dcfce7', cardBg: '#ffffff', cardBorder: '#bbf7d0', cardHover: '#f0fdf4',
    accent: '#16a34a', accentFg: '#ffffff', accentLight: '#dcfce7',
    sidebar: '#ffffff',
    header: '#052e16', headerText: '#ffffff', headerTextDim: 'rgba(255,255,255,0.45)',
  },
}

export type ThemeName = keyof typeof THEMES
export type Theme = typeof THEMES.rose

const DARK_THEMES: ThemeName[] = ['dark', 'slate']
export const isDarkTheme = (name: ThemeName) => DARK_THEMES.includes(name)

// ─── Context ───────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: Theme
  themeName: ThemeName
  setThemeName: (name: ThemeName) => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'app-theme'
const STYLE_TAG_ID = '__theme-dark-overrides__'

// ─── Dark-mode overrides CSS ───────────────────────────────────────────────
// Escopados em [data-theme-mode="dark"], então só disparam nos temas escuros.
// As barras `\\` viram `\` no CSS final — necessário para escapar `:` em
// classes Tailwind como `hover\:bg-gray-50`.
const DARK_OVERRIDES_CSS = `
:root[data-theme-mode="dark"] { color-scheme: dark; }

/* ─ Backgrounds ─ */
[data-theme-mode="dark"] .bg-white,
[data-theme-mode="dark"] .bg-gray-50 { background-color: var(--theme-cardBg); }
[data-theme-mode="dark"] .bg-gray-100,
[data-theme-mode="dark"] .bg-gray-200 { background-color: var(--theme-surface2); }

[data-theme-mode="dark"] .hover\\:bg-white:hover,
[data-theme-mode="dark"] .hover\\:bg-gray-50:hover,
[data-theme-mode="dark"] .hover\\:bg-gray-100:hover { background-color: var(--theme-surface2); }

/* ─ Borders ─ */
[data-theme-mode="dark"] .border-gray-100,
[data-theme-mode="dark"] .border-gray-200,
[data-theme-mode="dark"] .border-gray-300 { border-color: var(--theme-border); }

/* ─ Text ─ */
[data-theme-mode="dark"] .text-gray-900,
[data-theme-mode="dark"] .text-gray-800 { color: var(--theme-text); }
[data-theme-mode="dark"] .text-gray-700,
[data-theme-mode="dark"] .text-gray-600 { color: var(--theme-text2); }
[data-theme-mode="dark"] .text-gray-500,
[data-theme-mode="dark"] .text-gray-400,
[data-theme-mode="dark"] .text-gray-300 { color: var(--theme-text3); }

/* ─ Form controls ─ */
[data-theme-mode="dark"] input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]):not([type="range"]),
[data-theme-mode="dark"] textarea,
[data-theme-mode="dark"] select {
  background-color: var(--theme-surface2);
  color: var(--theme-text);
  border-color: var(--theme-border);
}
[data-theme-mode="dark"] input::placeholder,
[data-theme-mode="dark"] textarea::placeholder { color: var(--theme-text3); opacity: 1; }

/* ─ Soft tint cards (gradientes decorativos continuam, mas suavizados) ─ */
[data-theme-mode="dark"] .bg-violet-50,
[data-theme-mode="dark"] .bg-purple-50,
[data-theme-mode="dark"] .bg-fuchsia-50,
[data-theme-mode="dark"] .bg-blue-50,
[data-theme-mode="dark"] .bg-cyan-50,
[data-theme-mode="dark"] .bg-emerald-50,
[data-theme-mode="dark"] .bg-teal-50,
[data-theme-mode="dark"] .bg-amber-50,
[data-theme-mode="dark"] .bg-orange-50,
[data-theme-mode="dark"] .bg-pink-50,
[data-theme-mode="dark"] .bg-rose-50,
[data-theme-mode="dark"] .bg-red-50,
[data-theme-mode="dark"] .bg-green-50,
[data-theme-mode="dark"] .bg-yellow-50 { background-color: color-mix(in srgb, var(--theme-accent) 15%, var(--theme-surface2)); }

/* Gradientes "from-X-50 to-Y-50" usados em headers de card — descolorir para o tema */
[data-theme-mode="dark"] .from-violet-50, [data-theme-mode="dark"] .from-purple-50,
[data-theme-mode="dark"] .from-fuchsia-50,[data-theme-mode="dark"] .from-blue-50,
[data-theme-mode="dark"] .from-cyan-50,   [data-theme-mode="dark"] .from-emerald-50,
[data-theme-mode="dark"] .from-teal-50,   [data-theme-mode="dark"] .from-amber-50,
[data-theme-mode="dark"] .from-orange-50, [data-theme-mode="dark"] .from-pink-50,
[data-theme-mode="dark"] .from-rose-50,   [data-theme-mode="dark"] .from-green-50,
[data-theme-mode="dark"] .from-yellow-50,
[data-theme-mode="dark"] .to-violet-50,   [data-theme-mode="dark"] .to-purple-50,
[data-theme-mode="dark"] .to-fuchsia-50,  [data-theme-mode="dark"] .to-blue-50,
[data-theme-mode="dark"] .to-cyan-50,     [data-theme-mode="dark"] .to-emerald-50,
[data-theme-mode="dark"] .to-teal-50,     [data-theme-mode="dark"] .to-amber-50,
[data-theme-mode="dark"] .to-orange-50,   [data-theme-mode="dark"] .to-pink-50,
[data-theme-mode="dark"] .to-rose-50,     [data-theme-mode="dark"] .to-green-50,
[data-theme-mode="dark"] .to-yellow-50 {
  --tw-gradient-from: var(--theme-surface2) var(--tw-gradient-from-position);
  --tw-gradient-to: var(--theme-surface2) var(--tw-gradient-to-position);
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to);
}

/* ─ Accent color links (violet/blue/rose -600/700 text) continuam funcionando ─ */
/* (não sobrescrevemos; essas classes usam cores vivas que funcionam em ambos modos) */

/* ─ Shadows ─ pequenas sombras ficam invisíveis no dark, então reforçamos via borda */
[data-theme-mode="dark"] .shadow-sm,
[data-theme-mode="dark"] .shadow { box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
[data-theme-mode="dark"] .shadow-md { box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
[data-theme-mode="dark"] .shadow-lg,
[data-theme-mode="dark"] .shadow-xl,
[data-theme-mode="dark"] .shadow-2xl { box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
`

function ensureOverridesStyle() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_TAG_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_TAG_ID
  style.textContent = DARK_OVERRIDES_CSS
  document.head.appendChild(style)
}

// ─── Provider ──────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeNameState] = useState<ThemeName>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null
      if (saved && saved in THEMES) return saved
      // Migração da chave antiga usada só no kanban
      const legacy = localStorage.getItem('kanban-theme') as ThemeName | null
      if (legacy && legacy in THEMES) {
        localStorage.setItem(STORAGE_KEY, legacy)
        return legacy
      }
    } catch {}
    return 'rose'
  })

  const setThemeName = useCallback((name: ThemeName) => {
    setThemeNameState(name)
    try { localStorage.setItem(STORAGE_KEY, name) } catch {}
  }, [])

  const theme = THEMES[themeName]
  const isDark = isDarkTheme(themeName)

  // Injeta cada cor como CSS custom property em :root
  // → fica disponível em todo CSS via var(--theme-bg), var(--theme-accent), etc.
  // E define data-theme / data-theme-mode no <html> para os overrides CSS.
  useEffect(() => {
    ensureOverridesStyle()
    const root = document.documentElement
    Object.entries(theme).forEach(([key, value]) => {
      if (key === 'name' || key === 'icon') return
      root.style.setProperty(`--theme-${key}`, value as string)
    })
    root.dataset.theme = themeName
    root.dataset.themeMode = isDark ? 'dark' : 'light'
  }, [theme, themeName, isDark])

  const value = useMemo(
    () => ({ theme, themeName, setThemeName, isDark }),
    [theme, themeName, setThemeName, isDark]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Fallback seguro se alguém chamar fora do provider (não deve acontecer, mas evita crash)
    return { theme: THEMES.rose, themeName: 'rose', setThemeName: () => {}, isDark: false }
  }
  return ctx
}