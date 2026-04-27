// src/components/admin/documents/templates/editor/TemplateEditor.tsx
//
// Editor visual de template — Fase 3 + painel de propriedades.
//
// NOVIDADES:
//  • Painel de propriedades (direita) aparece ao selecionar um elemento:
//    - Texto: família, tamanho, cor, negrito/itálico, alinhamento H e V,
//             altura de linha, transformação, autoFit.
//    - Imagem: objectFit (cover / contain).
//    - Ambos: campos numéricos de X, Y, Largura, Altura em pt.
//  • Preview WYSIWYG já refletia os estilos; agora o usuário CONTROLA.
//
// ATENÇÃO À ESTRATÉGIA DE ALTURA:
// O AdminDashboard não dá altura fixa para a rota de Documentos — ela é
// scrollável normalmente. Para evitar dependências frágeis na árvore de
// flex do pai, este editor se "prende" ao viewport sozinho via
//     position: sticky; top: 52px; height: calc(100vh - 52px)

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ZoomIn, ZoomOut, Layers, AlertCircle, Loader2,
  FileText, Type as TypeIcon, Image as ImageIcon,
  MousePointer2, Check, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, ChevronUp, ChevronsUpDown, ChevronDown,
} from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { documentsService } from '../../lib/documentsService'
import type {
  DocumentTag, DocumentTemplate, DocumentTemplateElement, ElementStyle,
} from '../../types'
import { SUPPORTED_FONTS } from '../../types'
import { DraggableTagElement } from './DraggableTagElement'

const ADMIN_TOPBAR_HEIGHT = 52

let workerConfigured = false
function ensureWorker() {
  if (workerConfigured) return
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  workerConfigured = true
}

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
      onClick={onClick} disabled={disabled} title={title}
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
  const [tags, setTags] = useState<DocumentTag[]>([])
  const [elements, setElements] = useState<DocumentTemplateElement[]>([])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const [zoom, setZoom] = useState(1)
  const [activePage, setActivePage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingSavesRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const tagsById = useMemo(() => {
    const m: Record<string, DocumentTag> = {}
    for (const t of tags) m[t.id] = t
    return m
  }, [tags])

  const selectedElement = useMemo(
    () => elements.find(e => e.id === selectedId) ?? null,
    [elements, selectedId],
  )

  // ── Load ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!templateId) return
    ensureWorker()
    setLoading(true)
    setLoadError(null)

    try {
      const tpl = await documentsService.getTemplate(templateId)
      if (!tpl) { setLoadError('Template não encontrado.'); return }
      setTemplate(tpl)

      if (!tpl.base_pdf_path) {
        setLoadError('Template sem PDF base vinculado.')
        return
      }

      const [blob, tagsList, elementsList] = await Promise.all([
        documentsService.downloadBaseTemplate(tpl.base_pdf_path),
        documentsService.listTags({ includeInactive: false }),
        documentsService.listTemplateElements(templateId),
      ])

      const buf = await blob.arrayBuffer()
      if (!buf || buf.byteLength === 0) {
        setLoadError('O arquivo PDF está vazio no storage.')
        return
      }

      const data = new Uint8Array(buf.slice(0))
      const loadedPdf = await pdfjs.getDocument({ data }).promise

      setPdf(loadedPdf)
      setTags(tagsList)
      setElements(elementsList)
    } catch (e: any) {
      setLoadError(e?.message || 'Erro ao carregar template')
    } finally {
      setLoading(false)
    }
  }, [templateId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    return () => {
      if (pdf) pdf.destroy().catch(() => {})
      for (const t of Object.values(pendingSavesRef.current)) clearTimeout(t)
    }
  }, [pdf])

  // ── Zoom ──────────────────────────────────────────────────────────
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedId) return
      const target = e.target as HTMLElement | null
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      if (isTyping) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleDeleteElement(selectedId)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // ═══════════ CRUD ═══════════

  const handleCreateElement = async (tagId: string, pageNumber: number, xPt: number, yPt: number) => {
    const tag = tagsById[tagId]
    if (!tag || !template) return

    const defaultW = tag.type === 'image' ? 180 : 180
    const defaultH = tag.type === 'image' ? 180 : 40

    let x = xPt - defaultW / 2
    let y = yPt - defaultH / 2

    const maxX = template.page_width_pt - defaultW
    const maxY = template.page_height_pt - defaultH
    x = Math.max(0, Math.min(maxX, x))
    y = Math.max(0, Math.min(maxY, y))

    setSaveStatus('saving')
    try {
      const created = await documentsService.createTemplateElement({
        template_id: template.id,
        tag_id: tagId,
        page_number: pageNumber,
        x_pt: x,
        y_pt: y,
        width_pt: defaultW,
        height_pt: defaultH,
      })
      setElements(prev => [...prev, created])
      setSelectedId(created.id)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 1200)
    } catch (e: any) {
      setSaveStatus('error')
      alert(e?.message || 'Erro ao criar elemento')
    }
  }

  const handleChangeElement = (id: string, patch: Partial<DocumentTemplateElement>) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, ...patch } : el))

    if (pendingSavesRef.current[id]) clearTimeout(pendingSavesRef.current[id])
    setSaveStatus('saving')
    pendingSavesRef.current[id] = setTimeout(async () => {
      delete pendingSavesRef.current[id]
      try {
        await documentsService.updateTemplateElement(id, patch as any)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 1000)
      } catch (e: any) {
        setSaveStatus('error')
        console.error('Falha ao salvar elemento', e)
      }
    }, 400)
  }

  const handleDeleteElement = async (id: string) => {
    const prev = elements
    setElements(els => els.filter(el => el.id !== id))
    if (selectedId === id) setSelectedId(null)
    try {
      await documentsService.deleteTemplateElement(id)
    } catch (e: any) {
      setElements(prev)
      alert(e?.message || 'Erro ao excluir elemento')
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  const fullViewportStyle: React.CSSProperties = {
    position: 'sticky',
    top: ADMIN_TOPBAR_HEIGHT,
    height: `calc(100vh - ${ADMIN_TOPBAR_HEIGHT}px)`,
  }

  if (loading) {
    return (
      <div style={fullViewportStyle} className="flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Carregando template...</span>
        </div>
      </div>
    )
  }

  if (loadError || !template) {
    return (
      <div style={fullViewportStyle} className="flex items-center justify-center p-6">
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

  const pageNumbers = pdf ? Array.from({ length: pdf.numPages }, (_, i) => i + 1) : []

  return (
    <div
      style={fullViewportStyle}
      className="flex flex-col bg-gray-100 overflow-hidden"
    >
      {/* ─── Topbar do editor ───────────────────────────────────── */}
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
            <span className="text-gray-400">·</span>
            <span>{elements.length} elemento{elements.length !== 1 ? 's' : ''}</span>
          </p>
        </div>

        <div className="min-w-[80px] flex justify-end">
          <SaveStatusIndicator status={saveStatus} />
        </div>

        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={zoomOut} className="p-1.5 rounded-md hover:bg-white text-gray-600" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
          <button onClick={zoomFit} className="px-2 text-xs font-medium text-gray-600 hover:bg-white rounded-md h-7 min-w-[3rem]" title="Ajustar">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={zoomIn} className="p-1.5 rounded-md hover:bg-white text-gray-600" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* ─── Body ─────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* Palette (fixa) */}
        <aside className="w-60 border-r border-gray-200 bg-white flex-shrink-0 hidden lg:flex flex-col min-h-0">
          <div className="px-3 pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Tags disponíveis
            </p>
            <p className="text-[11px] text-gray-500 leading-tight">
              Arraste qualquer tag para uma página do PDF.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
            {tags.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8 px-2">
                Nenhuma tag ativa. Crie uma na aba Tags.
              </p>
            ) : (
              tags.map(t => <PaletteTagItem key={t.id} tag={t} />)
            )}
          </div>
        </aside>

        {/* Canvas (rola aqui) */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-4 md:px-8 py-6 min-h-0">
          {pdf ? (
            <div className="flex flex-col items-center gap-6">
              {pageNumbers.map(n => (
                <div
                  key={n}
                  ref={el => { pageRefs.current[n] = el }}
                  className="relative"
                >
                  <span className="absolute -top-5 left-0 text-[11px] text-gray-400 font-medium">
                    {n}
                  </span>
                  <PdfPageCanvas
                    pdf={pdf}
                    pageNumber={n}
                    zoom={zoom}
                    elements={elements.filter(e => e.page_number === n)}
                    tagsById={tagsById}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onChangeElement={handleChangeElement}
                    onDeleteElement={handleDeleteElement}
                    onDropTag={(tagId, xPt, yPt) => handleCreateElement(tagId, n, xPt, yPt)}
                  />
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

        {/* Painel direito: Propriedades (quando selecionado) ou Miniaturas */}
        {selectedElement ? (
          <StylePanel
            element={selectedElement}
            tag={tagsById[selectedElement.tag_id]}
            template={template}
            onChange={handleChangeElement}
          />
        ) : pdf && template.page_count > 1 ? (
          <aside className="w-32 border-l border-gray-200 bg-white flex-shrink-0 hidden md:flex flex-col min-h-0">
            <div className="px-2 pt-3 pb-1 flex-shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 px-1">
                Páginas
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
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
        ) : null}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   StylePanel — Painel de propriedades do elemento selecionado
// ═══════════════════════════════════════════════════════════════════════

function StylePanel({
  element, tag, template, onChange,
}: {
  element: DocumentTemplateElement
  tag: DocumentTag | undefined
  template: DocumentTemplate
  onChange: (id: string, patch: Partial<DocumentTemplateElement>) => void
}) {
  const style: ElementStyle = (element.style as ElementStyle) || {}
  const isImage = tag?.type === 'image'

  const updateStyle = (patch: Partial<ElementStyle>) => {
    onChange(element.id, { style: { ...style, ...patch } as any })
  }

  const updateGeom = (patch: Partial<Pick<DocumentTemplateElement,
    'x_pt' | 'y_pt' | 'width_pt' | 'height_pt'
  >>) => {
    onChange(element.id, patch)
  }

  return (
    <aside className="w-64 border-l border-gray-200 bg-white flex-shrink-0 hidden md:flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-3 border-b border-gray-100 flex-shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Propriedades
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {isImage
            ? <ImageIcon className="h-3.5 w-3.5 text-violet-500" />
            : <TypeIcon className="h-3.5 w-3.5 text-sky-500" />}
          <p className="text-xs font-medium text-gray-700 truncate">
            {tag?.name ?? '(tag removida)'}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* ── Posição e Tamanho ── */}
        <PropSection title="Posição e tamanho">
          <div className="grid grid-cols-2 gap-2">
            <NumericField
              label="X (pt)"
              value={element.x_pt}
              min={0}
              max={template.page_width_pt - (element.width_pt ?? 10)}
              onChange={v => updateGeom({ x_pt: v })}
            />
            <NumericField
              label="Y (pt)"
              value={element.y_pt}
              min={0}
              max={template.page_height_pt - (element.height_pt ?? 10)}
              onChange={v => updateGeom({ y_pt: v })}
            />
            <NumericField
              label="Largura"
              value={element.width_pt ?? (isImage ? 180 : 180)}
              min={10}
              max={template.page_width_pt}
              onChange={v => updateGeom({ width_pt: v })}
            />
            <NumericField
              label="Altura"
              value={element.height_pt ?? (isImage ? 180 : 40)}
              min={4}
              max={template.page_height_pt}
              onChange={v => updateGeom({ height_pt: v })}
            />
          </div>
        </PropSection>

        {isImage ? (
          /* ── Opções de imagem ── */
          <PropSection title="Ajuste da imagem">
            <p className="text-[11px] text-gray-500 mb-2 leading-snug">
              Como a imagem preenche o retângulo:
            </p>
            <div className="flex gap-2">
              <FitButton
                active={(style.objectFit ?? 'cover') === 'cover'}
                onClick={() => updateStyle({ objectFit: 'cover' })}
                label="Cobrir"
                hint="Preenche tudo, corta bordas"
              />
              <FitButton
                active={style.objectFit === 'contain'}
                onClick={() => updateStyle({ objectFit: 'contain' })}
                label="Conter"
                hint="Imagem inteira, sem corte"
              />
            </div>
          </PropSection>
        ) : (
          <>
            {/* ── Fonte ── */}
            <PropSection title="Fonte">
              {/* Família */}
              <div className="mb-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Família</label>
                <select
                  value={style.fontFamily ?? 'Inter'}
                  onChange={e => updateStyle({ fontFamily: e.target.value })}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-rose-400"
                >
                  {SUPPORTED_FONTS.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              {/* Tamanho + Cor */}
              <div className="flex gap-2 mb-2">
                <div className="flex-1">
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Tamanho (pt)</label>
                  <NumericField
                    value={style.fontSize ?? 14}
                    min={4}
                    max={200}
                    onChange={v => updateStyle({ fontSize: v })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Cor</label>
                  <div className="relative">
                    <input
                      type="color"
                      value={style.color ?? '#111827'}
                      onChange={e => updateStyle({ color: e.target.value })}
                      className="h-[30px] w-9 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white"
                      title="Cor do texto"
                    />
                  </div>
                </div>
              </div>

              {/* Negrito / Itálico */}
              <div className="flex gap-2">
                <StyleToggle
                  active={!!style.bold}
                  onClick={() => updateStyle({ bold: !style.bold })}
                  className="font-bold"
                  label="N"
                  title="Negrito"
                />
                <StyleToggle
                  active={!!style.italic}
                  onClick={() => updateStyle({ italic: !style.italic })}
                  className="italic"
                  label="I"
                  title="Itálico"
                />
              </div>
            </PropSection>

            {/* ── Alinhamento ── */}
            <PropSection title="Alinhamento">
              {/* Horizontal */}
              <div className="mb-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Horizontal</label>
                <div className="flex gap-1">
                  {(
                    [
                      { value: 'left',    Icon: AlignLeft,    title: 'Esquerda' },
                      { value: 'center',  Icon: AlignCenter,  title: 'Centro'   },
                      { value: 'right',   Icon: AlignRight,   title: 'Direita'  },
                      { value: 'justify', Icon: AlignJustify, title: 'Justificado' },
                    ] as const
                  ).map(({ value, Icon, title }) => (
                    <button
                      key={value}
                      title={title}
                      onClick={() => updateStyle({ align: value })}
                      className={`flex-1 h-8 rounded-lg flex items-center justify-center transition-colors ${
                        (style.align ?? 'left') === value
                          ? 'bg-rose-500 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Vertical */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Vertical</label>
                <div className="flex gap-1">
                  {(
                    [
                      { value: 'top',    Icon: ChevronUp,       title: 'Topo'   },
                      { value: 'middle', Icon: ChevronsUpDown,  title: 'Meio'   },
                      { value: 'bottom', Icon: ChevronDown,     title: 'Base'   },
                    ] as const
                  ).map(({ value, Icon, title }) => (
                    <button
                      key={value}
                      title={title}
                      onClick={() => updateStyle({ verticalAlign: value })}
                      className={`flex-1 h-8 rounded-lg flex items-center justify-center transition-colors ${
                        (style.verticalAlign ?? 'top') === value
                          ? 'bg-rose-500 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </PropSection>

            {/* ── Mais opções ── */}
            <PropSection title="Mais opções">
              <div className="space-y-2">
                <NumericField
                  label="Altura de linha"
                  value={style.lineHeight ?? 1.3}
                  min={0.8}
                  max={4}
                  step={0.1}
                  onChange={v => updateStyle({ lineHeight: v })}
                />
                <NumericField
                  label="Espaçamento entre letras (pt)"
                  value={style.letterSpacing ?? 0}
                  min={-5}
                  max={30}
                  step={0.5}
                  onChange={v => updateStyle({ letterSpacing: v })}
                />

                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    Transformação
                  </label>
                  <select
                    value={style.textTransform ?? 'none'}
                    onChange={e => updateStyle({ textTransform: e.target.value as any })}
                    className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-rose-400"
                  >
                    <option value="none">Normal</option>
                    <option value="uppercase">MAIÚSCULAS</option>
                    <option value="lowercase">minúsculas</option>
                  </select>
                </div>

                {/* AutoFit */}
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <div
                    onClick={() => updateStyle({ autoFit: !style.autoFit })}
                    className={`w-8 h-4 rounded-full relative transition-colors ${
                      style.autoFit ? 'bg-rose-500' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      style.autoFit ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </div>
                  <span className="text-[11px] text-gray-600">
                    Auto-fit <span className="text-gray-400">(reduz fonte pra caber)</span>
                  </span>
                </label>
              </div>
            </PropSection>
          </>
        )}
      </div>
    </aside>
  )
}

// ─── Micro-componentes do painel ──────────────────────────────────────

function PropSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 border-b border-gray-100 last:border-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2.5">
        {title}
      </p>
      {children}
    </div>
  )
}

function NumericField({
  label, value, min, max, step = 1, onChange,
}: {
  label?: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  // Estado local pra não travar o cursor enquanto digita
  const [local, setLocal] = useState(String(Math.round(value * 100) / 100))

  useEffect(() => {
    setLocal(String(Math.round(value * 100) / 100))
  }, [value])

  const commit = () => {
    const n = parseFloat(local)
    if (Number.isNaN(n)) { setLocal(String(value)); return }
    const clamped = min !== undefined ? Math.max(min, n) : n
    const final   = max !== undefined ? Math.min(max, clamped) : clamped
    onChange(Math.round(final * 100) / 100)
  }

  return (
    <div>
      {label && (
        <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
      )}
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit() }}
        className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-400"
      />
    </div>
  )
}

function StyleToggle({
  active, onClick, label, title, className = '',
}: {
  active: boolean
  onClick: () => void
  label: string
  title: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`h-8 w-10 rounded-lg text-sm border transition-colors ${className} ${
        active
          ? 'bg-rose-500 text-white border-rose-500'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
      }`}
    >
      {label}
    </button>
  )
}

function FitButton({
  active, onClick, label, hint,
}: {
  active: boolean; onClick: () => void; label: string; hint: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl border py-2 px-3 text-left transition-colors ${
        active
          ? 'border-rose-500 bg-rose-50'
          : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <p className={`text-xs font-medium ${active ? 'text-rose-700' : 'text-gray-700'}`}>{label}</p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{hint}</p>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   Subcomponentes existentes (sem alteração)
// ═══════════════════════════════════════════════════════════════════════

function SaveStatusIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
        <Check className="h-3 w-3" /> Salvo
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
      <AlertCircle className="h-3 w-3" /> Erro
    </span>
  )
}

function PaletteTagItem({ tag }: { tag: DocumentTag }) {
  const Icon = tag.type === 'image' ? ImageIcon : TypeIcon
  const color = tag.type === 'image' ? 'text-violet-500 bg-violet-50' : 'text-sky-500 bg-sky-50'

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-document-tag-id', tag.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="flex items-center gap-2 px-2 py-2 rounded-lg border border-transparent hover:border-rose-200 hover:bg-rose-50/40 cursor-grab active:cursor-grabbing transition-colors group"
      title={`Arraste "${tag.name}" para uma página`}
    >
      <div className={`h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate leading-tight">{tag.name}</p>
        <p className="text-[10px] text-gray-400 font-mono truncate">{tag.slug}</p>
      </div>
      <MousePointer2 className="h-3 w-3 text-gray-300 group-hover:text-rose-400 flex-shrink-0" />
    </div>
  )
}

function PdfPageCanvas({
  pdf, pageNumber, zoom,
  elements, tagsById,
  selectedId, onSelect,
  onChangeElement, onDeleteElement,
  onDropTag,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  zoom: number
  elements: DocumentTemplateElement[]
  tagsById: Record<string, DocumentTag>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChangeElement: (id: string, patch: Partial<DocumentTemplateElement>) => void
  onDeleteElement: (id: string) => void
  onDropTag: (tagId: string, xPt: number, yPt: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragHover, setDragHover] = useState(false)

  const renderTaskRef = useRef<ReturnType<pdfjs.PDFPageProxy['render']> | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)

    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return

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
        const w = Math.ceil(logical.width)
        const h = Math.ceil(logical.height)
        canvas.style.width  = `${w}px`
        canvas.style.height = `${h}px`
        setSize({ w, h })

        const ctx = canvas.getContext('2d')
        if (!ctx) { setError('Canvas indisponível'); return }

        const task = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
      } catch (e: any) {
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

  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('application/x-document-tag-id')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (!dragHover) setDragHover(true)
    }
  }

  const onDragLeave = () => setDragHover(false)

  const onDrop = (e: React.DragEvent) => {
    const tagId = e.dataTransfer.getData('application/x-document-tag-id')
    if (!tagId) return
    e.preventDefault()
    setDragHover(false)

    const overlay = overlayRef.current
    if (!overlay || !size) return

    const rect = overlay.getBoundingClientRect()
    const xPx = e.clientX - rect.left
    const yPx = e.clientY - rect.top

    const xPt = xPx / zoom
    const yPt = yPx / zoom

    onDropTag(tagId, xPt, yPt)
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onSelect(null)
  }

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

      {size && (
        <div
          ref={overlayRef}
          className={`absolute inset-0 ${dragHover ? 'bg-rose-50/40 ring-2 ring-rose-400 ring-inset' : ''}`}
          style={{ width: size.w, height: size.h }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onMouseDown={handleOverlayClick}
          data-page={pageNumber}
        >
          {elements.map(el => (
            <DraggableTagElement
              key={el.id}
              element={el}
              tag={tagsById[el.tag_id]}
              zoom={zoom}
              selected={selectedId === el.id}
              onSelect={() => onSelect(el.id)}
              onChange={patch => onChangeElement(el.id, patch)}
              onDelete={() => onDeleteElement(el.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

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
        const scale = 100 / base.width
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
        {pageNumber}
      </p>
    </button>
  )
}