// src/components/admin/documents/ai-compositions/AddPageDialog.tsx
//
// Dialog simplificado pra adicionar páginas à composição.
//
// Fluxo novo:
//   1. Seleciona o prompt PAI (ex: "Outono Escuro")
//      → mostra as N partes cadastradas nele
//   2. Seleciona a foto base:
//      • Da galeria do cliente (grid)
//      • OU faz upload de uma foto diretamente
//   3. Confirma → onConfirm recebe um AddPageResult POR PARTE
//      (o sistema enfileira N páginas de uma vez)
//
// Removido do dialog:
//   • Campo "Imagem de referência extra"  (agora mora no cadastro do prompt)
//   • Seletor de modelo               (vem do prompt)

import React, { useEffect, useState } from 'react'
import {
  X, Sparkles, Check, AlertCircle, Image as ImageIcon,
  ChevronDown, ChevronUp, Layers, FolderOpen, ChevronLeft,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { substitutePromptVars, type PromptVarSource } from '../lib/promptVars'
import type { AiPromptPart } from '../prompts/AiImagePromptsManager'

// ── Btn ───────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, type = 'button', className = '',
}: any) => {
  const v: any = {
    primary: 'bg-fuchsia-500 text-white hover:bg-fuchsia-600',
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

// ─── Types ────────────────────────────────────────────────────────────

interface ClientPhoto {
  id:              string
  photo_name:      string
  storage_path:    string
  url:             string
  drive_file_id:   string | null
  category_id:     string | null
  category_title:  string | null
}

interface AiPromptLite {
  id:                   string
  name:                 string
  parts:                AiPromptPart[]
  reference_image_url:  string | null
  model:                string
  size:                 string
  quality:              string
}

/** Um resultado por parte do prompt selecionado. */
export interface AddPageResult {
  promptId:    string
  promptName:  string
  partId:      string
  partLabel:   string
  partPrompt:  string   // texto do prompt desta parte — enviado direto à edge function
  // Foto base — apenas galeria
  photoId:     string
  photoName:   string
  photoUrl:    string         // thumbnail pra preview no card
  driveFileId?: string
  // Modelo vem do prompt
  modelVersion: string
}

interface Props {
  clientId:   string
  clientName: string
  onClose:    () => void
  onConfirm:  (results: AddPageResult[]) => void   // ← array, uma entrada por parte
}

// ─── Component ────────────────────────────────────────────────────────

export function AddPageDialog({ clientId, clientName, onClose, onConfirm }: Props) {

  // ── Prompts ──
  const [prompts, setPrompts]                   = useState<AiPromptLite[]>([])
  const [loadingPrompts, setLoadingPrompts]     = useState(true)
  const [promptsError, setPromptsError]         = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [promptOpen, setPromptOpen]             = useState(false)

  // ── Foto base ──
  // photoStep: 'category' = escolher categoria primeiro; 'photos' = escolher foto
  const [photoStep, setPhotoStep]               = useState<'category' | 'photos'>('category')
  const [photos, setPhotos]                     = useState<ClientPhoto[]>([])
  const [loadingPhotos, setLoadingPhotos]       = useState(true)
  const [photosError, setPhotosError]           = useState<string | null>(null)
  const [selectedPhotoId, setSelectedPhotoId]   = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null | undefined>(undefined)

  // ── Variáveis de prompt da cliente (ai_info_templates) ─────────────
  // Carregadas pra substituir `{{Label}}` no partPrompt antes do confirm.
  // Tags sem valor preenchido viram string vazia (silenciosamente).
  const [promptVarSources, setPromptVarSources] = useState<PromptVarSource[]>([])

  useEffect(() => {
    let cancelled = false
    documentsService.getTextImportSources(clientId)
      .then((sources: any[]) => {
        if (cancelled) return
        const aiInfo = (sources || [])
          .filter(s => typeof s?.key === 'string' && s.key.startsWith('ai_info:'))
          .map(s => ({ label: s.label, value: s.value }) as PromptVarSource)
        setPromptVarSources(aiInfo)
      })
      .catch(() => { if (!cancelled) setPromptVarSources([]) })
    return () => { cancelled = true }
  }, [clientId])

  // ── Esc fecha ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ── Load prompts ──
  useEffect(() => {
    let cancelled = false
    setLoadingPrompts(true); setPromptsError(null)
    documentsService.listAiImagePrompts()
      .then((list: any) => { if (!cancelled) setPrompts(list as AiPromptLite[]) })
      .catch((e: any) => { if (!cancelled) setPromptsError(e?.message || 'Erro ao carregar prompts') })
      .finally(() => { if (!cancelled) setLoadingPrompts(false) })
    return () => { cancelled = true }
  }, [])

  // ── Load fotos do cliente ──
  useEffect(() => {
    let cancelled = false
    setLoadingPhotos(true); setPhotosError(null)
    setSelectedPhotoId(null); setPhotos([])
    documentsService.listClientPhotos(clientId)
      .then((list: ClientPhoto[]) => { if (!cancelled) setPhotos(list) })
      .catch((e: any) => { if (!cancelled) setPhotosError(e?.message || 'Erro ao carregar fotos') })
      .finally(() => { if (!cancelled) setLoadingPhotos(false) })
    return () => { cancelled = true }
  }, [clientId])

  useEffect(() => { setPromptOpen(false) }, [selectedPromptId])

  // ── Derived ──
  const selectedPrompt = prompts.find(p => p.id === selectedPromptId) || null
  const selectedPhoto  = photos.find(p => p.id === selectedPhotoId)  || null

  const hasPhoto = !!selectedPhoto
  const canConfirm = !!selectedPrompt && hasPhoto

  // Agrupa fotos por categoria
  const grouped: Record<string, { title: string; photos: ClientPhoto[] }> = {}
  for (const p of photos) {
    const key = p.category_id || '__none__'
    if (!grouped[key]) grouped[key] = { title: p.category_title || 'Sem categoria', photos: [] }
    grouped[key].photos.push(p)
  }

  // Lista de categorias com contagem
  const categories = Object.entries(grouped).map(([key, g]) => ({
    key,
    title: g.title,
    count: g.photos.length,
  })).sort((a, b) => {
    if (a.key === '__none__') return 1
    if (b.key === '__none__') return -1
    return a.title.localeCompare(b.title)
  })

  // Fotos da categoria selecionada
  const visiblePhotos = selectedCategory === undefined
    ? []
    : photos.filter(p =>
        selectedCategory === '__none__'
          ? p.category_id === null
          : p.category_id === selectedCategory
      )
  // ── Confirm: gera 1 resultado por parte ──
  const handleConfirm = () => {
    if (!selectedPrompt || !selectedPhoto) return

    const results: AddPageResult[] = selectedPrompt.parts.map(part => ({
      promptId:    selectedPrompt.id,
      promptName:  selectedPrompt.name,
      partId:      part.id,
      partLabel:   part.label,
      partPrompt:  substitutePromptVars(part.prompt, promptVarSources),
      modelVersion: selectedPrompt.model,
      photoId:     selectedPhoto.id,
      photoName:   selectedPhoto.photo_name,
      photoUrl:    selectedPhoto.url,
      driveFileId: selectedPhoto.drive_file_id ?? undefined,
    }))

    onConfirm(results)
  }

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-fuchsia-500" /> Adicionar à composição
            </p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              Cliente: <span className="font-medium text-gray-700">{clientName}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0 space-y-5">

          {/* ═══ Passo 1: Prompt PAI ═══ */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />
              Prompt <span className="text-rose-500">*</span>
            </p>

            {loadingPrompts ? (
              <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-xs text-gray-400 flex items-center gap-2">
                <div className="animate-spin h-3 w-3 border-2 border-gray-300 border-t-fuchsia-400 rounded-full" />
                Carregando prompts…
              </div>
            ) : promptsError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{promptsError}</p>
              </div>
            ) : prompts.length === 0 ? (
              <p className="text-xs text-gray-500 italic px-3 py-2.5 border border-dashed border-gray-300 rounded-lg">
                Nenhum prompt ativo. Crie em <strong>Documents → Prompts IA</strong>.
              </p>
            ) : (
              <>
                <select
                  value={selectedPromptId}
                  onChange={e => setSelectedPromptId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:border-fuchsia-400"
                >
                  <option value="">— Escolha um prompt —</option>
                  {prompts.map(p => {
                    const cnt = Array.isArray(p.parts) ? p.parts.length : 0
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} · {cnt} parte{cnt !== 1 ? 's' : ''} · {p.size} · {p.quality}
                      </option>
                    )
                  })}
                </select>

                {/* Preview das partes + info de referência */}
                {selectedPrompt && (
                  <div className="mt-2 border border-fuchsia-200 bg-fuchsia-50/40 rounded-xl overflow-hidden">
                    {/* Sumário */}
                    <button
                      type="button"
                      onClick={() => setPromptOpen(o => !o)}
                      className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-fuchsia-100/40 transition-colors"
                    >
                      <Layers className="h-3.5 w-3.5 text-fuchsia-500 flex-shrink-0" />
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-fuchsia-700">
                        {selectedPrompt.parts.length} parte{selectedPrompt.parts.length !== 1 ? 's' : ''} — {selectedPrompt.parts.length} imagem{selectedPrompt.parts.length !== 1 ? 's' : ''} serão geradas
                      </span>
                      {selectedPrompt.reference_image_url && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold ml-auto">
                          + ref. complementar
                        </span>
                      )}
                      {promptOpen
                        ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                    </button>

                    {/* Detalhes das partes */}
                    {promptOpen && (
                      <div className="border-t border-fuchsia-200 bg-white divide-y divide-gray-100">
                        {/* Imagem de referência (se houver) */}
                        {selectedPrompt.reference_image_url && (
                          <div className="px-3 py-2 flex items-center gap-2">
                            <img
                              src={selectedPrompt.reference_image_url}
                              alt="Referência"
                              className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-blue-200"
                            />
                            <p className="text-[11px] text-blue-700 font-medium">
                              Imagem de referência complementar — enviada junto com todas as partes
                            </p>
                          </div>
                        )}
                        {selectedPrompt.parts.map((part, idx) => (
                          <div key={part.id} className="px-3 py-2">
                            <p className="text-[11px] font-bold text-fuchsia-700 mb-0.5">
                              {idx + 1}. {part.label}
                            </p>
                            <p className="text-[11px] text-gray-600 font-mono line-clamp-2 whitespace-pre-wrap break-words">
                              {part.prompt}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ═══ Passo 2: Foto base ═══ */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-gray-500" />
              Foto base <span className="text-rose-500">*</span>
            </p>

            {loadingPhotos ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-7 w-7 border-2 border-fuchsia-400 border-t-transparent rounded-full" />
              </div>
            ) : photosError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{photosError}</p>
              </div>
            ) : photos.length === 0 ? (
              <div className="border border-dashed border-amber-300 bg-amber-50/40 rounded-xl p-4 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">
                  Nenhuma foto encontrada para esta cliente. Vá até a aba <strong>Fotos</strong> do perfil da cliente e adicione as fotos antes de gerar composições.
                </p>
              </div>
            ) : photoStep === 'category' ? (
              /* ── Step: escolher categoria ── */
              <div>
                <p className="text-xs text-gray-500 mb-2">De qual categoria você quer buscar a foto?</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {categories.map(cat => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat.key === '__none__' ? '__none__' : cat.key)
                        setSelectedPhotoId(null)
                        setPhotoStep('photos')
                      }}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:border-fuchsia-300 hover:bg-fuchsia-50/40 transition-colors text-left group"
                    >
                      <div className="h-9 w-9 rounded-lg bg-fuchsia-50 text-fuchsia-400 flex items-center justify-center flex-shrink-0 group-hover:bg-fuchsia-100">
                        <FolderOpen className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate group-hover:text-fuchsia-700">
                          {cat.title}
                        </p>
                        <p className="text-xs text-gray-400">{cat.count} foto{cat.count !== 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-gray-300 group-hover:text-fuchsia-400 text-lg leading-none">→</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* ── Step: escolher foto da categoria ── */
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500">
                    {selectedPhotoId ? (
                      <span className="text-fuchsia-600 font-medium">✓ Foto selecionada</span>
                    ) : 'Clique em uma foto para selecioná-la'}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setPhotoStep('category'); setSelectedPhotoId(null) }}
                    className="text-xs text-gray-400 hover:text-fuchsia-600 flex items-center gap-1"
                  >
                    <ChevronLeft className="h-3 w-3" /> Categorias
                  </button>
                </div>
                {visiblePhotos.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-500 border border-dashed border-gray-300 rounded-xl">
                    <ImageIcon className="h-7 w-7 mx-auto mb-2 text-gray-300" />
                    Nenhuma foto nesta categoria.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {visiblePhotos.map(p => {
                      const selected = p.id === selectedPhotoId
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPhotoId(p.id)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                            selected ? 'border-fuchsia-500 ring-2 ring-fuchsia-200' : 'border-transparent hover:border-gray-300'
                          }`}
                        >
                          <img src={p.url} alt={p.photo_name} loading="lazy" className="w-full h-full object-cover" />
                          {selected && (
                            <div className="absolute top-1 right-1 h-6 w-6 rounded-full bg-fuchsia-500 text-white flex items-center justify-center shadow-lg">
                              <Check className="h-3.5 w-3.5" />
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Banner: quantas imagens vão ser adicionadas */}
          {selectedPrompt && hasPhoto && (
            <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-fuchsia-500 flex-shrink-0" />
              <p className="text-sm text-fuchsia-800">
                <strong>{selectedPrompt.parts.length} página{selectedPrompt.parts.length !== 1 ? 's' : ''}</strong> vão ser adicionadas à fila de geração — uma por parte do prompt.
              </p>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={handleConfirm} disabled={!canConfirm}>
            <Check className="h-3.5 w-3.5" />
            {selectedPrompt
              ? `Adicionar ${selectedPrompt.parts.length} página${selectedPrompt.parts.length !== 1 ? 's' : ''}`
              : 'Adicionar'}
          </Btn>
        </div>
      </div>
    </div>
  )
}