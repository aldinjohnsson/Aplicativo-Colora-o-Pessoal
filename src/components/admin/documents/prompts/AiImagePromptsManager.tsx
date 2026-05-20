// src/components/admin/documents/prompts/AiImagePromptsManager.tsx
//
// CRUD da aba "Prompts IA" no Documents Hub.
//
// Estrutura do prompt:
//   • name          — label do prompt pai (ex: "Outono Escuro")
//   • parts[]       — cada parte gera UMA imagem (ex: Parte 1, Parte 2 …)
//   • reference_image_path / reference_image_url — imagem complementar usada
//     em TODAS as partes (armazenada no Storage)
//   • model, size, quality, is_active

import React, { useEffect, useRef, useState } from 'react'
import {
  Plus, Sparkles, Trash2, X, Edit2, AlertCircle, ChevronDown, ChevronUp,
  Eye, EyeOff, Save, Loader2, GripVertical, Image as ImageIcon,
  UploadCloud, ArrowUp, ArrowDown, Layers, Braces,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { supabase } from '../../../../lib/supabase'

// ── Btn ────────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, type = 'button', className = '',
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:   'text-gray-600 hover:bg-gray-100',
    danger:  'text-red-600 hover:bg-red-50 border border-red-200',
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

export interface AiPromptPart {
  id:     string   // uuid local — salvo no JSONB do banco
  label:  string   // ex: "Parte 1", "Outono manhã"
  prompt: string   // texto enviado pra OpenAI nessa parte
}

export interface AiImagePrompt {
  id:                    string
  name:                  string
  parts:                 AiPromptPart[]
  reference_image_path:  string | null
  reference_image_url:   string | null   // signed URL (API devolve)
  model:                 string
  size:                  string
  quality:               string
  is_active:             boolean
  created_at:            string
  updated_at:            string
}

const partUid = () => `p_${Math.random().toString(36).slice(2)}`

const newPart = (n: number): AiPromptPart => ({
  id:     partUid(),
  label:  `Parte ${n}`,
  prompt: '',
})

type Draft = {
  id?:    string
  name:   string
  parts:  AiPromptPart[]
  // imagem de referência
  refImageFile?:    File | null
  refImagePreview?: string | null   // data URL da nova imagem (preview local)
  refImagePath?:    string | null   // path existente (modo edição)
  refImageUrl?:     string | null   // URL assinada existente (modo edição)
  removeRefImage:   boolean         // true = apagar imagem existente
  model:    string
  size:     string
  quality:  string
  is_active: boolean
}

const DEFAULT_DRAFT: Draft = {
  name:           '',
  parts:          [newPart(1)],
  refImageFile:   null,
  refImagePreview: null,
  refImagePath:   null,
  refImageUrl:    null,
  removeRefImage: false,
  model:    'gpt-image-2',
  size:     '1024x1024',
  quality:  'medium',
  is_active: true,
}

const MODEL_OPTIONS = [
  { value: 'gpt-image-2', label: 'gpt-image-2', desc: 'Mais novo · melhor qualidade (recomendado)' },
  { value: 'gpt-image-1', label: 'gpt-image-1', desc: 'Estável · boa qualidade' },
  { value: 'dall-e-3',    label: 'DALL·E 3',    desc: 'Alta criatividade' },
  { value: 'dall-e-2',    label: 'DALL·E 2',    desc: 'Mais rápido e barato' },
]

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
  const [items, setItems]         = useState<AiImagePrompt[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [expanded, setExpanded]   = useState<string | null>(null)

  const [openForm, setOpenForm]   = useState<null | { mode: 'create' } | { mode: 'edit'; item: AiImagePrompt }>(null)
  const [pendingDelete, setPendingDelete] = useState<AiImagePrompt | null>(null)
  const [deleting, setDeleting]   = useState(false)

  const reload = async () => {
    setLoading(true); setError(null)
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

  const handleSaved   = () => { setOpenForm(null); reload() }

  const handleDelete  = async () => {
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
                Cada prompt tem múltiplas partes — cada parte gera uma imagem separada na composição.
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
            <p className="text-xs text-gray-500 mt-1">Crie um prompt pra começar.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(p => {
              const isOpen = expanded === p.id
              const partCount = Array.isArray(p.parts) ? p.parts.length : 0
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

                    {/* Badges */}
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 font-semibold flex-shrink-0">
                      {partCount} parte{partCount !== 1 ? 's' : ''}
                    </span>
                    {p.reference_image_url && (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold flex-shrink-0 flex items-center gap-1">
                        <ImageIcon className="h-2.5 w-2.5" /> ref
                      </span>
                    )}
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {p.size} · {p.quality}
                    </span>
                    {!p.is_active && (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Inativo
                      </span>
                    )}

                    <button onClick={e => { e.stopPropagation(); handleToggleActive(p) }}
                      className="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100"
                      title={p.is_active ? 'Desativar' : 'Ativar'}
                    >
                      {p.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={e => { e.stopPropagation(); setOpenForm({ mode: 'edit', item: p }) }}
                      className="text-gray-400 hover:text-rose-500 p-1 rounded-md hover:bg-rose-50" title="Editar">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); setPendingDelete(p) }}
                      className="text-gray-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50" title="Remover">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </div>

                  {/* Expandido: lista de partes + imagem de referência */}
                  {isOpen && (
                    <div className="px-4 py-3 border-t border-gray-100 space-y-3">
                      {/* Imagem de referência */}
                      {p.reference_image_url && (
                        <div className="flex items-center gap-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                          <img
                            src={p.reference_image_url}
                            alt="Referência"
                            className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-blue-200"
                          />
                          <div>
                            <p className="text-xs font-semibold text-blue-800">Imagem de referência complementar</p>
                            <p className="text-[11px] text-blue-600 mt-0.5">Enviada junto com todas as partes deste prompt</p>
                          </div>
                        </div>
                      )}

                      {/* Partes */}
                      {(p.parts || []).map((part, idx) => (
                        <div key={part.id} className="bg-gray-50 rounded-lg p-3 space-y-1">
                          <p className="text-[11px] font-semibold text-fuchsia-700 uppercase tracking-wider">
                            {idx + 1}. {part.label}
                          </p>
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-40 overflow-y-auto">
                            {part.prompt}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800">
            💡 Cada parte gera uma imagem separada. Ao adicionar esse prompt à composição, o sistema cria automaticamente uma página por parte na fila de geração.
          </p>
        </div>
      </div>

      {openForm && (
        <PromptFormDialog
          mode={openForm.mode}
          item={openForm.mode === 'edit' ? openForm.item : null}
          onClose={() => setOpenForm(null)}
          onSaved={handleSaved}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteModal
          title="Remover prompt?"
          message={
            <>
              <strong>"{pendingDelete.name}"</strong> e todas as suas partes serão removidos.
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
//   PromptFormDialog
// ═══════════════════════════════════════════════════════════════════════

function PromptFormDialog({
  mode, item, onClose, onSaved,
}: {
  mode: 'create' | 'edit'
  item: AiImagePrompt | null
  onClose: () => void
  onSaved: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [draft, setDraft] = useState<Draft>(() => {
    if (item) {
      return {
        id:             item.id,
        name:           item.name,
        parts:          Array.isArray(item.parts) && item.parts.length > 0
                          ? item.parts
                          : [newPart(1)],
        refImageFile:   null,
        refImagePreview: null,
        refImagePath:   item.reference_image_path,
        refImageUrl:    item.reference_image_url,
        removeRefImage: false,
        model:          item.model,
        size:           item.size,
        quality:        item.quality,
        is_active:      item.is_active,
      }
    }
    return DEFAULT_DRAFT
  })

  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  // ── Variáveis de prompt (ai_info_templates) ────────────────────────
  // Lista os nomes das tags cadastradas em Configurações → Informações da
  // análise. Usado pelo picker "Inserir variável" acima de cada textarea.
  const [varLabels, setVarLabels] = useState<string[]>([])
  const [varPickerOpenIdx, setVarPickerOpenIdx] = useState<number | null>(null)
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({})

  useEffect(() => {
    let cancelled = false
    supabase
      .from('ai_info_templates')
      .select('name, sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        const labels = ((data || []) as Array<{ name: string | null }>)
          .map(t => (t.name || '').trim())
          .filter(Boolean)
        // Variável built-in da Ferramenta de Contraste — sem cadastro de tag.
        if (!labels.some(l => l.toLowerCase() === 'contraste')) {
          labels.push('Contraste')
        }
        setVarLabels(labels)
      })
    return () => { cancelled = true }
  }, [])

  // Fecha picker ao clicar fora
  useEffect(() => {
    if (varPickerOpenIdx === null) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-var-picker]')) setVarPickerOpenIdx(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [varPickerOpenIdx])

  /** Insere `{{Label}}` na posição atual do cursor da textarea da parte. */
  const insertVar = (partIdx: number, label: string) => {
    const ta = textareaRefs.current[partIdx]
    const current = draft.parts[partIdx]?.prompt ?? ''
    const placeholder = `{{${label}}}`
    if (ta) {
      const start = ta.selectionStart ?? current.length
      const end   = ta.selectionEnd   ?? current.length
      const next  = current.slice(0, start) + placeholder + current.slice(end)
      patchPart(partIdx, { prompt: next })
      requestAnimationFrame(() => {
        ta.focus()
        const pos = start + placeholder.length
        ta.setSelectionRange(pos, pos)
      })
    } else {
      patchPart(partIdx, { prompt: current + placeholder })
    }
    setVarPickerOpenIdx(null)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ── Parts helpers ──

  const addPart = () => {
    setDraft(d => ({ ...d, parts: [...d.parts, newPart(d.parts.length + 1)] }))
  }

  const removePart = (idx: number) => {
    setDraft(d => ({ ...d, parts: d.parts.filter((_, i) => i !== idx) }))
  }

  const patchPart = (idx: number, patch: Partial<AiPromptPart>) => {
    setDraft(d => ({
      ...d,
      parts: d.parts.map((p, i) => i === idx ? { ...p, ...patch } : p),
    }))
  }

  const movePart = (idx: number, dir: -1 | 1) => {
    setDraft(d => {
      const next = [...d.parts]
      const j = idx + dir
      if (j < 0 || j >= next.length) return d;
      [next[idx], next[j]] = [next[j], next[idx]]
      return { ...d, parts: next }
    })
  }

  // ── Reference image ──

  const handleRefImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ALLOWED = ['image/png', 'image/jpeg', 'image/webp']
    if (!ALLOWED.includes(file.type)) { setErr('Formato não suportado. Use PNG, JPEG ou WEBP.'); return }
    if (file.size > 10 * 1024 * 1024) { setErr('Arquivo muito grande. Máximo 10 MB.'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      setDraft(d => ({
        ...d,
        refImageFile:    file,
        refImagePreview: ev.target?.result as string,
        removeRefImage:  false,
      }))
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleRemoveRefImage = () => {
    setDraft(d => ({
      ...d,
      refImageFile:    null,
      refImagePreview: null,
      removeRefImage:  true,
    }))
  }

  // ── Save ──

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setErr(null)
    if (!draft.name.trim()) { setErr('Dê um nome ao prompt.'); return }
    if (draft.parts.length === 0) { setErr('Adicione pelo menos uma parte.'); return }
    const emptyPart = draft.parts.find(p => !p.prompt.trim())
    if (emptyPart) { setErr(`A parte "${emptyPart.label}" está sem texto.`); return }

    setSaving(true)
    try {
      // 1. Upload da imagem de referência (se houver nova)
      let refPath = draft.refImagePath ?? null
      if (draft.refImageFile) {
        const up = await documentsService.uploadPromptReferenceImage(draft.refImageFile, draft.refImagePath ?? null)
        refPath = up.path
      } else if (draft.removeRefImage) {
        refPath = null
      }

      const payload = {
        name:                 draft.name,
        parts:                draft.parts,
        reference_image_path: refPath,
        model:                draft.model,
        size:                 draft.size,
        quality:              draft.quality,
      }

      if (mode === 'create') {
        await documentsService.createAiImagePrompt(payload as any)
      } else if (item) {
        await documentsService.updateAiImagePrompt(item.id, {
          ...payload,
          is_active: draft.is_active,
        } as any)
      }
      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  // Imagem de referência atual (nova ou existente)
  const refPreviewSrc = draft.refImagePreview ?? (draft.removeRefImage ? null : draft.refImageUrl)

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        <form onSubmit={handleSave} className="flex flex-col min-h-0">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="font-semibold text-gray-900">{mode === 'create' ? 'Novo prompt' : 'Editar prompt'}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Cada parte gera uma imagem separada na composição.
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-5 overflow-y-auto">

            {/* Nome */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Nome do prompt <span className="text-rose-500">*</span>
              </label>
              <input
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder='Ex: "Outono Escuro"'
                maxLength={120}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>

            {/* Partes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-fuchsia-500" />
                  Partes <span className="text-rose-500">*</span>
                  <span className="text-gray-400 font-normal">— cada parte = 1 imagem gerada</span>
                </label>
                <button
                  type="button"
                  onClick={addPart}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 font-medium border border-fuchsia-200"
                >
                  <Plus className="h-3 w-3" /> Adicionar parte
                </button>
              </div>

              <div className="space-y-3">
                {draft.parts.map((part, idx) => (
                  <div key={part.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* Cabeçalho da parte */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                      <GripVertical className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex-shrink-0">
                        {idx + 1}.
                      </span>
                      <input
                        value={part.label}
                        onChange={e => patchPart(idx, { label: e.target.value })}
                        placeholder="Label da parte (ex: Parte 1)"
                        maxLength={60}
                        className="flex-1 min-w-0 text-xs font-medium text-gray-700 bg-transparent border-0 focus:outline-none focus:ring-0 placeholder-gray-400"
                      />
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button type="button" onClick={() => movePart(idx, -1)} disabled={idx === 0}
                          className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30">
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button type="button" onClick={() => movePart(idx, 1)} disabled={idx === draft.parts.length - 1}
                          className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30">
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button type="button" onClick={() => removePart(idx)} disabled={draft.parts.length <= 1}
                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {/* Barra do picker de variáveis (Inserir {{Label}}) */}
                    <div className="px-3 py-1.5 border-b border-gray-100 bg-violet-50/40 flex items-center gap-2 relative" data-var-picker>
                      <button
                        type="button"
                        onClick={() => setVarPickerOpenIdx(varPickerOpenIdx === idx ? null : idx)}
                        disabled={varLabels.length === 0}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium border border-violet-200"
                      >
                        <Braces className="h-3 w-3" /> Inserir variável
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </button>
                      <span className="text-[10px] text-gray-500 truncate flex-1">
                        {varLabels.length === 0
                          ? <>Cadastre tags em <strong>Configurações → Informações da análise</strong>.</>
                          : <>Será substituída pelo valor da cliente na hora da geração.</>}
                      </span>
                      {varPickerOpenIdx === idx && varLabels.length > 0 && (
                        <div
                          data-var-picker
                          className="absolute top-full left-3 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg w-64 max-h-72 overflow-y-auto"
                        >
                          <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100 sticky top-0">
                            Informações da análise
                          </div>
                          {varLabels.map(label => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => insertVar(idx, label)}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-violet-50 hover:text-violet-700 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0"
                            >
                              <span className="truncate font-medium">{label}</span>
                              <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">{`{{${label}}}`}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Textarea do prompt */}
                    <textarea
                      ref={el => { textareaRefs.current[idx] = el }}
                      value={part.prompt}
                      onChange={e => patchPart(idx, { prompt: e.target.value })}
                      rows={5}
                      placeholder="Texto do prompt enviado pra OpenAI nessa parte…"
                      className="w-full px-3 py-2.5 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-rose-400 leading-relaxed border-0"
                    />
                    <div className="px-3 pb-1 text-[10px] text-gray-400">
                      {part.prompt.length.toLocaleString('pt-BR')} caracteres
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Imagem de referência complementar */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5 text-blue-500" />
                Imagem de referência complementar
                <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <p className="text-[11px] text-gray-500 mb-2">
                Essa imagem será enviada junto com <strong>todas as partes</strong> deste prompt durante a geração.
                Use pra definir estilo, composição ou produto fixo. PNG, JPEG, WEBP · Máx 10 MB.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleRefImageChange}
              />

              {refPreviewSrc ? (
                <div className="flex items-center gap-3 p-2 border border-blue-200 rounded-xl bg-blue-50/40">
                  <img
                    src={refPreviewSrc}
                    alt="Referência"
                    className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-blue-200"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800">Imagem de referência</p>
                    {draft.refImageFile && (
                      <p className="text-[11px] text-gray-500 mt-0.5">{draft.refImageFile.name}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-100 font-medium">
                      Trocar
                    </button>
                    <button type="button" onClick={handleRemoveRefImage}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-medium">
                      Remover
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center gap-2 py-5 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors"
                >
                  <UploadCloud className="h-5 w-5" />
                  <span className="text-xs font-medium">Clique para selecionar imagem de referência</span>
                </button>
              )}
            </div>

            {/* Modelo + Tamanho + Qualidade */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Modelo</label>
                <select
                  value={draft.model}
                  onChange={e => setDraft({ ...draft, model: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  {MODEL_OPTIONS.map(o => (
                    <option key={o.value} value={o.value} title={o.desc}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-gray-400">
                  {MODEL_OPTIONS.find(o => o.value === draft.model)?.desc}
                </p>
              </div>
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

            {/* Active (só no edit) */}
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

          {/* Footer */}
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