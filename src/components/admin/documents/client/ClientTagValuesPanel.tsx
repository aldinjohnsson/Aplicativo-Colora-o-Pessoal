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
  AlertCircle, Loader2, Inbox, RefreshCw,
  Sparkles,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import type {
  DocumentTag, ClientTagValue, TextImportSourceOption,
} from '../types'
import { TagValueImageDialog, ImageDialogResult } from './TagValueImageDialog'
import { GenerateAiImageDialog } from './GenerateAiImageDialog'

// ─── Save status ──────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ─── Vínculo a fonte do sistema ───────────────────────────────────────

interface AiInfoLink {
  templateId: string
  templateName: string
  templateType: 'text' | 'image'
  selectedLabel: string
  imagePath: string | null
  imageUrl: string | null
}

/**
 * Lê o vínculo de uma DocumentTag.
 *
 * Suporta:
 *  • Formato novo (canônico):
 *      { source: 'import_source', key: '<chave>' }
 *  • Formato antigo (compat):
 *      { source: 'ai_info_template', templateId: '<uuid>' }
 *      → equivalente a key: 'ai_info:<uuid>'
 *
 * Retorna:
 *  • kind='ai_info_image' → doc-tag imagem que precisa do arquivo
 *    do catálogo AI Info (usa aiInfoLinks pra resolver bytes/URL)
 *  • kind='import_source' → doc-tag texto que pega a string via
 *    getTextImportSources (textSources já carregado)
 *  • null → tag manual (não vinculada)
 */
type ParsedTagLink =
  | { kind: 'ai_info_image'; templateId: string }
  | { kind: 'import_source'; key: string }
  | { kind: 'ai_generated' }
  | null

function parseTagLink(tag: DocumentTag): ParsedTagLink {
  const hint = (tag as any).default_hint
  if (!hint || typeof hint !== 'object') return null

  if (hint.source === 'ai_generated') {
    // promptId pode existir em tags antigas — ignoramos, agora é escolhido por cliente.
    if (tag.type === 'image') return { kind: 'ai_generated' }
    return null   // ai_generated só vale pra image
  }

  if (hint.source === 'ai_info_template' && typeof hint.templateId === 'string' && hint.templateId) {
    if (tag.type === 'image') return { kind: 'ai_info_image', templateId: hint.templateId }
    return { kind: 'import_source', key: `ai_info:${hint.templateId}` }
  }

  if (hint.source === 'import_source' && typeof hint.key === 'string' && hint.key) {
    if (tag.type === 'image') {
      const m = /^ai_info:(.+)$/.exec(hint.key)
      if (m) return { kind: 'ai_info_image', templateId: m[1] }
      return null
    }
    return { kind: 'import_source', key: hint.key }
  }

  return null
}

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
  const [aiInfoLinks, setAiInfoLinks] = useState<Record<string, AiInfoLink>>({})  // chave: templateId
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isExpanded, setIsExpanded] = useState(false)

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

      // Resolve os vínculos AI Info imagem (precisa dos templates pra ter URL).
      // Tags texto vinculadas resolvem via textSources direto, sem chamada extra.
      const linkedTplIdsForImage = Array.from(new Set(
        tagsList
          .map(t => parseTagLink(t))
          .filter((x): x is { kind: 'ai_info_image'; templateId: string } => x?.kind === 'ai_info_image')
          .map(x => x.templateId)
      ))
      if (linkedTplIdsForImage.length > 0) {
        const links = await documentsService.resolveAiInfoLinks(clientId, linkedTplIdsForImage)
        setAiInfoLinks(links)
      } else {
        setAiInfoLinks({})
      }
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
    const sourceByKey: Record<string, TextImportSourceOption> = {}
    for (const s of textSources) sourceByKey[s.key] = s

    return tags.reduce((acc, t) => {
      const link = parseTagLink(t)
      if (link?.kind === 'ai_info_image') {
        const ai = aiInfoLinks[link.templateId]
        return acc + (ai?.imageUrl ? 1 : 0)
      }
      if (link?.kind === 'import_source') {
        const src = sourceByKey[link.key]
        return acc + (src?.value && src.value.trim() ? 1 : 0)
      }
      if (link?.kind === 'ai_generated') {
        // Considera preenchida se a geração já foi salva em client_tag_values.
        const v = valuesByTag[t.id]
        return acc + (v?.image_storage_path ? 1 : 0)
      }
      // manual
      const v = valuesByTag[t.id]
      if (!v) return acc
      if (t.type === 'text')  return acc + (v.text_value && v.text_value.trim() ? 1 : 0)
      if (t.type === 'image') return acc + ((v.photo_id || v.image_storage_path) ? 1 : 0)
      return acc
    }, 0)
  }, [tags, valuesByTag, aiInfoLinks, textSources])

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
      {/* Header — clicável para expandir/colapsar */}
      <button
        type="button"
        onClick={() => setIsExpanded(v => !v)}
        className="w-full px-5 py-4 flex items-start justify-between gap-3 flex-wrap text-left hover:bg-gray-50/60 transition-colors"
      >
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <TagIcon className="h-4 w-4 text-rose-500" />
            Tags da cliente
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Dados usados automaticamente em qualquer PDF gerado.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          {tags.length > 0 && (
            <div className="text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">
              {filledCount}/{tags.length} preenchida{tags.length !== 1 ? 's' : ''}
            </div>
          )}
          <button
            onClick={e => { e.stopPropagation(); reload() }}
            title="Recarregar"
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Body — visível só quando expandido */}
      {isExpanded && (
        <div className="border-t border-gray-100 p-4 sm:p-5">
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
              {tags.map(tag => {
                const link = parseTagLink(tag)
                if (link?.kind === 'ai_generated') {
                  return (
                    <GeneratedTagRow
                      key={tag.id}
                      clientId={clientId}
                      tag={tag}
                      value={valuesByTag[tag.id]}
                      onUpdate={v => updateLocal(tag.id, v)}
                    />
                  )
                }
                if (link) {
                  return (
                    <LinkedTagRow
                      key={tag.id}
                      clientId={clientId}
                      tag={tag}
                      link={link}
                      aiInfoLink={link.kind === 'ai_info_image' ? aiInfoLinks[link.templateId] : null}
                      textSources={textSources}
                    />
                  )
                }
                return tag.type === 'text'
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
              })}
            </div>
          )}
        </div>
      )}
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
      <div
        className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-colors cursor-pointer
          ${hasValue ? 'border-gray-200 hover:border-rose-300 hover:bg-rose-50/30' : 'border-dashed border-gray-200 hover:border-rose-300 hover:bg-rose-50/20'}`}
        onClick={() => setShowDialog(true)}
        title="Clique para alterar imagem"
      >
        {/* Thumbnail */}
        <div className="h-14 w-14 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
          {loadingThumb ? (
            <Loader2 className="h-4 w-4 text-gray-300 animate-spin" />
          ) : thumbUrl ? (
            <img src={thumbUrl} alt={tag.name} className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-gray-300" />
          )}
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {tag.name}
            {!hasValue && <span className="ml-1.5 text-[11px] font-normal text-gray-400 italic">não definida</span>}
          </p>
          {hasValue && sourceLabel && (
            <p className="text-[11px] text-gray-400 mt-0.5">{sourceLabel}</p>
          )}
        </div>

        <StatusDot status={status} />
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

// ═══════════════════════════════════════════════════════════════════════
//   LinkedTagRow — tag vinculada a uma fonte do sistema (read-only)
// ═══════════════════════════════════════════════════════════════════════
//
// Renderiza a tag em modo leitura, exibindo o valor que vai entrar no PDF
// (label, ou imagem) puxado da fonte vinculada. Pra editar, o admin precisa
// ir até a origem do dado (geralmente a aba Resultado).

function LinkedTagRow({
  clientId, tag, link, aiInfoLink, textSources,
}: {
  clientId: string
  tag: DocumentTag
  link: ParsedTagLink
  aiInfoLink: AiInfoLink | null      // só pra link.kind === 'ai_info_image'
  textSources: TextImportSourceOption[]
}) {
  // ── Caminho A: imagem vinculada a AI Info ──
  if (link?.kind === 'ai_info_image') {
    const hasResolved  = !!aiInfoLink && !!aiInfoLink.imageUrl

    return (
      <div className={`flex items-center gap-3 px-3 py-3 rounded-xl border
        ${hasResolved ? 'border-gray-200' : 'border-dashed border-gray-200'}`}>
        {/* Thumbnail */}
        <div className="h-14 w-14 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
          {aiInfoLink?.imageUrl ? (
            <img src={aiInfoLink.imageUrl} alt={aiInfoLink.selectedLabel} className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-gray-300" />
          )}
        </div>

        {/* Name + label */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {tag.name}
            {!hasResolved && (
              <span className="ml-1.5 text-[11px] font-normal text-amber-600 italic">não definida</span>
            )}
          </p>
          {hasResolved && aiInfoLink && (
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">{aiInfoLink.selectedLabel}</p>
          )}
        </div>
      </div>
    )
  }

  // ── Caminho B: texto vinculado a uma fonte (cliente/resultado/AI Info/etc) ──
  if (link?.kind === 'import_source') {
    const source   = textSources.find(s => s.key === link.key) || null
    const value    = source?.value ?? null
    const hasValue = !!value && value.trim() !== ''

    // Label amigável da fonte. Se a fonte sumiu do catálogo (ex: AI Info
    // removido), tentamos inferir só pra explicar pro admin.
    const sourceLabel = source?.label || '(fonte não encontrada)'
    const groupLabel  = source?.groupLabel || ''

    return (
      <TagRowShell
        icon={TypeIcon}
        iconColor="text-sky-600 bg-sky-50"
        title={tag.name}
        description={tag.description}
        status="idle"
        tone={hasValue ? 'filled' : 'default'}
      >
        <div className="space-y-2">
          {!source ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              Fonte original não foi encontrada — pode ter sido removida.
            </p>
          ) : !hasValue ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {groupLabel === 'Informações da análise'
                ? 'Cliente ainda não preencheu essa tag em Resultado'
                : `Sem valor em ${groupLabel || 'origem'} → ${sourceLabel}`}
            </p>
          ) : (
            <div className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-800 whitespace-pre-wrap break-words">
              {value}
            </div>
          )}
        </div>
      </TagRowShell>
    )
  }

  // ── Não deveria chegar aqui (sem vínculo) ──
  return null
}

// ═══════════════════════════════════════════════════════════════════════
//   GeneratedTagRow — tag tipo imagem gerada por IA (gpt-image-1)
// ═══════════════════════════════════════════════════════════════════════
//
// Estado:
//  • sem geração ainda  → CTA "Gerar imagem" abre GenerateAiImageDialog
//  • já gerada          → preview + botões "Regenerar" e "Remover"
//
// Após gerar, faz reload local via onUpdate (mesma assinatura usada pelas
// outras Rows). O image_storage_path já foi gravado pela Edge Function.

function GeneratedTagRow({
  clientId, tag, value, onUpdate,
}: {
  clientId: string
  tag: DocumentTag
  value: ClientTagValue | undefined
  onUpdate: (next: ClientTagValue | undefined) => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [imgUrl, setImgUrl]         = useState<string | null>(null)

  const hasImage = !!value?.image_storage_path

  // Resolve signed URL pra preview quando há imagem
  useEffect(() => {
    let cancelled = false
    if (!hasImage || !value?.image_storage_path) { setImgUrl(null); return }
    documentsService.getSignedTagImageUrl(value.image_storage_path)
      .then(url => { if (!cancelled) setImgUrl(url) })
      .catch(() => { if (!cancelled) setImgUrl(null) })
    return () => { cancelled = true }
  }, [hasImage, value?.image_storage_path])

  const handleGenerated = async (storagePath: string) => {
    // A Edge Function já fez upsert. Re-busca o ClientTagValue pra sincronizar UI.
    try {
      const list = await documentsService.listClientTagValues(clientId)
      const updated = list.find(v => v.tag_id === tag.id)
      onUpdate(updated)
      setDialogOpen(false)
    } catch {
      // Mesmo se a re-busca falhar, fecha o modal — o admin pode dar refresh.
      setDialogOpen(false)
    }
  }

  return (
    <>
      <div
        className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-colors cursor-pointer
          ${hasImage ? 'border-gray-200 hover:border-fuchsia-300 hover:bg-fuchsia-50/20' : 'border-dashed border-gray-200 hover:border-fuchsia-300 hover:bg-fuchsia-50/20'}`}
        onClick={() => setDialogOpen(true)}
        title={hasImage ? 'Clique para regenerar' : 'Clique para gerar'}
      >
        {/* Thumbnail */}
        <div className="h-14 w-14 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
          {hasImage ? (
            imgUrl ? (
              <img src={imgUrl} alt={tag.name} className="h-full w-full object-cover" />
            ) : (
              <Loader2 className="h-4 w-4 text-gray-300 animate-spin" />
            )
          ) : (
            <Sparkles className="h-5 w-5 text-fuchsia-300" />
          )}
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {tag.name}
            {!hasImage && <span className="ml-1.5 text-[11px] font-normal text-gray-400 italic">não gerada</span>}
          </p>
          {hasImage && (
            <p className="text-[11px] text-fuchsia-600 mt-0.5">Gerada por IA</p>
          )}
        </div>
      </div>

      {dialogOpen && (
        <GenerateAiImageDialog
          clientId={clientId}
          tagId={tag.id}
          tagName={tag.name}
          onClose={() => setDialogOpen(false)}
          onGenerated={handleGenerated}
        />
      )}
    </>
  )
}