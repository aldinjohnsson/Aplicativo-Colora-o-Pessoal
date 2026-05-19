// src/components/admin/documents/ai-compositions/AddPageDialog.tsx

import React, { useEffect, useRef, useState } from 'react'
import {
  X, Sparkles, Check, AlertCircle, Image as ImageIcon,
  ChevronDown, ChevronUp, UploadCloud, Trash2, Cpu,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'

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

// ─── Modelos disponíveis ──────────────────────────────────────────────

const MODELS = [
  { value: 'gpt-image-1', label: 'gpt-image-1', desc: 'Melhor qualidade (padrão)' },
  { value: 'dall-e-3',    label: 'DALL·E 3',    desc: 'Alta criatividade' },
  { value: 'dall-e-2',    label: 'DALL·E 2',    desc: 'Mais rápido e barato' },
]

// ─── Types ────────────────────────────────────────────────────────────

interface ClientPhoto {
  id: string
  photo_name: string
  storage_path: string
  url: string
  category_id: string | null
  category_title: string | null
}

interface AiPromptLite {
  id: string
  name: string
  prompt: string
  size: string
  quality: string
}

export interface AddPageResult {
  promptId:   string
  promptName: string
  photoId:    string
  photoName:  string
  photoUrl:   string
  /** Imagem extra de referência em base64 puro (sem prefixo data:…) — opcional */
  uploadedImageBase64?: string
  uploadedImageMime?:   string
  /** Modelo selecionado pelo usuário */
  modelVersion: string
}

interface Props {
  clientId:   string
  clientName: string
  onClose:    () => void
  onConfirm:  (r: AddPageResult) => void
}

// ─── Component ────────────────────────────────────────────────────────

export function AddPageDialog({ clientId, clientName, onClose, onConfirm }: Props) {
  // ── Prompts ──
  const [prompts, setPrompts]                   = useState<AiPromptLite[]>([])
  const [loadingPrompts, setLoadingPrompts]     = useState(true)
  const [promptsError, setPromptsError]         = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [promptOpen, setPromptOpen]             = useState(false)

  // ── Fotos da galeria ──
  const [photos, setPhotos]                   = useState<ClientPhoto[]>([])
  const [loadingPhotos, setLoadingPhotos]     = useState(true)
  const [photosError, setPhotosError]         = useState<string | null>(null)
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null)

  // ── Upload opcional ──
  const fileInputRef                          = useRef<HTMLInputElement>(null)
  const [uploadedBase64, setUploadedBase64]   = useState<string | null>(null)
  const [uploadedMime, setUploadedMime]       = useState<string>('image/png')
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null)
  const [uploadError, setUploadError]         = useState<string | null>(null)

  // ── Modelo ──
  const [modelVersion, setModelVersion] = useState<string>('gpt-image-1')

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

  // ── Upload de imagem de referência ──
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      // Preview
      setUploadedPreview(dataUrl)
      // Extrai só o base64 puro (sem "data:image/png;base64,")
      const base64 = dataUrl.split(',')[1] || ''
      setUploadedBase64(base64)
      setUploadedMime(file.type)
    }
    reader.readAsDataURL(file)
    // Limpa o input pra permitir re-selecionar o mesmo arquivo
    e.target.value = ''
  }

  const handleRemoveUpload = () => {
    setUploadedBase64(null)
    setUploadedPreview(null)
    setUploadedMime('image/png')
    setUploadError(null)
  }

  // ── Derived ──
  const selectedPrompt = prompts.find(p => p.id === selectedPromptId) || null
  const selectedPhoto  = photos.find(p => p.id === selectedPhotoId)  || null
  const canConfirm     = !!selectedPrompt && !!selectedPhoto

  const handleConfirm = () => {
    if (!selectedPrompt || !selectedPhoto) return
    onConfirm({
      promptId:   selectedPrompt.id,
      promptName: selectedPrompt.name,
      photoId:    selectedPhoto.id,
      photoName:  selectedPhoto.photo_name,
      photoUrl:   selectedPhoto.url,
      modelVersion,
      ...(uploadedBase64 ? { uploadedImageBase64: uploadedBase64, uploadedImageMime: uploadedMime } : {}),
    })
  }

  // Agrupa fotos por categoria
  const grouped: Record<string, { title: string; photos: ClientPhoto[] }> = {}
  for (const p of photos) {
    const key = p.category_id || '__none__'
    if (!grouped[key]) grouped[key] = { title: p.category_title || 'Outras fotos', photos: [] }
    grouped[key].photos.push(p)
  }

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
              <Sparkles className="h-4 w-4 text-fuchsia-500" /> Adicionar página à composição
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

          {/* ═══ Passo 1: Prompt ═══ */}
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
                  {prompts.map(p => (
                    <option key={p.id} value={p.id}>{p.name} · {p.size} · {p.quality}</option>
                  ))}
                </select>

                {selectedPrompt && (
                  <div className="mt-2 border border-fuchsia-200 bg-fuchsia-50/40 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPromptOpen(o => !o)}
                      className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-fuchsia-100/40 transition-colors"
                    >
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-fuchsia-700">
                        Ver texto do prompt
                      </span>
                      <span className="text-[11px] text-gray-500 ml-auto">
                        {selectedPrompt.prompt.length.toLocaleString('pt-BR')} caracteres
                      </span>
                      {promptOpen
                        ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                    </button>
                    {promptOpen && (
                      <div className="px-3 pb-3 pt-1 border-t border-fuchsia-200 bg-white">
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
                          {selectedPrompt.prompt}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ═══ Passo 2: Foto da galeria ═══ */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-gray-500" />
              Foto base <span className="text-rose-500">*</span>
              <span className="text-gray-400 font-normal">(da galeria do cliente)</span>
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
          </div>

          {/* ═══ Passo 3: Imagem de referência extra (OPCIONAL) ═══ */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
              <UploadCloud className="h-3.5 w-3.5 text-gray-500" />
              Imagem de referência extra
              <span className="text-gray-400 font-normal">(opcional)</span>
            </p>
            <p className="text-[11px] text-gray-500 mb-2">
              Envie uma imagem adicional para orientar a geração (ex.: estilo, composição, produto).
              Formatos aceitos: PNG, JPEG, WEBP · Máx 10 MB.
            </p>

            {uploadError && (
              <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{uploadError}</p>
              </div>
            )}

            {uploadedPreview ? (
              <div className="flex items-center gap-3 p-2 border border-gray-200 rounded-xl bg-gray-50">
                <img
                  src={uploadedPreview}
                  alt="Referência extra"
                  className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-gray-200"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800">Imagem selecionada</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{uploadedMime}</p>
                </div>
                <Btn variant="danger" size="sm" onClick={handleRemoveUpload}>
                  <Trash2 className="h-3.5 w-3.5" /> Remover
                </Btn>
              </div>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center gap-2 py-6 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-fuchsia-400 hover:text-fuchsia-600 hover:bg-fuchsia-50/30 transition-colors"
                >
                  <UploadCloud className="h-6 w-6" />
                  <span className="text-xs font-medium">Clique para selecionar imagem</span>
                </button>
              </>
            )}
          </div>

          {/* ═══ Passo 4: Modelo ═══ */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-gray-500" />
              Modelo de geração <span className="text-rose-500">*</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {MODELS.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setModelVersion(m.value)}
                  className={`flex flex-col items-start px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                    modelVersion === m.value
                      ? 'border-fuchsia-500 bg-fuchsia-50 ring-2 ring-fuchsia-200'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <span className={`text-sm font-semibold ${modelVersion === m.value ? 'text-fuchsia-800' : 'text-gray-800'}`}>
                    {m.label}
                  </span>
                  <span className="text-[11px] text-gray-500 mt-0.5">{m.desc}</span>
                  {modelVersion === m.value && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-fuchsia-700 bg-fuchsia-100 px-1.5 py-0.5 rounded-full">
                      <Check className="h-2.5 w-2.5" /> selecionado
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={handleConfirm} disabled={!canConfirm}>
            <Check className="h-3.5 w-3.5" /> Adicionar página
          </Btn>
        </div>
      </div>
    </div>
  )
}