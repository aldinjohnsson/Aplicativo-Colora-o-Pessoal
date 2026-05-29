// src/components/admin/documents/client/irisCardGenerator.ts
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  CIRCLE_CENTER_X,
  CIRCLE_CENTER_Y,
  CIRCLE_RADIUS,
  IrisCardState,
  TEXT_AREA_WIDTH,
  TEXT_AREA_X,
  fontStack,
} from './irisAnalysisTypes'

// ── Google Fonts loader ────────────────────────────────────────────────────
// Injeta o link do Google Fonts no <head> caso ainda não esteja presente,
// depois força o carregamento das famílias usadas na ferramenta de íris.
// Isso resolve o bug de sobreposição de texto no canvas quando as fontes
// ainda não estavam disponíveis no momento do primeiro draw.

const GOOGLE_FONTS_FAMILIES = [
  'Playfair+Display:wght@400;700',
  'Cormorant+Garamond:wght@400;700',
  'Montserrat:wght@400;700',
  'Lora:wght@400;700',
  'Inter:wght@400;700',
]

function ensureGoogleFontsLink() {
  const id = 'iris-google-fonts'
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS_FAMILIES.map(f => `family=${f}`).join('&')}&display=swap`
  document.head.appendChild(link)
}

let _fontsLoaded = false

async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined') return
  if (_fontsLoaded) return

  ensureGoogleFontsLink()

  // Aguarda o carregamento nativo do navegador
  if ('fonts' in document) {
    try {
      await (document as any).fonts.ready
    } catch { /* ignore */ }
  }

  // Força o parse das famílias carregando um glifo invisível em cada uma.
  // Sem isso o canvas pode usar o fallback mesmo após fonts.ready.
  const families = [
    'Playfair Display',
    'Cormorant Garamond',
    'Montserrat',
    'Lora',
    'Inter',
  ]
  await Promise.allSettled(
    families.flatMap(family => [
      (document as any).fonts.load(`700 16px "${family}"`),
      (document as any).fonts.load(`400 16px "${family}"`),
    ])
  )

  _fontsLoaded = true
}

/**
 * Carrega uma imagem a partir de um dataUrl/URL e resolve quando estiver decodificada.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Falha ao carregar imagem'))
    img.src = src
  })
}

/** Quebra texto em linhas que cabem em maxWidth. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split(/\n+/)
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate
      } else {
        if (current) lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
    lines.push('') // espaço entre parágrafos
  }
  // remove última linha vazia
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Desenha o card no canvas fornecido (ou cria um novo) e devolve o canvas.
 * Útil tanto pro preview ao vivo quanto pra exportar PNG.
 */
export async function renderIrisCard(
  state: IrisCardState,
  targetCanvas?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const canvas = targetCanvas ?? document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D não disponível')

  // Garante que as Google Fonts estão injetadas e carregadas antes de medir/desenhar.
  // Sem isso o canvas usa o fallback e o texto fica sobreposto (medidas erradas).
  await ensureFontsLoaded()

  // 1. Fundo
  ctx.fillStyle = state.bgColor
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  // 2. Foto recortada em círculo
  if (state.imageDataUrl) {
    const img = await loadImage(state.imageDataUrl)
    ctx.save()
    ctx.beginPath()
    ctx.arc(CIRCLE_CENTER_X, CIRCLE_CENTER_Y, CIRCLE_RADIUS, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()

    // Dimensiona a imagem pra cobrir o círculo no zoom 1 (modo cover)
    const baseScale = Math.max(
      (CIRCLE_RADIUS * 2) / img.width,
      (CIRCLE_RADIUS * 2) / img.height,
    )
    const scale = baseScale * state.zoom
    const drawW = img.width * scale
    const drawH = img.height * scale
    const dx = CIRCLE_CENTER_X - drawW / 2 + state.offsetX
    const dy = CIRCLE_CENTER_Y - drawH / 2 + state.offsetY
    ctx.drawImage(img, dx, dy, drawW, drawH)
    ctx.restore()
  } else {
    // placeholder cinza
    ctx.save()
    ctx.beginPath()
    ctx.arc(CIRCLE_CENTER_X, CIRCLE_CENTER_Y, CIRCLE_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = '#e5e5e5'
    ctx.fill()
    ctx.fillStyle = '#888'
    ctx.font = `500 22px ${fontStack(state.fontFamily)}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Sem foto', CIRCLE_CENTER_X, CIRCLE_CENTER_Y)
    ctx.restore()
  }

  // 3. Bloco de texto à direita
  const fStack = fontStack(state.fontFamily)
  ctx.fillStyle = state.textColor
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  // Título
  ctx.font = `700 ${state.titleSize}px ${fStack}`
  const titleLineHeight = state.titleSize * 1.2
  const titleLines = wrapLines(ctx, state.title, TEXT_AREA_WIDTH)

  // Corpo
  const bodyFont = `400 ${state.bodySize}px ${fStack}`
  const bodyLineHeight = state.bodySize * 1.5

  // Mede altura total pra centralizar verticalmente
  ctx.font = bodyFont
  const bodyLines = wrapLines(ctx, state.body, TEXT_AREA_WIDTH)
  const titleBlockHeight = titleLines.length * titleLineHeight
  const bodyBlockHeight = bodyLines.length * bodyLineHeight
  const gap = state.titleSize * 0.6
  const totalHeight = titleBlockHeight + gap + bodyBlockHeight
  let y = (CARD_HEIGHT - totalHeight) / 2

  // Desenha título
  ctx.font = `700 ${state.titleSize}px ${fStack}`
  for (const line of titleLines) {
    ctx.fillText(line, TEXT_AREA_X, y)
    y += titleLineHeight
  }
  y += gap

  // Desenha corpo
  ctx.font = bodyFont
  for (const line of bodyLines) {
    if (line === '') {
      y += bodyLineHeight * 0.5
      continue
    }
    ctx.fillText(line, TEXT_AREA_X, y)
    y += bodyLineHeight
  }

  return canvas
}

/** Renderiza e retorna dataUrl PNG. */
export async function renderIrisCardToPng(state: IrisCardState): Promise<string> {
  const canvas = await renderIrisCard(state)
  return canvas.toDataURL('image/png')
}

/** Dispara download de um dataUrl como arquivo. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}