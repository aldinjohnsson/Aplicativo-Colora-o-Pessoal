// src/components/admin/documents/generate/generatePdf.ts
//
// Motor de geração da Fase 5 — versão revisada.
//
// Mudanças principais em relação à versão anterior:
//  • IMAGEM "cover" agora é REAL: a imagem é recortada via canvas no
//    aspect ratio do retângulo ANTES de ser embedada no PDF. Resultado:
//    a imagem preenche o retângulo exatamente como o usuário definiu,
//    sem sobra (era o bug de "imagem fica menor que o tamanho que coloco").
//  • TEXTO usa o ascent real da fonte (`heightAtSize(size, descender:false)`)
//    para posicionar o topo da primeira linha colado no topo do retângulo.
//    Antes usava `fontSize` como aproximação, e o texto descia ~25%.
//  • TEXTO suporta verticalAlign: 'top' | 'middle' | 'bottom'.
//  • TEXTO suporta autoFit: reduz fontSize até caber em largura e altura.
//
// Sistema de coordenadas:
//   • Banco guarda x_pt/y_pt com origem NO CANTO SUPERIOR ESQUERDO.
//   • pdf-lib usa origem NO CANTO INFERIOR ESQUERDO.
//   • Conversão: y_pdf = pageHeight - y_top - height

import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type {
  DocumentTemplate,
  DocumentTemplateElement,
  DocumentTag,
  ElementStyle,
} from '../types'
import { FontRegistry } from '../lib/pdfFonts'

// ─── Tipos de entrada ─────────────────────────────────────────────────

export interface TagValueResolved {
  tag: DocumentTag
  kind: 'text' | 'image'
  text?: string
  imageBytes?: ArrayBuffer
  imageMime?: string // 'image/jpeg' | 'image/png' | ...
}

export interface GeneratePdfInput {
  template: DocumentTemplate
  elements: DocumentTemplateElement[]
  values: Record<string, TagValueResolved>   // chave = tag_id
  basePdfBytes: ArrayBuffer
}

// ─── Helpers ──────────────────────────────────────────────────────────

function hexToRgb(hex: string | undefined): { r: number; g: number; b: number } {
  const fallback = { r: 0, g: 0, b: 0 }
  if (!hex) return fallback
  const clean = hex.trim().replace('#', '')
  if (clean.length !== 3 && clean.length !== 6) return fallback
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean
  const r = parseInt(full.substring(0, 2), 16) / 255
  const g = parseInt(full.substring(2, 4), 16) / 255
  const b = parseInt(full.substring(4, 6), 16) / 255
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallback
  return { r, g, b }
}

function measureLineWidth(
  line: string,
  font: import('pdf-lib').PDFFont,
  fontSize: number,
  letterSpacing: number,
): number {
  const base = font.widthOfTextAtSize(line, fontSize)
  if (letterSpacing === 0 || line.length <= 1) return base
  return base + letterSpacing * (line.length - 1)
}

/** Quebra texto em linhas que caibam em maxWidthPt, considerando letterSpacing. */
function wrapText(
  text: string,
  maxWidthPt: number,
  fontSize: number,
  font: import('pdf-lib').PDFFont,
  letterSpacing: number,
): string[] {
  if (maxWidthPt <= 0) return [text]
  const paragraphs = text.split('\n')
  const lines: string[] = []

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) { lines.push(''); continue }
    const tokens = paragraph.split(/(\s+)/)  // mantém espaços como tokens
    let current = ''

    for (const token of tokens) {
      const candidate = current + token
      const width = measureLineWidth(candidate, font, fontSize, letterSpacing)
      if (width <= maxWidthPt || current === '') {
        current = candidate
      } else {
        lines.push(current.trimEnd())
        current = token.trimStart()
      }
    }
    if (current) lines.push(current.trimEnd())
  }
  return lines
}

// ─── Engine ───────────────────────────────────────────────────────────

export async function generatePdf(input: GeneratePdfInput): Promise<Blob> {
  const { elements, values, basePdfBytes } = input

  // Cópia defensiva — pdf-lib mutates the buffer
  const pdf = await PDFDocument.load(basePdfBytes.slice(0))
  pdf.registerFontkit(fontkit)

  const fonts = new FontRegistry(pdf)
  const pages = pdf.getPages()

  // z_index menor → fundo
  const ordered = [...elements].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0))

  for (const el of ordered) {
    const resolved = values[el.tag_id]
    if (!resolved) continue

    const page = pages[el.page_number - 1]
    if (!page) continue

    const pageHeight = page.getHeight()
    const style: ElementStyle = (el.style as ElementStyle) || {}

    const isImage = resolved.kind === 'image'
    const width  = el.width_pt  ?? (isImage ? 180 : 180)
    const height = el.height_pt ?? (isImage ? 180 : 40)

    // top-left (banco) → bottom-left (pdf-lib)
    const x = el.x_pt
    const y = pageHeight - el.y_pt - height

    if (resolved.kind === 'text') {
      await drawText({
        page, text: resolved.text || '',
        x, y, width, height,
        style, fonts,
      })
    } else {
      await drawImage({
        pdf, page,
        bytes: resolved.imageBytes!, mime: resolved.imageMime || 'image/jpeg',
        x, y, width, height,
        style,
      })
    }
  }

  const out = await pdf.save()
  return new Blob([out], { type: 'application/pdf' })
}

// ═══════════ TEXTO ════════════════════════════════════════════════════

async function drawText(params: {
  page: import('pdf-lib').PDFPage
  text: string
  x: number; y: number; width: number; height: number
  style: ElementStyle
  fonts: FontRegistry
}) {
  const { page, text, x, y, width, height, style, fonts } = params

  const lineHeightFactor = style.lineHeight ?? 1.3
  const letterSpacing    = style.letterSpacing ?? 0
  const align            = style.align ?? 'left'
  const verticalAlign    = style.verticalAlign ?? 'top'
  const color            = hexToRgb(style.color ?? '#111827')
  const fontFamily       = style.fontFamily ?? 'Inter'
  const autoFit          = style.autoFit === true   // opt-in

  const font = await fonts.get(fontFamily, !!style.bold, !!style.italic)

  // textTransform antes de medir
  let prepared = text
  if (style.textTransform === 'uppercase') prepared = prepared.toUpperCase()
  else if (style.textTransform === 'lowercase') prepared = prepared.toLowerCase()

  // ── Determina fontSize final (eventual auto-fit)
  let fontSize = Math.max(2, style.fontSize ?? 14)
  let lines = wrapText(prepared, width, fontSize, font, letterSpacing)

  if (autoFit) {
    const minSize = 6
    // Reduz em passos de 0.5pt até caber tanto em largura quanto em altura.
    while (
      fontSize > minSize &&
      (
        lines.length * fontSize * lineHeightFactor > height ||
        lines.some(l => measureLineWidth(l, font, fontSize, letterSpacing) > width)
      )
    ) {
      fontSize -= 0.5
      lines = wrapText(prepared, width, fontSize, font, letterSpacing)
    }
  }

  if (lines.length === 0) return

  const lineSpacing = fontSize * lineHeightFactor

  // Ascent real da fonte no tamanho atual (sem descender). Isso faz com
  // que o TOPO visível da primeira letra fique exatamente no topo do box.
  // pdf-lib expõe `heightAtSize(size, { descender: false })`.
  // Fallback se a build do pdf-lib não suportar a opção: ~0.78 * fontSize.
  let ascent: number
  try {
    ascent = (font as any).heightAtSize(fontSize, { descender: false })
    if (!Number.isFinite(ascent) || ascent <= 0) ascent = fontSize * 0.78
  } catch {
    ascent = fontSize * 0.78
  }

  // Altura visual do bloco = ascent (1ª linha) + (n-1) * line spacing
  const totalBlockHeight = ascent + (lines.length - 1) * lineSpacing

  // Onde, dentro do retângulo, começa o topo do bloco?
  let topOffset = 0
  if (verticalAlign === 'middle') topOffset = (height - totalBlockHeight) / 2
  else if (verticalAlign === 'bottom') topOffset = height - totalBlockHeight
  if (topOffset < 0) topOffset = 0

  // Topo do retângulo em coords pdf-lib (bottom-left)
  const boxTop = y + height
  // Baseline da PRIMEIRA linha
  let baselineY = boxTop - topOffset - ascent

  for (const line of lines) {
    if (baselineY < y - 0.5) break   // cortou no fundo do box

    const textWidth = measureLineWidth(line, font, fontSize, letterSpacing)

    let lineX = x
    if (align === 'center')      lineX = x + (width - textWidth) / 2
    else if (align === 'right')  lineX = x + (width - textWidth)
    // 'justify' não é suportado por pdf-lib nativamente — cai pra left.

    if (letterSpacing === 0) {
      page.drawText(line, {
        x: lineX,
        y: baselineY,
        size: fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
      })
    } else {
      let xCursor = lineX
      for (const ch of line) {
        page.drawText(ch, {
          x: xCursor,
          y: baselineY,
          size: fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
        })
        xCursor += font.widthOfTextAtSize(ch, fontSize) + letterSpacing
      }
    }

    baselineY -= lineSpacing
  }
}

// ═══════════ IMAGEM ═══════════════════════════════════════════════════

/**
 * Recorta a imagem para o aspect ratio do box, retornando bytes prontos
 * para embed. Usado para "cover" — garante que após o embed, a imagem
 * preenche o retângulo exatamente, sem deformação e sem sobra.
 *
 * Implementação: createImageBitmap (decodifica) → canvas (recorta e
 * redimensiona) → toBlob (recodifica).
 *
 * Resolução do canvas: limitada para evitar arquivos enormes. Usamos
 * ~3× a largura final do box em pt, com piso de 800px. Isso dá qualidade
 * de impressão sem inflar o PDF.
 */
async function cropImageForCover(
  bytes: ArrayBuffer,
  mime: string,
  boxWPt: number,
  boxHPt: number,
): Promise<{ bytes: ArrayBuffer; mime: 'image/png' | 'image/jpeg' }> {
  const blob = new Blob([bytes], { type: mime })
  const bitmap = await createImageBitmap(blob)

  const imgRatio = bitmap.width / bitmap.height
  const boxRatio = boxWPt / boxHPt

  // Determina a área de origem (sx,sy,sw,sh) no aspect ratio do box,
  // centralizada na imagem.
  let sx = 0, sy = 0
  let sw = bitmap.width, sh = bitmap.height
  if (imgRatio > boxRatio) {
    // imagem mais larga que o box → corta laterais
    sw = bitmap.height * boxRatio
    sx = (bitmap.width - sw) / 2
  } else if (imgRatio < boxRatio) {
    // imagem mais alta que o box → corta topo/base
    sh = bitmap.width / boxRatio
    sy = (bitmap.height - sh) / 2
  }

  // Resolução de saída: limita a no máximo ~3× a largura do box e nunca
  // maior que o crop original.
  const maxTargetW = Math.max(800, boxWPt * 3)
  const targetW = Math.min(sw, maxTargetW)
  const scale = targetW / sw

  const canvas = document.createElement('canvas')
  canvas.width  = Math.max(1, Math.round(sw * scale))
  canvas.height = Math.max(1, Math.round(sh * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponível para recorte de imagem')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

  // Mantém PNG se a origem é PNG (pode ter transparência); caso contrário
  // usa JPEG pra ficar leve.
  const isPng = mime.toLowerCase().includes('png')
  const outMime: 'image/png' | 'image/jpeg' = isPng ? 'image/png' : 'image/jpeg'

  const outBlob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('canvas.toBlob falhou')),
      outMime,
      0.92,
    ),
  )
  // libera o bitmap
  bitmap.close?.()
  return { bytes: await outBlob.arrayBuffer(), mime: outMime }
}

async function drawImage(params: {
  pdf: import('pdf-lib').PDFDocument
  page: import('pdf-lib').PDFPage
  bytes: ArrayBuffer
  mime: string
  x: number; y: number; width: number; height: number
  style: ElementStyle
}) {
  const { pdf, page, bytes, mime, x, y, width, height, style } = params
  const fit: 'cover' | 'contain' = style.objectFit ?? 'cover'

  // Para cover: recorta antes pra preencher exatamente o box.
  let imgBytes = bytes
  let imgMime  = mime
  if (fit === 'cover') {
    const cropped = await cropImageForCover(bytes, mime, width, height)
    imgBytes = cropped.bytes
    imgMime  = cropped.mime
  }

  const m = imgMime.toLowerCase()
  const img = m.includes('png')
    ? await pdf.embedPng(imgBytes)
    : await pdf.embedJpg(imgBytes)

  if (fit === 'cover') {
    // Após o crop, a imagem JÁ está no aspect ratio do box.
    page.drawImage(img, { x, y, width, height })
    return
  }

  // contain: encaixa inteira, centralizada, mantém proporção
  const imgRatio = img.width / img.height
  const boxRatio = width / height

  let drawW: number, drawH: number, drawX: number, drawY: number
  if (imgRatio > boxRatio) {
    drawW = width
    drawH = width / imgRatio
    drawX = x
    drawY = y + (height - drawH) / 2
  } else {
    drawH = height
    drawW = height * imgRatio
    drawY = y
    drawX = x + (width - drawW) / 2
  }
  page.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH })
}