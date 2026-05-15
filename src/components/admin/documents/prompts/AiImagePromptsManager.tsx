// src/components/admin/documents/prompts/AiImagePromptsManager.tsx
//
// CRUD da aba "Prompts IA" no Documents Hub.
//
// Cada item da lista tem:
//   • nome curto (label)
//   • prompt longo (textarea)
//   • size  (1024x1024 | 1024x1536 | 1536x1024 | auto)
//   • quality (low | medium | high | auto)
//   • is_active
//
// Quando inativo, o prompt não aparece pra escolher em TagFormDialog,
// mas a doc tag que já estava linkada continua sabendo qual prompt era.

import React, { useEffect, useState } from 'react'
import {
  Plus, Sparkles, Trash2, X, Edit2, AlertCircle, ChevronDown, ChevronUp,
  Eye, EyeOff, Save, Loader2,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'

// ── Btn ────────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, type = 'button', className = '',
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

// ── Types ──────────────────────────────────────────────────────────────

interface AiImagePrompt {
  id: string
  name: string
  prompt: string
  model: string
  size: string
  quality: string
  is_active: boolean
  created_at: string
  updated_at: string
}

type Draft = Omit<AiImagePrompt, 'id' | 'created_at' | 'updated_at'> & { id?: string }

const DEFAULT_DRAFT: Draft = {
  name: '',
  prompt: '',
  model: 'gpt-image-1',
  size: '1024x1024',
  quality: 'medium',
  is_active: true,
}

const SIZE_OPTIONS = [
  { value: '1024x1024', label: '1024×1024 (quadrada)' },
  { value: '1024x1536', label: '1024×1536 (retrato)' },
  { value: '1536x1024', label: '1536×1024 (paisagem)' },
  { value: 'auto',      label: 'auto (decide na hora)' },
]
const QUALITY_OPTIONS = [
  { value: 'low',    label: 'low (mais barato)' },
  { value: 'medium', label: 'medium (padrão)' },
  { value: 'high',   label: 'high (caro, mais detalhe)' },
  { value: 'auto',   label: 'auto' },
]

// ─── Component ─────────────────────────────────────────────────────────

export function AiImagePromptsManager() {
  const [items, setItems] = useState<AiImagePrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Modal create / edit
  const [openForm, setOpenForm] = useState<null | { mode: 'create' } | { mode: 'edit'; item: AiImagePrompt }>(null)

  // Confirm delete
  const [pendingDelete, setPendingDelete] = useState<AiImagePrompt | null>(null)
  const [deleting, setDeleting] = useState(false)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await documentsService.listAiImagePrompts({ includeInactive: true })
      setItems(data as AiImagePrompt[])
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar prompts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const filtered = items.filter(p => showInactive || p.is_active)

  const handleSaved = () => {
    setOpenForm(null)
    reload()
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await documentsService.deleteAiImagePrompt(pendingDelete.id)
      setItems(prev => prev.filter(p => p.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (e: any) {
      alert(e?.message || 'Erro ao remover')
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleActive = async (item: AiImagePrompt) => {
    try {
      await documentsService.updateAiImagePrompt(item.id, { is_active: !item.is_active })
      setItems(prev => prev.map(p => p.id === item.id ? { ...p, is_active: !item.is_active } : p))
    } catch (e: any) {
      alert(e?.message || 'Erro ao alternar status')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-fuchsia-50 to-rose-50">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-fuchsia-500 to-rose-500 rounded-xl flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Prompts de Imagem IA</h2>
              <p className="text-sm text-gray-500">
                Cadastre prompts pra gerar imagens via OpenAI (gpt-image-1) com base numa foto da galeria.
              </p>
            </div>
          </div>
          <Btn variant="primary" onClick={() => setOpenForm({ mode: 'create' })}>
            <Plus className="h-4 w-4" /> Novo prompt
          </Btn>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-3">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">
            {loading ? 'Carregando…' : `${filtered.length} prompt${filtered.length !== 1 ? 's' : ''}${showInactive ? '' : ' ativos'}`}
          </p>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-rose-500 focus:ring-rose-400"
            />
            Mostrar inativos
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 text-rose-400 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-gray-300 rounded-xl p-8 text-center">
            <Sparkles className="h-5 w-5 text-gray-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700">Nenhum prompt cadastrado</p>
            <p className="text-xs text-gray-500 mt-1">
              Crie um prompt pra usar nas doc tags vinculadas a "Gerada por IA".
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(p => {
              const isOpen = expanded === p.id
              return (
                <div
                  key={p.id}
                  className={`border rounded-xl overflow-hidden ${
                    p.is_active ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-75'
                  }`}
                >
                  <div
                    className={`px-4 py-3 flex items-center gap-3 cursor-pointer ${
                      isOpen ? 'bg-fuchsia-50/50' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                  >
                    <Sparkles className="h-4 w-4 text-fuchsia-500 flex-shrink-0" />
                    <span className="font-medium text-sm text-gray-800 flex-1 truncate">{p.name}</span>
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {p.size} · {p.quality}
                    </span>
                    {!p.is_active && (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Inativo
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); handleToggleActive(p) }}
                      className="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100"
                      title={p.is_active ? 'Desativar' : 'Ativar'}
                    >
                      {p.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setOpenForm({ mode: 'edit', item: p }) }}
                      className="text-gray-400 hover:text-rose-500 p-1 rounded-md hover:bg-rose-50"
                      title="Editar"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setPendingDelete(p) }}
                      className="text-gray-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50"
                      title="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </div>

                  {isOpen && (
                    <div className="px-4 py-3 border-t border-gray-100">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-72 overflow-y-auto bg-gray-50 rounded-lg p-3">
                        {p.prompt}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800">
            💡 Cada geração consome créditos da sua conta OpenAI (gpt-image-1 medium: ~US$ 0,04 / high: ~US$ 0,19 por imagem). Use "Regenerar" com parcimônia.
          </p>
        </div>
      </div>

      {/* Form modal */}
      {openForm && (
        <PromptFormDialog
          mode={openForm.mode}
          item={openForm.mode === 'edit' ? openForm.item : null}
          onClose={() => setOpenForm(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Confirm delete */}
      {pendingDelete && (
        <ConfirmDeleteModal
          title="Remover prompt?"
          message={
            <>
              <strong>"{pendingDelete.name}"</strong> será removido.
              <br />
              Doc tags que estavam vinculadas a ele vão precisar ser re-vinculadas a outro prompt.
            </>
          }
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   PromptFormDialog — modal create / edit
// ═══════════════════════════════════════════════════════════════════════

function PromptFormDialog({
  mode, item, onClose, onSaved,
}: {
  mode: 'create' | 'edit'
  item: AiImagePrompt | null
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft>(
    item
      ? { id: item.id, name: item.name, prompt: item.prompt, model: item.model, size: item.size, quality: item.quality, is_active: item.is_active }
      : DEFAULT_DRAFT
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setErr(null)
    if (!draft.name.trim()) { setErr('Dê um nome ao prompt.'); return }
    if (!draft.prompt.trim()) { setErr('Cole o prompt.'); return }

    setSaving(true)
    try {
      if (mode === 'create') {
        await documentsService.createAiImagePrompt({
          name:    draft.name,
          prompt:  draft.prompt,
          model:   draft.model,
          size:    draft.size,
          quality: draft.quality,
        })
      } else if (item) {
        await documentsService.updateAiImagePrompt(item.id, {
          name:      draft.name,
          prompt:    draft.prompt,
          model:     draft.model,
          size:      draft.size,
          quality:   draft.quality,
          is_active: draft.is_active,
        })
      }
      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        <form onSubmit={handleSave} className="flex flex-col min-h-0">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="font-semibold text-gray-900">{mode === 'create' ? 'Novo prompt' : 'Editar prompt'}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Configura o modelo, qualidade e o texto que será enviado pra OpenAI.
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Nome do prompt <span className="text-rose-500">*</span>
              </label>
              <input
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder='Ex: "Contraste 2 a 9"'
                maxLength={120}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>

            {/* Prompt textarea */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Prompt <span className="text-rose-500">*</span>
                <span className="text-gray-400 font-normal ml-1">(o texto enviado pra OpenAI)</span>
              </label>
              <textarea
                value={draft.prompt}
                onChange={e => setDraft({ ...draft, prompt: e.target.value })}
                rows={12}
                placeholder="Descreva exatamente como a IA deve compor a imagem..."
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-rose-400 leading-relaxed"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                {draft.prompt.length.toLocaleString('pt-BR')} caracteres
              </p>
            </div>

            {/* Size + quality */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Tamanho</label>
                <select
                  value={draft.size}
                  onChange={e => setDraft({ ...draft, size: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  {SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Qualidade</label>
                <select
                  value={draft.quality}
                  onChange={e => setDraft({ ...draft, quality: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  {QUALITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {/* Active */}
            {mode === 'edit' && (
              <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={e => setDraft({ ...draft, is_active: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-rose-500 focus:ring-rose-400"
                />
                Prompt ativo
              </label>
            )}

            {err && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{err}</p>
              </div>
            )}
          </div>

          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
            <Btn variant="outline" onClick={onClose} disabled={saving}>Cancelar</Btn>
            <Btn type="submit" variant="primary" loading={saving} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              {mode === 'create' ? 'Criar prompt' : 'Salvar alterações'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   ConfirmDeleteModal
// ═══════════════════════════════════════════════════════════════════════

function ConfirmDeleteModal({
  title, message, busy, onCancel, onConfirm,
}: {
  title: string
  message: React.ReactNode
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
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
            Remover
          </button>
        </div>
      </div>
    </div>
  )
}
