// src/components/admin/iris-analysis/types.ts

export type FontFamily =
  | 'Inter'
  | 'Playfair Display'
  | 'Cormorant Garamond'
  | 'Montserrat'
  | 'Lora'

export const AVAILABLE_FONTS: { value: FontFamily; label: string; stack: string }[] = [
  { value: 'Inter',              label: 'Inter (sans-serif moderna)',  stack: "'Inter', system-ui, sans-serif" },
  { value: 'Montserrat',         label: 'Montserrat (sans-serif)',     stack: "'Montserrat', system-ui, sans-serif" },
  { value: 'Playfair Display',   label: 'Playfair (serif elegante)',   stack: "'Playfair Display', Georgia, serif" },
  { value: 'Cormorant Garamond', label: 'Cormorant (serif romântica)', stack: "'Cormorant Garamond', Georgia, serif" },
  { value: 'Lora',               label: 'Lora (serif legível)',        stack: "'Lora', Georgia, serif" },
]

export function fontStack(family: FontFamily): string {
  return AVAILABLE_FONTS.find(f => f.value === family)?.stack ?? "'Inter', system-ui, sans-serif"
}

/** Template salvo de texto padrão pra carregar no dialog. */
export interface IrisTextTemplate {
  id: string
  name: string
  title: string
  body: string
  fontFamily: FontFamily
  textColor: string
  bgColor: string
  titleSize: number
  bodySize: number
  createdAt: string
  updatedAt: string
}

/** Estado completo do card que o dialog manipula. */
export interface IrisCardState {
  imageDataUrl: string | null
  zoom: number
  offsetX: number
  offsetY: number
  title: string
  body: string
  fontFamily: FontFamily
  textColor: string
  bgColor: string
  titleSize: number
  bodySize: number
}

/**
 * Registro persistido por cliente. Vai dentro do documento do cliente,
 * lado-a-lado com "contraste", "subtom", etc.
 */
export interface IrisAnalysisRecord extends IrisCardState {
  /** PNG já renderizado pra usar em prompts e mostrar miniatura. */
  cardPngDataUrl: string
  /** ISO. */
  updatedAt: string
}

export const DEFAULT_CARD_STATE: IrisCardState = {
  imageDataUrl: null,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  title: 'ANÁLISE DA ÍRIS',
  body:
    'Sua íris possui tonalidade: castanho médio quente. Uma íris de padrão: cratera com gotas ou pétalas. Possui borda suave ao redor.',
  fontFamily: 'Playfair Display',
  textColor: '#2b2b2b',
  bgColor: '#f7f3ee',
  titleSize: 28,
  bodySize: 18,
}

/** Dimensões fixas do card gerado. */
export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 600
export const CIRCLE_RADIUS = 230
export const CIRCLE_CENTER_X = 320
export const CIRCLE_CENTER_Y = CARD_HEIGHT / 2
export const TEXT_AREA_X = 620
export const TEXT_AREA_WIDTH = CARD_WIDTH - TEXT_AREA_X - 60