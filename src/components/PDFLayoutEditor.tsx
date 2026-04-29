// src/components/PDFLayoutEditor.tsx
//
// Editor visual de layout PDF — estilo Canva.
// Dois modos:
//   'flow'     → layout de fluxo (foto esquerda + blocos direita, empilhados)
//   'freeform' → blocos e foto livres, arrastáveis e redimensionáveis na página A4
//
// O layout salvo (ItemLayout) é consumido pelo templatePDFGenerator para gerar o PDF.

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  X, Minus, Plus, RotateCcw, Check, Download, Trash2,
  Scissors, MousePointer, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Grid, Move, Maximize2,
  ChevronUp, ChevronDown, Image as ImageIcon, Camera,
  ZoomIn, ZoomOut, Edit3, Tag,
} from 'lucide-react'

// ─── Tipos públicos ──────────────────────────────────────────────────────────

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
  // Visual variant
  blockVariant?: 'plain' | 'soft' | 'card' | 'outline' | 'accent'
  // Cor de fundo customizada (hex). Em soft/card/accent, sobrescreve o fundo default.
  blockBgColor?: string
  // Alinhamentos independentes de título e corpo
  titleAlign?: 'left' | 'center' | 'right' | 'justify'
  textAlign?:  'left' | 'center' | 'right' | 'justify'
}

export interface PhotoConfig {
  x: number   // pts from page left
  y: number   // pts from page top
  w: number   // pts width
  h: number   // pts height
}

// ─── Configuração do label (nome visível para a cliente) ──────────────────────

export interface LabelConfig {
  visible?:    boolean        // default: true
  x?:          number         // pts from left (default: centred below photo)
  y?:          number         // pts from top (default: auto below photo)
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

// ─── Props ───────────────────────────────────────────────────────────────────

interface PDFLayoutEditorProps {
  caption:        string
  imageUrl?:      string
  clientName?:    string
  sectionTitle?:  string
  promptLabel?:   string        // "Nome (aparece para a cliente)" — ex: "Iluminado Avelã, Mel e Ash Brown"
  initialStyle:   PdfStyleConfig
  initialLayout?: ItemLayout
  onSave:         (layout: ItemLayout) => void
  onClose:        () => void
  onGeneratePDF?: () => void
}

// ─── Constantes A4 ───────────────────────────────────────────────────────────

const SCALE          = 0.72
const PW             = 595.5
const PH             = 842.2
const CW             = Math.round(PW * SCALE)   // 429
const CH             = Math.round(PH * SCALE)   // 607

const DEF_MG         = 39.7
const DEF_PHOTO_X    = DEF_MG
const DEF_PHOTO_Y    = 72
const DEF_PHOTO_W    = 192
const DEF_PHOTO_H    = 700
const DEF_TXT_X      = DEF_PHOTO_X + DEF_PHOTO_W + 16
const DEF_TXT_W      = PW - DEF_TXT_X - DEF_MG

const SNAP_GRID      = 8   // pts
const HANDLE_SIZE    = 8   // px

const MIN_ZOOM       = 0.5
const MAX_ZOOM       = 2.0
const ZOOM_STEP      = 0.1

const FONT_CSS: Record<PdfFontFamily, string> = {
  Helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  Times:     'Georgia, "Times New Roman", Times, serif',
  Courier:   '"Courier New", Courier, monospace',
}
const FONTS: PdfFontFamily[] = ['Helvetica', 'Times', 'Courier']

// ─── Parsers ─────────────────────────────────────────────────────────────────

const EMOJI_RE_CLEAN = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}\u{FE00}-\u{FEFF}]/gu
const EMOJI_RE_TEST  = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}\u{FE00}-\u{FEFF}]/u
const BLOCK_START_RE = /^[🎯🎨🥇✨💡❌🧠📌🚫👉]/u

function cleanLine(text: string): string {
  return text.replace(EMOJI_RE_CLEAN, '').replace(/→/g, '>').replace(/–/g, '-')
    .replace(/\u2014/g, '--').replace(/[""]/g, '"').replace(/['']/g, "'")
    .replace(/\s+/g, ' ').trim()
}

function parseCaption(caption: string): Array<{ lines: string[]; isSection: boolean }> {
  if (!caption.trim()) return []
  const rawLines = caption.split('\n')
  const normalized: string[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim(), p = i > 0 ? rawLines[i - 1].trim() : ''
    if (t && p && BLOCK_START_RE.test(t)) normalized.push('')
    normalized.push(rawLines[i])
  }
  return normalized.join('\n').split(/\n[ \t]*\n/).map(raw => {
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) return null
    const first = lines[0]
    const isSection = EMOJI_RE_TEST.test(first)
      || (first === first.toUpperCase() && first.replace(/[^A-Za-z]/g, '').length >= 4)
      || /^(MINI DOSSIÊ|RESUMO|LEITURA|TÉCNICA|ERROS|NUANCES|DISTRIBUI|CORES|BALAYAGE)/i.test(first)
    return { lines, isSection }
  }).filter(Boolean) as Array<{ lines: string[]; isSection: boolean }>
}

function captionToBlocks(caption: string): EditorBlock[] {
  return parseCaption(caption).map((b, i) => ({
    id: `block-${i}-${Date.now()}`,
    rawLines: b.lines,
    isSection: b.isSection,
    marginBelow: 8,
  }))
}

function estimateBlockH(block: EditorBlock, wPts: number): number {
  const hSize = block.headerSize ?? 8.5
  const bSize = block.bodySize   ?? 7.5
  const charW = 4.2
  const cpl   = Math.max(1, Math.floor(wPts / charW))
  let totalH  = 0
  for (let i = 0; i < block.rawLines.length; i++) {
    const c = block.rawLines[i].replace(EMOJI_RE_CLEAN, '').trim()
    const wrapped = Math.max(1, Math.ceil((c.length || 1) / cpl))
    // Primeira linha de seção renderiza em hSize; demais em bSize
    const lh = (i === 0 && block.isSection) ? hSize * 1.47 : bSize * 1.47
    totalH += wrapped * lh
  }
  return Math.max(18, totalH + 6)
}

function initFreeformBlocks(blocks: EditorBlock[], photo: PhotoConfig, mgH: number): EditorBlock[] {
  const txtX = photo.x + photo.w + 16
  const txtW = PW - txtX - mgH
  let curY = DEF_PHOTO_Y
  return blocks.map(b => {
    if (b.x !== undefined && b.y !== undefined && b.w !== undefined) return b
    const h = estimateBlockH(b, txtW)
    const out = { ...b, x: txtX, y: curY, w: txtW, h }
    curY += h + (b.marginBelow || 8)
    return out
  })
}

// ─── Paginação modo flow ─────────────────────────────────────────────────────

const FLOW_CONTENT_TOP_PTS   = 72
const FLOW_CONTENT_BTM_PTS   = 800
const FLOW_PHOTO_BOTTOM_PTS  = 72 + DEF_PHOTO_H   // 772
const PAGE_GAP_PX            = 24

interface FlowPlacement {
  block:     EditorBlock
  idx:       number
  yPts:      number
  hPts:      number
  xPts:      number
  wPts:      number
  fullWidth: boolean
}

function paginateFlow(blocks: EditorBlock[], mgH: number): FlowPlacement[][] {
  const narrowW = DEF_TXT_W
  const narrowX = DEF_TXT_X
  const wideW   = PW - 2 * mgH
  const wideX   = mgH

  const pages: FlowPlacement[][] = [[]]
  let pageIdx   = 0
  let yCursor   = FLOW_CONTENT_TOP_PTS
  let fullWidth = false

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const gap   = block.marginBelow ?? 8

    const photoBottom = pageIdx === 0 ? FLOW_PHOTO_BOTTOM_PTS : FLOW_CONTENT_TOP_PTS

    if (pageIdx === 0 && !fullWidth && yCursor >= photoBottom) {
      fullWidth = true
      yCursor = photoBottom + 4
    }

    if (pageIdx > 0) fullWidth = true

    let colW = fullWidth ? wideW   : narrowW
    let colX = fullWidth ? wideX   : narrowX
    let h    = estimateBlockH(block, colW)
    let totalH = h + gap

    if (yCursor + totalH > FLOW_CONTENT_BTM_PTS) {
      if (!fullWidth && pageIdx === 0) {
        fullWidth = true
        yCursor = photoBottom + 4
        colW = wideW; colX = wideX
        h = estimateBlockH(block, colW); totalH = h + gap
      }
      if (yCursor + totalH > FLOW_CONTENT_BTM_PTS) {
        pageIdx++
        pages.push([])
        yCursor = FLOW_CONTENT_TOP_PTS
        fullWidth = true
        colW = wideW; colX = wideX
        h = estimateBlockH(block, colW); totalH = h + gap
      }
    }

    pages[pageIdx].push({ block, idx: i, yPts: yCursor, hPts: h, xPts: colX, wPts: colW, fullWidth })
    yCursor += totalH
  }

  return pages
}

// ─── Paginação modo freeform ─────────────────────────────────────────────────

function paginateFreeformPages(blocks: EditorBlock[], photo: PhotoConfig): number {
  const maxBlockBottom = blocks.reduce((max, b) => {
    const by = b.y ?? 72
    const bh = b.h ?? estimateBlockH(b, b.w ?? DEF_TXT_W)
    return Math.max(max, by + bh)
  }, photo.y + photo.h)
  return Math.max(1, Math.ceil(maxBlockBottom / PH))
}

// ─── Drag state ──────────────────────────────────────────────────────────────

type HandleType = 'move' | 'right' | 'left' | 'bottom' | 'br' | 'bl' | 'top' | 'tr' | 'tl'

interface DragState {
  id:   string
  type: HandleType
  sx:   number; sy: number
  ox:   number; oy: number
  ow:   number; oh: number
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PDFLayoutEditor({
  caption,
  imageUrl,
  clientName   = 'Pré-visualização',
  sectionTitle = 'Cabelo',
  promptLabel  = '',
  initialStyle,
  initialLayout,
  onSave,
  onClose,
  onGeneratePDF,
}: PDFLayoutEditorProps) {

  // ── Core state ────────────────────────────────────────────────────────────

  const [layoutMode, setLayoutMode] = useState<'flow' | 'freeform'>(
    initialLayout?.layoutMode ?? 'flow'
  )
  const [blocks, setBlocks] = useState<EditorBlock[]>(() =>
    initialLayout?.blocks?.length ? initialLayout.blocks : captionToBlocks(caption)
  )
  const [style, setStyle] = useState<PdfStyleConfig>(() => ({
    headerFont: 'Helvetica', headerSize: 8.5, headerColor: '#77304F',
    bodyFont: 'Helvetica', bodySize: 7.5, bodyColor: '#645859',
    accentColor: '#87485E',
    ...initialStyle,
    ...(initialLayout?.style ?? {}),
  }))
  const [photo, setPhoto] = useState<PhotoConfig>(
    initialLayout?.photo ?? { x: DEF_PHOTO_X, y: DEF_PHOTO_Y, w: DEF_PHOTO_W, h: DEF_PHOTO_H }
  )
  const [mgH, setMgH] = useState(initialLayout?.pageMarginH ?? DEF_MG)
  const [snap, setSnap] = useState(true)
  const [zoom, setZoom] = useState(1)

  // ── Label state ────────────────────────────────────────────────────────────
  const [labelConfig, setLabelConfig] = useState<LabelConfig>(
    initialLayout?.labelConfig ?? { visible: true, bold: true, uppercase: true }
  )

  // ── Flow mode state ───────────────────────────────────────────────────────

  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [draggingId,  setDraggingId]  = useState<string | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [saved,       setSaved]       = useState(false)

  const blocksRef   = useRef(blocks)
  const dragOverRef = useRef<number | null>(null)
  const txtColRef   = useRef<HTMLDivElement>(null)

  // ── Freeform mode state ───────────────────────────────────────────────────

  const canvasRef   = useRef<HTMLDivElement>(null)
  const dragRef     = useRef<DragState | null>(null)
  const [freeSel,   setFreeSel]   = useState<string | null>(null)
  const [, forceUpdate] = useState(0)
  const [alignGuides, setAlignGuides] = useState<{ x?: number; y?: number; snap?: boolean }[]>([])

  useEffect(() => { blocksRef.current = blocks }, [blocks])
  useEffect(() => { dragOverRef.current = dragOverIdx }, [dragOverIdx])

  // ── Undo history ──────────────────────────────────────────────────────────

  type HistorySnap = { blocks: EditorBlock[]; style: PdfStyleConfig; photo: PhotoConfig }
  const historyRef      = useRef<HistorySnap[]>([{ blocks, style, photo }])
  const historyIdxRef   = useRef(0)
  const styleRef        = useRef(style)
  const photoRef        = useRef(photo)
  useEffect(() => { styleRef.current = style }, [style])
  useEffect(() => { photoRef.current = photo }, [photo])

  const pushHistory = useCallback(() => {
    const snap: HistorySnap = {
      blocks: blocksRef.current,
      style:  styleRef.current,
      photo:  photoRef.current,
    }
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1)
    historyRef.current.push(snap)
    if (historyRef.current.length > 60) historyRef.current.shift()
    historyIdxRef.current = historyRef.current.length - 1
  }, [])

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return
    historyIdxRef.current--
    const snap = historyRef.current[historyIdxRef.current]
    setBlocks(snap.blocks)
    setStyle(snap.style)
    setPhoto(snap.photo)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo])

  // ── Switch to freeform: init positions ────────────────────────────────────

  const switchToFreeform = () => {
    setBlocks(prev => initFreeformBlocks(prev, photo, mgH))
    setLayoutMode('freeform')
    setSelectedId(null)
    setFreeSel(null)
  }

  const switchToFlow = () => {
    setLayoutMode('flow')
    setFreeSel(null)
  }

  // ── Flow: block helpers ───────────────────────────────────────────────────

  const updateBlock = useCallback((id: string, u: Partial<EditorBlock>) => {
    pushHistory()
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...u } : b))
  }, [pushHistory])

  const moveBlock = (id: string, dir: -1 | 1) => {
    pushHistory()
    setBlocks(prev => {
      const i = prev.findIndex(b => b.id === id), j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n
    })
  }

  const deleteBlock = (id: string) => {
    pushHistory()
    setBlocks(prev => prev.filter(b => b.id !== id))
    setSelectedId(null); setFreeSel(null)
  }

  const mergeBlocks = (id: string) => {
    pushHistory()
    setBlocks(prev => {
      const i = prev.findIndex(b => b.id === id); if (i < 0 || i >= prev.length - 1) return prev
      const a = prev[i], b = prev[i + 1]
      const mergedLines = [...a.rawLines, ...b.rawLines]
      const merged: EditorBlock = { ...a, rawLines: mergedLines, marginBelow: b.marginBelow }
      if (a.w !== undefined) {
        merged.h = estimateBlockH({ ...merged, rawLines: mergedLines }, a.w)
      }
      const n = [...prev]; n.splice(i, 2, merged); return n
    })
  }

  const splitBlock = (id: string) => {
    pushHistory()
    setBlocks(prev => {
      const i = prev.findIndex(b => b.id === id); if (i < 0) return prev
      const b = prev[i]; if (b.rawLines.length < 2) return prev
      const mid = Math.ceil(b.rawLines.length / 2), ts = Date.now()
      const a = b.rawLines.slice(0, mid), bLines = b.rawLines.slice(mid)
      const n = [...prev]
      n.splice(i, 1,
        { ...b, id: `${id}a${ts}`, rawLines: a,
          isSection: EMOJI_RE_TEST.test(a[0]) || (a[0]===a[0].toUpperCase()&&a[0].replace(/[^A-Za-z]/g,'').length>=4) },
        { ...b, id: `${id}b${ts}`, rawLines: bLines, marginBelow: 8,
          isSection: EMOJI_RE_TEST.test(bLines[0]) || (bLines[0]===bLines[0].toUpperCase()&&bLines[0].replace(/[^A-Za-z]/g,'').length>=4) },
      ); return n
    })
  }

  // ── Flow: drag-to-reorder ─────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.MouseEvent, blockId: string) => {
    e.preventDefault(); setDraggingId(blockId); setSelectedId(blockId)
  }, [])

  useEffect(() => {
    if (!draggingId || layoutMode !== 'flow') return
    const onMove = (e: MouseEvent) => {
      const col = txtColRef.current; if (!col) return
      const rect = col.getBoundingClientRect(), relY = e.clientY - rect.top
      const els = Array.from(col.querySelectorAll('[data-block-id]')) as HTMLElement[]
      let target = els.length
      for (let i = 0; i < els.length; i++) {
        const er = els[i].getBoundingClientRect()
        if (relY < er.top + er.height / 2 - rect.top) { target = i; break }
      }
      setDragOverIdx(target)
    }
    const onUp = () => {
      const from = blocksRef.current.findIndex(b => b.id === draggingId)
      const to = dragOverRef.current
      if (to !== null && from !== -1 && to !== from && to !== from + 1) {
        setBlocks(prev => {
          const n = [...prev]; const [item] = n.splice(from, 1)
          n.splice(to > from ? to - 1 : to, 0, item); return n
        })
      }
      setDraggingId(null); setDragOverIdx(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [draggingId, layoutMode])

  // ── Freeform: drag/resize ─────────────────────────────────────────────────

  const getBlockOrPhoto = (id: string) => {
    if (id === '__photo__') return { x: photo.x, y: photo.y, w: photo.w, h: photo.h }
    const b = blocks.find(b => b.id === id)
    return b ? { x: b.x ?? 0, y: b.y ?? 72, w: b.w ?? 200, h: b.h ?? 40 } : null
  }

  const applyDelta = (id: string, type: HandleType, dxPts: number, dyPts: number) => {
    const orig = dragRef.current; if (!orig) return
    const s = (v: number) => snap ? Math.round(v / SNAP_GRID) * SNAP_GRID : v

    if (id === '__photo__') {
      setPhoto(prev => {
        let { x, y, w, h } = prev
        if (type === 'move')   { x = s(orig.ox + dxPts); y = s(orig.oy + dyPts) }
        if (type === 'right' || type === 'br' || type === 'tr') w = Math.max(40, s(orig.ow + dxPts))
        if (type === 'left'  || type === 'bl' || type === 'tl') { w = Math.max(40, s(orig.ow - dxPts)); x = s(orig.ox + dxPts) }
        if (type === 'bottom'|| type === 'br' || type === 'bl') h = Math.max(30, s(orig.oh + dyPts))
        if (type === 'top'   || type === 'tr' || type === 'tl') { h = Math.max(30, s(orig.oh - dyPts)); y = s(orig.oy + dyPts) }
        return { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(PW, w), h: Math.min(PH, h) }
      })
    } else {
      setBlocks(prev => {
        const updated = prev.map(b => {
          if (b.id !== id) return b
          let { x = 0, y = 72, w = 200, h = 40 } = b
          if (type === 'move')   { x = s(orig.ox + dxPts); y = s(orig.oy + dyPts) }
          if (type === 'right' || type === 'br' || type === 'tr') w = Math.max(30, s(orig.ow + dxPts))
          if (type === 'left'  || type === 'bl' || type === 'tl') { w = Math.max(30, s(orig.ow - dxPts)); x = s(orig.ox + dxPts) }
          if (type === 'bottom'|| type === 'br' || type === 'bl') h = Math.max(16, s(orig.oh + dyPts))
          if (type === 'top'   || type === 'tr' || type === 'tl') { h = Math.max(16, s(orig.oh - dyPts)); y = s(orig.oy + dyPts) }
          return { ...b, x: Math.max(0, x), y: Math.max(0, y), w: Math.min(PW, w), h: Math.max(16, h) }
        })

        const moving = updated.find(b => b.id === id)
        if (moving) {
          const mx = moving.x ?? 0, my = moving.y ?? 0
          const mw = moving.w ?? 200, mh = moving.h ?? 40
          const edges = { left: mx, right: mx + mw, top: my, bottom: my + mh, cx: mx + mw/2, cy: my + mh/2 }
          const guides: { x?: number; y?: number; snap?: boolean }[] = []
          const THR = 4
          const others = [
            ...updated.filter(b => b.id !== id),
            { x: photo.x, y: photo.y, w: photo.w, h: photo.h, id: '__photo__' } as any
          ]

          const activeX = new Set<number>()
          const activeY = new Set<number>()
          if (type === 'move') {
            activeX.add(edges.left); activeX.add(edges.right); activeX.add(edges.cx)
            activeY.add(edges.top);  activeY.add(edges.bottom); activeY.add(edges.cy)
          }
          if (type === 'right' || type === 'br' || type === 'tr') activeX.add(edges.right)
          if (type === 'left'  || type === 'bl' || type === 'tl') activeX.add(edges.left)
          if (type === 'bottom'|| type === 'br' || type === 'bl') activeY.add(edges.bottom)
          if (type === 'top'   || type === 'tr' || type === 'tl') activeY.add(edges.top)

          for (const ob of others) {
            const ox = ob.x ?? 0, oy = ob.y ?? 72, ow = ob.w ?? 200, oh = ob.h ?? 40
            const oEdges = { left: ox, right: ox + ow, top: oy, bottom: oy + oh, cx: ox + ow/2, cy: oy + oh/2 }

            for (const xe of [oEdges.left, oEdges.right, oEdges.cx]) {
              for (const me of activeX) {
                if (Math.abs(me - xe) < THR) guides.push({ x: xe, snap: true })
              }
            }
            for (const ye of [oEdges.top, oEdges.bottom, oEdges.cy]) {
              for (const me of activeY) {
                if (Math.abs(me - ye) < THR) guides.push({ y: ye, snap: true })
              }
            }

            if ((type === 'right' || type === 'left' || type === 'br' || type === 'bl' || type === 'tr' || type === 'tl') &&
                Math.abs(mw - ow) < THR) {
              guides.push({ x: mx + mw, snap: false })
            }
            if ((type === 'bottom' || type === 'top' || type === 'br' || type === 'bl' || type === 'tr' || type === 'tl') &&
                Math.abs(mh - oh) < THR) {
              guides.push({ y: my + mh, snap: false })
            }
          }

          setAlignGuides(guides)
        }

        return updated
      })
    }
  }

  const startInteraction = (e: React.MouseEvent, id: string, type: HandleType) => {
    e.preventDefault(); e.stopPropagation()
    const canvas = canvasRef.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const item = getBlockOrPhoto(id); if (!item) return
    pushHistory()
    dragRef.current = {
      id, type,
      sx: e.clientX - rect.left, sy: e.clientY - rect.top,
      ox: item.x, oy: item.y, ow: item.w, oh: item.h,
    }
    setFreeSel(id)
    forceUpdate(n => n + 1)
  }

  useEffect(() => {
    if (layoutMode !== 'freeform') return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const effScale = SCALE * zoom
      const dx = (e.clientX - rect.left - dragRef.current.sx) / effScale
      const dy = (e.clientY - rect.top  - dragRef.current.sy) / effScale
      applyDelta(dragRef.current.id, dragRef.current.type, dx, dy)
    }
    const onUp = () => { dragRef.current = null; setAlignGuides([]) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [layoutMode, snap, photo, blocks, zoom])

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = () => {
    onSave({ blocks, style, layoutMode, photo, pageMarginH: mgH, labelConfig })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // ── Render block text ─────────────────────────────────────────────────────

  const renderBlockContent = (block: EditorBlock, compact = false, maxHeightPts?: number) => {
    const hFont  = FONT_CSS[block.fontFamily ?? style.headerFont ?? 'Helvetica']
    const bFont  = FONT_CSS[block.fontFamily ?? style.bodyFont   ?? 'Helvetica']
    const hSize  = (block.headerSize ?? style.headerSize ?? 8.5) * SCALE
    const bSize  = (block.bodySize   ?? style.bodySize   ?? 7.5) * SCALE
    const variant = block.blockVariant ?? 'plain'
    const hColor = variant === 'accent' ? '#ffffff' : (block.headerColor ?? style.headerColor ?? '#77304F')
    const bColor = variant === 'accent' ? '#ffffff' : (block.bodyColor   ?? style.bodyColor   ?? '#645859')
    const titleAlign = block.titleAlign ?? 'left'
    const textAlign  = block.textAlign  ?? 'left'
    // Cada linha usa lineHeight proporcional ao seu próprio fontSize
    const hLineH = hSize * 1.47
    const bLineH = bSize * 1.47
    const padding = 6
    const maxLines = maxHeightPts !== undefined
      ? Math.max(1, Math.floor((maxHeightPts - padding) / (bLineH / SCALE)))
      : Infinity

    let lineCount = 0
    return block.rawLines.map((line, i) => {
      const raw = cleanLine(line); if (!raw) return null
      if (lineCount >= maxLines) return null
      lineCount++
      const isFirst = i === 0, isSub = /^[•*\-→>]/.test(raw)
      const bold = isFirst && block.isSection
      const align = bold ? titleAlign : textAlign
      const lineH = bold ? hLineH : bLineH
      return (
        <div key={i} style={{
          fontSize: bold ? hSize : bSize, color: bold ? hColor : bColor,
          fontFamily: bold ? hFont : bFont, fontWeight: bold ? 700 : 400,
          lineHeight: `${lineH}px`, paddingLeft: (!isFirst && isSub) ? 8 : 0,
          textAlign: align,
          wordBreak: 'break-word', userSelect: 'none',
          whiteSpace: compact ? 'nowrap' : undefined,
          overflow: compact ? 'hidden' : undefined,
          textOverflow: compact ? 'ellipsis' : undefined,
        }}>
          {isSub ? '• ' + raw.replace(/^[•*\-→>]+\s*/, '') : raw}
        </div>
      )
    })
  }

  // ── Freeform: resize handle ───────────────────────────────────────────────

  const Handle = ({ id, type, style: s }: { id: string; type: HandleType; style: React.CSSProperties }) => (
    <div
      onMouseDown={e => startInteraction(e, id, type)}
      style={{
        position: 'absolute', width: HANDLE_SIZE, height: HANDLE_SIZE,
        background: '#fff', border: '1.5px solid #87485E', borderRadius: 2,
        zIndex: 10, cursor: getCursor(type), ...s,
      }}
    />
  )

  function getCursor(type: HandleType): string {
    if (type === 'move')   return 'move'
    if (type === 'right' || type === 'left') return 'ew-resize'
    if (type === 'top'   || type === 'bottom') return 'ns-resize'
    if (type === 'br'    || type === 'tl') return 'nwse-resize'
    if (type === 'bl'    || type === 'tr') return 'nesw-resize'
    return 'default'
  }

  const hs = HANDLE_SIZE / 2
  const renderHandles = (id: string, _isPhoto: boolean) => (
    <>
      <Handle id={id} type="tl" style={{ top: -hs, left: -hs }} />
      <Handle id={id} type="tr" style={{ top: -hs, right: -hs }} />
      <Handle id={id} type="bl" style={{ bottom: -hs, left: -hs }} />
      <Handle id={id} type="br" style={{ bottom: -hs, right: -hs }} />
      <Handle id={id} type="top"    style={{ top: -hs,    left: '50%', transform: 'translateX(-50%)' }} />
      <Handle id={id} type="bottom" style={{ bottom: -hs, left: '50%', transform: 'translateX(-50%)' }} />
      <Handle id={id} type="left"   style={{ left: -hs,   top:  '50%', transform: 'translateY(-50%)' }} />
      <Handle id={id} type="right"  style={{ right: -hs,  top:  '50%', transform: 'translateY(-50%)' }} />
    </>
  )

  const accent = style.accentColor ?? '#87485E'

  // ── Label preview helper ──────────────────────────────────────────────────

  const renderLabelPreview = (photoLeftPx: number, photoWidthPx: number, photoBottomPx: number) => {
    if (labelConfig.visible === false) return null
    const rawLabel = promptLabel || caption?.split('\n')[0]?.slice(0, 40) || ''
    if (!rawLabel.trim()) return null

    // Mesma lógica do drawItemLabel no PDF: mostra só a primeira parte antes de " — "
    const label = rawLabel.split(/\s*—\s*/)[0].trim() || rawLabel

    const displayText = (labelConfig.uppercase !== false) ? label.toUpperCase() : label
    // Mínimo 9px no preview — o PDF usa o tamanho real (7pt), mas na tela 5px é ilegível
    const fontSizePts = labelConfig.fontSize ?? 7
    const fontSize    = Math.max(9, fontSizePts * SCALE)
    const color       = labelConfig.color ?? (style.headerColor ?? '#77304F')
    const fontFamily  = FONT_CSS[labelConfig.fontFamily ?? 'Helvetica']
    const fontWeight  = labelConfig.bold !== false ? 700 : 400

    const customX = labelConfig.x !== undefined ? labelConfig.x * SCALE : null
    const customY = labelConfig.y !== undefined ? labelConfig.y * SCALE : null

    const top  = customY !== null ? customY : (photoBottomPx + 4)
    const left = customX !== null ? customX : photoLeftPx
    const width = customX !== null ? 'auto' : photoWidthPx

    return (
      <div style={{
        position: 'absolute',
        top, left, width,
        textAlign: customX !== null ? 'left' : 'center',
        // Chip visual para indicar posição no editor — não afeta o PDF gerado
        background: `${color}18`,
        borderRadius: 3,
        border: `1px dashed ${color}55`,
        padding: '1px 4px',
        fontSize,
        fontFamily,
        color,
        fontWeight,
        letterSpacing: 0.4,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxSizing: 'border-box' as const,
      }}>
        {displayText}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const selectedBlock = blocks.find(b => b.id === (layoutMode === 'flow' ? selectedId : freeSel)) ?? null

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: 'rgba(8,8,12,0.88)', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 52, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', background: '#18181b', borderBottom: '1px solid #2a2a2e',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={iconBtn}>
            <X size={15} />
          </button>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f0f0', lineHeight: 1.2 }}>
              Editor de Layout PDF
            </div>
            <div style={{ fontSize: 11, color: '#666' }}>
              {sectionTitle} · {clientName}
            </div>
          </div>
        </div>

        {/* Mode switcher */}
        <div style={{ display: 'flex', gap: 4, background: '#111', border: '1px solid #2a2a2e', borderRadius: 10, padding: 3 }}>
          {(['flow', 'freeform'] as const).map(m => (
            <button key={m} onClick={() => m === 'freeform' ? switchToFreeform() : switchToFlow()}
              style={{
                height: 28, padding: '0 12px', borderRadius: 7, border: 'none',
                background: layoutMode === m ? accent : 'transparent',
                color: layoutMode === m ? '#fff' : '#666',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
              }}
            >
              {m === 'flow' ? <><AlignLeft size={11} /> Fluxo</> : <><Move size={11} /> Livre</>}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {/* Zoom controls */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            background: '#111', border: '1px solid #2a2a2e', borderRadius: 8, padding: 2,
          }}>
            <button
              onClick={() => setZoom(z => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
              disabled={zoom <= MIN_ZOOM}
              style={{
                width: 28, height: 28, borderRadius: 6, border: 'none',
                background: 'transparent', cursor: zoom <= MIN_ZOOM ? 'not-allowed' : 'pointer',
                color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: zoom <= MIN_ZOOM ? 0.35 : 1,
              }}
            >
              <ZoomOut size={13} />
            </button>
            <button
              onClick={() => setZoom(1)}
              style={{
                minWidth: 44, height: 28, padding: '0 6px', borderRadius: 6, border: 'none',
                background: 'transparent', cursor: 'pointer', color: '#c4a0b8',
                fontSize: 11, fontWeight: 600,
              }}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => setZoom(z => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
              disabled={zoom >= MAX_ZOOM}
              style={{
                width: 28, height: 28, borderRadius: 6, border: 'none',
                background: 'transparent', cursor: zoom >= MAX_ZOOM ? 'not-allowed' : 'pointer',
                color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: zoom >= MAX_ZOOM ? 0.35 : 1,
              }}
            >
              <ZoomIn size={13} />
            </button>
          </div>

          {layoutMode === 'freeform' && (
            <button
              onClick={() => setSnap(s => !s)}
              style={{ ...iconBtn, background: snap ? '#2e2e3a' : 'transparent', color: snap ? '#c4a0b8' : '#555' }}
              title="Snap ao grid (8pt)"
            >
              <Grid size={14} />
            </button>
          )}
          <button onClick={handleSave} style={{
            height: 34, padding: '0 14px', borderRadius: 8,
            background: saved ? '#16a34a' : accent, border: 'none',
            cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.2s',
          }}>
            <Check size={13} />
            {saved ? 'Salvo!' : 'Salvar Layout'}
          </button>
          {onGeneratePDF && (
            <button onClick={() => { handleSave(); onGeneratePDF() }} style={{
              height: 34, padding: '0 14px', borderRadius: 8,
              background: '#f0f0f0', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: '#111',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Download size={13} /> Gerar PDF
            </button>
          )}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 52, bottom: 0, left: 0, right: 0, display: 'flex', overflow: 'hidden' }}>

        {/* ── Canvas area ──────────────────────────────────────────────── */}
        {(() => {
          const flowPages = layoutMode === 'flow' ? paginateFlow(blocks, mgH) : null
          const freePageCount = layoutMode === 'freeform' ? paginateFreeformPages(blocks, photo) : 1
          const pageCount = flowPages?.length ?? freePageCount
          const totalH = pageCount * CH + (pageCount - 1) * PAGE_GAP_PX

          return (
            <div style={{
              flex: 1, overflow: 'auto', display: 'flex',
              alignItems: 'flex-start', justifyContent: 'center',
              padding: '32px 24px',
              background: 'radial-gradient(ellipse at 60% 40%, #1c1c28 0%, #0d0d11 100%)',
            }}>
              <div style={{ width: CW * zoom, height: totalH * zoom, flexShrink: 0 }}>
                <div style={{
                  width: CW, height: totalH,
                  transform: `scale(${zoom})`, transformOrigin: 'top left',
                }}>
                  {layoutMode === 'flow'
                    ? renderFlowCanvas(flowPages!)
                    : renderFreeformCanvas()
                  }
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div style={{
          width: 270, flexShrink: 0, height: '100%',
          background: '#1a1a1e', borderLeft: '1px solid #2a2a2e',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          {selectedBlock
            ? <BlockPanel
                block={selectedBlock}
                mode={layoutMode}
                onChange={u => updateBlock(selectedBlock.id, u)}
                onDelete={() => deleteBlock(selectedBlock.id)}
                onSplit={() => splitBlock(selectedBlock.id)}
                onMerge={() => mergeBlocks(selectedBlock.id)}
                onMoveUp={layoutMode === 'flow' ? () => moveBlock(selectedBlock.id, -1) : undefined}
                onMoveDn={layoutMode === 'flow' ? () => moveBlock(selectedBlock.id,  1) : undefined}
                style={style}
              />
            : <GlobalPanel
                style={style}
                layoutMode={layoutMode}
                snap={snap}
                onSnapChange={setSnap}
                mgH={mgH}
                onMgHChange={setMgH}
                photo={photo}
                onPhotoChange={setPhoto}
                onChange={setStyle}
                labelConfig={labelConfig}
                onLabelChange={setLabelConfig}
                promptLabel={promptLabel}
              />
          }
        </div>
      </div>
    </div>
  )

  // ─────────────────────────────────────────────────────────────────────────
  // FLOW CANVAS (multi-page)
  // ─────────────────────────────────────────────────────────────────────────

  function renderFlowCanvas(pages: FlowPlacement[][]) {
    const S_MG   = Math.round(DEF_MG * SCALE)
    const S_IW   = Math.round(DEF_PHOTO_W * SCALE)
    const S_IMGH = Math.round(DEF_PHOTO_H * SCALE)
    const IMG_TOP_PX = Math.round(72 * SCALE)

    return (
      <div
        ref={txtColRef}
        style={{ display: 'flex', flexDirection: 'column', gap: PAGE_GAP_PX, alignItems: 'center' }}
        onClick={() => setSelectedId(null)}
      >
        {pages.map((placements, pageIdx) => (
          <div
            key={pageIdx}
            style={{
              width: CW, height: CH, position: 'relative', flexShrink: 0,
              background: '#f8f4ef', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', borderRadius: 2,
            }}
          >
            {/* Top accent bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: '2px 2px 0 0' }} />

            {/* Header */}
            <div style={{ position: 'absolute', top: 8, left: S_MG, right: S_MG, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 5.5, fontFamily: FONT_CSS.Helvetica, color: accent, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{sectionTitle}</span>
              <span style={{ fontSize: 5.5, fontFamily: FONT_CSS.Helvetica, color: style.bodyColor ?? '#645859' }}>{clientName}</span>
            </div>
            <div style={{ position: 'absolute', top: 16, left: S_MG, right: S_MG, height: 0.4, background: accent, opacity: 0.2 }} />

            {/* Photo (page 1 only) */}
            {pageIdx === 0 && (
              <div style={{ position: 'absolute', left: S_MG, top: IMG_TOP_PX, width: S_IW }}>
                <div style={{ width: '100%', height: S_IMGH, borderRadius: 3, overflow: 'hidden', background: imageUrl ? 'transparent' : '#f0ebe4' }}>
                  {imageUrl
                    ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'top center' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Camera size={18} color="#a09488" />
                        <div style={{ fontSize: 7, color: '#a09488' }}>Foto da cliente</div>
                      </div>
                  }
                </div>
                {/* Prompt label below photo */}
                {renderLabelPreview(0, S_IW, S_IMGH)}
              </div>
            )}

            {/* Drag-over indicator */}
            {draggingId && dragOverIdx !== null && placements.length > 0 && (() => {
              const insertBefore = placements.find((_, i) => i === dragOverIdx)
              if (!insertBefore) return null
              return <div style={{ position: 'absolute', left: insertBefore.xPts * SCALE, top: insertBefore.yPts * SCALE - 1, width: insertBefore.wPts * SCALE, height: 2, background: accent, borderRadius: 1, opacity: 0.8 }} />
            })()}

            {/* Blocks */}
            {placements.map(pl => {
              const block  = pl.block
              const isSel  = selectedId === block.id
              const isDrag = draggingId === block.id

              const left = pl.xPts * SCALE
              const top  = pl.yPts * SCALE
              const widt = pl.wPts * SCALE
              const hgt  = pl.hPts * SCALE

              return (
                <div
                  key={block.id}
                  data-block-id={block.id}
                  style={{
                    position: 'absolute',
                    left, top, width: widt,
                    // height exata + overflow hidden = preview 100% fiel ao PDF
                    height: hgt, overflow: 'hidden',
                    opacity: isDrag ? 0.3 : 1,
                    cursor: 'pointer', borderRadius: 2,
                    padding: '1px 3px 1px 6px',
                    outline: isSel ? `1.5px solid ${accent}` : '1px solid transparent',
                    background: isSel ? `${accent}12` : 'transparent',
                    transition: 'outline 0.12s',
                    boxSizing: 'border-box',
                  }}
                  onClick={e => { e.stopPropagation(); setSelectedId(block.id) }}
                >
                  {block.isSection && (
                    <div style={{ position: 'absolute', left: 0, top: 2, bottom: 2, width: 2, background: accent, opacity: 0.55, borderRadius: 1 }} />
                  )}
                  {isSel && (
                    <div style={{ position: 'absolute', top: 1, right: 1, display: 'flex', gap: 3 }}>
                      <div style={dotHandle} onMouseDown={e => handleDragStart(e, block.id)} title="Arrastar">≡</div>
                    </div>
                  )}
                  {renderBlockContent(block)}
                </div>
              )
            })}

            {/* Footer */}
            <div style={{ position: 'absolute', bottom: 10, left: S_MG, right: S_MG, height: 0.4, background: accent, opacity: 0.15 }} />
            <div style={{ position: 'absolute', bottom: 6, left: S_MG, fontSize: 4.5, color: style.bodyColor ?? '#aaa' }}>
              MARILIA SANTOS — COLORAÇÃO PESSOAL
            </div>

            {pages.length > 1 && (
              <div style={{
                position: 'absolute', bottom: 6, right: S_MG,
                fontSize: 5.5, color: accent, fontWeight: 600, letterSpacing: 0.5,
              }}>
                {pageIdx + 1} / {pages.length}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FREEFORM CANVAS
  // ─────────────────────────────────────────────────────────────────────────

  function renderFreeformCanvas() {
    const S_MG = Math.round(mgH * SCALE)
    const freePageCount = paginateFreeformPages(blocks, photo)

    return (
      <div style={{ position: 'relative' }}>
        {snap && (
          <div style={{ position: 'absolute', top: -22, right: 0, fontSize: 10, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Grid size={10} color="#555" /> Snap 8pt ativo
          </div>
        )}

        <div
          ref={canvasRef}
          style={{ display: 'flex', flexDirection: 'column', gap: PAGE_GAP_PX, alignItems: 'center' }}
          onClick={() => { setFreeSel(null) }}
        >
          {Array.from({ length: freePageCount }, (_, pageIdx) => {
            const pageYStartPts = pageIdx * PH
            const pageYEndPts   = (pageIdx + 1) * PH
            const photoOnThisPage = pageIdx === 0
            const pageBlocks = blocks.filter(b => {
              const by = b.y ?? 72
              return by >= pageYStartPts && by < pageYEndPts
            })

            return (
              <div
                key={pageIdx}
                style={{
                  width: CW, height: CH, position: 'relative', flexShrink: 0,
                  background: '#f8f4ef', boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
                  borderRadius: 2, overflow: 'hidden', cursor: 'default',
                }}
              >
                {snap && <SnapGrid accent={accent} />}

                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: '2px 2px 0 0' }} />

                <div style={{ position: 'absolute', top: 8, left: S_MG, right: S_MG, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 5.5, fontFamily: FONT_CSS.Helvetica, color: accent, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{sectionTitle}</span>
                  <span style={{ fontSize: 5.5, fontFamily: FONT_CSS.Helvetica, color: style.bodyColor ?? '#645859' }}>{clientName}</span>
                </div>
                <div style={{ position: 'absolute', top: 16, left: S_MG, right: S_MG, height: 0.4, background: accent, opacity: 0.2 }} />

                {/* Photo — page 1 only */}
                {photoOnThisPage && (() => {
                  const sel = freeSel === '__photo__'
                  const px = Math.round(photo.x * SCALE)
                  const py = Math.round(photo.y * SCALE)
                  const pw = Math.round(photo.w * SCALE)
                  const ph = Math.round(photo.h * SCALE)
                  return (
                    <div style={{ position: 'absolute', left: px, top: py, width: pw }}>
                      <div
                        style={{
                          width: '100%', height: ph,
                          background: imageUrl ? 'transparent' : '#f0ebe4',
                          borderRadius: 3, overflow: 'hidden',
                          outline: sel ? `2px solid ${accent}` : '1.5px dashed #b0a090',
                          cursor: 'move', zIndex: sel ? 5 : 2,
                          boxSizing: 'border-box',
                        }}
                        onMouseDown={e => startInteraction(e, '__photo__', 'move')}
                        onClick={e => { e.stopPropagation(); setFreeSel('__photo__') }}
                      >
                        {imageUrl
                          ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'top center', pointerEvents: 'none' }} />
                          : <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, pointerEvents: 'none' }}>
                              <Camera size={20} color="#a09488" />
                              <div style={{ fontSize: 7, color: '#a09488' }}>Foto da cliente</div>
                              <div style={{ fontSize: 6, color: '#b8ada0' }}>{Math.round(photo.w)} × {Math.round(photo.h)} pt</div>
                            </div>
                        }
                        {sel && renderHandles('__photo__', true)}
                        {sel && (
                          <div style={{ position: 'absolute', top: 4, left: 4, background: accent, color: '#fff', fontSize: 8, padding: '2px 5px', borderRadius: 4, pointerEvents: 'none' }}>
                            📷 Foto
                          </div>
                        )}
                      </div>
                      {/* Prompt label below photo */}
                      {renderLabelPreview(0, pw, ph)}
                    </div>
                  )
                })()}

                {/* Alignment guides */}
                {alignGuides.map((g, gi) => {
                  const color = g.snap === false ? '#ff9800' : '#4fc3f7'
                  if (g.x !== undefined) {
                    const gx = Math.round(g.x * SCALE)
                    return <div key={`gx${gi}`} style={{ position: 'absolute', left: gx, top: 0, width: 1, height: '100%', background: color, opacity: 0.9, pointerEvents: 'none', zIndex: 50 }} />
                  }
                  if (g.y !== undefined) {
                    const gy = Math.round((g.y - pageYStartPts) * SCALE)
                    if (gy < 0 || gy > CH) return null
                    return <div key={`gy${gi}`} style={{ position: 'absolute', top: gy, left: 0, height: 1, width: '100%', background: color, opacity: 0.9, pointerEvents: 'none', zIndex: 50 }} />
                  }
                  return null
                })}

                {/* Text blocks */}
                {pageBlocks.map(block => {
                  const bx  = Math.round((block.x ?? DEF_TXT_X) * SCALE)
                  const by  = Math.round(((block.y ?? 72) - pageYStartPts) * SCALE)
                  const bw  = Math.round((block.w ?? DEF_TXT_W) * SCALE)
                  const bh  = Math.round((block.h ?? estimateBlockH(block, block.w ?? DEF_TXT_W)) * SCALE)
                  const sel = freeSel === block.id
                  const variant = block.blockVariant ?? 'plain'
                  const customBg = block.blockBgColor

                  const variantStyle: React.CSSProperties = {
                    plain:   { background: sel ? `${accent}08` : 'rgba(255,255,255,0.85)', borderRadius: 2 },
                    soft:    { background: customBg ?? '#F5F0EC', borderRadius: 5 },
                    card:    { background: customBg ?? '#ffffff', borderRadius: 5, boxShadow: '0 0.5px 2px rgba(0,0,0,0.05)', border: `0.5px solid ${accent}18` },
                    outline: { background: 'transparent', borderRadius: 5, border: `1px solid ${accent}50` },
                    accent:  { background: customBg ?? `${accent}ee`, borderRadius: 5 },
                  }[variant] as React.CSSProperties

                  return (
                    <div key={block.id}
                      style={{
                        position: 'absolute', left: bx, top: by, width: bw, height: bh,
                        ...variantStyle,
                        outline: sel ? `1.5px solid ${accent}` : undefined,
                        cursor: 'move', zIndex: sel ? 5 : 3, overflow: 'hidden',
                        boxSizing: 'border-box', padding: '3px 5px 3px 7px',
                      }}
                      onMouseDown={e => startInteraction(e, block.id, 'move')}
                      onClick={e => { e.stopPropagation(); setFreeSel(block.id) }}
                    >
                      {variant === 'plain' && block.isSection && (() => {
                        // Barra acompanha o tamanho real do texto.
                        // Mesma lógica do PDF: altura proporcional à primeira linha (título)
                        // + linhas seguintes (body).
                        const titleSize = block.headerSize ?? style.headerSize ?? 8.5
                        const bodySize  = block.bodySize  ?? style.bodySize  ?? 7.5
                        const nLines    = block.rawLines.filter(l => cleanLine(l).length > 0).length
                        const contentHpts = titleSize * 1.47 + Math.max(0, nLines - 1) * (bodySize * 1.47)
                        const contentHpx  = Math.min(bh - 6, contentHpts * SCALE)
                        return (
                          <div style={{
                            position: 'absolute', left: 0, top: 3, width: 2,
                            height: contentHpx,
                            background: accent, opacity: 0.6, borderRadius: 1,
                          }} />
                        )
                      })()}
                      {variant === 'accent' && (
                        <div style={{ position: 'absolute', inset: 0, background: customBg ?? accent, borderRadius: 5, zIndex: 0 }} />
                      )}
                      <div style={{ position: 'relative', zIndex: 1, overflow: 'hidden', height: '100%' }}>
                        {renderBlockContent(block, false, bh / SCALE)}
                      </div>
                      {sel && renderHandles(block.id, false)}
                      {sel && (() => {
                        const isResizing = dragRef.current?.id === block.id && dragRef.current?.type !== 'move'
                        const hasSizeMatch = alignGuides.some(g => g.snap === false)
                        const badgeColor = hasSizeMatch && isResizing ? '#ff9800' : accent
                        return (
                          <div style={{
                            position: 'absolute', top: 2, right: 2,
                            background: badgeColor, color: '#fff',
                            fontSize: 7, padding: '1px 4px', borderRadius: 3,
                            pointerEvents: 'none', transition: 'background 0.1s',
                            fontWeight: 600, letterSpacing: 0.2,
                          }}>
                            {Math.round(block.w ?? DEF_TXT_W)} × {Math.round(block.h ?? bh / SCALE)} pt
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}

                {/* Footer */}
                <div style={{ position: 'absolute', bottom: 10, left: S_MG, right: S_MG, height: 0.4, background: accent, opacity: 0.15 }} />
                <div style={{ position: 'absolute', bottom: 6, left: S_MG, fontSize: 4.5, color: style.bodyColor ?? '#aaa' }}>
                  MARILIA SANTOS — COLORAÇÃO PESSOAL
                </div>

                {freePageCount > 1 && (
                  <div style={{
                    position: 'absolute', bottom: 6, right: S_MG,
                    fontSize: 5.5, color: accent, fontWeight: 600, letterSpacing: 0.5,
                  }}>
                    {pageIdx + 1} / {freePageCount}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }
}

// ─── SnapGrid visual ─────────────────────────────────────────────────────────

function SnapGrid({ accent }: { accent: string }) {
  const gridPx = SNAP_GRID * SCALE
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.07 }}>
      <defs>
        <pattern id="sg" width={gridPx} height={gridPx} patternUnits="userSpaceOnUse">
          <path d={`M ${gridPx} 0 L 0 0 0 ${gridPx}`} fill="none" stroke={accent} strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#sg)" />
    </svg>
  )
}

// ─── Sidebar: Global Panel ────────────────────────────────────────────────────

function GlobalPanel({
  style, onChange, layoutMode, snap, onSnapChange, mgH, onMgHChange,
  photo, onPhotoChange, labelConfig, onLabelChange, promptLabel,
}: {
  style: PdfStyleConfig; onChange: (s: PdfStyleConfig) => void
  layoutMode: 'flow' | 'freeform'; snap: boolean; onSnapChange: (v: boolean) => void
  mgH: number; onMgHChange: (v: number) => void
  photo: PhotoConfig; onPhotoChange: (p: PhotoConfig) => void
  labelConfig: LabelConfig; onLabelChange: (l: LabelConfig) => void
  promptLabel?: string
}) {
  const s: Required<PdfStyleConfig> = {
    headerFont: 'Helvetica', headerSize: 8.5, headerColor: '#77304F',
    bodyFont: 'Helvetica', bodySize: 7.5, bodyColor: '#645859', accentColor: '#87485E',
    ...style,
  }
  const set = (k: keyof PdfStyleConfig, v: any) => onChange({ ...style, [k]: v })
  const setLabel = (u: Partial<LabelConfig>) => onLabelChange({ ...labelConfig, ...u })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a2e', background: '#222228', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8 }}>Estilo Global</div>
        <div style={{ fontSize: 10, color: '#555', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <MousePointer size={10} color="#444" /> Clique em um bloco para editar
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          <Section label="Fonte dos títulos"><FontSelector value={s.headerFont} onChange={v => set('headerFont', v as PdfFontFamily)} /></Section>
          <Section label="Fonte do corpo"><FontSelector value={s.bodyFont} onChange={v => set('bodyFont', v as PdfFontFamily)} /></Section>
          <Section label="Tamanho título (pt)"><Stepper value={s.headerSize} min={5} max={20} step={0.5} onChange={v => set('headerSize', v)} /></Section>
          <Section label="Tamanho corpo (pt)"><Stepper value={s.bodySize} min={5} max={18} step={0.5} onChange={v => set('bodySize', v)} /></Section>

          <Section label="Cor do título">
            <ColorPicker value={s.headerColor} onChange={v => set('headerColor', v)} />
          </Section>
          <Section label="Cor do corpo">
            <ColorPicker value={s.bodyColor} onChange={v => set('bodyColor', v)} />
          </Section>
          <Section label="Cor de destaque">
            <ColorPicker value={s.accentColor} onChange={v => set('accentColor', v)} />
          </Section>

          <Section label="Margem lateral (pt)">
            <Stepper value={mgH} min={10} max={80} step={2} onChange={onMgHChange} />
          </Section>

          {/* ── Label (nome da simulação) ── */}
          <div style={{ height: 1, background: '#2a2a2e' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Tag size={11} color="#888" />
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Nome (para a cliente)
            </div>
          </div>

          {promptLabel && (
            <div style={{ background: '#111', borderRadius: 6, padding: '6px 8px', fontSize: 10, color: '#c4a0b8', fontWeight: 600, letterSpacing: 0.3 }}>
              "{promptLabel}"
            </div>
          )}

          <Section label="Visível no PDF">
            <div style={{ display: 'flex', gap: 6 }}>
              {[true, false].map(v => (
                <button key={String(v)} onClick={() => setLabel({ visible: v })} style={{
                  flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid #2a2a2e',
                  background: (labelConfig.visible !== false) === v ? '#2e2e38' : 'transparent',
                  color: (labelConfig.visible !== false) === v ? '#f0f0f0' : '#666',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                }}>
                  {v ? 'Sim' : 'Não'}
                </button>
              ))}
            </div>
          </Section>

          <Section label="Maiúsculas">
            <div style={{ display: 'flex', gap: 6 }}>
              {[true, false].map(v => (
                <button key={String(v)} onClick={() => setLabel({ uppercase: v })} style={{
                  flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid #2a2a2e',
                  background: (labelConfig.uppercase !== false) === v ? '#2e2e38' : 'transparent',
                  color: (labelConfig.uppercase !== false) === v ? '#f0f0f0' : '#666',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                }}>
                  {v ? 'SIM' : 'Normal'}
                </button>
              ))}
            </div>
          </Section>

          <Section label={`Tamanho fonte (${labelConfig.fontSize ?? 7}pt)`}>
            <Stepper value={labelConfig.fontSize ?? 7} min={5} max={16} step={0.5} onChange={v => setLabel({ fontSize: v })} />
          </Section>

          <Section label="Fonte do nome">
            <FontSelector value={labelConfig.fontFamily ?? 'Helvetica'} onChange={v => setLabel({ fontFamily: v as PdfFontFamily })} />
          </Section>

          <Section label="Cor do nome">
            <ColorPicker value={labelConfig.color ?? (style.headerColor ?? '#77304F')} onChange={v => setLabel({ color: v })} />
          </Section>

          <Section label="Negrito">
            <div style={{ display: 'flex', gap: 6 }}>
              {[true, false].map(v => (
                <button key={String(v)} onClick={() => setLabel({ bold: v })} style={{
                  flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid #2a2a2e',
                  background: (labelConfig.bold !== false) === v ? '#2e2e38' : 'transparent',
                  color: (labelConfig.bold !== false) === v ? '#f0f0f0' : '#666',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                }}>
                  {v ? 'Sim' : 'Não'}
                </button>
              ))}
            </div>
          </Section>

          <Section label="Y do nome (pt do topo)">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Stepper
                value={labelConfig.y ?? 780}
                min={0} max={840} step={4}
                onChange={v => setLabel({ y: v })}
              />
              {labelConfig.y !== undefined && (
                <button onClick={() => setLabel({ y: undefined })} style={{ ...stepBtn, fontSize: 9, color: '#c4a0b8', padding: '0 4px', width: 'auto', whiteSpace: 'nowrap' }}>
                  Auto
                </button>
              )}
            </div>
          </Section>

          <Section label="X do nome (pt da esquerda)">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Stepper
                value={labelConfig.x ?? 39}
                min={0} max={520} step={4}
                onChange={v => setLabel({ x: v })}
              />
              {labelConfig.x !== undefined && (
                <button onClick={() => setLabel({ x: undefined })} style={{ ...stepBtn, fontSize: 9, color: '#c4a0b8', padding: '0 4px', width: 'auto', whiteSpace: 'nowrap' }}>
                  Auto
                </button>
              )}
            </div>
          </Section>

          {/* ── Freeform photo controls ── */}
          {layoutMode === 'freeform' && (
            <>
              <div style={{ height: 1, background: '#2a2a2e' }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8 }}>📷 Foto</div>
              <Section label="X (pt da esquerda)"><Stepper value={photo.x} min={0} max={400} step={4} onChange={v => onPhotoChange({ ...photo, x: v })} /></Section>
              <Section label="Y (pt do topo)"><Stepper value={photo.y} min={0} max={700} step={4} onChange={v => onPhotoChange({ ...photo, y: v })} /></Section>
              <Section label="Largura (pt)"><Stepper value={photo.w} min={40} max={500} step={4} onChange={v => onPhotoChange({ ...photo, w: v })} /></Section>
              <Section label="Altura (pt)"><Stepper value={photo.h} min={40} max={800} step={4} onChange={v => onPhotoChange({ ...photo, h: v })} /></Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sidebar: Block Panel ─────────────────────────────────────────────────────

function BlockPanel({ block, mode, onChange, onDelete, onSplit, onMerge, onMoveUp, onMoveDn, style }: {
  block: EditorBlock; mode: 'flow' | 'freeform'
  onChange: (u: Partial<EditorBlock>) => void
  onDelete: () => void; onSplit: () => void; onMerge?: () => void
  onMoveUp?: () => void; onMoveDn?: () => void
  style: PdfStyleConfig
}) {
  const s: Required<PdfStyleConfig> = {
    headerFont: 'Helvetica', headerSize: 8.5, headerColor: '#77304F',
    bodyFont: 'Helvetica', bodySize: 7.5, bodyColor: '#645859', accentColor: '#87485E', ...style,
  }
  const hasOverride = !!(block.fontFamily || block.headerSize || block.bodySize || block.headerColor || block.bodyColor)
  const resetStyle = () => onChange({ fontFamily: undefined, headerSize: undefined, bodySize: undefined, headerColor: undefined, bodyColor: undefined })

  // Text editing state
  const [editingText, setEditingText] = useState(false)
  const [draftText, setDraftText] = useState(block.rawLines.join('\n'))

  // Sync draftText when block changes from outside
  useEffect(() => {
    if (!editingText) setDraftText(block.rawLines.join('\n'))
  }, [block.rawLines, editingText])

  const commitText = () => {
    const newLines = draftText.split('\n').map(l => l.trim()).filter(Boolean)
    if (newLines.length > 0) onChange({ rawLines: newLines })
    setEditingText(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a2e', background: '#222228', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8 }}>Bloco selecionado</div>
        <div style={{ fontSize: 11, color: '#999', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {block.rawLines[0]?.slice(0, 40) || '(vazio)'}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Text editor ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Conteúdo do bloco
              </div>
              <button
                onClick={() => editingText ? commitText() : setEditingText(true)}
                style={{
                  height: 22, padding: '0 8px', borderRadius: 5,
                  border: `1px solid ${editingText ? '#87485E' : '#2a2a2e'}`,
                  background: editingText ? '#87485E22' : 'transparent',
                  color: editingText ? '#c4a0b8' : '#666',
                  fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {editingText ? <><Check size={10} /> Salvar</> : <><Edit3 size={10} /> Editar texto</>}
              </button>
            </div>
            {editingText ? (
              <textarea
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setEditingText(false); setDraftText(block.rawLines.join('\n')) }
                }}
                autoFocus
                style={{
                  width: '100%', minHeight: 100, padding: '8px 10px',
                  background: '#111', border: '1px solid #87485E',
                  borderRadius: 8, color: '#e0e0e0', fontSize: 11,
                  fontFamily: 'monospace', lineHeight: 1.5,
                  resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }}
                placeholder="Uma linha por parágrafo&#10;Linhas com • são itens&#10;Primeira linha = título se for MAIÚSCULA"
              />
            ) : (
              <div
                onClick={() => setEditingText(true)}
                style={{
                  background: '#111', borderRadius: 8, padding: '8px 10px',
                  border: '1px solid #2a2a2e', cursor: 'text',
                  fontSize: 10, color: '#999', lineHeight: 1.6,
                  maxHeight: 90, overflow: 'hidden',
                }}
              >
                {block.rawLines.slice(0, 5).map((l, i) => (
                  <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l || ' '}</div>
                ))}
                {block.rawLines.length > 5 && <div style={{ color: '#555', fontSize: 9 }}>+{block.rawLines.length - 5} linhas…</div>}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {onMoveUp && <MiniBtn onClick={onMoveUp} icon={<ChevronUp size={12} />} label="Subir" />}
            {onMoveDn && <MiniBtn onClick={onMoveDn} icon={<ChevronDown size={12} />} label="Descer" />}
            <MiniBtn onClick={onSplit} icon={<Scissors size={12} />} label="Dividir" disabled={block.rawLines.length < 2} />
            {onMerge && <MiniBtn onClick={onMerge} icon={<Maximize2 size={12} />} label="Unir" />}
            {hasOverride && <MiniBtn onClick={resetStyle} icon={<RotateCcw size={12} />} label="Reset" />}
            <MiniBtn onClick={onDelete} icon={<Trash2 size={12} />} label="Apagar" />
          </div>

          {/* Position & size (freeform only) */}
          {mode === 'freeform' && (
            <>
              <div style={{ height: 1, background: '#2a2a2e' }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8 }}>Posição / Tamanho</div>
              <Section label="X (pt)">
                <Stepper value={block.x ?? DEF_TXT_X} min={0} max={500} step={4} onChange={v => onChange({ x: v })} />
              </Section>
              <Section label="Y (pt do topo)">
                <Stepper value={block.y ?? 72} min={0} max={1640} step={4} onChange={v => onChange({ y: v })} />
              </Section>
              <Section label="Largura (pt)">
                <Stepper value={block.w ?? DEF_TXT_W} min={30} max={520} step={4} onChange={v => onChange({ w: v })} />
              </Section>
              <Section label="Altura (pt)">
                <Stepper value={block.h ?? estimateBlockH(block, block.w ?? DEF_TXT_W)} min={16} max={780} step={2} onChange={v => onChange({ h: v })} />
              </Section>
            </>
          )}

          {/* Spacing (flow mode) */}
          {mode === 'flow' && (
            <Section label="Espaço abaixo (pt)">
              <SpacingSlider value={block.marginBelow} onChange={v => onChange({ marginBelow: v })} />
            </Section>
          )}

          <div style={{ height: 1, background: '#2a2a2e' }} />
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8 }}>Estilo do bloco</div>

          <Section label="É título/seção">
            <div style={{ display: 'flex', gap: 6 }}>
              {[true, false].map(v => (
                <button key={String(v)} onClick={() => onChange({ isSection: v })} style={{
                  flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid #2a2a2e',
                  background: block.isSection === v ? '#2e2e38' : 'transparent',
                  color: block.isSection === v ? '#f0f0f0' : '#666',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                }}>
                  {v ? 'Sim' : 'Não'}
                </button>
              ))}
            </div>
          </Section>

          <Section label="Design do bloco">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {(['plain', 'soft', 'card', 'outline', 'accent'] as const).map(v => {
                const labels = { plain: 'Simples', soft: 'Suave', card: 'Card', outline: 'Contorno', accent: 'Destaque' }
                const active = (block.blockVariant ?? 'plain') === v
                return (
                  <button key={v} onClick={() => onChange({ blockVariant: v })} style={{
                    padding: '7px 5px', borderRadius: 7,
                    border: active ? `1.5px solid ${s.accentColor}` : '1px solid #2a2a2e',
                    background: active ? `${s.accentColor}22` : '#1a1a1e',
                    color: active ? '#f0f0f0' : '#777',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer', textAlign: 'center',
                  }}>
                    {labels[v]}
                  </button>
                )
              })}
            </div>
          </Section>

          {(block.blockVariant === 'soft' || block.blockVariant === 'card' || block.blockVariant === 'accent') && (
            <Section label="Cor de fundo do bloco">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ColorPicker
                  value={block.blockBgColor ?? (block.blockVariant === 'soft' ? '#F5F0EC' : block.blockVariant === 'card' ? '#FFFFFF' : s.accentColor)}
                  onChange={v => onChange({ blockBgColor: v })}
                  active={!!block.blockBgColor}
                />
                {block.blockBgColor && (
                  <button onClick={() => onChange({ blockBgColor: undefined })} title="Voltar ao padrão do variant" style={{
                    height: 30, padding: '0 8px', borderRadius: 7, border: '1px solid #2a2a2e',
                    background: '#222', color: '#888', fontSize: 10, fontWeight: 500, cursor: 'pointer', flexShrink: 0,
                  }}>
                    Padrão
                  </button>
                )}
              </div>
            </Section>
          )}

          <Section label="Alinhar título">
            <AlignToggle
              value={block.titleAlign ?? 'left'}
              onChange={v => onChange({ titleAlign: v })}
              accent={s.accentColor}
            />
          </Section>

          <Section label="Alinhar texto">
            <AlignToggle
              value={block.textAlign ?? 'left'}
              onChange={v => onChange({ textAlign: v })}
              accent={s.accentColor}
            />
          </Section>

          <Section label="Fonte">
            <FontSelector value={block.fontFamily ?? s.headerFont} onChange={v => onChange({ fontFamily: v as PdfFontFamily })} />
          </Section>
          <Section label={`Tam. título (${(block.headerSize ?? s.headerSize).toFixed(1)}pt)`}>
            <Stepper value={block.headerSize ?? s.headerSize} min={5} max={20} step={0.5} onChange={v => onChange({ headerSize: v })} active={!!block.headerSize} />
          </Section>
          <Section label={`Tam. corpo (${(block.bodySize ?? s.bodySize).toFixed(1)}pt)`}>
            <Stepper value={block.bodySize ?? s.bodySize} min={5} max={18} step={0.5} onChange={v => onChange({ bodySize: v })} active={!!block.bodySize} />
          </Section>
          <Section label="Cor do título">
            <ColorPicker value={block.headerColor ?? s.headerColor} onChange={v => onChange({ headerColor: v })} active={!!block.headerColor} />
          </Section>
          <Section label="Cor do corpo">
            <ColorPicker value={block.bodyColor ?? s.bodyColor} onChange={v => onChange({ bodyColor: v })} active={!!block.bodyColor} />
          </Section>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  )
}

function FontSelector({ value, onChange }: { value: PdfFontFamily; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {FONTS.map(f => (
        <button key={f} onClick={() => onChange(f)} style={{
          width: '100%', padding: '7px 10px', borderRadius: 7, border: `1px solid ${value === f ? '#555' : '#2a2a2e'}`,
          background: value === f ? '#2e2e38' : 'transparent', cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: value === f ? '#f0f0f0' : '#666',
        }}>
          <span style={{ fontFamily: FONT_CSS[f], fontSize: 12 }}>{f}</span>
          {value === f && <span style={{ fontSize: 9, color: '#888' }}>✓</span>}
        </button>
      ))}
    </div>
  )
}

function Stepper({ value, min, max, step, onChange, active }: {
  value: number; min: number; max: number; step: number
  onChange: (v: number) => void; active?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={() => onChange(Math.max(min, +(value - step).toFixed(1)))} style={stepBtn}><Minus size={12} /></button>
      <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600, color: active ? '#e8c4b0' : '#d0d0d0' }}>
        {Number.isInteger(value) ? value : value.toFixed(1)}
        <span style={{ fontSize: 10, color: '#666', marginLeft: 2 }}>pt</span>
      </div>
      <button onClick={() => onChange(Math.min(max, +(value + step).toFixed(1)))} style={stepBtn}><Plus size={12} /></button>
    </div>
  )
}

function SpacingSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <button onClick={() => onChange(Math.max(0, value - 2))} style={stepBtn}><Minus size={12} /></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#d0d0d0' }}>{value}<span style={{ fontSize: 10, color: '#666', marginLeft: 2 }}>pt</span></div>
        <button onClick={() => onChange(Math.min(80, value + 2))} style={stepBtn}><Plus size={12} /></button>
      </div>
      <div style={{ height: 3, background: '#2a2a2e', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #87485e, #c47a9a)', width: `${Math.min(100, (value / 80) * 100)}%`, transition: 'width 0.15s' }} />
      </div>
    </div>
  )
}

function ColorPicker({ value, onChange, active }: { value: string; onChange: (v: string) => void; active?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 36, height: 36, borderRadius: 8, padding: 2, border: `1px solid ${active ? '#555' : '#2a2a2e'}`, background: '#222', cursor: 'pointer' }} />
      <input type="text" value={value} onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value) }} maxLength={7} style={{ flex: 1, background: '#111', border: '1px solid #2a2a2e', borderRadius: 8, color: '#ccc', fontSize: 12, padding: '6px 10px', fontFamily: 'monospace', outline: 'none' }} />
    </div>
  )
}

function AlignToggle({ value, onChange, accent }: {
  value: 'left' | 'center' | 'right' | 'justify'
  onChange: (v: 'left' | 'center' | 'right' | 'justify') => void
  accent: string
}) {
  const options = [
    { v: 'left'    as const, Icon: AlignLeft    },
    { v: 'center'  as const, Icon: AlignCenter  },
    { v: 'right'   as const, Icon: AlignRight   },
    { v: 'justify' as const, Icon: AlignJustify },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
      {options.map(({ v, Icon }) => {
        const active = value === v
        return (
          <button key={v} onClick={() => onChange(v)} style={{
            height: 30, borderRadius: 7,
            border: active ? `1.5px solid ${accent}` : '1px solid #2a2a2e',
            background: active ? `${accent}22` : '#1a1a1e',
            color: active ? '#f0f0f0' : '#777',
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={13} />
          </button>
        )
      })}
    </div>
  )
}

function MiniBtn({ onClick, icon, label, disabled }: { onClick: () => void; icon: React.ReactNode; label?: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      height: 30, padding: '0 8px', borderRadius: 7, border: '1px solid #2a2a2e',
      background: '#222', cursor: disabled ? 'not-allowed' : 'pointer', color: '#aaa',
      display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500,
      opacity: disabled ? 0.35 : 1,
    }}>
      {icon} {label}
    </button>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const stepBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 7, border: '1px solid #2a2a2e',
  background: '#222', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', flexShrink: 0,
}

const iconBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid #3a3a3e',
  background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999',
}

const dotHandle: React.CSSProperties = {
  width: 16, height: 16, background: '#87485E', borderRadius: 3,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 10, color: '#fff', cursor: 'grab', userSelect: 'none',
}