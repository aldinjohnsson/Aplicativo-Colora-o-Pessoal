// src/components/admin/documents/client/ClientTagValuesPanel.tsx
//
// Painel de "Valores das tags para este cliente".
// Melhorias desta revisão:
//   • Dropdown "Importar de" renderiza em portal (createPortal + coordenadas
//     calculadas), evitando clipping por cards adjacentes.
//   • Slug da tag removido da UI (era exposição técnica desnecessária).
//   • Layout mais calmo: header próprio por card, input largo, status sutil.
//   • Tag de imagem: preview maior e ações alinhadas.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Tag as TagIcon, Type as TypeIcon, Image as ImageIcon,
  Download as DownloadIcon, ChevronDown, Check,
  AlertCircle, Trash2, Loader2, Inbox, RefreshCw,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import type {
  DocumentTag, ClientTagValue, TextImportSourceOption,
} from '../types'
import { TagValueImageDialog, ImageDialogResult } from './TagValueImageDialog'

// ─── Save status ──────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function StatusDot({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  const map = {
    saving: { label: 'Salvando', cls: 'text-gray-400', Icon: Loader2, spin: true },
    saved:  { label: 'Salvo',    cls: 'text-emerald-600', Icon: Check,  spin: false },
    error:  { label: 'Erro',     cls: 'text-red-600',     Icon: AlertCircle, spin: false },
  }[status]
  const Icon = map.Icon
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${map.cls}`}>
      <Icon className={`h-3 w-3 ${map.spin ? 'animate-spin' : ''}`} />
      {map.label}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   ClientTagValuesPanel
// ═══════════════════════════════════════════════════════════════════════

interface Props { clientId: string }

export function ClientTagValuesPanel({ clientId }: Props) {
  const [tags, setTags] = useState<DocumentTag[]>([])
  const [valuesByTag, setValuesByTag] = useState<Record<string, ClientTagValue>>({})
  const [textSources, setTextSources] = useState<TextImportSourceOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tagsList, valuesList, sources] = await Promise.all([
        documentsService.listTags({ includeInactive: false }),
        documentsService.listClientTagValues(clientId),
        documentsService.getTextImportSources(clientId),
      ])
      setTags(tagsList)
      const map: Record<string, ClientTagValue> = {}
      for (const v of valuesList) map[v.tag_id] = v
      setValuesByTag(map)
      setTextSources(sources)
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar tags e valores')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { reload() }, [reload])

  const updateLocal = (tagId: string, value: ClientTagValue | null) => {
    setValuesByTag(prev => {
      const copy = { ...prev }
      if (value) copy[tagId] = value
      else delete copy[tagId]
      return copy
    })
  }

  const filledCount = useMemo(() => {
    return tags.reduce((acc, t) => {
      const v = valuesByTag[t.id]
      if (!v) return acc
      if (t.type === 'text')  return acc + (v.text_value && v.text_value.trim() ? 1 : 0)
      if (t.type === 'image') return acc + ((v.photo_id || v.image_storage_path) ? 1 : 0)
      return acc
    }, 0)
  }, [tags, valuesByTag])

  if (loading) {
    return (
      <section className="bg-white border border-gray-200 rounded-xl p-8">
        <div className="flex justify-center">
          <Loader2 className="h-6 w-6 text-rose-400 animate-spin" />
        </div>
      </section>
    )
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-visible">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <TagIcon className="h-4 w-4 text-rose-500" />
            Valores das tags para este cliente
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Esses dados entram automaticamente em qualquer template de PDF gerado.
          </p>
        </div>
        {tags.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">
              {filledCount}/{tags.length} preenchida{tags.length !== 1 ? 's' : ''}
            </div>
            <button
              onClick={reload}
              title="Recarregar"
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4 sm:p-5">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 mb-4">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {tags.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
              <Inbox className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-700">Nenhuma tag cadastrada</p>
            <p className="text-xs text-gray-500 mt-1">
              Crie tags em <span className="text-rose-600">Documentos → Tags</span> para começar.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tags.map(tag => (
              tag.type === 'text'
                ? <TextTagRow
                    key={tag.id}
                    tag={tag}
                    clientId={clientId}
                    value={valuesByTag[tag.id]}
                    sources={textSources}
                    onUpdate={v => updateLocal(tag.id, v)}
                  />
                : <ImageTagRow
                    key={tag.id}
                    tag={tag}
                    clientId={clientId}
                    value={valuesByTag[tag.id]}
                    onUpdate={v => updateLocal(tag.id, v)}
                  />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   Card base — header + area
// ═══════════════════════════════════════════════════════════════════════

function TagRowShell({
  icon: Icon, iconColor, title, description, status, children,
  tone = 'default',
}: {
  icon: any
  iconColor: string
  title: string
  description?: string | null
  status: SaveStatus
  children: React.ReactNode
  tone?: 'default' | 'filled'
}) {
  const border = tone === 'filled' ? 'border-gray-200' : 'border-gray-200'
  return (
    <div className={`border ${border} rounded-xl overflow-visible bg-white transition-shadow hover:shadow-sm`}>
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
            {description && (
              <p className="text-[11px] text-gray-500 mt-0.5 leading-snug line-clamp-2">{description}</p>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 pt-1"><StatusDot status={status} /></div>
      </div>

      {/* Area */}
      <div className="px-4 pb-4">{children}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   TextTagRow
// ═══════════════════════════════════════════════════════════════════════

function TextTagRow({
  tag, clientId, value, sources, onUpdate,
}: {
  tag: DocumentTag
  clientId: string
  value: ClientTagValue | undefined
  sources: TextImportSourceOption[]
  onUpdate: (v: ClientTagValue | null) => void
}) {
  const [text, setText] = useState(value?.text_value ?? '')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [menuOpen, setMenuOpen] = useState(false)
  const importBtnRef = useRef<HTMLButtonElement>(null)

  const savedRef = useRef(value?.text_value ?? '')
  const firstRender = useRef(true)

  // Autosave debounced (800ms)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    if (text === savedRef.current) return
    setStatus('saving')
    const handle = setTimeout(async () => {
      try {
        const saved = await documentsService.setClientTagText(clientId, tag.id, text || null)
        savedRef.current = text
        onUpdate(saved)
        setStatus('saved')
        setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 1600)
      } catch {
        setStatus('error')
      }
    }, 800)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const handleImport = (opt: TextImportSourceOption) => {
    if (opt.value) setText(opt.value)
    setMenuOpen(false)
  }

  const handleClear = async () => {
    if (!value) { setText(''); return }
    try {
      await documentsService.clearClientTagValue(clientId, tag.id)
      savedRef.current = ''
      setText('')
      onUpdate(null)
    } catch {
      setStatus('error')
    }
  }

  const hasValue = !!text.trim()

  return (
    <TagRowShell
      icon={TypeIcon}
      iconColor="text-sky-600 bg-sky-50"
      title={tag.name}
      description={tag.description}
      status={status}
      tone={hasValue ? 'filled' : 'default'}
    >
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Digite o valor deste cliente..."
        rows={2}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-rose-400/40 focus:border-rose-400 transition-colors bg-gray-50/30 focus:bg-white"
      />

      <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
        <div className="flex items-center gap-1 relative">
          <button
            ref={importBtnRef}
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${
              menuOpen
                ? 'bg-rose-100 text-rose-700'
                : 'text-rose-600 hover:bg-rose-50'
            }`}
          >
            <DownloadIcon className="h-3 w-3" /> Importar de
            <ChevronDown className={`h-3 w-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>
          {hasValue && (
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 px-2 py-1.5 rounded-md hover:bg-red-50 transition-colors"
              title="Limpar valor"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-400">
          {text.length > 0 ? `${text.length} caracteres` : ''}
        </span>
      </div>

      {menuOpen && (
        <ImportMenuPortal
          anchor={importBtnRef.current}
          sources={sources}
          onPick={handleImport}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </TagRowShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   Import menu — renderizado em portal, posicionado via getBoundingClientRect
// ═══════════════════════════════════════════════════════════════════════

function ImportMenuPortal({
  anchor, sources, onPick, onClose,
}: {
  anchor: HTMLButtonElement | null
  sources: TextImportSourceOption[]
  onPick: (opt: TextImportSourceOption) => void
  onClose: () => void
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Calcula posição relativa à viewport. Reposiciona em resize/scroll.
  useEffect(() => {
    if (!anchor) return
    const compute = () => {
      const rect = anchor.getBoundingClientRect()
      const menuWidth = 320
      const menuMaxHeight = 380
      const viewportH = window.innerHeight

      let top = rect.bottom + 4
      // Se não couber abaixo, abre acima
      if (top + menuMaxHeight > viewportH - 10) {
        top = Math.max(10, rect.top - menuMaxHeight - 4)
      }
      let left = rect.left
      // Evita estourar à direita
      if (left + menuWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - menuWidth - 10)
      }
      setPos({ top, left, width: menuWidth })
    }
    compute()

    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [anchor])

  // Click fora / Esc fecha
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchor && !anchor.contains(e.target as Node)
      ) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  // Agrupa
  const groups = useMemo(() => {
    const g: Record<string, { label: string; items: TextImportSourceOption[] }> = {}
    for (const s of sources) {
      if (!g[s.group]) g[s.group] = { label: s.groupLabel, items: [] }
      g[s.group].items.push(s)
    }
    return g
  }, [sources])

  if (!pos) return null

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[100] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: 380,
      }}
    >
      <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
        {Object.keys(groups).length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">
            Nenhuma fonte disponível para este cliente.
          </div>
        ) : (
          Object.entries(groups).map(([key, group], i) => (
            <div key={key} className={i > 0 ? 'border-t border-gray-100' : ''}>
              <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {group.label}
              </p>
              {group.items.map(item => {
                const disabled = !item.value
                return (
                  <button
                    key={item.key}
                    disabled={disabled}
                    onClick={() => onPick(item)}
                    className={`w-full text-left px-3 py-2 transition-colors ${
                      disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:bg-rose-50'
                    }`}
                  >
                    <p className="text-xs font-medium text-gray-800">{item.label}</p>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5">
                      {item.value ? item.value : <span className="italic">sem valor</span>}
                    </p>
                  </button>
                )
              })}
              <div className="h-1" />
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   ImageTagRow
// ═══════════════════════════════════════════════════════════════════════

function ImageTagRow({
  tag, clientId, value, onUpdate,
}: {
  tag: DocumentTag
  clientId: string
  value: ClientTagValue | undefined
  onUpdate: (v: ClientTagValue | null) => void
}) {
  const [showDialog, setShowDialog] = useState(false)
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [loadingThumb, setLoadingThumb] = useState(false)
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setThumbUrl(null)
      if (!value) return
      if (value.image_storage_path) {
        setLoadingThumb(true)
        try {
          const url = await documentsService.getSignedTagImageUrl(value.image_storage_path)
          if (!cancelled) setThumbUrl(url)
        } catch {
          if (!cancelled) setThumbUrl(null)
        } finally {
          if (!cancelled) setLoadingThumb(false)
        }
      } else if (value.photo_id) {
        setLoadingThumb(true)
        try {
          const photos = await documentsService.listClientPhotos(clientId)
          const found = photos.find(p => p.id === value.photo_id)
          if (!cancelled) setThumbUrl(found?.url || null)
        } catch {
          if (!cancelled) setThumbUrl(null)
        } finally {
          if (!cancelled) setLoadingThumb(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [value?.id, value?.image_storage_path, value?.photo_id, clientId])

  const handleSelect = async (result: ImageDialogResult) => {
    setStatus('saving')
    try {
      let saved: ClientTagValue
      if (result.kind === 'photo') {
        saved = await documentsService.setClientTagPhoto(clientId, tag.id, result.photoId)
      } else {
        saved = await documentsService.setClientTagImageUpload(clientId, tag.id, result.file)
      }
      onUpdate(saved)
      setShowDialog(false)
      setStatus('saved')
      setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 1600)
    } catch (e: any) {
      setStatus('error')
      throw e
    }
  }

  const handleClear = async () => {
    setStatus('saving')
    try {
      await documentsService.clearClientTagValue(clientId, tag.id)
      onUpdate(null)
      setStatus('saved')
      setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 1600)
    } catch {
      setStatus('error')
    }
  }

  const hasValue = !!value && (!!value.photo_id || !!value.image_storage_path)
  const sourceLabel = value?.image_storage_path
    ? 'Imagem enviada por upload'
    : value?.photo_id
      ? 'Foto da galeria do cliente'
      : null

  return (
    <>
      <TagRowShell
        icon={ImageIcon}
        iconColor="text-violet-600 bg-violet-50"
        title={tag.name}
        description={tag.description}
        status={status}
        tone={hasValue ? 'filled' : 'default'}
      >
        <div className="flex items-center gap-4">
          <div className="h-24 w-24 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
            {loadingThumb ? (
              <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
            ) : thumbUrl ? (
              <img src={thumbUrl} alt={tag.name} className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-7 w-7 text-gray-300" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {hasValue ? (
              <p className="text-xs text-gray-500">{sourceLabel}</p>
            ) : (
              <p className="text-xs text-gray-400 italic">Nenhuma imagem selecionada</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button
                onClick={() => setShowDialog(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {hasValue ? 'Trocar imagem' : 'Escolher imagem'}
              </button>
              {hasValue && (
                <button
                  onClick={handleClear}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 px-2 py-1.5 rounded-md hover:bg-red-50 transition-colors"
                  title="Remover imagem"
                >
                  <Trash2 className="h-3 w-3" /> Remover
                </button>
              )}
            </div>
          </div>
        </div>
      </TagRowShell>

      {showDialog && (
        <TagValueImageDialog
          clientId={clientId}
          tagName={tag.name}
          currentPhotoId={value?.photo_id ?? null}
          onClose={() => setShowDialog(false)}
          onSelect={handleSelect}
        />
      )}
    </>
  )
}