// src/components/admin/documents/client/ClientTagValuesPanel.tsx
//
// Painel que lista todas as tags ativas e permite vincular, para ESTE cliente:
//   • tags de texto  → textarea com auto-save + menu "Importar de"
//   • tags de imagem → botão que abre TagValueImageDialog (fotos existentes ou upload)
//
// Esses valores ficam em client_tag_values e são consumidos pelo motor de
// geração na Fase 5 (template + valores → PDF carimbado).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Tag as TagIcon, Type as TypeIcon, Image as ImageIcon,
  Download as DownloadIcon, ChevronDown, Check, AlertCircle,
  Trash2, Loader2, Inbox,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import type {
  DocumentTag, ClientTagValue, TextImportSourceOption,
} from '../types'
import { TagValueImageDialog, ImageDialogResult } from './TagValueImageDialog'

// ── Btn inline ─────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'sm',
  loading = false, disabled = false, type = 'button', className = '',
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:   'text-gray-600 hover:bg-gray-100',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ─── Save status ──────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function StatusBadge({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  const map = {
    saving: { label: 'Salvando...', className: 'text-gray-400', Icon: Loader2, spin: true },
    saved:  { label: 'Salvo',       className: 'text-green-600', Icon: Check, spin: false },
    error:  { label: 'Erro',        className: 'text-red-600',   Icon: AlertCircle, spin: false },
  }[status]
  const Icon = map.Icon
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${map.className}`}>
      <Icon className={`h-3 w-3 ${map.spin ? 'animate-spin' : ''}`} />
      {map.label}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   ClientTagValuesPanel
// ═══════════════════════════════════════════════════════════════════════

interface Props {
  clientId: string
}

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

  const updateLocalValue = (tagId: string, value: ClientTagValue | null) => {
    setValuesByTag(prev => {
      const copy = { ...prev }
      if (value) copy[tagId] = value
      else delete copy[tagId]
      return copy
    })
  }

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex justify-center py-6">
          <div className="animate-spin h-7 w-7 border-2 border-rose-400 border-t-transparent rounded-full" />
        </div>
      </section>
    )
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <TagIcon className="h-4 w-4 text-rose-500" />
          Valores das tags para este cliente
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Preencha os dados deste cliente. Eles serão usados automaticamente em
          qualquer template que referencie as tags abaixo.
        </p>
      </div>

      {/* Body */}
      <div className="p-5">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 mb-4">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {tags.length === 0 ? (
          <div className="text-center py-8">
            <Inbox className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700">Nenhuma tag cadastrada ainda</p>
            <p className="text-xs text-gray-500 mt-1">
              Crie tags em <span className="font-mono">Documentos → Tags</span> para começar.
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
                    onUpdate={v => updateLocalValue(tag.id, v)}
                  />
                : <ImageTagRow
                    key={tag.id}
                    tag={tag}
                    clientId={clientId}
                    value={valuesByTag[tag.id]}
                    onUpdate={v => updateLocalValue(tag.id, v)}
                  />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   TextTagRow  (com autosave debounced)
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
  const [showImport, setShowImport] = useState(false)
  const importBtnRef = useRef<HTMLButtonElement>(null)

  const savedRef = useRef(value?.text_value ?? '')
  const firstRender = useRef(true)

  // Debounced save
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
        setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 1800)
      } catch {
        setStatus('error')
      }
    }, 800)

    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const handleImport = (opt: TextImportSourceOption) => {
    if (opt.value) setText(opt.value)
    setShowImport(false)
  }

  const handleClear = async () => {
    if (!value) { setText(''); return }
    try {
      await documentsService.clearClientTagValue(clientId, tag.id)
      savedRef.current = ''
      setText('')
      onUpdate(null)
    } catch (e) {
      setStatus('error')
    }
  }

  // Agrupa fontes por group
  const groupedSources = useMemo(() => {
    const g: Record<string, { label: string; items: TextImportSourceOption[] }> = {}
    for (const s of sources) {
      if (!g[s.group]) g[s.group] = { label: s.groupLabel, items: [] }
      g[s.group].items.push(s)
    }
    return g
  }, [sources])

  return (
    <div className="border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-sky-50 text-sky-500 flex items-center justify-center flex-shrink-0">
          <TypeIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-medium text-gray-900 truncate">{tag.name}</p>
            <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-gray-100 text-gray-500">{tag.slug}</code>
          </div>
          {tag.description && (
            <p className="text-xs text-gray-500 mb-2">{tag.description}</p>
          )}

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Digite o valor deste cliente..."
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
          />

          <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
            <div className="flex items-center gap-2 relative">
              <button
                ref={importBtnRef}
                onClick={() => setShowImport(v => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 font-medium px-2 py-1 rounded-md hover:bg-rose-50"
              >
                <DownloadIcon className="h-3 w-3" /> Importar de <ChevronDown className="h-3 w-3" />
              </button>
              {text && (
                <button
                  onClick={handleClear}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 px-1.5 py-1 rounded-md hover:bg-red-50"
                  title="Limpar valor"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
              {showImport && (
                <ImportFromMenu
                  groups={groupedSources}
                  onPick={handleImport}
                  onClose={() => setShowImport(false)}
                  anchorRef={importBtnRef}
                />
              )}
            </div>
            <StatusBadge status={status} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Import menu (dropdown) ────────────────────────────────────────────

function ImportFromMenu({
  groups, onPick, onClose, anchorRef,
}: {
  groups: Record<string, { label: string; items: TextImportSourceOption[] }>
  onPick: (opt: TextImportSourceOption) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLButtonElement>
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose, anchorRef])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const isEmpty = Object.keys(groups).length === 0

  return (
    <div
      ref={menuRef}
      className="absolute left-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded-xl shadow-xl w-80 max-h-96 overflow-y-auto"
    >
      {isEmpty ? (
        <div className="px-4 py-6 text-center text-sm text-gray-500">
          Nenhuma fonte disponível para este cliente.
        </div>
      ) : (
        Object.entries(groups).map(([key, group]) => (
          <div key={key} className="py-2 border-b border-gray-100 last:border-b-0">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {group.label}
            </p>
            {group.items.map(item => {
              const disabled = !item.value
              return (
                <button
                  key={item.key}
                  disabled={disabled}
                  onClick={() => onPick(item)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                    disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-rose-50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800">{item.label}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {item.value ? item.value : '(vazio)'}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        ))
      )}
    </div>
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

  // Resolve a URL do thumbnail atual (pode vir de photo_id OU image_storage_path)
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
        // Busca o storage_path da foto referenciada
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
      setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 1800)
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
      setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 1800)
    } catch {
      setStatus('error')
    }
  }

  const hasValue = !!value && (!!value.photo_id || !!value.image_storage_path)
  const sourceLabel = value?.image_storage_path
    ? 'Upload avulso'
    : value?.photo_id
      ? 'Foto da galeria do cliente'
      : null

  return (
    <>
      <div className="border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center flex-shrink-0">
            <ImageIcon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="font-medium text-gray-900 truncate">{tag.name}</p>
              <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-gray-100 text-gray-500">{tag.slug}</code>
            </div>
            {tag.description && (
              <p className="text-xs text-gray-500 mb-2">{tag.description}</p>
            )}

            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {/* thumbnail */}
              <div className="h-16 w-16 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {loadingThumb ? (
                  <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />
                ) : thumbUrl ? (
                  <img src={thumbUrl} alt={tag.name} className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-gray-300" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                {hasValue ? (
                  <p className="text-xs text-gray-500">{sourceLabel}</p>
                ) : (
                  <p className="text-xs text-gray-400 italic">Nenhuma imagem selecionada</p>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Btn variant="outline" size="sm" onClick={() => setShowDialog(true)}>
                    {hasValue ? 'Trocar imagem' : 'Escolher imagem'}
                  </Btn>
                  {hasValue && (
                    <button
                      onClick={handleClear}
                      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 px-1.5 py-1 rounded-md hover:bg-red-50"
                      title="Remover"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                  <div className="ml-auto"><StatusBadge status={status} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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
