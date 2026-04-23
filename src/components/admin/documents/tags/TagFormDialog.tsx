// src/components/admin/documents/tags/TagFormDialog.tsx
//
// Modal de criação/edição de uma Tag de documento.
// Segue o padrão visual de InputModal / ConfirmModal usados em FoldersManager.

import React, { useEffect, useRef, useState } from 'react'
import { X, Type as TypeIcon, Image as ImageIcon, AlertCircle } from 'lucide-react'
import { documentsService, isValidSlug, toSlug } from '../lib/documentsService'
import type { DocumentTag, DocumentTagType } from '../types'

// ── Shared tiny UI (mesmo padrão de PlansManager / FoldersManager) ──

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

// ─── Props ─────────────────────────────────────────────────────────────

interface TagFormDialogProps {
  mode: 'create' | 'edit'
  tag?: DocumentTag | null           // obrigatório quando mode === 'edit'
  onClose: () => void
  onSaved: (tag: DocumentTag) => void
}

// ─── Component ────────────────────────────────────────────────────────

export function TagFormDialog({ mode, tag, onClose, onSaved }: TagFormDialogProps) {
  const [name, setName] = useState(tag?.name ?? '')
  const [slug, setSlug] = useState(tag?.slug ?? '')
  const [type, setType] = useState<DocumentTagType>(tag?.type ?? 'text')
  const [description, setDescription] = useState(tag?.description ?? '')
  const [slugEdited, setSlugEdited] = useState(mode === 'edit')   // em edição, assume slug manual

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)

  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => nameInputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  // Auto-slug enquanto o usuário não edita o campo slug diretamente
  useEffect(() => {
    if (!slugEdited && mode === 'create') {
      setSlug(toSlug(name))
    }
  }, [name, slugEdited, mode])

  // Fecha com ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const validate = (): string | null => {
    if (!name.trim()) return 'Informe um nome para a tag'
    if (!slug.trim()) return 'Informe um identificador (slug)'
    if (!isValidSlug(slug)) {
      return 'Slug inválido. Use apenas letras minúsculas, números e underscore (ex: melhores_fotos_1).'
    }
    return null
  }

  const handleSlugBlur = async () => {
    setSlugError(null)
    if (!slug || !isValidSlug(slug)) return
    try {
      const taken = await documentsService.isSlugTaken(slug, tag?.id)
      if (taken) setSlugError('Este identificador já está em uso.')
    } catch (e) {
      // silencioso — deixa validar no submit
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    try {
      // Última checagem antes de salvar
      const taken = await documentsService.isSlugTaken(slug, tag?.id)
      if (taken) {
        setSlugError('Este identificador já está em uso.')
        setSaving(false)
        return
      }

      const payload = {
        name: name.trim(),
        slug: slug.trim(),
        type,
        description: description.trim() || null,
      }

      const saved = mode === 'create'
        ? await documentsService.createTag(payload)
        : await documentsService.updateTag(tag!.id, payload)

      onSaved(saved)
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar tag')
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'create' ? 'Nova Tag' : 'Editar Tag'

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{title}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Slots reutilizáveis que você vai posicionar nos templates de PDF.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 space-y-4">
            {/* Nome */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Nome <span className="text-rose-500">*</span>
              </label>
              <input
                ref={nameInputRef}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder='Ex: "Melhores fotos 1"'
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
                maxLength={120}
              />
            </div>

            {/* Slug */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Identificador <span className="text-rose-500">*</span>
                <span className="text-gray-400 font-normal ml-1">
                  (usado internamente, não aparece no PDF)
                </span>
              </label>
              <input
                value={slug}
                onChange={e => { setSlug(e.target.value); setSlugEdited(true); setSlugError(null) }}
                onBlur={handleSlugBlur}
                placeholder="melhores_fotos_1"
                className={`w-full px-3 py-2.5 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 ${
                  slugError
                    ? 'border-red-300 focus:ring-red-300 focus:border-red-400'
                    : 'border-gray-300 focus:ring-rose-400 focus:border-rose-400'
                }`}
                maxLength={80}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {slugError && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />{slugError}
                </p>
              )}
            </div>

            {/* Tipo */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Tipo <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType('text')}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    type === 'text'
                      ? 'border-rose-500 bg-rose-50 text-rose-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <TypeIcon className="h-4 w-4" /> Texto
                </button>
                <button
                  type="button"
                  onClick={() => setType('image')}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    type === 'image'
                      ? 'border-rose-500 bg-rose-50 text-rose-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <ImageIcon className="h-4 w-4" /> Imagem
                </button>
              </div>
            </div>

            {/* Descrição */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Descrição <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Para que serve esta tag? Ex: foto de tecido favorito do cliente"
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
                maxLength={300}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end">
            <Btn variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Btn>
            <Btn type="submit" variant="primary" loading={saving} disabled={saving}>
              {mode === 'create' ? 'Criar tag' : 'Salvar alterações'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}
