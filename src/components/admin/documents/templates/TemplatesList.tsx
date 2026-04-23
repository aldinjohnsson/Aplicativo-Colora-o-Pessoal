// src/components/admin/documents/templates/TemplatesList.tsx
//
// Grade de templates. Cada card mostra:
//   • Miniatura da primeira página do PDF (gerada em tempo real no cliente)
//   • Nome, descrição, contagem de páginas
//   • Ações: Abrir editor, Ativar/Desativar, Excluir
// Botão principal "Novo template" abre o TemplateCreateDialog.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Layers, Eye, EyeOff, Trash2, AlertCircle,
  FileText, ExternalLink, Loader2, Inbox, Pencil,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { renderPdfPageToDataURL } from '../lib/pdfUtils'
import type { DocumentTemplate } from '../types'
import { TemplateCreateDialog } from './TemplateCreateDialog'

// ── Btn ───────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, className = '',
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
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ─── Confirm modal (excluir) ─────────────────────────────────────────

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
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
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

// ─── Rename modal (simples) ──────────────────────────────────────────

function RenameTemplateModal({
  template, onClose, onSaved,
}: {
  template: DocumentTemplate
  onClose: () => void
  onSaved: (t: DocumentTemplate) => void
}) {
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const updated = await documentsService.updateTemplate(template.id, {
        name: name.trim(),
        description: description.trim() || null,
      })
      onSaved(updated)
    } catch (e: any) {
      setError(e?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="font-semibold text-gray-900">Editar template</p>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Nome</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={140}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Descrição</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                maxLength={300}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}
          </div>
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end">
            <Btn variant="outline" onClick={onClose} disabled={saving}>Cancelar</Btn>
            <Btn type="submit" variant="primary" loading={saving}>Salvar</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   TemplatesList (main)
// ═══════════════════════════════════════════════════════════════════════

export function TemplatesList() {
  const navigate = useNavigate()

  const [templates, setTemplates] = useState<DocumentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<DocumentTemplate | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DocumentTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Load ──
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await documentsService.listTemplates({ includeInactive: true })
      setTemplates(list)
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar templates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => ({
    total: templates.length,
    active: templates.filter(t => t.is_active).length,
  }), [templates])

  const visible = useMemo(
    () => showInactive ? templates : templates.filter(t => t.is_active),
    [templates, showInactive],
  )

  // ── Handlers ──
  const handleCreated = (tpl: DocumentTemplate) => {
    setTemplates(prev => [tpl, ...prev])
    setShowCreate(false)
    // Navega direto ao editor para facilitar o fluxo
    navigate(`/admin/documents/templates/${tpl.id}`)
  }

  const handleUpdated = (tpl: DocumentTemplate) => {
    setTemplates(prev => prev.map(t => t.id === tpl.id ? tpl : t))
    setEditing(null)
  }

  const handleToggleActive = async (tpl: DocumentTemplate) => {
    const newActive = !tpl.is_active
    setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, is_active: newActive } : t))
    try {
      await documentsService.updateTemplate(tpl.id, { is_active: newActive })
    } catch (e: any) {
      setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, is_active: !newActive } : t))
      alert(e?.message || 'Erro ao alterar status')
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await documentsService.deleteTemplate(pendingDelete.id)
      setTemplates(prev => prev.filter(t => t.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (e: any) {
      alert(e?.message || 'Erro ao excluir')
    } finally {
      setDeleting(false)
    }
  }

  // ── Render ──
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
            <Layers className="h-5 w-5 text-rose-500" />
            Templates de PDF
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {stats.active} ativo{stats.active !== 1 ? 's' : ''}
            {stats.total > stats.active && (
              <span className="text-gray-400"> · {stats.total - stats.active} inativo{stats.total - stats.active !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="accent-rose-500 h-3.5 w-3.5"
            />
            Mostrar inativos
          </label>
          <Btn variant="primary" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Novo template
          </Btn>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
            <Inbox className="h-6 w-6 text-rose-400" />
          </div>
          {templates.length === 0 ? (
            <>
              <p className="font-semibold text-gray-800">Nenhum template ainda</p>
              <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
                Comece enviando um PDF base. Em seguida, abra o editor e posicione
                as tags que você criou em cada página.
              </p>
              <div className="mt-4">
                <Btn variant="primary" onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4" /> Criar primeiro template
                </Btn>
              </div>
            </>
          ) : (
            <>
              <p className="font-semibold text-gray-800">Nenhum template ativo</p>
              <p className="text-sm text-gray-500 mt-1">Marque "Mostrar inativos" para ver os demais.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(tpl => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onOpen={() => navigate(`/admin/documents/templates/${tpl.id}`)}
              onEdit={() => setEditing(tpl)}
              onToggle={() => handleToggleActive(tpl)}
              onDelete={() => setPendingDelete(tpl)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <TemplateCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {editing && (
        <RenameTemplateModal
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={handleUpdated}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteModal
          title={`Excluir "${pendingDelete.name}"?`}
          message="Esta ação não pode ser desfeita. O PDF base e todos os elementos posicionados serão removidos."
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
          busy={deleting}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   TemplateCard — miniatura + ações
// ═══════════════════════════════════════════════════════════════════════

function TemplateCard({
  template, onOpen, onEdit, onToggle, onDelete,
}: {
  template: DocumentTemplate
  onOpen: () => void
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const [thumb, setThumb] = useState<string | null>(null)
  const [thumbError, setThumbError] = useState(false)

  // Gera thumbnail: baixa o PDF, renderiza a primeira página em dataURL
  useEffect(() => {
    if (!template.base_pdf_path) return
    let cancelled = false
    setThumb(null)
    setThumbError(false)

    ;(async () => {
      try {
        const blob = await documentsService.downloadBaseTemplate(template.base_pdf_path)
        const buf = await blob.arrayBuffer()
        const dataUrl = await renderPdfPageToDataURL(buf, 1, 480)
        if (!cancelled) setThumb(dataUrl)
      } catch {
        if (!cancelled) setThumbError(true)
      }
    })()

    return () => { cancelled = true }
  }, [template.base_pdf_path])

  // Proporção pra o thumbnail não distorcer, mesmo antes de carregar
  const ratio = template.page_width_pt > 0 && template.page_height_pt > 0
    ? `${template.page_width_pt} / ${template.page_height_pt}`
    : '210 / 297'

  return (
    <div className={`group bg-white border rounded-xl overflow-hidden flex flex-col transition-all ${
      template.is_active ? 'border-gray-200 hover:border-rose-300 hover:shadow-md' : 'border-gray-100 opacity-70'
    }`}>
      {/* Thumbnail */}
      <button
        onClick={onOpen}
        className="relative w-full bg-gray-50 border-b border-gray-100"
        style={{ aspectRatio: ratio }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt={template.name}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : thumbError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <FileText className="h-8 w-8 mb-1" />
            <span className="text-xs">Preview indisponível</span>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {template.page_count > 1 && (
          <span className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/70 text-white">
            {template.page_count} págs
          </span>
        )}
        {!template.is_active && (
          <span className="absolute top-2 left-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-gray-100 text-gray-500">
            Inativo
          </span>
        )}
      </button>

      {/* Body */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate" title={template.name}>{template.name}</p>
          {template.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{template.description}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 mt-3 flex-wrap">
          <Btn variant="outline" size="sm" onClick={onOpen} className="flex-1">
            <ExternalLink className="h-3.5 w-3.5" /> Abrir editor
          </Btn>
          <button
            onClick={onEdit}
            title="Renomear"
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onToggle}
            title={template.is_active ? 'Desativar' : 'Ativar'}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            {template.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          <button
            onClick={onDelete}
            title="Excluir"
            className="p-2 rounded-lg text-red-500 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
