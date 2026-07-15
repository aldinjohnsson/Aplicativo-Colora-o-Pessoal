// src/lib/clientTheme.ts
//
// Tema visual do portal do cliente (Login / Cadastro / Portal), configurável
// por admin. O admin escolhe DUAS cores em Configurações:
//   - accentColor: a cor "forte" da marca — ícone do IA Color, botões
//     primários, barra de progresso, links, foco dos inputs.
//   - bgColor: o tom de fundo da página (o degradê suave por trás de tudo).
//
// Todo o resto (tons claros pra hover, gradientes, etc.) é DERIVADO dessas
// duas cores automaticamente, expostas como CSS custom properties. Os
// componentes usam classes Tailwind com valor arbitrário apontando pra essas
// variáveis (ex: `bg-[var(--client-accent)]`) — funciona porque a classe em
// si é um literal estático no código-fonte (o JIT do Tailwind só não
// consegue resolver strings de classe montadas dinamicamente).
//
// Sem tema configurado, cai no rosa/pink padrão (visual histórico do produto).

export interface ClientTheme {
  accentColor?: string
  bgColor?: string
}

export const DEFAULT_CLIENT_THEME: Required<ClientTheme> = {
  accentColor: '#ec4899', // pink-500 — mesma cor forte usada até hoje
  bgColor: '#fff1f2',     // ~rose-50 — fundo suave usado até hoje
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function mix(hex: string, target: number[], amount: number): string {
  if (!HEX_RE.test(hex)) hex = DEFAULT_CLIENT_THEME.accentColor
  const num = parseInt(hex.slice(1), 16)
  const rgb = [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff]
  const out = rgb.map((c, i) => Math.round(c + (target[i] - c) * amount))
  return `#${out.map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`
}

/** Clareia uma cor hex em direção ao branco. amount: 0 (sem mudança) a 1 (branco puro). */
export function lightenHex(hex: string, amount: number): string {
  return mix(hex, [255, 255, 255], amount)
}

/** Escurece uma cor hex em direção ao preto. amount: 0 (sem mudança) a 1 (preto puro). */
export function darkenHex(hex: string, amount: number): string {
  return mix(hex, [0, 0, 0], amount)
}

/**
 * Monta o mapa de CSS custom properties do tema, pronto pra jogar no `style`
 * de um wrapper (ex: `<div style={clientThemeVars(theme) as React.CSSProperties}>`).
 * Todos os descendentes herdam as variáveis via cascata normal do CSS.
 */
export function clientThemeVars(theme?: ClientTheme | null): Record<string, string> {
  const accent = (theme?.accentColor && HEX_RE.test(theme.accentColor))
    ? theme.accentColor
    : DEFAULT_CLIENT_THEME.accentColor
  const bg = (theme?.bgColor && HEX_RE.test(theme.bgColor))
    ? theme.bgColor
    : DEFAULT_CLIENT_THEME.bgColor

  return {
    '--client-accent': accent,
    '--client-accent-light': lightenHex(accent, 0.28),   // stop claro dos degradês (ex: from-rose-400 antigo)
    '--client-accent-lighter': lightenHex(accent, 0.55), // tons bem suaves (hover de cards, badges)
    '--client-accent-soft': lightenHex(accent, 0.88),    // fundo tipo rose-50/pink-50 (banners, cards suaves)
    '--client-accent-soft2': lightenHex(accent, 0.80),   // fundo tipo rose-100 (hover dos cards suaves)
    '--client-accent-dark': darkenHex(accent, 0.12),      // hover de botão primário (tipo rose-600)
    '--client-accent-border': lightenHex(accent, 0.75),   // bordas suaves (tipo rose-100/200)
    '--client-bg': bg,
    '--client-bg-soft': lightenHex(bg, 0.5),
  }
}
