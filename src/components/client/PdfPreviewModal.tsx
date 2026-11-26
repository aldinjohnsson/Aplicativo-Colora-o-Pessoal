// PdfPreviewModal.tsx
//
// Visualizador de PDF em tela cheia, feito com pdf.js.
// Substitui o <iframe src={blobUrl}>, que no iOS (Safari/PWA) mostra só a
// 1ª página e não permite zoom nem troca de página.
//
// Recursos: todas as páginas em rolagem vertical, zoom (+ / − / 100%),
// pinça nativa (quando o viewport permite), contador "X de N" com setas,
// botões Baixar e Fechar.
//
// Dependência: npm i pdfjs-dist
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, ZoomIn, ZoomOut, Loader2 } from 'lucide-react'

interface Props {
  blob: Blob
  title?: string
  onClose: () => void
  onDownload: () => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 3
const STEP = 0.5

export function PdfPreviewModal({ blob, title = 'Pré-visualização do PDF', onClose, onDownload }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef  = useRef<HTMLDivElement>(null)
  const pdfRef    = useRef<any>(null)
  const renderId  = useRef(0)

  const [numPages, setNumPages] = useState(0)
  const [current, setCurrent]   = useState(1)
  const [zoom, setZoom]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

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

  // Renderiza todas as páginas (de novo a cada mudança de zoom)
  const renderPages = useCallback(async () => {
    const doc = pdfRef.current
    const host = pagesRef.current
    const scroller = scrollRef.current
    if (!doc || !host || !scroller) return
    const myId = ++renderId.current
    setLoading(true)

    const fitW = scroller.clientWidth - 24            // 12px de respiro de cada lado
    const cssW = fitW * zoom
    const dpr  = Math.min(window.devicePixelRatio || 1, 2)

    host.innerHTML = ''
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
      host.appendChild(canvas)

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, canvas, viewport }).promise
      if (n === 1 && myId === renderId.current) setLoading(false)
    }
    if (myId === renderId.current) setLoading(false)
  }, [zoom])

  useEffect(() => { if (numPages) renderPages() }, [numPages, renderPages])

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

  // Pinça com dois dedos: muda só o zoom do PDF (não o zoom da página do app).
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const dist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) pinch.current = { d: dist(e.touches), z: zoom }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (pinch.current && e.touches.length < 2) {
      const last = pinch.current
      pinch.current = null
      const ratio = lastRatio.current
      lastRatio.current = 1
      if (Math.abs(ratio - 1) > 0.08) {
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(last.z * ratio * 4) / 4))
        setZoom(z)
      }
    }
  }
  const lastRatio = useRef(1)
  const onTouchMove = (e: React.TouchEvent) => {
    if (pinch.current && e.touches.length === 2) lastRatio.current = dist(e.touches) / pinch.current.d
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
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="flex-1 overflow-auto py-3 px-3 relative"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}
      >
        {error && <p className="text-white text-sm text-center mt-10">{error}</p>}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        )}
        <div ref={pagesRef} style={{ width: 'max-content', minWidth: '100%' }} />
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
          <button type="button" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - STEP))}
            aria-label="Diminuir zoom" className="p-2 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setZoom(1)}
            className="px-2 py-1.5 text-xs font-medium text-gray-700 min-w-[48px]">{Math.round(zoom * 100)}%</button>
          <button type="button" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + STEP))}
            aria-label="Aumentar zoom" className="p-2 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}