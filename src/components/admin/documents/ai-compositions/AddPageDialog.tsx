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

import React, { useEffect, useRef, useState } from 'react'
import {
  X, Sparkles, Check, AlertCircle, Image as ImageIcon,
  ChevronDown, ChevronUp, UploadCloud, Trash2, Layers,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
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
  // Foto base — galeria ou upload
  photoId?:    string         // presente se veio da galeria
  photoName:   string
  photoUrl:    string         // thumbnail pra preview no card
  driveFileId?: string
  uploadedPhotoBase64?: string  // presente se foi feito upload
  uploadedPhotoMime?:   string
  // Modelo vem do prompt
  modelVersion: string
}

interface Props {
  clientId:   string
  clientName: string
  onClose:    () => void
  onConfirm:  (results: AddPageResult[]) => void   // ← array, uma entrada por parte
}

type PhotoSource = 'gallery' | 'upload'

// ─── Component ────────────────────────────────────────────────────────

export function AddPageDialog({ clientId, clientName, onClose, onConfirm }: Props) {

  // ── Prompts ──
  const [prompts, setPrompts]                   = useState<AiPromptLite[]>([])
  const [loadingPrompts, setLoadingPrompts]     = useState(true)
  const [promptsError, setPromptsError]         = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [promptOpen, setPromptOpen]             = useState(false)

  // ── Foto base ──
  const [photoSource, setPhotoSource]           = useState<PhotoSource>('gallery')

  // Galeria
  const [photos, setPhotos]                     = useState<ClientPhoto[]>([])
  const [loadingPhotos, setLoadingPhotos]       = useState(true)
  const [photosError, setPhotosError]           = useState<string | null>(null)
  const [selectedPhotoId, setSelectedPhotoId]   = useState<string | null>(null)

  // Upload
  const photoFileRef                            = useRef<HTMLInputElement>(null)
  const [uploadedBase64, setUploadedBase64]     = useState<string | null>(null)
  const [uploadedMime, setUploadedMime]         = useState<string>('image/png')
  const [uploadedPreview, setUploadedPreview]   = useState<string | null>(null)
  const [uploadedName, setUploadedName]         = useState<string>('foto-upload')
  const [uploadError, setUploadError]           = useState<string | null>(null)

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

  // ── Upload de foto ──
  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    const ALLOWED = ['image/png', 'image/jpeg', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      setUploadError('Formato não suportado. Use PNG, JPEG ou WEBP.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Arquivo muito grande. Máximo 10 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setUploadedPreview(dataUrl)
      setUploadedBase64(dataUrl.split(',')[1] || '')
      setUploadedMime(file.type)
      setUploadedName(file.name)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleRemoveUpload = () => {
    setUploadedBase64(null)
    setUploadedPreview(null)
    setUploadedMime('image/png')
    setUploadedName('foto-upload')
    setUploadError(null)
  }

  // Quando troca de aba de foto, limpa a seleção da outra aba
  const handlePhotoSourceChange = (src: PhotoSource) => {
    setPhotoSource(src)
    if (src === 'gallery') {
      handleRemoveUpload()
    } else {
      setSelectedPhotoId(null)
    }
  }

  // ── Derived ──
  const selectedPrompt = prompts.find(p => p.id === selectedPromptId) || null
  const selectedPhoto  = photos.find(p => p.id === selectedPhotoId)  || null

  const hasPhoto =
    photoSource === 'gallery'
      ? !!selectedPhoto
      : !!uploadedBase64

  const canConfirm = !!selectedPrompt && hasPhoto

  // ── Confirm: gera 1 resultado por parte ──
  const handleConfirm = () => {
    if (!selectedPrompt || !hasPhoto) return

    const basePhotoInfo =
      photoSource === 'gallery' && selectedPhoto
        ? {
            photoId:    selectedPhoto.id,
            photoName:  selectedPhoto.photo_name,
            photoUrl:   selectedPhoto.url,
            driveFileId: selectedPhoto.drive_file_id ?? undefined,
          }
        : {
            photoId:    undefined,
            photoName:  uploadedName,
            photoUrl:   uploadedPreview!,
            uploadedPhotoBase64: uploadedBase64!,
            uploadedPhotoMime:   uploadedMime,
          }

    const results: AddPageResult[] = selectedPrompt.parts.map(part => ({
      promptId:    selectedPrompt.id,
      promptName:  selectedPrompt.name,
      partId:      part.id,
      partLabel:   part.label,
      partPrompt:  part.prompt,
      modelVersion: selectedPrompt.model,
      ...basePhotoInfo,
    }))

    onConfirm(results)
  }

  // Agrupa fotos por categoria (galeria)
  const grouped: Record<string, { title: string; photos: ClientPhoto[] }> = {}
  for (const p of photos) {
    const key = p.category_id || '__none__'
    if (!grouped[key]) grouped[key] = { title: p.category_title || 'Outras fotos', photos: [] }
    grouped[key].photos.push(p)
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

            {/* Tabs: galeria / upload */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-3">
              <button
                type="button"
                onClick={() => handlePhotoSourceChange('gallery')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  photoSource === 'gallery'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Da galeria do cliente
              </button>
              <button
                type="button"
                onClick={() => handlePhotoSourceChange('upload')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  photoSource === 'upload'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Fazer upload
              </button>
            </div>

            {/* ── Galeria ── */}
            {photoSource === 'gallery' && (
              <>
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
                  <div className="text-center py-12 text-sm text-gray-500 border border-dashed border-gray-300 rounded-xl">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                    Nenhuma foto enviada por esse cliente ainda.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {Object.entries(grouped).map(([key, group]) => (
                      <div key={key}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
                          {group.title}
                        </p>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                          {group.photos.map(p => {
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
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Upload de foto ── */}
            {photoSource === 'upload' && (
              <div>
                {uploadError && (
                  <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-700">{uploadError}</p>
                  </div>
                )}

                <input
                  ref={photoFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handlePhotoFileChange}
                />

                {uploadedPreview ? (
                  <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl bg-gray-50">
                    <img
                      src={uploadedPreview}
                      alt="Foto selecionada"
                      className="w-20 h-20 rounded-lg object-cover flex-shrink-0 border border-gray-200"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{uploadedName}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{uploadedMime}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <button type="button" onClick={() => photoFileRef.current?.click()}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium">
                        Trocar
                      </button>
                      <Btn variant="danger" size="sm" onClick={handleRemoveUpload}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => photoFileRef.current?.click()}
                    className="w-full flex flex-col items-center gap-2 py-10 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-fuchsia-400 hover:text-fuchsia-600 hover:bg-fuchsia-50/30 transition-colors"
                  >
                    <UploadCloud className="h-8 w-8" />
                    <span className="text-sm font-medium">Clique para selecionar a foto base</span>
                    <span className="text-xs text-gray-400">PNG, JPEG, WEBP · Máx 10 MB</span>
                  </button>
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