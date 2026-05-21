// src/components/admin/documents/tags/TagFormDialog.tsx
//
// Modal de criação/edição de uma Tag de documento.
//
// Seção "Origem dos dados":
//   • Personalizada (default) — admin preenche por cliente em ClientTagValuesPanel
//   • Vinculada a uma fonte do sistema — valor é puxado automaticamente.
//     Fontes suportadas (vêm de documentsService.listImportSourceCatalog):
//       - Dados do cliente (Nome, E-mail, Telefone)
//       - Resultado (Observações, Link da pasta)
//       - Tags de Informação (ai_info_templates — texto OU imagem)
//
// Quando vinculada a uma AI Info imagem em uma doc tag tipo IMAGEM, o valor é
// o ARQUIVO da opção; em uma doc tag tipo TEXTO, é a LABEL da opção.
//
// `default_hint` gravado:
//   { source: 'import_source', key: '<chave>' }
//
// Backward-compat: doc tags com o formato antigo
//   { source: 'ai_info_template', templateId: '<uuid>' }
// continuam funcionando no resolver. Ao editar uma dessas tags, ela é
// migrada pro formato novo automaticamente no próximo save.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Type as TypeIcon, Image as ImageIcon, AlertCircle, Link2, Tag as TagIcon,
} from 'lucide-react'
import { documentsService, isValidSlug, toSlug } from '../lib/documentsService'
import type { DocumentTag, DocumentTagType } from '../types'

// ── Shared tiny UI ────────────────────────────────────────────────────

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

// ─── Tipos auxiliares ─────────────────────────────────────────────────

interface ImportSource {
  key: string
  label: string
  groupLabel: string
  acceptedTagTypes: Array<'text' | 'image'>
}

type Origin = 'manual' | 'import_source'

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Lê origem + chave do default_hint, normalizando o formato antigo
 * ({source:'ai_info_template', templateId}) pro novo.
 */
function readOriginFromTag(tag: DocumentTag | null | undefined): {
  origin: Origin
  sourceKey: string
} {
  const hint = (tag as any)?.default_hint
  if (!hint || typeof hint !== 'object') return { origin: 'manual', sourceKey: '' }

  if (hint.source === 'ai_generated') {
    return { origin: 'manual', sourceKey: '' }
  }
  if (hint.source === 'import_source' && typeof hint.key === 'string' && hint.key) {
    return { origin: 'import_source', sourceKey: hint.key }
  }
  // Formato antigo → migra silenciosamente
  if (hint.source === 'ai_info_template' && typeof hint.templateId === 'string' && hint.templateId) {
    return { origin: 'import_source', sourceKey: `ai_info:${hint.templateId}` }
  }
  return { origin: 'manual', sourceKey: '' }
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
  const initial = readOriginFromTag(tag)

  const [name, setName] = useState(tag?.name ?? '')
  const [slug, setSlug] = useState(tag?.slug ?? '')
  const [type, setType] = useState<DocumentTagType>(tag?.type ?? 'text')
  const [description, setDescription] = useState(tag?.description ?? '')
  const [slugEdited, setSlugEdited] = useState(mode === 'edit')   // em edição, assume slug manual

  // Origem / vínculo
  const [origin, setOrigin] = useState<Origin>(initial.origin)
  const [sourceKey, setSourceKey] = useState<string>(initial.sourceKey)
  const [sources, setSources] = useState<ImportSource[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)

  const nameInputRef = useRef<HTMLInputElement>(null)

  // ── Load catálogo de fontes ──
  useEffect(() => {
    let cancelled = false
    setLoadingSources(true)
    setSourcesError(null)
    documentsService.listImportSourceCatalog()
      .then(list => { if (!cancelled) setSources(list) })
      .catch(e => { if (!cancelled) setSourcesError(e?.message || 'Erro ao carregar fontes') })
      .finally(() => { if (!cancelled) setLoadingSources(false) })
    return () => { cancelled = true }
  }, [])

  // ── Foco inicial ──
  useEffect(() => {
    const t = setTimeout(() => nameInputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  // ── ESC fecha ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ── Auto-slug enquanto o usuário não edita o slug ──
  useEffect(() => {
    if (!slugEdited && mode === 'create') {
      setSlug(toSlug(name))
    }
  }, [name, slugEdited, mode])

  // ── Filtro de fontes válidas pro tipo atual da doc tag ──
  const sourcesForType = useMemo(
    () => sources.filter(s => s.acceptedTagTypes.includes(type)),
    [sources, type],
  )

  // Agrupa por groupLabel pra renderizar como <optgroup>
  const groupedSources = useMemo(() => {
    const groups: Record<string, ImportSource[]> = {}
    for (const s of sourcesForType) {
      if (!groups[s.groupLabel]) groups[s.groupLabel] = []
      groups[s.groupLabel].push(s)
    }
    return groups
  }, [sourcesForType])

  const selectedSource = useMemo(
    () => sources.find(s => s.key === sourceKey) || null,
    [sources, sourceKey],
  )

  // ── Quando troca a fonte selecionada (em modo create) ────────────
  //   - Se o nome ainda está vazio, pré-preenche com o label da fonte
  useEffect(() => {
    if (origin !== 'import_source' || !selectedSource) return
    if (mode === 'create' && !name.trim()) {
      setName(selectedSource.label)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource, origin])

  // ── Quando o usuário troca o TIPO e a fonte selecionada não é mais
  //    compatível, limpa a fonte (sem perder a origem 'import_source') ─
  useEffect(() => {
    if (origin !== 'import_source' || !sourceKey) return
    const cur = sources.find(s => s.key === sourceKey)
    if (cur && !cur.acceptedTagTypes.includes(type)) {
      setSourceKey('')
    }
  }, [type, origin, sourceKey, sources])

  // ── Alterna origem ────────────────────────────────────────────────
  const handleSetOrigin = (next: Origin) => {
    setOrigin(next)
    setError(null)
    if (next === 'manual') setSourceKey('')
    if (next === 'import_source') { /* nada extra */ }
  }

  // ── Validação ─────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!name.trim()) return 'Informe um nome para a tag'
    if (!slug.trim()) return 'Informe um identificador (slug)'
    if (!isValidSlug(slug)) {
      return 'Slug inválido. Use apenas letras minúsculas, números e underscore (ex: melhores_fotos_1).'
    }
    if (origin === 'import_source') {
      if (!sourceKey) return 'Escolha a fonte que vai alimentar esta tag.'
      const s = sources.find(x => x.key === sourceKey)
      if (!s) return 'Fonte selecionada não foi encontrada — recarregue.'
      if (!s.acceptedTagTypes.includes(type)) {
        return 'A fonte selecionada não é compatível com o tipo da tag.'
      }
    }
    return null
  }

  const handleSlugBlur = async () => {
    setSlugError(null)
    if (!slug || !isValidSlug(slug)) return
    try {
      const taken = await documentsService.isSlugTaken(slug, tag?.id)
      if (taken) setSlugError('Este identificador já está em uso.')
    } catch {
      // silencioso — submit pega
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)

    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setSaving(true)
    try {
      const taken = await documentsService.isSlugTaken(slug, tag?.id)
      if (taken) {
        setSlugError('Este identificador já está em uso.')
        setSaving(false)
        return
      }

      const default_hint =
        origin === 'import_source' && sourceKey
          ? { source: 'import_source', key: sourceKey }
          : {}

      const payload = {
        name: name.trim(),
        slug: slug.trim(),
        type,
        description: description.trim() || null,
        default_hint,
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
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
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
          <div className="px-5 py-5 space-y-4 overflow-y-auto">
            {/* ── Origem ────────────────────────────────────────── */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Origem dos dados <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => handleSetOrigin('manual')}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-all text-left ${
                    origin === 'manual'
                      ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-200'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <TagIcon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${origin === 'manual' ? 'text-rose-600' : 'text-gray-400'}`} />
                  <div className="min-w-0">
                    <p className={`font-medium text-xs ${origin === 'manual' ? 'text-rose-700' : 'text-gray-700'}`}>
                      Personalizada
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                      O valor é preenchido manualmente por cliente na aba <strong>Documentos</strong>.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSetOrigin('import_source')}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-all text-left ${
                    origin === 'import_source'
                      ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-200'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <Link2 className={`h-4 w-4 mt-0.5 flex-shrink-0 ${origin === 'import_source' ? 'text-rose-600' : 'text-gray-400'}`} />
                  <div className="min-w-0">
                    <p className={`font-medium text-xs ${origin === 'import_source' ? 'text-rose-700' : 'text-gray-700'}`}>
                      Vinculada a uma fonte do sistema
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                      Puxa automaticamente dados do cliente, do resultado ou de Tags de Informação.
                    </p>
                  </div>
                </button>

              </div>
            </div>

            {/* ── Dropdown de fonte (só quando vinculada) ──────────── */}
            {origin === 'import_source' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Fonte <span className="text-rose-500">*</span>
                </label>

                {loadingSources ? (
                  <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-xs text-gray-400 flex items-center gap-2">
                    <div className="animate-spin h-3 w-3 border-2 border-gray-300 border-t-rose-400 rounded-full" />
                    Carregando fontes…
                  </div>
                ) : sourcesError ? (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />{sourcesError}
                  </p>
                ) : sourcesForType.length === 0 ? (
                  <p className="text-xs text-gray-500 italic px-3 py-2.5 border border-dashed border-gray-300 rounded-lg">
                    Nenhuma fonte compatível com o tipo <strong>{type === 'image' ? 'imagem' : 'texto'}</strong>.
                    {type === 'image' && (
                      <> Crie Tags de Informação tipo imagem em <strong>Configurações</strong>.</>
                    )}
                  </p>
                ) : (
                  <select
                    value={sourceKey}
                    onChange={e => setSourceKey(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
                  >
                    <option value="">— Escolha uma fonte —</option>
                    {Object.entries(groupedSources).map(([groupLabel, items]) => (
                      <optgroup key={groupLabel} label={groupLabel}>
                        {items.map(s => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}

                {selectedSource && (
                  <p className="text-[11px] text-gray-500 mt-1.5 flex items-start gap-1">
                    <Link2 className="h-3 w-3 mt-0.5 flex-shrink-0 text-rose-400" />
                    <span>
                      {type === 'image'
                        ? 'A imagem cadastrada na opção selecionada em Resultado vai pro PDF.'
                        : <>O valor será puxado de <strong>{selectedSource.groupLabel} → {selectedSource.label}</strong>.</>}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* ── Nome ──────────────────────────────────────────── */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Nome <span className="text-rose-500">*</span>
                <span className="text-gray-400 font-normal ml-1">(aparece no editor de templates)</span>
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

            {/* ── Slug ──────────────────────────────────────────── */}
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

            {/* ── Tipo ─────────────────────────────────────────── */}
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

            {/* ── Descrição ────────────────────────────────────── */}
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
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
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