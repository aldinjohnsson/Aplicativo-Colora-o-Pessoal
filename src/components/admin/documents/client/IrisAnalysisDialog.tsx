// src/components/admin/documents/client/IrisAnalysisDialog.tsx
//
// Ferramenta de Análise da Íris — usa a galeria de fotos já existente da cliente
// (mesmo padrão do ContrastLayoutDialog: category → pick → edit).
// Nenhum upload avulso: as fotos vêm do Drive via driveStorage.fetchPhotoBlob.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, Download, ChevronLeft, Loader2,
  Image as ImageIcon, AlertCircle, Save, FolderOpen, Eye,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { driveStorage } from '../../../../lib/driveStorage'
import { useTheme } from '../../../../lib/theme'
import {
  AVAILABLE_FONTS,
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_CARD_STATE,
  FontFamily,
  IrisAnalysisRecord,
  IrisCardState,
  IrisTextTemplate,
} from './irisAnalysisTypes'
import {
  downloadDataUrl,
  renderIrisCard,
  renderIrisCardToPng,
} from './irisCardGenerator'

// ── Types ──────────────────────────────────────────────────────────────────

interface ClientPhoto {
  id: string
  url: string
  thumb?: string
  driveFileId?: string | null
  categoryId?: string | null
  categoryTitle?: string | null
}

interface PhotoCategory { id: string | null; title: string; count: number }

interface Props {
  clientId: string
  clientName: string
  initial: IrisAnalysisRecord | null
  onClose: () => void
  onSave: (record: IrisAnalysisRecord) => Promise<void> | void
  templates?: IrisTextTemplate[]
  onSaveTemplate?: (data: {
    name: string; title: string; body: string
    fontFamily: FontFamily; textColor: string; bgColor: string
    titleSize: number; bodySize: number
  }) => Promise<void> | void
}

// ── Helpers ────────────────────────────────────────────────────────────────

function recordToState(r: IrisAnalysisRecord | null): IrisCardState {
  if (!r) return DEFAULT_CARD_STATE
  return {
    imageDataUrl: r.imageDataUrl,
    zoom: r.zoom, offsetX: r.offsetX, offsetY: r.offsetY,
    title: r.title, body: r.body, fontFamily: r.fontFamily,
    textColor: r.textColor, bgColor: r.bgColor,
    titleSize: r.titleSize, bodySize: r.bodySize,
  }
}

// ── Btn ────────────────────────────────────────────────────────────────────

const Btn = ({ children, onClick, variant = 'primary', loading = false, disabled = false, className = '' }: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
  }
  return (
    <button onClick={onClick} disabled={disabled || loading} type="button"
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${className}`}>
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ── Subcomponentes do editor ───────────────────────────────────────────────

function Field({ t, label, children }: { t: any; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: t.text3 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function SliderRow(props: {
  t: any; label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; format?: (v: number) => string
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: props.t.text3 }}>
        <span>{props.label}</span>
        <span className="font-normal normal-case" style={{ color: props.t.text3 }}>
          {props.format ? props.format(props.value) : props.value}
        </span>
      </div>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={e => props.onChange(parseFloat(e.target.value))}
        className="block w-full accent-rose-500" />
    </div>
  )
}

function ColorRow(props: { t: any; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: props.t.text3 }}>
        {props.label}
      </label>
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5"
        style={{ background: props.t.surface2, border: `1px solid ${props.t.border}` }}>
        <input type="color" value={props.value} onChange={e => props.onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
        <input type="text" value={props.value} onChange={e => props.onChange(e.target.value)}
          className="flex-1 bg-transparent text-sm focus:outline-none" style={{ color: props.t.text }} />
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────

export function IrisAnalysisDialog({
  clientId, clientName, initial, onClose, onSave,
  templates = [], onSaveTemplate,
}: Props) {
  const { theme: t } = useTheme()

  // ── Galeria (category → pick) ──────────────────────────────────────
  const [step, setStep] = useState<'category' | 'pick' | 'edit'>(
    initial?.cardPngDataUrl ? 'edit' : 'category'
  )
  const [photos, setPhotos]             = useState<ClientPhoto[]>([])
  const [categories, setCategories]     = useState<PhotoCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null | undefined>(undefined)
  const [blobUrls, setBlobUrls]         = useState<Record<string, string>>({})
  const [photoLoading, setPhotoLoading] = useState(true)
  const [blobLoading, setBlobLoading]   = useState(false)
  const [photoError, setPhotoError]     = useState<string | null>(null)
  const [loadingImg, setLoadingImg]     = useState(false)
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null)

  // ── Editor ─────────────────────────────────────────────────────────
  const [state, setState]                   = useState<IrisCardState>(() => recordToState(initial))
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [saving, setSaving]                 = useState(false)
  const [saveError, setSaveError]           = useState<string | null>(null)
  const [saved, setSaved]                   = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [newTemplateName, setNewTemplateName]   = useState('')
  const [savingTemplate, setSavingTemplate]     = useState(false)

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const objectUrlRef     = useRef<string | null>(null)

  // Revoga objectURL ao desmontar
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  // Esc fecha
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ── Carrega lista de fotos ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setPhotoLoading(true)
    documentsService.listClientPhotos(clientId)
      .then(list => {
        if (cancelled) return
        const mapped: ClientPhoto[] = list.map((p: any) => ({
          id: p.id,
          url: p.url,
          driveFileId: p.drive_file_id ?? null,
          categoryId: p.category_id ?? null,
          categoryTitle: p.category_title ?? null,
        }))
        setPhotos(mapped)

        const catMap: Record<string, PhotoCategory> = {}
        for (const p of mapped) {
          const key = p.categoryId ?? '__none__'
          if (!catMap[key]) {
            catMap[key] = { id: p.categoryId ?? null, title: p.categoryTitle ?? 'Sem categoria', count: 0 }
          }
          catMap[key].count++
        }
        setCategories(Object.values(catMap).sort((a, b) => {
          if (a.id === null) return 1
          if (b.id === null) return -1
          return a.title.localeCompare(b.title)
        }))
      })
      .catch((e: any) => { if (!cancelled) setPhotoError(e?.message || 'Erro ao carregar fotos') })
      .finally(() => { if (!cancelled) setPhotoLoading(false) })
    return () => { cancelled = true }
  }, [clientId])

  // ── Carrega blobs ao selecionar categoria ─────────────────────────
  useEffect(() => {
    if (selectedCategory === undefined) return
    let cancelled = false
    const subset = photos.filter(p =>
      selectedCategory === '__none__' ? p.categoryId === null : p.categoryId === selectedCategory
    )
    const driveSubset = subset.filter(p => p.driveFileId)
    if (driveSubset.length === 0) return
    setBlobLoading(true)
    Promise.allSettled(
      driveSubset.map(async p => {
        const blob = await driveStorage.fetchPhotoBlob(p.driveFileId!)
        return { id: p.id, blobUrl: URL.createObjectURL(blob) }
      })
    ).then(entries => {
      if (cancelled) return
      const map: Record<string, string> = {}
      for (const r of entries) {
        if (r.status === 'fulfilled') map[r.value.id] = r.value.blobUrl
      }
      setBlobUrls(prev => ({ ...prev, ...map }))
    }).finally(() => { if (!cancelled) setBlobLoading(false) })
    return () => { cancelled = true }
  }, [selectedCategory, photos])

  // ── Re-renderiza preview a cada mudança de estado ─────────────────
  useEffect(() => {
    if (!previewCanvasRef.current || step !== 'edit') return
    let cancelled = false
    renderIrisCard(state, previewCanvasRef.current).catch(err => {
      if (!cancelled) console.error('[IrisAnalysisDialog] preview:', err)
    })
    return () => { cancelled = true }
  }, [state, step])

  const patch = useCallback((p: Partial<IrisCardState>) => setState(prev => ({ ...prev, ...p })), [])

  // ── Seleciona foto da galeria ──────────────────────────────────────
  const selectPhoto = async (photo: ClientPhoto) => {
    setLoadingImg(true)
    setPhotoError(null)
    try {
      let blob: Blob
      if (photo.driveFileId) {
        blob = await driveStorage.fetchPhotoBlob(photo.driveFileId)
      } else {
        const res = await fetch(photo.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        blob = await res.blob()
      }

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const objectUrl = URL.createObjectURL(blob)
      objectUrlRef.current = objectUrl

      // Converte objectUrl → dataUrl pra poder salvar no IrisAnalysisRecord
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = img.naturalWidth; c.height = img.naturalHeight
          c.getContext('2d')!.drawImage(img, 0, 0)
          resolve(c.toDataURL('image/jpeg', 0.85))
        }
        img.onerror = () => reject(new Error('Falha ao decodificar imagem'))
        img.src = objectUrl
      })

      patch({ imageDataUrl: dataUrl, zoom: 1, offsetX: 0, offsetY: 0 })
      setSelectedPhotoId(photo.id)
      setStep('edit')
    } catch (e: any) {
      setPhotoError(e?.message || 'Erro ao baixar a foto.')
    } finally {
      setLoadingImg(false)
    }
  }

  // ── Handlers de template ───────────────────────────────────────────
  const handleLoadTemplate = (id: string) => {
    setSelectedTemplateId(id)
    if (!id) return
    const tpl = templates.find(tt => tt.id === id)
    if (!tpl) return
    patch({
      title: tpl.title, body: tpl.body, fontFamily: tpl.fontFamily,
      textColor: tpl.textColor, bgColor: tpl.bgColor,
      titleSize: tpl.titleSize, bodySize: tpl.bodySize,
    })
  }

  const handleSaveTemplate = async () => {
    if (!onSaveTemplate) return
    const name = newTemplateName.trim()
    if (!name) return
    setSavingTemplate(true)
    try {
      await onSaveTemplate({
        name, title: state.title, body: state.body,
        fontFamily: state.fontFamily, textColor: state.textColor, bgColor: state.bgColor,
        titleSize: state.titleSize, bodySize: state.bodySize,
      })
      setShowSaveTemplate(false)
      setNewTemplateName('')
    } finally {
      setSavingTemplate(false)
    }
  }

  // ── Download e Save ────────────────────────────────────────────────
  const handleDownload = async () => {
    const dataUrl = await renderIrisCardToPng(state)
    downloadDataUrl(dataUrl, `analise-iris-${clientName.toLowerCase().replace(/\s+/g, '-')}.png`)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const cardPngDataUrl = await renderIrisCardToPng(state)
      const record: IrisAnalysisRecord = {
        ...state,
        cardPngDataUrl,
        updatedAt: new Date().toISOString(),
      }
      await onSave(record)
      setSaved(true)
      setTimeout(onClose, 600)
    } catch (e: any) {
      setSaveError(e?.message || 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  // ── Step: category ────────────────────────────────────────────────
  const renderCategory = () => (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {photoLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 text-rose-400 animate-spin" />
        </div>
      ) : photoError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{photoError}</p>
        </div>
      ) : categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <ImageIcon className="h-6 w-6 text-gray-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700">Nenhuma foto encontrada</p>
          <p className="text-xs text-gray-500 mt-1">Adicione fotos ao perfil da cliente primeiro.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">De qual categoria você quer escolher a foto?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {categories.map(cat => (
              <button key={cat.id ?? '__none__'} type="button"
                onClick={() => { setSelectedCategory(cat.id ?? '__none__'); setStep('pick') }}
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white hover:border-rose-300 hover:bg-rose-50/40 transition-colors text-left group"
              >
                <div className="h-9 w-9 rounded-lg bg-rose-50 text-rose-400 flex items-center justify-center flex-shrink-0 group-hover:bg-rose-100">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate group-hover:text-rose-700">{cat.title}</p>
                  <p className="text-xs text-gray-400">{cat.count} foto{cat.count !== 1 ? 's' : ''}</p>
                </div>
                <span className="text-gray-300 group-hover:text-rose-400 text-lg leading-none">→</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  // ── Step: pick ────────────────────────────────────────────────────
  const renderPick = () => {
    const visiblePhotos = photos.filter(p =>
      selectedCategory === '__none__' ? p.categoryId === null : p.categoryId === selectedCategory
    )
    return (
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {blobLoading && (
          <div className="flex items-center gap-2 mb-3 text-sm text-rose-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando fotos...
          </div>
        )}
        {loadingImg && (
          <div className="flex items-center gap-2 mb-3 text-sm text-rose-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Baixando foto...
          </div>
        )}
        {photoError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{photoError}</p>
          </div>
        )}
        {visiblePhotos.length === 0 && !blobLoading ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
            <ImageIcon className="h-6 w-6 text-gray-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700">Nenhuma foto nesta categoria</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-500">Clique em uma foto para usá-la na análise.</p>
              <button type="button" onClick={() => setStep('category')}
                className="text-xs text-gray-400 hover:text-rose-600 flex items-center gap-1">
                <ChevronLeft className="h-3 w-3" /> Categorias
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {visiblePhotos.map(p => (
                <button key={p.id} type="button" onClick={() => selectPhoto(p)} disabled={loadingImg}
                  className="aspect-square rounded-xl overflow-hidden border-2 border-transparent hover:border-rose-400 transition-colors relative group disabled:opacity-50">
                  <img src={blobUrls[p.id] || p.thumb || p.url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Step: edit ────────────────────────────────────────────────────
  const renderEdit = () => (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Trocar foto */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: t.text3 }}>
            Ajuste a foto e o texto
          </p>
          <button type="button" onClick={() => setStep('category')}
            className="text-xs flex items-center gap-1 hover:text-rose-600" style={{ color: t.text3 }}>
            <ChevronLeft className="h-3 w-3" /> Trocar foto
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Coluna esquerda — controles da foto */}
          <section className="space-y-4">
            <SliderRow t={t} label="Zoom" value={state.zoom} min={0.5} max={3} step={0.01}
              onChange={v => patch({ zoom: v })} format={v => `${Math.round(v * 100)}%`} />
            <SliderRow t={t} label="Posição horizontal" value={state.offsetX} min={-250} max={250} step={1}
              onChange={v => patch({ offsetX: v })} format={v => `${v}`} />
            <SliderRow t={t} label="Posição vertical" value={state.offsetY} min={-250} max={250} step={1}
              onChange={v => patch({ offsetY: v })} format={v => `${v}`} />
          </section>

          {/* Coluna direita — texto */}
          <section className="space-y-4">
            {/* ── Setlist de templates ─────────────────────────────── */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: t.text3 }}>
                  Textos padrão
                </label>
                {onSaveTemplate && (
                  <button type="button" onClick={() => setShowSaveTemplate(s => !s)}
                    className="text-[11px] font-medium flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors"
                    style={{
                      color: showSaveTemplate ? '#f43f5e' : t.text3,
                      background: showSaveTemplate ? '#fff1f2' : 'transparent',
                      border: `1px solid ${showSaveTemplate ? '#fecdd3' : 'transparent'}`,
                    }}>
                    {showSaveTemplate ? '✕ Cancelar' : '+ Salvar texto atual'}
                  </button>
                )}
              </div>

              {/* Inline save-as-template form */}
              {showSaveTemplate && (
                <div className="mb-2 flex gap-2 rounded-lg p-2.5" style={{ background: t.surface2, border: `1px solid ${t.border}` }}>
                  <input type="text" placeholder="Nome do template (ex: Íris solar castanha)" value={newTemplateName}
                    onChange={e => setNewTemplateName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveTemplate()}
                    className="flex-1 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rose-400"
                    style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text }}
                    autoFocus />
                  <button type="button" onClick={handleSaveTemplate}
                    disabled={!newTemplateName.trim() || savingTemplate}
                    className="rounded-md bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5">
                    {savingTemplate ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Salvar
                  </button>
                </div>
              )}

              {templates.length === 0 ? (
                <p className="text-xs rounded-lg px-3 py-3 text-center"
                  style={{ color: t.text3, background: t.surface2, border: `1px dashed ${t.border}` }}>
                  Nenhum texto padrão cadastrado ainda.
                </p>
              ) : (
                <select
                  value={selectedTemplateId}
                  onChange={e => handleLoadTemplate(e.target.value)}
                  className="block w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                  style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }}
                >
                  <option value="">— Escolher texto padrão —</option>
                  {templates.map(tpl => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </select>
              )}
            </div>

            <Field t={t} label="Título">
              <input type="text" value={state.title} onChange={e => patch({ title: e.target.value })}
                className="block w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }} />
            </Field>

            <Field t={t} label="Corpo">
              <textarea value={state.body} onChange={e => patch({ body: e.target.value })} rows={6}
                className="block w-full resize-y rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field t={t} label="Fonte">
                  <select value={state.fontFamily} onChange={e => patch({ fontFamily: e.target.value as FontFamily })}
                    className="block w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                    style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }}>
                    {AVAILABLE_FONTS.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <ColorRow t={t} label="Cor do texto" value={state.textColor} onChange={v => patch({ textColor: v })} />
              <ColorRow t={t} label="Cor do fundo" value={state.bgColor} onChange={v => patch({ bgColor: v })} />
              <SliderRow t={t} label="Tamanho do título" value={state.titleSize} min={18} max={56} step={1}
                onChange={v => patch({ titleSize: v })} format={v => `${v}px`} />
              <SliderRow t={t} label="Tamanho do corpo" value={state.bodySize} min={12} max={28} step={1}
                onChange={v => patch({ bodySize: v })} format={v => `${v}px`} />
            </div>
          </section>
        </div>

        {/* Preview do canvas */}
        <div className="rounded-lg overflow-hidden shadow-sm" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
          <canvas ref={previewCanvasRef} width={CARD_WIDTH} height={CARD_HEIGHT}
            className="block h-auto w-full" style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }} />
        </div>
        <p className="text-[11px] text-right" style={{ color: t.text3 }}>{CARD_WIDTH}×{CARD_HEIGHT}px · PNG</p>

        {saveError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{saveError}</p>
          </div>
        )}
        {saved && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2 flex items-center gap-2">
            <Save className="h-4 w-4 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">Salvo! Fechando…</p>
          </div>
        )}
      </div>
    </>
  )

  // ── Título do header por step ──────────────────────────────────────
  const stepLabel = step === 'category'
    ? `Escolha a categoria de fotos de ${clientName}`
    : step === 'pick'
    ? `Escolha uma foto de ${clientName}`
    : 'Ajuste a análise e salve. O card vira variável {{AnaliseIris}} nos prompts.'

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col"
        style={{ maxWidth: 900, maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-semibold text-gray-900 flex items-center gap-2">
              <Eye className="h-4 w-4 text-rose-500" /> Ferramenta de Análise da Íris
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{stepLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conteúdo */}
        {step === 'category' ? renderCategory() : step === 'pick' ? renderPick() : renderEdit()}

        {/* Footer — só no step edit */}
        {step === 'edit' && (
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-wrap flex-shrink-0">
            <Btn variant="outline" onClick={handleDownload} disabled={saving}>
              <Download className="h-3.5 w-3.5" /> Baixar PNG
            </Btn>
            <Btn variant="primary" onClick={handleSave} loading={saving} disabled={saving || saved}>
              <Save className="h-3.5 w-3.5" /> {saved ? 'Salvo' : 'Salvar'}
            </Btn>
          </div>
        )}
      </div>
    </div>
  )
}