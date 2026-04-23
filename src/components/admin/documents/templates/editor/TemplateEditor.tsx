// src/components/admin/documents/templates/editor/TemplateEditor.tsx
//
// Editor visual de template (Fase 2 — skeleton).
//
// Correção chave: o PDF é carregado **UMA ÚNICA VEZ** aqui e o
// PDFDocumentProxy é compartilhado com todos os filhos (páginas + miniaturas).
// Motivo: pdfjs v4+ detacha o ArrayBuffer quando você chama getDocument(),
// então abrir várias vezes o mesmo buffer causa "The PDF file is empty,
// i.e. its size is zero bytes" no segundo consumidor em diante.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ZoomIn, ZoomOut, Layers, AlertCircle, Loader2,
  Construction, FileText,
} from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { documentsService } from '../../lib/documentsService'
import type { DocumentTemplate } from '../../types'

// ── Worker local (mesma config do pdfUtils.ts) ────────────────────────
let workerConfigured = false
function ensureWorker() {
  if (workerConfigured) return
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  workerConfigured = true
}

// ── Btn ───────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md', className = '',
  disabled = false, title,
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:   'text-gray-600 hover:bg-gray-100',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {children}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   TemplateEditor
// ═══════════════════════════════════════════════════════════════════════

export function TemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()

  const [template, setTemplate] = useState<DocumentTemplate | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [zoom, setZoom] = useState(1)
  const [activePage, setActivePage] = useState(1)

  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Load template + PDF (UMA VEZ) ─────────────────────────────
  const load = useCallback(async () => {
    if (!templateId) return
    ensureWorker()
    setLoading(true)
    setLoadError(null)

    let loadedPdf: PDFDocumentProxy | null = null

    try {
      const tpl = await documentsService.getTemplate(templateId)
      if (!tpl) { setLoadError('Template não encontrado.'); return }
      setTemplate(tpl)

      if (!tpl.base_pdf_path) {
        setLoadError('Template sem PDF base vinculado.')
        return
      }

      const blob = await documentsService.downloadBaseTemplate(tpl.base_pdf_path)
      const buf = await blob.arrayBuffer()

      if (!buf || buf.byteLength === 0) {
        setLoadError('O arquivo PDF está vazio no storage.')
        return
      }

      // Clone defensivo: pdfjs v4+ detacha o buffer original; manter cópia
      // evita quebrar outros consumidores se algum dia precisarmos reler.
      const data = new Uint8Array(buf.slice(0))

      loadedPdf = await pdfjs.getDocument({ data }).promise
      setPdf(loadedPdf)
    } catch (e: any) {
      setLoadError(e?.message || 'Erro ao carregar template')
    } finally {
      setLoading(false)
    }

    // cleanup: pdf destruído quando o editor desmonta (ver useEffect abaixo)
  }, [templateId])

  useEffect(() => { load() }, [load])

  // Destroi o PDF ao desmontar (libera memória/worker)
  useEffect(() => {
    return () => {
      if (pdf) pdf.destroy().catch(() => {})
    }
  }, [pdf])

  // ── Zoom ──────────────────────────────────────────────────────
  const setZoomClamped = (v: number) => setZoom(Math.max(0.4, Math.min(2.5, v)))
  const zoomIn  = () => setZoomClamped(zoom + 0.1)
  const zoomOut = () => setZoomClamped(zoom - 0.1)
  const zoomFit = () => setZoom(1)

  const scrollToPage = (n: number) => {
    const el = pageRefs.current[n]
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 20, behavior: 'smooth' })
      setActivePage(n)
    }
  }

  useEffect(() => {
    if (!scrollRef.current) return
    const container = scrollRef.current
    const onScroll = () => {
      const viewportTop = container.scrollTop + container.clientHeight / 3
      let closest = 1
      let closestDist = Infinity
      for (const [k, el] of Object.entries(pageRefs.current)) {
        if (!el) continue
        const dist = Math.abs(el.offsetTop - viewportTop)
        if (dist < closestDist) { closestDist = dist; closest = Number(k) }
      }
      setActivePage(closest)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [template, pdf])

  const pageNumbers = useMemo(
    () => pdf ? Array.from({ length: pdf.numPages }, (_, i) => i + 1) : [],
    [pdf],
  )

  // ─── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Carregando template...</span>
        </div>
      </div>
    )
  }

  if (loadError || !template) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
          <p className="font-semibold text-gray-800">Não foi possível abrir o template</p>
          <p className="text-sm text-gray-500 mt-1">{loadError || 'Recurso não encontrado.'}</p>
          <div className="mt-4">
            <Btn variant="outline" onClick={() => navigate('/admin/documents/templates')}>
              <ArrowLeft className="h-4 w-4" /> Voltar para templates
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-100 overflow-hidden">
      {/* ─── Topbar ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/admin/documents/templates')}
          className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100"
          title="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate text-sm">{template.name}</p>
          <p className="text-xs text-gray-500 flex items-center gap-1.5">
            <Layers className="h-3 w-3" />
            {template.page_count} página{template.page_count !== 1 ? 's' : ''}
            <span className="text-gray-400">·</span>
            <span>{Math.round(template.page_width_pt)}×{Math.round(template.page_height_pt)} pt</span>
          </p>
        </div>

        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={zoomOut} className="p-1.5 rounded-md hover:bg-white text-gray-600" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
          <button onClick={zoomFit} className="px-2 text-xs font-medium text-gray-600 hover:bg-white rounded-md h-7 min-w-[3rem]" title="Ajustar">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={zoomIn} className="p-1.5 rounded-md hover:bg-white text-gray-600" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* ─── Aviso Fase 3 ──────────────────────────────────────── */}
      <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center gap-2 flex-shrink-0">
        <Construction className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <p className="text-xs text-amber-800">
          Editor em construção — nesta fase você visualiza o PDF.
          O drag-and-drop para posicionar tags chega na próxima fase.
        </p>
      </div>

      {/* ─── Body: sidebar + canvas ─────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar: miniaturas */}
        {pdf && template.page_count > 1 && (
          <aside className="w-40 border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0 hidden md:block">
            <div className="p-3 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Páginas
              </p>
              {pageNumbers.map(n => (
                <PageThumbnail
                  key={n}
                  pdf={pdf}
                  pageNumber={n}
                  active={activePage === n}
                  onClick={() => scrollToPage(n)}
                />
              ))}
            </div>
          </aside>
        )}

        {/* Canvas principal */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto px-4 md:px-8 py-6"
        >
          {pdf ? (
            <div className="flex flex-col items-center gap-5">
              {pageNumbers.map(n => (
                <div
                  key={n}
                  ref={el => { pageRefs.current[n] = el }}
                  className="relative"
                >
                  <span className="absolute -top-5 left-0 text-[11px] text-gray-400 font-medium">
                    {n}
                  </span>
                  <PdfPageCanvas pdf={pdf} pageNumber={n} zoom={zoom} />
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-gray-400">
                <FileText className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">PDF base não encontrado.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   PdfPageCanvas — renderiza UMA página. Recebe o PDF já aberto.
// ═══════════════════════════════════════════════════════════════════════

function PdfPageCanvas({
  pdf, pageNumber, zoom,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  zoom: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Mantém a task de render em andamento pra poder cancelar quando o zoom muda rápido
  const renderTaskRef = useRef<ReturnType<pdfjs.PDFPageProxy['render']> | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)

    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return

        // Cancela render anterior se ainda estiver rodando
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel() } catch {}
          renderTaskRef.current = null
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: zoom * dpr })
        const canvas = canvasRef.current
        if (!canvas) return

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        const logical = page.getViewport({ scale: zoom })
        canvas.style.width  = `${Math.ceil(logical.width)}px`
        canvas.style.height = `${Math.ceil(logical.height)}px`
        setSize({ w: Math.ceil(logical.width), h: Math.ceil(logical.height) })

        const ctx = canvas.getContext('2d')
        if (!ctx) { setError('Canvas indisponível'); return }

        const task = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
      } catch (e: any) {
        // Se for cancelamento esperado, silencia
        if (e?.name === 'RenderingCancelledException') return
        if (!cancelled) setError(e?.message || 'Falha ao renderizar página')
      }
    })()

    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel() } catch {}
        renderTaskRef.current = null
      }
    }
  }, [pdf, pageNumber, zoom])

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-sm shadow-lg p-6 text-center" style={{ width: 420 }}>
        <AlertCircle className="h-5 w-5 text-red-500 mx-auto mb-2" />
        <p className="text-sm font-medium text-red-700">Falha ao renderizar página {pageNumber}</p>
        <p className="text-xs text-red-500 mt-1">{error}</p>
      </div>
    )
  }

  return (
    <div className="relative inline-block shadow-lg rounded-sm bg-white">
      {!size && (
        <div className="w-60 aspect-[210/297] flex items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      <canvas ref={canvasRef} className="block" />
      {/* Overlay vazio — receberá elementos draggable na Fase 3 */}
      {size && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ width: size.w, height: size.h }}
          data-page={pageNumber}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   PageThumbnail — miniatura na sidebar. Também usa o PDF compartilhado.
// ═══════════════════════════════════════════════════════════════════════

function PageThumbnail({
  pdf, pageNumber, active, onClick,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  active: boolean
  onClick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<pdfjs.PDFPageProxy['render']> | null = null

    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const scale = 120 / base.width
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        task = page.render({ canvasContext: ctx, viewport })
        await task.promise
      } catch (e: any) {
        if (e?.name === 'RenderingCancelledException') return
        if (!cancelled) setError(true)
      }
    })()

    return () => {
      cancelled = true
      if (task) { try { task.cancel() } catch {} }
    }
  }, [pdf, pageNumber])

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg overflow-hidden border-2 transition-colors ${
        active ? 'border-rose-500' : 'border-transparent hover:border-gray-300'
      }`}
    >
      <div className="bg-gray-50">
        {error ? (
          <div className="aspect-[210/297] flex items-center justify-center text-gray-300">
            <FileText className="h-5 w-5" />
          </div>
        ) : (
          <canvas ref={canvasRef} className="w-full block" />
        )}
      </div>
      <p className={`text-[10px] py-1 font-medium ${active ? 'text-rose-600' : 'text-gray-500'}`}>
        Página {pageNumber}
      </p>
    </button>
  )
}