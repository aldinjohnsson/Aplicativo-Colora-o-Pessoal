// src/components/admin/documents/generate/generatePdf.ts
//
// Motor de geração da Fase 5.
//
// Dado um template + valores das tags do cliente, carimba cada elemento
// (texto ou imagem) no PDF base e devolve um Blob pronto pra upload.
//
// Sistema de coordenadas:
//   • Banco guarda x_pt/y_pt com origem NO CANTO SUPERIOR ESQUERDO (como HTML).
//   • pdf-lib usa origem NO CANTO INFERIOR ESQUERDO.
//   • Conversão: y_pdf = pageHeight - y_top - height

import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type {
  DocumentTemplate,
  DocumentTemplateElement,
  DocumentTag,
  ClientTagValue,
  ElementStyle,
} from '../types'
import { FontRegistry } from '../lib/pdfFonts'

// ─── Tipos de entrada ─────────────────────────────────────────────────

export interface TagValueResolved {
  tag: DocumentTag
  // Texto final (tags de texto) OU URL + bytes (tags de imagem)
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

// ─── Helpers de conversão ─────────────────────────────────────────────

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

/** Quebra o texto em linhas que caibam na largura (em pontos). */
function wrapText(
  text: string,
  maxWidthPt: number,
  fontSize: number,
  font: import('pdf-lib').PDFFont,
): string[] {
  if (maxWidthPt <= 0) return [text]
  const paragraphs = text.split('\n')
  const lines: string[] = []

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) { lines.push(''); continue }
    const words = paragraph.split(/(\s+)/)  // mantém espaços como tokens
    let current = ''

    for (const token of words) {
      const candidate = current + token
      const width = font.widthOfTextAtSize(candidate, fontSize)
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
  const { template, elements, values, basePdfBytes } = input

  // Carrega PDF base. Cópia defensiva do buffer porque pdf-lib pode mutar.
  const pdf = await PDFDocument.load(basePdfBytes.slice(0))
  pdf.registerFontkit(fontkit)

  const fonts = new FontRegistry(pdf)
  const pages = pdf.getPages()

  // Ordena elementos por z_index (menor primeiro = fundo)
  const ordered = [...elements].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0))

  for (const el of ordered) {
    const resolved = values[el.tag_id]
    if (!resolved) continue   // tag sem valor (validado antes, mas guarda)

    const page = pages[el.page_number - 1]
    if (!page) continue

    const pageHeight = page.getHeight()
    const style: ElementStyle = (el.style as ElementStyle) || {}

    // Tamanho default por tipo se nunca foi editado no editor
    const isImage = resolved.kind === 'image'
    const width  = el.width_pt  ?? (isImage ? 180 : 180)
    const height = el.height_pt ?? (isImage ? 180 : 40)

    // Converte origem top-left (banco) -> bottom-left (pdf-lib)
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

// ─── Desenho de texto ─────────────────────────────────────────────────

async function drawText(params: {
  page: import('pdf-lib').PDFPage
  text: string
  x: number; y: number; width: number; height: number
  style: ElementStyle
  fonts: FontRegistry
}) {
  const { page, text, x, y, width, height, style, fonts } = params

  const fontSize = style.fontSize ?? 14
  const lineHeight = style.lineHeight ?? 1.3
  const letterSpacing = style.letterSpacing ?? 0
  const align: 'left' | 'center' | 'right' | 'justify' = style.align ?? 'left'
  const color = hexToRgb(style.color ?? '#111827')
  const fontFamily = style.fontFamily ?? 'Inter'

  const font = await fonts.get(fontFamily, !!style.bold, !!style.italic)

  // Aplica textTransform antes de medir
  let prepared = text
  if (style.textTransform === 'uppercase') prepared = prepared.toUpperCase()
  else if (style.textTransform === 'lowercase') prepared = prepared.toLowerCase()

  const lines = wrapText(prepared, width, fontSize, font)
  const lineSpacing = fontSize * lineHeight

  // Origem top-left lógica (dentro do retângulo) convertida pra baseline
  // da primeira linha. Em pdf-lib, drawText usa baseline da linha.
  // Primeira baseline = topo do retângulo - fontSize (aprox ascent).
  let currentBaselineY = (y + height) - fontSize

  for (const line of lines) {
    if (currentBaselineY < y) break   // overflow: descarta linhas que sairiam da caixa

    const textWidth = measureLineWidth(line, font, fontSize, letterSpacing)

    let lineX = x
    if (align === 'center') lineX = x + (width - textWidth) / 2
    else if (align === 'right') lineX = x + (width - textWidth)
    // "justify" é complexo sem libs extras — tratamos como left por ora.

    // Desenha caractere por caractere só se letterSpacing != 0. Senão,
    // chamada única é muito mais eficiente.
    if (letterSpacing === 0) {
      page.drawText(line, {
        x: lineX,
        y: currentBaselineY,
        size: fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
      })
    } else {
      let xCursor = lineX
      for (const ch of line) {
        page.drawText(ch, {
          x: xCursor,
          y: currentBaselineY,
          size: fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
        })
        xCursor += font.widthOfTextAtSize(ch, fontSize) + letterSpacing
      }
    }

    currentBaselineY -= lineSpacing
  }
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

// ─── Desenho de imagem ────────────────────────────────────────────────

async function drawImage(params: {
  pdf: import('pdf-lib').PDFDocument
  page: import('pdf-lib').PDFPage
  bytes: ArrayBuffer
  mime: string
  x: number; y: number; width: number; height: number
  style: ElementStyle
}) {
  const { pdf, page, bytes, mime, x, y, width, height, style } = params

  const m = mime.toLowerCase()
  const img = m.includes('png')
    ? await pdf.embedPng(bytes)
    : await pdf.embedJpg(bytes)

  const fit: 'cover' | 'contain' = style.objectFit ?? 'cover'

  const imgRatio  = img.width / img.height
  const boxRatio  = width / height

  let drawW = width
  let drawH = height
  let drawX = x
  let drawY = y

  if (fit === 'contain') {
    // Inteira dentro da caixa, preservando proporção
    if (imgRatio > boxRatio) {
      // imagem mais larga — limita pela largura
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
  } else {
    // cover: preenche a caixa inteira, pode cortar. Precisamos clipar.
    // pdf-lib não tem clip simples, mas usamos um hack: desenhamos dentro
    // de um "form" (XObject). Forma direta é aplicar uma máscara via
    // PDF graphic state. Pra manter simples e estável, fazemos assim:
    //   1. Calculamos tamanho ampliado
    //   2. Ajustamos posição
    //   3. Desenhamos a imagem ampliada; as partes fora do retângulo
    //      sobrepõem o conteúdo do PDF base nas laterais, mas como
    //      elementos costumam ficar em áreas dedicadas, isso é aceitável.
    // Para uma solução mais rigorosa no futuro: recortar a imagem no lado
    // do cliente (canvas) antes de embedar.
    if (imgRatio > boxRatio) {
      drawH = height
      drawW = height * imgRatio
      drawY = y
      drawX = x - (drawW - width) / 2
    } else {
      drawW = width
      drawH = width / imgRatio
      drawX = x
      drawY = y - (drawH - height) / 2
    }

    // Clip real: cria um form XObject, desenha a imagem dentro e então
    // desenha o form recortado à caixa. pdf-lib expõe pushGraphicsState/
    // popGraphicsState mas não clipping direto. A forma suportada é usar
    // operadores crus.
    // Solução pragmática: para evitar vazamento visual na Fase 5,
    // caímos para "contain" quando cover sobraria da caixa. É seguro e
    // consistente com o preview do editor.
    // (Abaixo o fallback; troque para o bloco acima se quiser testar o
    // comportamento "bleed" de cover.)
    const containDrawW = imgRatio > boxRatio ? width : height * imgRatio
    const containDrawH = imgRatio > boxRatio ? width / imgRatio : height
    const containDrawX = x + (width - containDrawW) / 2
    const containDrawY = y + (height - containDrawH) / 2
    page.drawImage(img, {
      x: containDrawX, y: containDrawY,
      width: containDrawW, height: containDrawH,
    })
  }
}
