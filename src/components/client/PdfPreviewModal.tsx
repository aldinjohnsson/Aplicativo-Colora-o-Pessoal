// PdfPreviewModal.tsx
//
// Visualizador de PDF em tela cheia, feito com pdf.js.
// Substitui o <iframe src={blobUrl}>, que no iOS (Safari/PWA) mostra só a
// 1ª página e não permite zoom nem troca de página.
//
// Recursos: todas as páginas em rolagem vertical, zoom (+ / − / 100%),
// pinça com dois dedos acompanhando o gesto em tempo real, contador "X de N"
// com setas, botões Baixar e Fechar.
//
// Dependência: npm i pdfjs-dist
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, ZoomIn, ZoomOut, Loader2 } from 'lucide-react'

interface Props {
  blob: Blob
  title?: string
  onClose: () => void
  onDownload: () => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const STEP = 0.5
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

// Ponto (em coordenadas do conteúdo, sem zoom) que deve ficar parado na tela
// quando o zoom muda, e a posição dele dentro da área visível.
interface Anchor { x: number; y: number; vx: number; vy: number; k: number }

export function PdfPreviewModal({ blob, title = 'Pré-visualização do PDF', onClose, onDownload }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef  = useRef<HTMLDivElement>(null)
  const pdfRef    = useRef<any>(null)
  const renderId  = useRef(0)
  const zoomRef   = useRef(1)
  const anchorRef = useRef<Anchor | null>(null)

  const [numPages, setNumPages] = useState(0)
  const [current, setCurrent]   = useState(1)
  const [zoom, setZoom]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Carrega o documento
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs: any = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()
        const data = new Uint8Array(await blob.arrayBuffer())
        const doc = await pdfjs.getDocument({ data }).promise
        if (cancelled) { doc.destroy?.(); return }
        pdfRef.current = doc
        setNumPages(doc.numPages)
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Não foi possível abrir o PDF'); setLoading(false) }
      }
    })()
    return () => { cancelled = true; renderId.current++; pdfRef.current?.destroy?.(); pdfRef.current = null }
  }, [blob])

  // Renderiza todas as páginas no zoom atual.
  // 1ª vez: vai aparecendo página a página. Nas trocas de zoom: renderiza num
  // contêiner fora da tela e só troca no final — a versão antiga (esticada pelo
  // gesto) continua visível até a nova ficar pronta, sem "piscar" em branco.
  const renderPages = useCallback(async () => {
    const doc = pdfRef.current
    const host = pagesRef.current
    const scroller = scrollRef.current
    if (!doc || !host || !scroller) return
    const myId = ++renderId.current

    const first = host.childElementCount === 0
    if (first) setLoading(true)

    const fitW = scroller.clientWidth - 24            // 12px de respiro de cada lado
    const cssW = fitW * zoom
    const dpr  = Math.min(window.devicePixelRatio || 1, 2)

    const buffer: HTMLCanvasElement[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      if (myId !== renderId.current) return
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (cssW / base.width) * dpr })

      const canvas = document.createElement('canvas')
      canvas.width  = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width  = `${cssW}px`
      canvas.style.height = `${(cssW / base.width) * base.height}px`
      canvas.className = 'bg-white shadow-md mx-auto mb-3 block'

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, canvas, viewport }).promise
      if (myId !== renderId.current) return

      if (first) {
        host.appendChild(canvas)
        if (n === 1) setLoading(false)
      } else {
        buffer.push(canvas)
      }
    }
    if (myId !== renderId.current) return

    if (!first) {
      host.replaceChildren(...buffer)
      host.style.transform = ''
      host.style.transformOrigin = ''
    }

    // Mantém na tela o ponto que o usuário estava olhando (foco da pinça ou centro)
    const a = anchorRef.current
    anchorRef.current = null
    if (a) {
      scroller.scrollLeft = host.offsetLeft + a.x * a.k - a.vx
      scroller.scrollTop  = host.offsetTop  + a.y * a.k - a.vy
    }
    setLoading(false)
  }, [zoom])

  useEffect(() => { if (numPages) renderPages() }, [numPages, renderPages])

  // Troca de zoom pelos botões: ancora no centro da área visível
  const zoomTo = (next: number) => {
    const sc = scrollRef.current, host = pagesRef.current
    const z = clampZoom(next)
    if (!sc || !host || z === zoomRef.current) return
    const vx = sc.clientWidth / 2, vy = sc.clientHeight / 2
    anchorRef.current = {
      x: sc.scrollLeft + vx - host.offsetLeft,
      y: sc.scrollTop  + vy - host.offsetTop,
      vx, vy, k: z / zoomRef.current,
    }
    setZoom(z)
  }

  // Pinça com dois dedos — ouvintes nativos (precisam ser não-passivos para o
  // preventDefault funcionar). Durante o gesto o conteúdo é esticado com CSS
  // transform (instantâneo, acompanha o dedo); ao soltar, re-renderiza nítido.
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let start: { d: number; z: number; ox: number; oy: number } | null = null
    let ratio = 1
    let mid = { x: 0, y: 0 }

    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const midpoint = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })

    const onStart = (e: TouchEvent) => {
      const host = pagesRef.current
      if (e.touches.length !== 2 || !host) return
      const m = midpoint(e.touches)
      const r = host.getBoundingClientRect()
      // foco em coordenadas locais do conteúdo (sem zoom aplicado)
      start = { d: dist(e.touches), z: zoomRef.current, ox: m.x - r.left, oy: m.y - r.top }
      mid = m
      ratio = 1
      host.style.transformOrigin = `${start.ox}px ${start.oy}px`
    }

    const onMove = (e: TouchEvent) => {
      const host = pagesRef.current
      if (!start || e.touches.length !== 2 || !host) return
      e.preventDefault()
      // limita para não passar de MIN/MAX
      ratio = Math.min(MAX_ZOOM / start.z, Math.max(MIN_ZOOM / start.z, dist(e.touches) / start.d))
      mid = midpoint(e.touches)
      host.style.transform = `scale(${ratio})`
    }

    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return
      const host = pagesRef.current
      const s = start
      start = null
      if (!host) return
      if (Math.abs(ratio - 1) < 0.03) {            // gesto mínimo: desfaz
        host.style.transform = ''
        host.style.transformOrigin = ''
        return
      }
      const z = clampZoom(Math.round(s.z * ratio * 100) / 100)
      if (z === s.z) {                              // já no limite: nada a re-renderizar
        host.style.transform = ''
        host.style.transformOrigin = ''
        return
      }
      const rect = sc.getBoundingClientRect()
      anchorRef.current = { x: s.ox, y: s.oy, vx: mid.x - rect.left, vy: mid.y - rect.top, k: z / s.z }
      // a versão esticada continua na tela até a nova ficar pronta (ver renderPages)
      setZoom(z)
    }

    sc.addEventListener('touchstart', onStart, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })
    sc.addEventListener('touchend', onEnd, { passive: true })
    sc.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      sc.removeEventListener('touchstart', onStart)
      sc.removeEventListener('touchmove', onMove)
      sc.removeEventListener('touchend', onEnd)
      sc.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  // Atualiza "X de N" conforme a rolagem
  const onScroll = () => {
    const sc = scrollRef.current, host = pagesRef.current
    if (!sc || !host) return
    const mid = sc.scrollTop + sc.clientHeight / 2
    const kids = Array.from(host.children) as HTMLElement[]
    let page = 1
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].offsetTop - host.offsetTop <= mid) page = i + 1
    }
    setCurrent(page)
  }

  const goTo = (n: number) => {
    const host = pagesRef.current, sc = scrollRef.current
    const el = host?.children[n - 1] as HTMLElement | undefined
    if (el && sc) sc.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-gray-800 flex flex-col overscroll-contain"
      style={{ touchAction: 'none', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Barra superior */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-white border-b border-gray-200 flex-shrink-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={onDownload}
            className="flex items-center gap-1.5 bg-violet-500 text-white text-xs font-semibold rounded-full px-3.5 py-2 whitespace-nowrap">
            <Download className="h-3.5 w-3.5" /> Baixar
          </button>
          <button type="button" onClick={onClose} aria-label="Fechar pré-visualização"
            className="bg-gray-900 text-white rounded-full p-2.5">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Páginas */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto py-3 px-3 relative"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}
      >
        {error && <p className="text-white text-sm text-center mt-10">{error}</p>}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        )}
        <div ref={pagesRef} style={{ width: 'max-content', minWidth: '100%', willChange: 'transform' }} />
      </div>

      {/* Barra inferior: páginas + zoom */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-white border-t border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-700">
          <button type="button" disabled={current <= 1} onClick={() => goTo(current - 1)}
            aria-label="Página anterior" className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">‹</button>
          <span className="min-w-[64px] text-center font-medium">{current} de {numPages || '–'}</span>
          <button type="button" disabled={current >= numPages} onClick={() => goTo(current + 1)}
            aria-label="Próxima página" className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">›</button>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom - STEP)}
            aria-label="Diminuir zoom" className="p-2 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => zoomTo(1)}
            className="px-2 py-1.5 text-xs font-medium text-gray-700 min-w-[48px]">{Math.round(zoom * 100)}%</button>
          <button type="button" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom + STEP)}
            aria-label="Aumentar zoom" className="p-2 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}