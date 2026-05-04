// src/lib/templatePDFGenerator.ts
//
// Gera o PDF de estilo usando o Modelo.pdf como template.
// Suporta dois modos de layout:
//   'flow'     → layout de fluxo (foto esquerda + blocos direita empilhados)
//   'freeform' → blocos e foto em posições absolutas definidas no PDFLayoutEditor
//
// Estrutura do PDF gerado:
//   1. Capa (template)
//   2. Página de Colagem — todas as fotos selecionadas lado a lado com seus nomes
//   3. Para cada item: foto + referências (1+ páginas conforme necessário)
//   4. Contra-capa (template)

import {
  PDFDocument, PDFPage, rgb, StandardFonts, PDFFont,
  pushGraphicsState, popGraphicsState, PDFOperator, PDFNumber,
} from 'pdf-lib'
import { supabase } from './supabase'

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type PdfSection = string

export interface PdfImageItem {
  dataUrl:  string
  label:    string
  caption?: string
  section:  PdfSection
  layout?:  ItemLayout
}

export type PdfFontFamily = 'Helvetica' | 'Times' | 'Courier'

export interface PdfStyleConfig {
  headerFont?:  PdfFontFamily
  headerSize?:  number
  headerColor?: string
  bodyFont?:    PdfFontFamily
  bodySize?:    number
  bodyColor?:   string
  accentColor?: string
}

export interface EditorBlock {
  id:          string
  rawLines:    string[]
  isSection:   boolean
  marginBelow: number
  // Freeform position (pts; y from page top)
  x?:          number
  y?:          number
  w?:          number
  h?:          number
  // Style overrides
  fontFamily?:  PdfFontFamily
  headerSize?:  number
  bodySize?:    number
  headerColor?: string
  bodyColor?:   string
  // Visual variant (fundo/borda do bloco)
  blockVariant?: 'plain' | 'soft' | 'card' | 'outline' | 'accent'
  // Cor de fundo customizada (hex). Quando presente, sobrescreve a cor
  // padrão do variant em soft/card/accent. Ignorado em plain/outline.
  blockBgColor?: string
  // Alinhamento independente para o título (primeira linha do bloco quando isSection)
  // e para o corpo do texto
  titleAlign?: 'left' | 'center' | 'right' | 'justify'
  textAlign?:  'left' | 'center' | 'right' | 'justify'
}

export interface PhotoConfig {
  x: number   // pts from left
  y: number   // pts from top
  w: number   // pts
  h: number   // pts
}

// ─── Configuração do label (nome visível para a cliente) ──────────────────────

export interface LabelConfig {
  visible?:    boolean        // default: true
  x?:          number         // pts from left (default: centered below photo)
  y?:          number         // pts from top (default: photo bottom + 8)
  fontSize?:   number         // default: 7
  fontFamily?: PdfFontFamily  // default: Helvetica
  color?:      string         // default: headerColor
  bold?:       boolean        // default: true
  uppercase?:  boolean        // default: true
}

export interface ItemLayout {
  blocks:       EditorBlock[]
  style:        PdfStyleConfig
  layoutMode?:  'flow' | 'freeform'
  photo?:       PhotoConfig
  pageMarginH?: number
  labelConfig?: LabelConfig
}

// ─── Mapa de seções ───────────────────────────────────────────────────────────

const LEGACY_SECTION_TITLES: Record<string, { icon: string; title: string }> = {
  cabelo:     { icon: '✂️', title: 'Cabelo' },
  maquiagem:  { icon: '💄', title: 'Maquiagens' },
  roupa:      { icon: '👗', title: 'Roupas / Look' },
  acessorio:  { icon: '💎', title: 'Acessórios' },
  acessorios: { icon: '💎', title: 'Acessórios' },
  acessrios:  { icon: '💎', title: 'Acessórios' },
  geral:      { icon: '✨', title: 'Estilo Geral' },
}

function getSectionTitle(section: string): string {
  if (LEGACY_SECTION_TITLES[section]) return LEGACY_SECTION_TITLES[section].title
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
  const ns = norm(section)
  for (const [key, val] of Object.entries(LEGACY_SECTION_TITLES)) {
    if (norm(key) === ns || norm(val.title) === ns) return val.title
  }
  return section.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Defaults ────────────────────────────────────────────────────────────────

// Texto: títulos e corpo em preto por padrão (visual limpo, legível).
// O accent (vinho) permanece para elementos visuais (barras, separadores).
const DEFAULT_HEADER_COLOR = '#000000'
const DEFAULT_BODY_COLOR   = '#000000'
const DEFAULT_ACCENT_COLOR = '#87485E'

// Tamanhos padrão de fonte (pt)
const DEFAULT_HEADER_SIZE  = 9.5
const DEFAULT_BODY_SIZE    = 9

const BG_CREAM = rgb(0.976, 0.965, 0.945)

// ─── Dimensões A4 (pts) ───────────────────────────────────────────────────────

const PW = 595.5
const PH = 842.2

const MG            = 39.7
const HEADER_TEXT_Y = PH - 41
const CONTENT_TOP   = PH - 72
const CONTENT_BTM   = PH - 800

const IMG_COL_X     = MG
const IMG_COL_W     = 192   // largura padrão da foto (pt)
const IMG_DEFAULT_H = 256   // altura padrão da foto (pt) — combina com o editor (192 × 256)
const IMG_MAX_H     = CONTENT_TOP - CONTENT_BTM - 24  // teto absoluto

const TXT_COL_X  = IMG_COL_X + IMG_COL_W + 16
const TXT_COL_W  = PW - TXT_COL_X - MG

const TXT_BLOCK_GAP = 8
const TXT_INDENT    = 10

// ─── Defaults exportados (úteis para o editor sincronizar com o PDF) ─────────

export const PDF_DEFAULTS = {
  headerSize:  DEFAULT_HEADER_SIZE,
  bodySize:    DEFAULT_BODY_SIZE,
  headerColor: DEFAULT_HEADER_COLOR,
  bodyColor:   DEFAULT_BODY_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
  photo: {
    x: IMG_COL_X,
    y: 72,
    w: IMG_COL_W,
    h: IMG_DEFAULT_H,
  },
  blockGap:    TXT_BLOCK_GAP,
  pageMarginH: MG,
  page: { w: PW, h: PH },
} as const

// ─── Estilo resolvido ─────────────────────────────────────────────────────────

interface ResolvedStyle {
  fontHeaderBold: PDFFont
  fontBody:       PDFFont
  headerSize:     number
  bodySize:       number
  lineH:          number
  colorHeader:    ReturnType<typeof rgb>
  colorBody:      ReturnType<typeof rgb>
  colorAccent:    ReturnType<typeof rgb>
}

async function resolveStyle(pdf: PDFDocument, cfg?: PdfStyleConfig): Promise<ResolvedStyle> {
  const family     = cfg?.headerFont ?? 'Helvetica'
  const bodyFamily = cfg?.bodyFont   ?? 'Helvetica'
  const headerSize = clamp(cfg?.headerSize ?? DEFAULT_HEADER_SIZE, 6, 20)
  const bodySize   = clamp(cfg?.bodySize   ?? DEFAULT_BODY_SIZE,   5, 18)
  const lineH      = Math.round(bodySize * 1.47)

  return {
    fontHeaderBold: await pdf.embedFont(pickStandardFont(family,     true)),
    fontBody:       await pdf.embedFont(pickStandardFont(bodyFamily, false)),
    headerSize, bodySize, lineH,
    colorHeader: hexToRgb(cfg?.headerColor, DEFAULT_HEADER_COLOR),
    colorBody:   hexToRgb(cfg?.bodyColor,   DEFAULT_BODY_COLOR),
    colorAccent: hexToRgb(cfg?.accentColor, DEFAULT_ACCENT_COLOR),
  }
}

function resolveBlockStyle(base: ResolvedStyle, block: EditorBlock): ResolvedStyle {
  return {
    ...base,
    headerSize: block.headerSize ?? base.headerSize,
    bodySize:   block.bodySize   ?? base.bodySize,
    lineH:      Math.round((block.bodySize ?? base.bodySize) * 1.47),
    colorHeader: block.headerColor ? hexToRgb(block.headerColor, DEFAULT_HEADER_COLOR) : base.colorHeader,
    colorBody:   block.bodyColor   ? hexToRgb(block.bodyColor,   DEFAULT_BODY_COLOR)   : base.colorBody,
  }
}

function pickStandardFont(family: PdfFontFamily, bold: boolean): StandardFonts {
  switch (family) {
    case 'Times':    return bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman
    case 'Courier':  return bold ? StandardFonts.CourierBold    : StandardFonts.Courier
    default:         return bold ? StandardFonts.HelveticaBold  : StandardFonts.Helvetica
  }
}

function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)) }

function hexToRgb(hex: string | undefined, fallback: string): ReturnType<typeof rgb> {
  const raw = (hex ?? fallback).replace('#', '').trim()
  if (!/^[0-9a-f]{6}$/i.test(raw)) {
    const f = fallback.replace('#', '')
    return rgb(parseInt(f.slice(0,2),16)/255, parseInt(f.slice(2,4),16)/255, parseInt(f.slice(4,6),16)/255)
  }
  return rgb(parseInt(raw.slice(0,2),16)/255, parseInt(raw.slice(2,4),16)/255, parseInt(raw.slice(4,6),16)/255)
}

// ─── Interfaces internas ──────────────────────────────────────────────────────

interface TextBlock {
  lines:        string[]
  isSection:    boolean
  gapBelow:     number
  x?:           number
  y?:           number
  w?:           number
  titleAlign?:  'left' | 'center' | 'right' | 'justify'
  textAlign?:   'left' | 'center' | 'right' | 'justify'
  blockVariant?: 'plain' | 'soft' | 'card' | 'outline' | 'accent'
  blockBgColor?: string
}

interface RendLine {
  text:          string
  bold:          boolean
  size:          number
  indent:        boolean
  color:         ReturnType<typeof rgb>
  align:         'left' | 'center' | 'right' | 'justify'
  isLastWrapped: boolean  // última linha de um parágrafo quebrado — não justifica
}

const EMOJI_RE      = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}\u{FE00}-\u{FEFF}]/gu
const EMOJI_RE_TEST = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}\u{FE00}-\u{FEFF}]/u

// ─── Função principal ─────────────────────────────────────────────────────────

export async function generateStylePDF(
  templateBytes: ArrayBuffer,
  clientName:    string,
  items:         PdfImageItem[],
  styleConfig?:  PdfStyleConfig,
): Promise<Uint8Array> {

  const templateDoc = await PDFDocument.load(templateBytes)
  const pdf         = await PDFDocument.create()

  const style = await resolveStyle(pdf, styleConfig)

  const dateStr = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  // Capa
  const [coverPage] = await pdf.copyPages(templateDoc, [0])
  pdf.addPage(coverPage)

  // Pré-carregar imagens
  const imgCache = new Map<string, { image: any; width: number; height: number }>()
  for (const item of items) {
    if (!imgCache.has(item.dataUrl)) {
      const emb = await embedImage(pdf, item.dataUrl)
      if (emb) imgCache.set(item.dataUrl, emb)
    }
  }

  // ── Página de Colagem (todas as fotos juntas) ────────────────────────────────
  if (items.length > 0) {
    await renderCollagePage(pdf, templateDoc, items, imgCache, clientName, style)
  }

  // ── Renderizar cada item individualmente ─────────────────────────────────────

  for (const item of items) {
    const layout     = item.layout
    const itemStyle  = layout?.style ? await resolveStyle(pdf, layout.style) : style
    const imgEntry   = imgCache.get(item.dataUrl) ?? null
    const sectionTitle = getSectionTitle(item.section)
    const isFreeform = layout?.layoutMode === 'freeform'

    if (isFreeform) {
      await renderFreeformItem(pdf, templateDoc, item, layout!, itemStyle, imgEntry, clientName, sectionTitle, dateStr, styleConfig)
    } else {
      await renderFlowItem(pdf, templateDoc, item, layout, itemStyle, imgEntry, clientName, sectionTitle, dateStr, styleConfig)
    }
  }

  // Contra-capa
  const [backPage] = await pdf.copyPages(templateDoc, [2])
  pdf.addPage(backPage)

  return await pdf.save()
}

// ─── COLLAGE PAGE — todas as fotos lado a lado ────────────────────────────────

// Layout fixo: 3 colunas x 3 linhas = 9 fotos por página.
// Independente da quantidade de items, cada célula tem o mesmo tamanho.
const COLLAGE_COLS      = 3
const COLLAGE_ROWS      = 3
const COLLAGE_PER_PAGE  = COLLAGE_COLS * COLLAGE_ROWS  // 9
const COLLAGE_GAP       = 14
const COLLAGE_LABEL_H   = 20
// Aspect ratio da foto (altura / largura). 1.33 ≈ portrait 3:4
const COLLAGE_ASPECT    = 1.33

async function renderCollagePage(
  pdf:       PDFDocument,
  templateDoc: PDFDocument,
  items:     PdfImageItem[],
  imgCache:  Map<string, { image: any; width: number; height: number }>,
  clientName: string,
  style:     ResolvedStyle,
): Promise<void> {
  // Divide os items em páginas de 9
  const pageChunks: PdfImageItem[][] = []
  for (let i = 0; i < items.length; i += COLLAGE_PER_PAGE) {
    pageChunks.push(items.slice(i, i + COLLAGE_PER_PAGE))
  }

  for (let pIdx = 0; pIdx < pageChunks.length; pIdx++) {
    await renderCollageSinglePage(pdf, templateDoc, pageChunks[pIdx], imgCache, clientName, style, pIdx, pageChunks.length)
  }
}

async function renderCollageSinglePage(
  pdf:       PDFDocument,
  templateDoc: PDFDocument,
  pageItems: PdfImageItem[],
  imgCache:  Map<string, { image: any; width: number; height: number }>,
  clientName: string,
  style:     ResolvedStyle,
  pageIdx:   number,
  totalPages:number,
): Promise<void> {
  const [tpl] = await pdf.copyPages(templateDoc, [1])
  const page  = pdf.addPage(tpl)

  const title = totalPages > 1 ? `Simulações — ${pageIdx + 1}/${totalPages}` : 'Simulações'
  drawPageHeader(page, title, clientName, style)

  const margin = MG
  const availW = PW - 2 * margin
  const availH = CONTENT_TOP - CONTENT_BTM

  // Grid fixo 3x3 — dimensões calculadas uma vez, não dependem do nº de items
  const cellW = (availW - (COLLAGE_COLS - 1) * COLLAGE_GAP) / COLLAGE_COLS
  // Altura da célula = altura da foto (portrait) + espaço do label
  let imgH    = cellW * COLLAGE_ASPECT
  let cellH   = imgH + COLLAGE_LABEL_H
  // Se o grid não couber em altura, reduzir proporcionalmente
  const gridH = cellH * COLLAGE_ROWS + COLLAGE_GAP * (COLLAGE_ROWS - 1)
  if (gridH > availH) {
    const scale = availH / gridH
    cellH = cellH * scale
    imgH  = imgH  * scale
  }

  // Offset vertical para centralizar o grid na área disponível (útil quando sobra espaço)
  const actualGridH = cellH * COLLAGE_ROWS + COLLAGE_GAP * (COLLAGE_ROWS - 1)
  const gridTopPts  = 72 + Math.max(0, (availH - actualGridH) / 2)

  for (let i = 0; i < pageItems.length; i++) {
    const col = i % COLLAGE_COLS
    const row = Math.floor(i / COLLAGE_COLS)

    const cellTopPts  = gridTopPts + row * (cellH + COLLAGE_GAP)
    const cellLeftPts = margin + col * (cellW + COLLAGE_GAP)

    const item = pageItems[i]
    const imgEntry = imgCache.get(item.dataUrl)
    if (imgEntry) {
      const { image, width: iw, height: ih } = imgEntry

      // Cover scale: foto preenche a célula em ambas dimensões (overflow é cortado)
      const coverScale = Math.max(cellW / iw, imgH / ih)
      const rw = iw * coverScale
      const rh = ih * coverScale

      const ox = cellLeftPts + (cellW - rw) / 2
      const oy = PH - cellTopPts - (imgH + rh) / 2

      const clipX = cellLeftPts
      const clipY = PH - cellTopPts - imgH

      page.pushOperators(
        pushGraphicsState(),
        PDFOperator.of('re' as any, [
          PDFNumber.of(clipX), PDFNumber.of(clipY),
          PDFNumber.of(cellW), PDFNumber.of(imgH),
        ]),
        PDFOperator.of('W' as any),
        PDFOperator.of('n' as any),
      )
      page.drawImage(image, { x: ox, y: oy, width: rw, height: rh })
      page.pushOperators(popGraphicsState())
    }

    // Label abaixo da foto
    const rawLabel   = item.label || ''
    const labelParts = rawLabel.split(/\s*—\s*/)
    const fullLabel  = (labelParts.length > 1 ? labelParts[0] : rawLabel).toUpperCase()
    let labelText    = fullLabel
    if (labelText) {
      const fontSize = 6.5
      let wasTruncated = false
      while (labelText.length > 2 && style.fontHeaderBold.widthOfTextAtSize(labelText, fontSize) > cellW) {
        labelText    = labelText.slice(0, -1)
        wasTruncated = true
      }
      if (wasTruncated && labelText.length > 1) labelText = labelText.slice(0, -1) + '…'

      const lw = style.fontHeaderBold.widthOfTextAtSize(labelText, fontSize)
      const lx = cellLeftPts + Math.max(0, (cellW - lw) / 2)

      const labelTopPts = cellTopPts + imgH + 5
      const ly          = PH - labelTopPts - fontSize

      page.drawText(labelText, {
        x: lx, y: ly,
        size: fontSize,
        font: style.fontHeaderBold,
        color: style.colorHeader,
        characterSpacing: 0.4,
      })

      page.drawLine({
        start: { x: cellLeftPts,          y: ly - 3 },
        end:   { x: cellLeftPts + cellW,  y: ly - 3 },
        thickness: 0.3,
        color: style.colorAccent,
        opacity: 0.3,
      })
    }
  }
}

// ─── Helper: draw label under photo for individual pages ──────────────────────

function drawItemLabel(
  page:       PDFPage,
  label:      string,
  photoX:     number,
  photoW:     number,
  photoBottomY: number,  // PDF bottom-origin Y of photo bottom edge
  labelCfg:   LabelConfig | undefined,
  style:      ResolvedStyle,
): void {
  if (labelCfg?.visible === false) return
  if (!label.trim()) return

  // Items gerados antes da correção no GeminiChat podem ter sido salvos com
  // o label no formato "Nome — Comprimento — Textura". Aqui aplicamos uma
  // defesa: se o label contiver " — ", mostramos só a primeira parte.
  // (A página de colagem já fazia isso; agora o label abaixo de cada foto também.)
  const cleanedLabel = label.split(/\s*—\s*/)[0].trim() || label

  // Defaults: tamanho do título (9,5pt), bold, uppercase, cor do header (preto por padrão)
  const fontSize   = labelCfg?.fontSize   ?? DEFAULT_HEADER_SIZE
  const uppercase  = labelCfg?.uppercase  !== false
  const bold       = labelCfg?.bold       !== false
  const labelText  = uppercase ? cleanedLabel.toUpperCase() : cleanedLabel
  const font       = bold ? style.fontHeaderBold : style.fontBody
  const color      = labelCfg?.color ? hexToRgb(labelCfg.color, DEFAULT_HEADER_COLOR) : style.colorHeader

  let lx: number
  if (labelCfg?.x !== undefined) {
    lx = labelCfg.x
  } else {
    const lw = font.widthOfTextAtSize(labelText, fontSize)
    lx = photoX + Math.max(0, (photoW - lw) / 2)
  }

  let ly: number
  if (labelCfg?.y !== undefined) {
    // labelCfg.y is pts from page top → convert to pdf bottom-origin
    ly = PH - labelCfg.y - fontSize
  } else {
    ly = photoBottomY - fontSize - 6
  }

  page.drawText(labelText, {
    x: lx, y: ly,
    size: fontSize,
    font,
    color,
    characterSpacing: 0.4,
  })
}

// ─── FLOW layout renderer ─────────────────────────────────────────────────────

async function renderFlowItem(
  pdf: PDFDocument,
  templateDoc: PDFDocument,
  item: PdfImageItem,
  layout: ItemLayout | undefined,
  itemStyle: ResolvedStyle,
  imgEntry: { image: any; width: number; height: number } | null,
  clientName: string,
  sectionTitle: string,
  dateStr: string,
  styleConfig?: PdfStyleConfig,
) {
  const newContentPage = async (): Promise<PDFPage> => {
    const [tpl] = await pdf.copyPages(templateDoc, [1])
    const page = pdf.addPage(tpl)
    drawPageHeader(page, sectionTitle, clientName, itemStyle)
    return page
  }

  let curPage = await newContentPage()
  let textY   = CONTENT_TOP

  // ── Foto (caixa padrão 192 × 256 pt; honra layout.photo se presente) ─────
  // Largura/altura da CAIXA da foto. A imagem é "contain" dentro dela
  // (preserva aspect ratio, sem cortar), e top-aligned.
  const photoBoxW = clamp(layout?.photo?.w ?? IMG_COL_W,     60, IMG_COL_W)
  const photoBoxH = clamp(layout?.photo?.h ?? IMG_DEFAULT_H, 60, IMG_MAX_H)

  let photoBottomY = CONTENT_TOP   // pdf bottom-origin Y da borda inferior da foto
  let photoDrawX   = IMG_COL_X
  let photoDrawW   = photoBoxW

  if (imgEntry) {
    const { image, width: iw, height: ih } = imgEntry
    const scale  = Math.min(photoBoxW / iw, photoBoxH / ih)
    const rw = iw * scale, rh = ih * scale
    const imgX = IMG_COL_X + (photoBoxW - rw) / 2
    const imgY = CONTENT_TOP - rh
    curPage.drawImage(image, { x: imgX, y: imgY, width: rw, height: rh })
    photoBottomY = imgY
    photoDrawX   = imgX
    photoDrawW   = rw
  }

  // Label below photo
  drawItemLabel(curPage, item.label, photoDrawX, photoDrawW, photoBottomY, layout?.labelConfig, itemStyle)

  // Limite vertical da coluna de foto: a base da CAIXA + espaço reservado pro
  // label desenhado abaixo (mesmo cálculo do drawItemLabel: 6pt gap acima +
  // fontSize do label + 4pt gap abaixo). Sem isso, o primeiro bloco em
  // largura cheia abaixo da foto pode sobrepor o label.
  const labelCfg     = layout?.labelConfig
  const labelVisible = labelCfg?.visible !== false
  const labelSize    = labelCfg?.fontSize ?? DEFAULT_HEADER_SIZE
  const labelSpace   = imgEntry && labelVisible && (item.label?.trim() ?? '') !== ''
    ? labelSize + 10
    : 0
  const imgBottomY = imgEntry
    ? CONTENT_TOP - photoBoxH - labelSpace
    : CONTENT_BTM

  // Blocos de texto
  const blocks: TextBlock[] = layout?.blocks?.length
    ? layout.blocks.map(b => ({
        lines:        b.rawLines,
        isSection:    b.isSection,
        gapBelow:     b.marginBelow ?? TXT_BLOCK_GAP,
        titleAlign:   b.titleAlign,
        textAlign:    b.textAlign,
        blockVariant: b.blockVariant,
        blockBgColor: b.blockBgColor,
      }))
    : item.caption ? parseCaptionBlocks(item.caption) : []

  let fullWidth = false

  for (let bi = 0; bi < blocks.length; bi++) {
    const block    = blocks[bi]
    const bStyle   = layout?.blocks?.[bi] ? resolveBlockStyle(itemStyle, layout.blocks[bi]) : itemStyle
    const blockGap = block.gapBelow ?? TXT_BLOCK_GAP
    const variant: BlockVariant = block.blockVariant ?? 'plain'
    const hPad = blockHPad(variant)
    const vPad = blockVPad(variant)

    if (!fullWidth && textY > imgBottomY) {
      const testLines  = renderBlockLines(block, TXT_COL_W - hPad.left - hPad.right, bStyle)
      const testBlockH = testLines.length * bStyle.lineH + blockGap + vPad.top + vPad.bottom
      if (textY - testBlockH < imgBottomY) {
        fullWidth = true
        // Para variants com fundo visual (soft/card/outline/accent), o topo do fundo do
        // bloco sobe exatamente `lineH - 2` acima de textY (o vPad.top é subtraído de textY
        // na linha 632 MAS somado de volta em bgTopY na linha 637, cancelando-se).
        // Se não compensarmos aqui, esse overhang invade a faixa reservada ao label,
        // desenhando o fundo sobre o texto abaixo da foto.
        const bgOverhang = variant !== 'plain' ? bStyle.lineH - 2 : 0
        textY = imgBottomY - bgOverhang - 4
      }
    }

    let useFullW = fullWidth || textY <= imgBottomY
    let colX     = useFullW ? MG       : TXT_COL_X
    let colW     = useFullW ? (PW - MG * 2) : TXT_COL_W

    // O texto é wrappado considerando o padding interno
    let textW    = colW - hPad.left - hPad.right
    let rlines   = renderBlockLines(block, textW, bStyle)
    // Altura total do bloco = texto + gap + padding vertical
    let blockH   = rlines.length * bStyle.lineH + blockGap + vPad.top + vPad.bottom

    if (textY - blockH < CONTENT_BTM + 10) {
      curPage = await newContentPage()
      textY   = CONTENT_TOP; useFullW = true
      colX    = MG; colW = PW - MG * 2
      textW   = colW - hPad.left - hPad.right
      rlines  = renderBlockLines(block, textW, bStyle)
      blockH  = rlines.length * bStyle.lineH + blockGap + vPad.top + vPad.bottom
    }

    // Aplicar padding superior: primeira baseline começa vPad.top abaixo do topo do card
    textY -= vPad.top

    // Desenhar fundo do bloco (card/outline/accent/soft) ANTES do texto
    if (variant !== 'plain' && rlines.length > 0) {
      const textBlockH = rlines.length * bStyle.lineH
      const bgTopY    = textY + bStyle.lineH - 2 + vPad.top
      const bgBottomY = bgTopY - textBlockH - vPad.top - vPad.bottom
      drawBlockBackground(curPage, variant, colX, bgBottomY, colW, bgTopY - bgBottomY, bStyle, block.blockBgColor)
    }

    // Barra lateral só no variant 'plain' (nos outros o fundo já delimita o bloco)
    if (variant === 'plain' && block.isSection && rlines.length > 0) {
      const firstLineSize = rlines[0].size
      const lastLineSize  = rlines[rlines.length - 1].size
      const topExtra      = firstLineSize * 0.75
      const bottomExtra   = lastLineSize  * 0.15
      const barTopY       = textY + topExtra
      const barBottomY    = textY - (rlines.length - 1) * bStyle.lineH - bottomExtra
      curPage.drawLine({ start: { x: colX - 4, y: barTopY }, end: { x: colX - 4, y: barBottomY }, thickness: 2, color: bStyle.colorAccent, opacity: 0.7 })
    }

    const forcedColor = variant === 'accent' ? rgb(1, 1, 1) : undefined
    const textX = colX + hPad.left

    for (const rl of rlines) {
      if (textY < CONTENT_BTM) break  // proteção: nunca renderizar abaixo da área de conteúdo
      const font = rl.bold ? bStyle.fontHeaderBold : bStyle.fontBody
      drawAlignedLine(curPage, rl, textX, textW, font, textY, forcedColor)
      textY -= bStyle.lineH
    }

    // Padding inferior + gap
    textY -= vPad.bottom

    if (bi < blocks.length - 1 && variant === 'plain') {
      curPage.drawLine({ start: { x: colX, y: textY + 1 }, end: { x: colX + colW, y: textY + 1 }, thickness: 0.3, color: itemStyle.colorAccent, opacity: 0.2 })
    }
    textY -= blockGap
  }
}

// ─── FREEFORM layout renderer ─────────────────────────────────────────────────

async function renderFreeformItem(
  pdf: PDFDocument,
  templateDoc: PDFDocument,
  item: PdfImageItem,
  layout: ItemLayout,
  itemStyle: ResolvedStyle,
  imgEntry: { image: any; width: number; height: number } | null,
  clientName: string,
  sectionTitle: string,
  dateStr: string,
  styleConfig?: PdfStyleConfig,
) {
  const blocks      = layout.blocks ?? []
  const mgH         = layout.pageMarginH ?? MG
  // Foto padrão: 192 × 256 pt (combina com a caixa do editor "Pré-visualização").
  const photoConfig = layout.photo ?? { x: MG, y: 72, w: IMG_COL_W, h: IMG_DEFAULT_H }

  // Ordenar por y crescente (topo → rodapé em coordenadas de page-top).
  // Necessário para calcular a altura disponível de cada bloco sem h explícito,
  // usando a distância até o início do bloco seguinte na mesma página.
  const sortedBlocks = [...blocks].sort((a, b) => (a.y ?? 72) - (b.y ?? 72))

  const maxBottom   = sortedBlocks.reduce((m, b) => Math.max(m, (b.y ?? 72) + (b.h ?? 40)), photoConfig.y + photoConfig.h)
  const totalPages  = Math.max(1, Math.ceil(maxBottom / PH))

  const blocksByPage = new Map<number, typeof sortedBlocks>()
  for (const block of sortedBlocks) {
    const pi = Math.floor((block.y ?? 72) / PH)
    if (!blocksByPage.has(pi)) blocksByPage.set(pi, [])
    blocksByPage.get(pi)!.push(block)
  }

  for (let pi = 0; pi < totalPages; pi++) {
    const [tpl] = await pdf.copyPages(templateDoc, [1])
    const page  = pdf.addPage(tpl)
    drawPageHeader(page, sectionTitle, clientName, itemStyle)

    // ── Photo (page 0 only) ──────────────────────────────────────────────────
    let photoBottomPdfY = PH - photoConfig.y - photoConfig.h
    if (pi === 0 && imgEntry) {
      const { image, width: iw, height: ih } = imgEntry
      const scale = Math.min(photoConfig.w / iw, photoConfig.h / ih)
      const rw = iw * scale, rh = ih * scale
      const ox = photoConfig.x + (photoConfig.w - rw) / 2
      const oy = PH - photoConfig.y - rh
      page.drawImage(image, { x: ox, y: oy, width: rw, height: rh })
      photoBottomPdfY = oy

      // Label below photo (page 0)
      drawItemLabel(page, item.label, ox, rw, photoBottomPdfY, layout.labelConfig, itemStyle)
    }

    // ── Text blocks ──────────────────────────────────────────────────────────
    const pageBlocks      = blocksByPage.get(pi) ?? []
    const pageYOffsetPts  = pi * PH

    for (let bi = 0; bi < pageBlocks.length; bi++) {
      const block  = pageBlocks[bi]
      const bStyle = resolveBlockStyle(itemStyle, block)
      const variant: BlockVariant = block.blockVariant ?? 'plain'
      const hPad = blockHPad(variant)
      const vPad = blockVPad(variant)

      const bx     = block.x ?? (MG + 192 + 16)
      const bw     = block.w ?? (PW - bx - MG)
      const byPage = (block.y ?? 72) - pageYOffsetPts

      // Dimensões efetivas do TEXTO (dentro do padding do card)
      const textX = bx + hPad.left
      const textW = bw - hPad.left - hPad.right

      // block.y é o TOPO do bloco (igual ao preview do editor).
      // Em PDF, drawText y é a BASELINE do texto.
      // Offset por lineH pra primeira baseline ficar uma linha abaixo do topo,
      // mais o padding superior quando há variant visual.
      let textY = PH - byPage - bStyle.lineH - vPad.top

      const rlines = renderBlockLines(
        {
          lines:        block.rawLines,
          isSection:    block.isSection,
          gapBelow:     block.marginBelow ?? 8,
          titleAlign:   block.titleAlign,
          textAlign:    block.textAlign,
          blockVariant: block.blockVariant,
          blockBgColor: block.blockBgColor,
        },
        textW, bStyle,
      )

      // ── Altura efetiva do bloco ──────────────────────────────────────────
      // Se block.h está definido: usa ele (mantém o comportamento original).
      // Se NÃO está: calcula a distância até o próximo bloco na mesma página
      // (ou até CONTENT_BTM), impedindo que o texto transborde e sobreponha
      // o bloco seguinte — principal causa de textos sobrepostos no PDF.
      let effectiveBlockH: number
      if (block.h != null) {
        effectiveBlockH = block.h
      } else {
        const nextBlock = pageBlocks[bi + 1]
        if (nextBlock) {
          const nextByPage = (nextBlock.y ?? 72) - pageYOffsetPts
          const gap = block.marginBelow ?? 8
          effectiveBlockH = Math.max(
            bStyle.lineH + vPad.top + vPad.bottom,
            nextByPage - byPage - gap,
          )
        } else {
          // Último bloco da página: ocupa até CONTENT_BTM
          effectiveBlockH = Math.max(
            bStyle.lineH + vPad.top + vPad.bottom,
            PH - byPage - CONTENT_BTM - 4,
          )
        }
      }

      const textAvailH     = effectiveBlockH - vPad.top - vPad.bottom
      const effectiveLines = rlines.slice(0, Math.max(1, Math.floor(textAvailH / bStyle.lineH)))

      // ── Fundo do bloco (card/outline/accent/soft) — desenhado PRIMEIRO ────
      if (variant !== 'plain') {
        // Usa a altura natural das linhas visíveis + padding (limitada a effectiveBlockH).
        const bgH = block.h != null
          ? block.h
          : Math.min(effectiveBlockH, effectiveLines.length * bStyle.lineH + vPad.top + vPad.bottom)
        const bgY = PH - byPage - bgH
        drawBlockBackground(page, variant, bx, bgY, bw, bgH, bStyle, block.blockBgColor)
      }

      // Barra lateral só no variant 'plain' (nos outros o fundo já delimita o bloco)
      if (variant === 'plain' && block.isSection && effectiveLines.length > 0) {
        // Acompanha o tamanho real das linhas:
        //  - topo da barra = textY (baseline 1ª linha) + cap-height do título (~75% do size)
        //  - base da barra = baseline da última linha - descender (~15% do size)
        const firstLineSize = effectiveLines[0].size
        const lastLineSize  = effectiveLines[effectiveLines.length - 1].size
        const topExtra      = firstLineSize * 0.75
        const bottomExtra   = lastLineSize  * 0.15
        const barTopY       = textY + topExtra
        const barBottomY    = textY - (effectiveLines.length - 1) * bStyle.lineH - bottomExtra
        page.drawLine({
          start: { x: bx - 4, y: barTopY },
          end:   { x: bx - 4, y: barBottomY },
          thickness: 2, color: bStyle.colorAccent, opacity: 0.7,
        })
      }

      const forcedColor = variant === 'accent' ? rgb(1, 1, 1) : undefined

      for (const rl of effectiveLines) {
        if (textY < CONTENT_BTM) break
        const font = rl.bold ? bStyle.fontHeaderBold : bStyle.fontBody
        drawAlignedLine(page, rl, textX, textW, font, textY, forcedColor)
        textY -= bStyle.lineH
      }

      if (bi < pageBlocks.length - 1) {
        // Separador só quando o bloco é 'plain' (nos outros o fundo já delimita)
        if (variant === 'plain') {
          const sepY = block.h
            ? PH - byPage - block.h
            : textY + 1
          page.drawLine({
            start: { x: bx, y: sepY }, end: { x: bx + bw, y: sepY },
            thickness: 0.3, color: itemStyle.colorAccent, opacity: 0.2,
          })
        }
      }
    }
  }
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Detecta se uma linha é um "título maiúsculo" — usado como delimitador
 * de blocos: ao encontrar um, tudo abaixo (até o próximo título maiúsculo)
 * vira o corpo do mesmo bloco. Ao encontrar OUTRO título maiúsculo, começa
 * um novo bloco.
 *
 * Critérios (todos precisam ser verdadeiros):
 *  - tem ao menos 3 letras
 *  - todas as letras são maiúsculas
 *  - não termina com um caractere típico de frase corrente (.,;)
 *  - não é uma linha "bullet" (começa com •, -, *, →, >)
 */
function isUppercaseTitle(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^[•*\-→>]/.test(t)) return false
  // Permite ":" no fim (ex: "RESULTADO ESPERADO:") mas não ponto/vírgula
  if (/[.,;]$/.test(t)) return false
  // Conta apenas letras (incluindo acentos comuns)
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '')
  if (letters.length < 3) return false
  return letters === letters.toUpperCase()
}

/**
 * Quebra a caption em blocos seguindo a regra:
 *  - Toda linha em CAIXA ALTA inicia um novo bloco (com ou sem emoji prefix).
 *  - Tudo o que vier abaixo — incluindo linhas em branco — pertence ao bloco
 *    atual até o próximo título em CAIXA ALTA.
 *  - Linhas em branco internas ao bloco são preservadas (renderizadas como
 *    espaçamento vertical), permitindo separação visual de subgrupos como
 *    "Base:" / "Luz:" / "Controle:" dentro de um mesmo bloco "CORES".
 *
 * Conteúdo que apareça antes do primeiro título (preâmbulo) vira um bloco
 * sem isSection.
 */
function parseCaptionBlocks(caption: string): TextBlock[] {
  if (!caption.trim()) return []

  const rawLines = caption.split('\n')
  const blocks: TextBlock[] = []
  let currentLines: string[] = []
  let currentIsSection = false

  const flush = () => {
    // Remove linhas em branco do início e do fim do bloco — internas mantêm.
    while (currentLines.length && !currentLines[0].trim()) currentLines.shift()
    while (currentLines.length && !currentLines[currentLines.length - 1].trim()) currentLines.pop()
    if (currentLines.length) {
      blocks.push({
        lines: [...currentLines],
        isSection: currentIsSection,
        gapBelow: TXT_BLOCK_GAP,
        blockVariant: 'soft',
      })
    }
    currentLines = []
    currentIsSection = false
  }

  for (const raw of rawLines) {
    const trimmed = raw.trim()
    if (isUppercaseTitle(trimmed)) {
      flush()
      currentLines.push(trimmed)
      currentIsSection = true
    } else {
      currentLines.push(trimmed)
    }
  }
  flush()

  return blocks
}

// ─── Desenho de fundo do bloco (soft / card / outline / accent) ──────────────

type BlockVariant = 'plain' | 'soft' | 'card' | 'outline' | 'accent'

// Padding interno aplicado ao texto quando o bloco tem fundo visual.
// No variant 'plain' o texto usa toda a largura (sem padding).
const BLOCK_PAD_LEFT   = 7
const BLOCK_PAD_RIGHT  = 6
const BLOCK_PAD_TOP    = 5
const BLOCK_PAD_BOTTOM = 4

const BLOCK_CORNER_RADIUS = 5

/** Retorna o padding horizontal que deve ser descontado da largura do texto quando há variant visual. */
function blockHPad(variant: BlockVariant): { left: number; right: number } {
  return variant === 'plain'
    ? { left: 0, right: 0 }
    : { left: BLOCK_PAD_LEFT, right: BLOCK_PAD_RIGHT }
}

/** Retorna o padding vertical (top/bottom) aplicado ao texto em variants visuais. */
function blockVPad(variant: BlockVariant): { top: number; bottom: number } {
  return variant === 'plain'
    ? { top: 0, bottom: 0 }
    : { top: BLOCK_PAD_TOP, bottom: BLOCK_PAD_BOTTOM }
}

/**
 * Gera um path SVG para um retângulo com cantos arredondados.
 * Coordenadas são em sistema SVG (Y cresce pra baixo), origem em (0,0).
 * drawSvgPath do pdf-lib aplica translate(x, y) + scale(1, -1), então o path é
 * "pendurado" a partir do canto superior-esquerdo passado em options.x/options.y.
 */
function roundedRectSvgPath(width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  if (r <= 0.1) {
    return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`
  }
  return [
    `M ${r} 0`,
    `L ${width - r} 0`,
    `Q ${width} 0 ${width} ${r}`,
    `L ${width} ${height - r}`,
    `Q ${width} ${height} ${width - r} ${height}`,
    `L ${r} ${height}`,
    `Q 0 ${height} 0 ${height - r}`,
    `L 0 ${r}`,
    `Q 0 0 ${r} 0`,
    'Z',
  ].join(' ')
}

function drawBlockBackground(
  page:    PDFPage,
  variant: BlockVariant | undefined,
  bx:      number,  // canto esquerdo (pts, PDF coords)
  byPdf:   number,  // y bottom-origin do canto INFERIOR do bloco
  bw:      number,
  bh:      number,
  style:   ResolvedStyle,
  bgColor?: string, // cor de fundo customizada (hex)
) {
  if (!variant || variant === 'plain') return

  // drawSvgPath espera o canto SUPERIOR-esquerdo em PDF coords.
  const topY = byPdf + bh
  const path = roundedRectSvgPath(bw, bh, BLOCK_CORNER_RADIUS)

  // Cor de fundo resolvida: customizada (se presente) > default do variant
  const customBg = bgColor ? hexToRgb(bgColor, '#F5F0EC') : null

  if (variant === 'soft') {
    // Minimalista: fundo sutil, SEM borda, SEM sombra
    const fill = customBg ?? hexToRgb('#F5F0EC', '#F5F0EC')  // bege claro default
    page.drawSvgPath(path, {
      x: bx, y: topY,
      color: fill, opacity: 1,
    })
    return
  }

  if (variant === 'card') {
    // Sombra muito sutil — minimalista
    page.drawSvgPath(roundedRectSvgPath(bw, bh, BLOCK_CORNER_RADIUS), {
      x: bx + 0.6, y: topY - 0.6,
      color: rgb(0, 0, 0), opacity: 0.04,
    })
    // Card com borda muito leve
    page.drawSvgPath(path, {
      x: bx, y: topY,
      color: customBg ?? rgb(1, 1, 1),
      borderColor: style.colorAccent, borderWidth: 0.3, borderOpacity: 0.15,
    })
    return
  }

  if (variant === 'outline') {
    page.drawSvgPath(path, {
      x: bx, y: topY,
      borderColor: style.colorAccent, borderWidth: 0.6, borderOpacity: 0.35,
    })
    return
  }

  if (variant === 'accent') {
    page.drawSvgPath(path, {
      x: bx, y: topY,
      color: customBg ?? style.colorAccent,
      opacity: 0.95,
    })
    return
  }
}

// ─── Desenho de uma linha com alinhamento ────────────────────────────────────

function drawAlignedLine(
  page:     PDFPage,
  rl:       RendLine,
  colX:     number,   // início da coluna de texto (onde encostaria o alinhamento left)
  colW:     number,   // largura total disponível para a linha
  font:     PDFFont,
  baselineY: number,  // y da baseline do texto
  forcedColor?: ReturnType<typeof rgb>,  // força cor (ex: branco no variant accent)
) {
  const indentPx = rl.indent ? TXT_INDENT : 0
  const textX    = colX + indentPx
  const availW   = colW - indentPx
  const color    = forcedColor ?? rl.color

  // JUSTIFY — desenha palavra por palavra distribuindo o espaço disponível.
  // (Evita dependência de `wordSpacing` no drawText, que não existe no pdf-lib 1.17.)
  // Última linha de um parágrafo quebrado NÃO é justificada (comportamento CSS padrão).
  if (rl.align === 'justify' && !rl.isLastWrapped) {
    const words = rl.text.split(' ').filter(Boolean)
    if (words.length > 1) {
      const totalWordsW = words.reduce((s, w) => s + font.widthOfTextAtSize(w, rl.size), 0)
      const gap = (availW - totalWordsW) / (words.length - 1)
      if (gap >= 0) {
        let x = textX
        for (const w of words) {
          page.drawText(w, { x, y: baselineY, size: rl.size, font, color })
          x += font.widthOfTextAtSize(w, rl.size) + gap
        }
        return
      }
      // Se gap ficar negativo (texto maior que avail), cai pro left normal.
    }
  }

  const lineW = font.widthOfTextAtSize(rl.text, rl.size)
  let x = textX
  if (rl.align === 'center') {
    x = textX + Math.max(0, (availW - lineW) / 2)
  } else if (rl.align === 'right') {
    x = textX + Math.max(0, availW - lineW)
  }

  page.drawText(rl.text, { x, y: baselineY, size: rl.size, font, color })
}

function renderBlockLines(block: TextBlock, maxWidth: number, style: ResolvedStyle): RendLine[] {
  const result: RendLine[] = []
  const titleAlign = block.titleAlign ?? 'left'
  const textAlign  = block.textAlign  ?? 'left'
  for (let i = 0; i < block.lines.length; i++) {
    const raw = cleanLine(block.lines[i])
    if (!raw) {
      // Linha em branco: preserva como espaçamento vertical (uma linha vazia)
      // para separar visualmente subgrupos dentro de um mesmo bloco
      // (ex.: "Base:" / "Luz:" / "Controle:" sob "CORES").
      result.push({
        text: '', bold: false, size: style.bodySize, indent: false,
        color: style.colorBody, align: 'left', isLastWrapped: true,
      })
      continue
    }
    const isFirst = i === 0, isSub = /^[•*\-→>]/.test(raw)
    const bold = isFirst && block.isSection
    const size = bold ? style.headerSize : style.bodySize
    const color = bold ? style.colorHeader : style.colorBody
    const indent = !isFirst && isSub
    const avail = maxWidth - (indent ? TXT_INDENT : 0)
    const font = bold ? style.fontHeaderBold : style.fontBody
    const text = isSub ? '• ' + raw.replace(/^[•*\-→>]+\s*/, '') : raw
    const align = bold ? titleAlign : textAlign
    const wrapped = wrapText(text, avail, font, size)
    for (let j = 0; j < wrapped.length; j++) {
      result.push({
        text: wrapped[j], bold, size, indent, color, align,
        isLastWrapped: j === wrapped.length - 1,
      })
    }
  }
  return result
}

function cleanLine(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/→/g, '>').replace(/–/g, '-')
    .replace(/\u2014/g, '--').replace(/[""]/g, '"').replace(/['']/g, "'")
    .replace(/\s+/g, ' ').trim()
}

function wrapText(text: string, maxWidth: number, font: any, size: number): string[] {
  const words = text.split(' '), lines: string[] = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    if (cur && font.widthOfTextAtSize(test, size) > maxWidth) { lines.push(cur); cur = w }
    else cur = test
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

// ─── Page helpers ─────────────────────────────────────────────────────────────

function drawPageHeader(page: PDFPage, sectionTitle: string, clientName: string, style: ResolvedStyle) {
  const hy = HEADER_TEXT_Y
  page.drawText(sectionTitle.toUpperCase(), {
    x: MG, y: hy, size: 7, font: style.fontHeaderBold, color: style.colorHeader, characterSpacing: 0.5,
  })
  const dw = style.fontBody.widthOfTextAtSize(clientName, 7)
  page.drawText(clientName, { x: PW - MG - dw, y: hy, size: 7, font: style.fontBody, color: style.colorBody })
}

function coverFooterRight(page: PDFPage) {
  page.drawRectangle({ x: 420, y: 20, width: 180, height: 45, color: BG_CREAM, borderWidth: 0 })
}

function drawDynamicFooter(page: PDFPage, dateStr: string, style: ResolvedStyle) {
  const fy = PH - 818 + 4
  const dw = style.fontBody.widthOfTextAtSize(dateStr, 7)
  page.drawText(dateStr, { x: PW - MG - dw, y: fy, size: 7, font: style.fontBody, color: style.colorAccent })
}

async function embedImage(pdf: PDFDocument, dataUrl: string): Promise<{ image: any; width: number; height: number } | null> {
  try {
    let bytes: Uint8Array, isPng = false
    if (dataUrl.startsWith('data:')) {
      const [header, b64] = dataUrl.split(',')
      isPng = header.includes('png')
      bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    } else {
      const res  = await fetch(dataUrl)
      const blob = await res.blob()
      isPng = blob.type.includes('png')
      bytes = new Uint8Array(await blob.arrayBuffer())
    }
    const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    return { image, width: image.width, height: image.height }
  } catch (e) { console.error('Erro ao embutir imagem:', e); return null }
}

// ─── Carregamento do template + settings ─────────────────────────────────────

interface LoadedTemplate { templateBytes: ArrayBuffer; style?: PdfStyleConfig }

async function loadTemplateFromSettings(): Promise<LoadedTemplate> {
  const { data: settingsRow, error: settingsErr } = await supabase
    .from('admin_content').select('content').eq('type', 'settings').maybeSingle()
  if (settingsErr) throw new Error('Erro ao carregar configurações: ' + settingsErr.message)

  const { data: tplRow } = await supabase
    .from('admin_content').select('content').eq('type', 'pdf_template').maybeSingle()

  const tplContent = tplRow?.content as { pdfTemplateBase64?: string } | null
  const settings   = settingsRow?.content as Record<string, any> | null

  const base64: string | undefined =
    tplContent?.pdfTemplateBase64 || settings?.pdfTemplateBase64

  if (!base64) throw new Error('PDF modelo não configurado.\nAcesse Configurações → PDF Modelo de Estilo e faça o upload do Modelo.pdf.')

  const raw = base64.includes(',') ? base64.split(',')[1] : base64
  const binaryStr = atob(raw)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

  return { templateBytes: bytes.buffer, style: settings?.pdfStyle as PdfStyleConfig | undefined }
}

// ─── Download ─────────────────────────────────────────────────────────────────

export async function downloadStylePDF({
  clientName, items, styleOverride,
}: { clientName: string; items: PdfImageItem[]; styleOverride?: PdfStyleConfig }): Promise<void> {
  const { templateBytes, style } = await loadTemplateFromSettings()
  const pdfBytes = await generateStylePDF(templateBytes, clientName, items, styleOverride ?? style)
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `Simulações MS Color IA - ${clientName.replace(/\s+/g, '-').toLowerCase()}.pdf`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}