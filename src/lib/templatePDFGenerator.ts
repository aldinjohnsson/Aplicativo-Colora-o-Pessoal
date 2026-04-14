// src/lib/templatePDFGenerator.ts
//
// Gera o PDF de estilo usando o Modelo.pdf como template real.
// Usa pdf-lib para carregar as páginas do template e sobrepor conteúdo.
//
// Instalar:  npm install pdf-lib

import {
  PDFDocument, PDFPage, rgb, StandardFonts,
  pushGraphicsState, popGraphicsState,
  rectangle, clip, endPath,
} from 'pdf-lib'

// ─── Tipos ──────────────────────────────────────────────────

// PdfSection is now a free string — the actual category name from folderConfig
export type PdfSection = string

export interface PdfImageItem {
  /** Data-URL (data:image/...;base64,...) ou URL pública */
  dataUrl: string
  /** Nome do prompt / título da imagem (ex: "Loiro Mel — Médio") */
  label: string
  /** Texto de referência do prompt (ex: tinta recomendada, descrição detalhada) */
  caption?: string
  /** Seção do PDF */
  section: PdfSection
}

// Legacy icon map — used only for backwards-compat with old saved data that still has enum values
const LEGACY_SECTION_TITLES: Record<string, { icon: string; title: string }> = {
  cabelo:      { icon: '✂️', title: 'Cabelo' },
  maquiagem:   { icon: '💄', title: 'Maquiagens' },
  roupa:       { icon: '👗', title: 'Roupas / Look' },
  acessorio:   { icon: '💎', title: 'Acessórios' },
  acessorios:  { icon: '💎', title: 'Acessórios' },  // id correto (com acento normalizado)
  acessrios:   { icon: '💎', title: 'Acessórios' },  // legado: id gerado sem normalizar acento
  geral:       { icon: '✨', title: 'Estilo Geral' },
}

// Returns the display title for any section key (category name or legacy enum)
function getSectionTitle(section: string): string {
  // 1. Lookup direto
  if (LEGACY_SECTION_TITLES[section]) return LEGACY_SECTION_TITLES[section].title

  // 2. Lookup normalizado (remove acentos e pontuação para comparar)
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
  const normSection = norm(section)
  for (const [key, val] of Object.entries(LEGACY_SECTION_TITLES)) {
    if (norm(key) === normSection || norm(val.title) === normSection) return val.title
  }

  // 3. Fallback: formatar o key como título legível ("foto_para_cabelo" → "Foto Para Cabelo")
  return section.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Cores (extraídas do template Marilia Santos) ───────────
const MAUVE    = rgb(0.467, 0.184, 0.310)   // rose escuro — títulos/labels
const MAUVE2   = rgb(0.529, 0.282, 0.369)   // rose médio — linhas/subtítulos
const GRAY_W   = rgb(0.392, 0.345, 0.361)   // cinza quente — captions
const BG_CREAM = rgb(0.976, 0.965, 0.945)   // creme do fundo (para cobrir texto)

// ─── Layout (A4 pts: 595.5 × 842.2) ────────────────────────
const PW = 595.5
const PH = 842.2

// Grid de conteúdo
const MG   = 39.7   // margem lateral
const COLS = 3
const GAP  = 14     // gap entre colunas
const COL_W = (PW - MG * 2 - GAP * (COLS - 1)) / COLS  // ≈ 162.6

// Posições verticais (Y = 0 na base da página, cresce pra cima)
const HEADER_TEXT_Y   = PH - 41   // base do texto do header
const CONTENT_START_Y = PH - 75   // onde começa o conteúdo
const FOOTER_LINE_Y   = PH - 805  // linha do footer
const FOOTER_TEXT_Y   = PH - 818  // texto do footer

// ─── Dimensões das células de imagem ────────────────────────
//
// TODAS as imagens são desenhadas com o MESMO tamanho: COL_W × CELL_H
// Usando clipping (object-cover): a imagem preenche a célula, o excesso é cortado.
// Isso garante grid perfeitamente uniforme em todas as seções.

const CELL_W       = COL_W  // largura fixa da célula = largura da coluna
const CELL_H       = 204    // altura fixa da célula — +10% vs original (era 185)
const LABEL_H      = 13     // altura reservada para o label (nome do item)
const CAPTION_H    = 12     // altura reservada para o caption (referência)
const LABEL_GAP    = 9      // gap imagem → label
const CAPTION_GAP  = 6      // gap label → caption
const SECTION_GAP  = 18     // espaço extra entre seções

// Altura total de uma linha: imagem + textos + espaçamento
const ROW_H = CELL_H + LABEL_GAP + LABEL_H + CAPTION_GAP + CAPTION_H + 16


// ─── Prefixos de legenda IA a serem filtrados ───────────────
//
// Captions que começam com esses padrões são textos de conversa da IA
// (ex: "Que tal esse batom vermelho ce") e NÃO devem aparecer no PDF.

// Padrões que identificam texto conversacional da IA — tanto prefixos quanto fragmentos internos
const CAPTION_BLOCKLIST_STARTS = [
  'que tal', 'como ficaria', 'o que acha', 'aqui está', 'aqui tem',
  'veja esse', 'veja este', 'olha esse', 'olha este', 'olha só',
  'sugestão', 'sugiro', 'recomendo', 'te recomendo', 'para você',
  'e se você', 'essa é uma', 'esse é um', 'esta é uma', 'este é um',
  'que acha de', 'que tal esse', 'que tal esta', 'que tal este',
  'experimente', 'imagina você', 'imagine você', 'ficaria lindo',
  'ficaria incrível', 'ficaria ótimo', 'ficaria perfeito',
  'aqui está', 'aqui tem', 'aqui temos', 'trouxe uma', 'trouxe um',
  'preparei uma', 'preparei um', 'vou sugerir', 'segue uma', 'segue um',
]

const CAPTION_BLOCKLIST_CONTAINS = [
  ' ficaria bem', ' ficaria ótima', ' ficaria linda', ' ficaria incrível',
  ' que tal ', 'combina muito', 'vai te valorizar', 'vai valorizar',
]

/**
 * Verifica se um caption é "legítimo" (referência real, não mensagem de IA).
 * Retorna undefined se for texto de conversa — nunca aparece no PDF.
 */
function sanitizeCaption(caption?: string): string | undefined {
  if (!caption) return undefined
  const trimmed = caption.trim()
  if (!trimmed) return undefined
  const lower = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Verificar prefixos
  for (const prefix of CAPTION_BLOCKLIST_STARTS) {
    const normalizedPrefix = prefix.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (lower.startsWith(normalizedPrefix)) return undefined
  }

  // Verificar fragmentos internos (frases conversacionais no meio do texto)
  for (const frag of CAPTION_BLOCKLIST_CONTAINS) {
    const normalizedFrag = frag.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (lower.includes(normalizedFrag)) return undefined
  }

  // Caption muito longa (>80 chars) sem estrutura de referência provavelmente é texto de IA
  // Referências reais são curtas: "Wella Koleston 7/0", "Tom Outono Quente"
  if (trimmed.length > 80) return undefined

  return trimmed
}


// ─── Função principal ──────────────────────────────────────

export async function generateStylePDF(
  templateBytes: ArrayBuffer,
  clientName: string,
  items: PdfImageItem[],
): Promise<Uint8Array> {

  // 1. Carregar template
  const templateDoc = await PDFDocument.load(templateBytes)

  // 2. Criar documento final
  const pdf = await PDFDocument.create()

  const fontBold   = await pdf.embedFont(StandardFonts.HelveticaBold)
  const fontNormal = await pdf.embedFont(StandardFonts.Helvetica)
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique)

  const dateStr = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  // ─── CAPA (página 1 do template) ──────────────────────────
  const [coverPage] = await pdf.copyPages(templateDoc, [0])
  pdf.addPage(coverPage)

  // ─── Ordenar e agrupar por seção ──────────────────────────
  // Preserve the order sections first appear in the items list (chat order)
  const seenSections: PdfSection[] = []
  for (const it of items) {
    if (!seenSections.includes(it.section)) seenSections.push(it.section)
  }
  const sections = seenSections
    .map(s => ({ key: s, items: items.filter(it => it.section === s) }))
    .filter(s => s.items.length > 0)

  // ─── Pré-carregar todas as imagens ────────────────────────
  const imageCache = new Map<string, { image: any; width: number; height: number }>()
  for (const item of items) {
    if (!imageCache.has(item.dataUrl)) {
      const embedded = await embedImage(pdf, item.dataUrl)
      if (embedded) imageCache.set(item.dataUrl, embedded)
    }
  }

  let currentPage: PDFPage | null = null
  let cursorY = 0

  // ── Cria nova página de conteúdo clonada da pág 2 do template ──
  const newContentPage = async (): Promise<PDFPage> => {
    const [page] = await pdf.copyPages(templateDoc, [1])
    pdf.addPage(page)

    coverFooterRight(page)

    const nameHeaderW = fontNormal.widthOfTextAtSize(clientName, 8)
    page.drawText(clientName, {
      x: PW - MG - nameHeaderW,
      y: HEADER_TEXT_Y,
      size: 8,
      font: fontNormal,
      color: MAUVE2,
    })

    drawDynamicFooter(page, clientName, dateStr, fontNormal)

    cursorY = CONTENT_START_Y
    return page
  }

  // ── Garante espaço vertical; cria nova página se necessário ──
  const ensureSpace = async (needed: number) => {
    if (!currentPage || cursorY - needed < FOOTER_LINE_Y + 20) {
      currentPage = await newContentPage()
    }
  }

  // ── Renderizar seções ──────────────────────────────────────

  for (const { key, items: sectionItems } of sections) {

    // ── Cabeçalho da seção ────────────────────────────────────
    await ensureSpace(28 + ROW_H)

    const sectionLabel = getSectionTitle(key).toUpperCase()
    const labelW = fontBold.widthOfTextAtSize(sectionLabel, 9)

    currentPage!.drawText(sectionLabel, {
      x: MG,
      y: cursorY,
      size: 9,
      font: fontBold,
      color: MAUVE,
    })

    const lineStartX = MG + labelW + 8
    const lineEndX   = PW - MG

    currentPage!.drawLine({
      start: { x: MG,         y: cursorY - 5 },
      end:   { x: lineStartX, y: cursorY - 5 },
      thickness: 0.8,
      color: MAUVE,
    })
    currentPage!.drawLine({
      start: { x: lineStartX, y: cursorY - 5 },
      end:   { x: lineEndX,   y: cursorY - 5 },
      thickness: 0.4,
      color: MAUVE2,
      opacity: 0.35,
    })

    cursorY -= 24

    // ── Imagens da seção em linhas de até 3 colunas ───────────

    for (let i = 0; i < sectionItems.length; i += COLS) {
      const rowItems = sectionItems.slice(i, i + COLS)

      await ensureSpace(ROW_H)

      for (let col = 0; col < rowItems.length; col++) {
        const item      = rowItems[col]
        const embedded  = imageCache.get(item.dataUrl)
        if (!embedded) continue

        // Posição X da célula (canto esquerdo)
        const cellX    = MG + col * (COL_W + GAP)
        // Topo da célula em coordenadas PDF (Y aumenta pra cima)
        const cellTopY = cursorY - CELL_H  // base inferior da célula

        // ── Object-cover com crop inteligente: foca no rosto ──────────────────
        //
        // Para fotos PORTRAIT (mais altas que largas no contexto da célula):
        //   A câmera está normalmente acima da pessoa ou na altura dos olhos,
        //   então o rosto está no terço SUPERIOR da foto.
        //   → bias de 0.25: 25% do excesso fica acima da célula, 75% fica abaixo.
        //   Isso sobe a imagem mostrando mais do topo (rosto/cabeça) e cortando
        //   mais do fundo (ombros/fundo da cena).
        //
        // Para fotos LANDSCAPE (mais largas):
        //   Centralizar horizontalmente é o comportamento correto.

        const imgAR  = embedded.width / embedded.height
        const cellAR = CELL_W / CELL_H

        let drawW: number, drawH: number

        if (imgAR > cellAR) {
          // Imagem mais larga que a célula → encaixa pela altura, overflow lateral
          drawH = CELL_H
          drawW = CELL_H * imgAR
        } else {
          // Imagem mais alta que a célula → encaixa pela largura, overflow vertical
          drawW = CELL_W
          drawH = CELL_W / imgAR
        }

        // Posicionamento:
        // — Horizontal: sempre centralizado
        // — Vertical (portrait): bias para o topo (rosto), não centralizado
        //
        // Em pdf-lib, Y cresce para CIMA. O drawY é o canto inferior-esquerdo da imagem.
        // excesso vertical = drawH - CELL_HQ
        // drawY = cellTopY - excesso * (1 - topBias)
        //   topBias=0   → mostra o topo da imagem (face bias máximo)
        //   topBias=0.5 → centralizado (comportamento anterior)
        //   topBias=1   → mostra o fundo da imagem
        //
        // Para fotos de rosto/busto: topBias=0.20 (mostra 80% do excesso cortado embaixo)
        const isPortrait = imgAR < cellAR
        const topBias = isPortrait ? 0.60 : 0.0

        const drawX = cellX + (CELL_W - drawW) / 2
        const drawY = cellTopY - (drawH - CELL_H) * (1 - topBias)

        // Clip para a célula e desenhar (object-cover com face bias)
        currentPage!.pushOperators(
          pushGraphicsState(),
          rectangle(cellX, cellTopY, CELL_W, CELL_H),
          clip(),
          endPath(),
        )

        currentPage!.drawImage(embedded.image, {
          x:      drawX,
          y:      drawY,
          width:  drawW,
          height: drawH,
        })

        currentPage!.pushOperators(popGraphicsState())

        // ── Label: nome do item (negrito, rose) ───────────────
        const labelText = truncate(item.label, 32)
        currentPage!.drawText(labelText, {
          x:    cellX,
          y:    cellTopY - LABEL_GAP,
          size: 7.5,
          font: fontBold,
          color: MAUVE,
        })

        // ── Caption: referência real (itálico, cinza) — sem texto de IA ──
        const caption = sanitizeCaption(item.caption)
        if (caption) {
          const capText = truncate(caption, 38)
          currentPage!.drawText(capText, {
            x:    cellX,
            y:    cellTopY - LABEL_GAP - LABEL_H - CAPTION_GAP + 2,
            size: 6.5,
            font: fontItalic,
            color: GRAY_W,
          })
        }
      }

      cursorY -= ROW_H
    }

    // Espaço extra entre seções
    cursorY -= SECTION_GAP
  }

  // ─── CONTRA-CAPA (página 3 do template) ───────────────────
  const [backPage] = await pdf.copyPages(templateDoc, [2])
  pdf.addPage(backPage)

  // 3. Salvar
  return await pdf.save()
}


// ─── Helpers privados ───────────────────────────────────────

/**
 * Cobre o footer direito do template (telefone/instagram da Marília)
 * com um retângulo na cor creme do fundo.
 */
function coverFooterRight(page: PDFPage) {
  page.drawRectangle({
    x: 420,
    y: 20,
    width: 180,
    height: 45,
    color: BG_CREAM,
    borderWidth: 0,
  })
}

/**
 * Desenha o footer dinâmico: nome da cliente (centro) + data (direita).
 */
function drawDynamicFooter(
  page: PDFPage,
  clientName: string,
  dateStr: string,
  font: any,
) {
  const FOOTER_Y = PH - 818 + 4

  const nameW = font.widthOfTextAtSize(clientName, 7)
  page.drawText(clientName, {
    x: (PW - nameW) / 2,
    y: FOOTER_Y,
    size: 7,
    font,
    color: MAUVE2,
  })

  const dateW = font.widthOfTextAtSize(dateStr, 7)
  page.drawText(dateStr, {
    x: PW - MG - dateW,
    y: FOOTER_Y,
    size: 7,
    font,
    color: MAUVE2,
  })
}

/**
 * Embute uma imagem no PDF a partir de data-URL ou URL pública.
 * Suporta JPEG e PNG. Outros formatos são ignorados (retorna null).
 */
async function embedImage(
  pdf: PDFDocument,
  dataUrl: string,
): Promise<{ image: any; width: number; height: number } | null> {
  try {
    let bytes: Uint8Array
    let isPng = false

    if (dataUrl.startsWith('data:')) {
      const [header, b64] = dataUrl.split(',')
      isPng = header.includes('png')
      bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    } else {
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      isPng = blob.type.includes('png')
      bytes = new Uint8Array(await blob.arrayBuffer())
    }

    const image = isPng
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes)

    return { image, width: image.width, height: image.height }
  } catch (e) {
    console.error('Erro ao embutir imagem no PDF:', e)
    return null
  }
}

/** Trunca texto longo com reticências */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}


// ─── Função de download ─────────────────────────────────────

/**
 * Gera e inicia o download do PDF de estilo personalizado.
 *
 * @param templateUrl  URL do Modelo.pdf (ex: '/Modelo.pdf')
 * @param clientName   Nome da cliente
 * @param items        Lista de imagens com metadados
 */
export async function downloadStylePDF(
  templateUrl: string,
  clientName: string,
  items: PdfImageItem[],
): Promise<void> {
  const res = await fetch(templateUrl)
  if (!res.ok) throw new Error(`Erro ao carregar template: ${res.status}`)
  const templateBytes = await res.arrayBuffer()

  const pdfBytes = await generateStylePDF(templateBytes, clientName, items)

  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `Simulações MS Color IA - ${clientName.replace(/\s+/g, '-').toLowerCase()}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}