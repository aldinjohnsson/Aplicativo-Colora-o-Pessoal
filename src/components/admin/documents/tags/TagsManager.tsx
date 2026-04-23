// src/components/admin/documents/tags/TagsManager.tsx
//
// Lista/CRUD de tags de documento. É a tela principal da sub-aba "Tags"
// dentro de /admin/documents.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Search, Pencil, Trash2, Tag as TagIcon,
  Type as TypeIcon, Image as ImageIcon, EyeOff, Eye,
  AlertCircle, Inbox,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import type { DocumentTag, DocumentTagType } from '../types'
import { TagFormDialog } from './TagFormDialog'

// ── Shared tiny UI (mesmo padrão de PlansManager / FoldersManager) ──

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, className = '',
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:   'text-gray-600 hover:bg-gray-100',
    danger:  'text-red-600 hover:bg-red-50',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ─── ConfirmModal local (destructive delete) ──────────────────────────

function ConfirmDeleteModal({
  title, message, onConfirm, onCancel, busy,
}: {
  title: string; message: string
  onConfirm: () => void; onCancel: () => void
  busy?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="font-semibold text-gray-900">{title}</p>
          <p className="text-sm text-gray-500 mt-1">{message}</p>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end">
          <Btn variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Btn>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
            Excluir
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────

type TypeFilter = 'all' | DocumentTagType

export function TagsManager() {
  const [tags, setTags] = useState<DocumentTag[]>([])
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [showInactive, setShowInactive] = useState(false)

  const [editingTag, setEditingTag] = useState<DocumentTag | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DocumentTag | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ─── Load ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await documentsService.listTags({ includeInactive: true })
      setTags(list)

      // Contagem de uso (quantos elementos referenciam cada tag)
      // Feito em paralelo, sem bloquear a renderização em caso de erro.
      const counts: Record<string, number> = {}
      await Promise.all(
        list.map(async t => {
          try { counts[t.id] = await documentsService.countTagUsage(t.id) }
          catch { counts[t.id] = 0 }
        })
      )
      setUsageCounts(counts)
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar tags')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ─── Derived ───────────────────────────────────────────────────────

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tags.filter(t => {
      if (!showInactive && !t.is_active) return false
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (q) {
        const hit =
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q)
        if (!hit) return false
      }
      return true
    })
  }, [tags, search, typeFilter, showInactive])

  const stats = useMemo(() => ({
    total: tags.length,
    active: tags.filter(t => t.is_active).length,
    text: tags.filter(t => t.type === 'text').length,
    image: tags.filter(t => t.type === 'image').length,
  }), [tags])

  // ─── Actions ───────────────────────────────────────────────────────

  const handleCreated = (tag: DocumentTag) => {
    setTags(prev => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))
    setUsageCounts(prev => ({ ...prev, [tag.id]: 0 }))
    setShowCreate(false)
  }

  const handleUpdated = (tag: DocumentTag) => {
    setTags(prev => prev.map(t => t.id === tag.id ? tag : t))
    setEditingTag(null)
  }

  const handleToggleActive = async (tag: DocumentTag) => {
    const newActive = !tag.is_active
    // otimista
    setTags(prev => prev.map(t => t.id === tag.id ? { ...t, is_active: newActive } : t))
    try {
      await documentsService.setTagActive(tag.id, newActive)
    } catch (e: any) {
      // rollback
      setTags(prev => prev.map(t => t.id === tag.id ? { ...t, is_active: !newActive } : t))
      alert(e?.message || 'Erro ao alterar status da tag')
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await documentsService.deleteTag(pendingDelete.id)
      setTags(prev => prev.filter(t => t.id !== pendingDelete.id))
      setUsageCounts(prev => {
        const copy = { ...prev }
        delete copy[pendingDelete.id]
        return copy
      })
      setPendingDelete(null)
    } catch (e: any) {
      alert(e?.message || 'Erro ao excluir tag')
    } finally {
      setDeleting(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <TagIcon className="h-5 w-5 text-rose-500" />
            Tags de Documento
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {stats.active} ativa{stats.active !== 1 ? 's' : ''}
            {stats.total > stats.active && (
              <span className="text-gray-400"> · {stats.total - stats.active} inativa{stats.total - stats.active !== 1 ? 's' : ''}</span>
            )}
            {stats.total > 0 && (
              <span className="text-gray-400"> · {stats.text} texto, {stats.image} imagem</span>
            )}
          </p>
        </div>
        <Btn variant="primary" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Nova tag
        </Btn>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, slug ou descrição..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
          />
        </div>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {([
            { id: 'all', label: 'Todas' },
            { id: 'text', label: 'Texto' },
            { id: 'image', label: 'Imagem' },
          ] as { id: TypeFilter; label: string }[]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTypeFilter(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                typeFilter === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-600 select-none cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="accent-rose-500 h-3.5 w-3.5"
          />
          Mostrar inativas
        </label>
      </div>

      {/* Erro global */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Lista */}
      {filteredTags.length === 0 ? (
        <EmptyState
          hasAny={tags.length > 0}
          onCreate={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-2">
          {filteredTags.map(tag => (
            <TagRow
              key={tag.id}
              tag={tag}
              usage={usageCounts[tag.id] ?? 0}
              onEdit={() => setEditingTag(tag)}
              onDelete={() => setPendingDelete(tag)}
              onToggleActive={() => handleToggleActive(tag)}
            />
          ))}
        </div>
      )}

      {/* Modais */}
      {showCreate && (
        <TagFormDialog
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={handleCreated}
        />
      )}

      {editingTag && (
        <TagFormDialog
          mode="edit"
          tag={editingTag}
          onClose={() => setEditingTag(null)}
          onSaved={handleUpdated}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteModal
          title={`Excluir "${pendingDelete.name}"?`}
          message={
            (usageCounts[pendingDelete.id] ?? 0) > 0
              ? `Esta tag está em uso em ${usageCounts[pendingDelete.id]} elemento(s) de template. A exclusão será bloqueada — considere desativá-la em vez disso.`
              : 'Esta ação não pode ser desfeita. A tag deixará de existir no catálogo.'
          }
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
          busy={deleting}
        />
      )}
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────

function TagRow({
  tag, usage, onEdit, onDelete, onToggleActive,
}: {
  tag: DocumentTag
  usage: number
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}) {
  const isImage = tag.type === 'image'
  const Icon = isImage ? ImageIcon : TypeIcon
  const typeColor = isImage ? 'text-violet-500 bg-violet-50' : 'text-sky-500 bg-sky-50'

  return (
    <div className={`bg-white border rounded-xl p-4 flex items-start gap-3 transition-opacity ${
      tag.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'
    }`}>
      {/* Ícone do tipo */}
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${typeColor}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900 truncate">{tag.name}</p>
          <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
            {tag.slug}
          </code>
          {!tag.is_active && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-semibold">
              Inativa
            </span>
          )}
        </div>
        {tag.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tag.description}</p>
        )}
        {usage > 0 && (
          <p className="text-[11px] text-gray-400 mt-1">
            Em uso em {usage} elemento{usage !== 1 ? 's' : ''} de template
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onToggleActive}
          title={tag.is_active ? 'Desativar' : 'Ativar'}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        >
          {tag.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
        <Btn variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Editar
        </Btn>
        <button
          onClick={onDelete}
          title="Excluir"
          className="p-2 rounded-lg text-red-500 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function EmptyState({ hasAny, onCreate }: { hasAny: boolean; onCreate: () => void }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
      <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
        <Inbox className="h-6 w-6 text-rose-400" />
      </div>
      {hasAny ? (
        <>
          <p className="font-semibold text-gray-800">Nenhuma tag corresponde aos filtros</p>
          <p className="text-sm text-gray-500 mt-1">Ajuste a busca ou limpe os filtros.</p>
        </>
      ) : (
        <>
          <p className="font-semibold text-gray-800">Nenhuma tag criada ainda</p>
          <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
            Tags são slots reutilizáveis que você vai posicionar dentro de templates de PDF.
            Comece criando tags para os dados que deseja inserir (nome do cliente, cartela, fotos de tecidos, etc.).
          </p>
          <div className="mt-4">
            <Btn variant="primary" onClick={onCreate}>
              <Plus className="h-4 w-4" /> Criar primeira tag
            </Btn>
          </div>
        </>
      )}
    </div>
  )
}
