// src/components/admin/documents/client/TagValueImageDialog.tsx
//
// Modal usado em ClientTagValuesPanel para definir o valor de uma tag de
// imagem. Três abas:
//   1. "Das fotos do cliente" — grade das fotos já enviadas (client_photos).
//   2. "Das tags de análise"  — imagens das opções selecionadas em
//                               ai_info_templates do tipo imagem.
//   3. "Upload novo"          — file input para imagem avulsa.
//
// A aba "Tags de análise" usa o snapshot/cópia: ao confirmar, baixa os bytes
// da imagem do catálogo (bucket ai-tag-option-images) e devolve como um
// `File` normal via onSelect({ kind: 'upload', file: ... }). Assim o caller
// usa o fluxo existente de upload, sem nenhuma mudança de schema ou de
// resolveTagValues / generatePdf.

import React, { useEffect, useRef, useState } from 'react'
import {
  X, Upload, Image as ImageIcon, Camera, Check, AlertCircle, Tag as TagIcon,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'

// ── Btn ───────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, type = 'button', className = '',
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:   'text-gray-600 hover:bg-gray-100',
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

// ─── Types ─────────────────────────────────────────────────────────────

interface ClientPhoto {
  id: string
  photo_name: string
  storage_path: string
  url: string
  category_id: string | null
  category_title: string | null
}

interface AiInfoImageSource {
  templateId: string
  templateName: string
  selectedLabel: string
  imagePath: string
  imageUrl: string
}

export type ImageDialogResult =
  | { kind: 'photo'; photoId: string }
  | { kind: 'upload'; file: File }

interface Props {
  clientId: string
  tagName: string
  /** id da foto atualmente vinculada (pra destacar no grid), se for o caso */
  currentPhotoId?: string | null
  onClose: () => void
  onSelect: (result: ImageDialogResult) => void | Promise<void>
}

type Tab = 'existing' | 'ai_info' | 'upload'

// ─── Component ────────────────────────────────────────────────────────

export function TagValueImageDialog({
  clientId, tagName, currentPhotoId, onClose, onSelect,
}: Props) {
  const [tab, setTab] = useState<Tab>('existing')

  // ── Aba "fotos do cliente" ──
  const [photos, setPhotos] = useState<ClientPhoto[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(true)
  const [photosError, setPhotosError] = useState<string | null>(null)
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(currentPhotoId ?? null)

  // ── Aba "tags de análise" ──
  const [aiSources, setAiSources] = useState<AiInfoImageSource[]>([])
  const [loadingAi, setLoadingAi] = useState(true)
  const [aiError, setAiError] = useState<string | null>(null)
  const [selectedAiKey, setSelectedAiKey] = useState<string | null>(null)

  // ── Aba "upload" ──
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // ── Submit ──
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Load fotos ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoadingPhotos(true)
    setPhotosError(null)
    documentsService.listClientPhotos(clientId)
      .then(list => { if (!cancelled) setPhotos(list) })
      .catch(e => { if (!cancelled) setPhotosError(e?.message || 'Erro ao carregar fotos') })
      .finally(() => { if (!cancelled) setLoadingPhotos(false) })
    return () => { cancelled = true }
  }, [clientId])

  // ── Load AI info image sources ─────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoadingAi(true)
    setAiError(null)
    documentsService.getAiInfoImageSources(clientId)
      .then(list => { if (!cancelled) setAiSources(list) })
      .catch(e => { if (!cancelled) setAiError(e?.message || 'Erro ao carregar tags de análise') })
      .finally(() => { if (!cancelled) setLoadingAi(false) })
    return () => { cancelled = true }
  }, [clientId])

  // ── Esc pra fechar ──────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ── Upload preview ──────────────────────────────────────────────
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleFileChange = (f: File | null) => {
    setSubmitError(null)
    if (!f) { setFile(null); return }
    if (!f.type.startsWith('image/')) {
      setSubmitError('Selecione um arquivo de imagem (PNG, JPG, etc).')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setSubmitError('Imagem muito grande (máx. 10 MB).')
      return
    }
    setFile(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFileChange(f)
  }

  // ── Materializa imagem do catálogo AI info em File ─────────────
  const buildFileFromAiInfoSource = async (src: AiInfoImageSource): Promise<File> => {
    const res = await fetch(src.imageUrl)
    if (!res.ok) {
      throw new Error(`Falha ao baixar imagem do catálogo (HTTP ${res.status})`)
    }
    const blob = await res.blob()
    const mime = blob.type || 'image/jpeg'
    const ext  = mime.toLowerCase().includes('png') ? 'png' : 'jpg'
    // Nome amigável: "<tag>_<label>.<ext>" sanitizado
    const baseName = `${src.templateName}_${src.selectedLabel}`
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'ai_info'
    const fileName = `${baseName}.${ext}`
    return new File([blob], fileName, { type: mime })
  }

  // ── Submit ───────────────────────────────────────────────────────
  const handleConfirm = async () => {
    setSubmitError(null)
    try {
      setSubmitting(true)

      if (tab === 'existing') {
        if (!selectedPhotoId) {
          setSubmitError('Selecione uma foto.')
          setSubmitting(false)
          return
        }
        await onSelect({ kind: 'photo', photoId: selectedPhotoId })
        return
      }

      if (tab === 'ai_info') {
        const src = aiSources.find(s => s.templateId === selectedAiKey)
        if (!src) {
          setSubmitError('Selecione uma tag de análise.')
          setSubmitting(false)
          return
        }
        const synthFile = await buildFileFromAiInfoSource(src)
        await onSelect({ kind: 'upload', file: synthFile })
        return
      }

      // upload tab
      if (!file) {
        setSubmitError('Escolha um arquivo primeiro.')
        setSubmitting(false)
        return
      }
      await onSelect({ kind: 'upload', file })
    } catch (e: any) {
      setSubmitError(e?.message || 'Erro ao salvar imagem')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Agrupa fotos por categoria pra exibição ────────────────────
  const grouped: Record<string, { title: string; photos: ClientPhoto[] }> = {}
  for (const p of photos) {
    const key = p.category_id || '__none__'
    if (!grouped[key]) {
      grouped[key] = { title: p.category_title || 'Outras fotos', photos: [] }
    }
    grouped[key].photos.push(p)
  }

  // ── Disponibilidade do botão "Usar esta imagem" ────────────────
  const canConfirm =
    (tab === 'existing' && !!selectedPhotoId) ||
    (tab === 'ai_info'  && !!selectedAiKey) ||
    (tab === 'upload'   && !!file)

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-semibold text-gray-900">Escolher imagem</p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              Para a tag: <span className="font-medium text-gray-700">{tagName}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 flex-shrink-0 border-b border-gray-100">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
            <button
              onClick={() => setTab('existing')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'existing' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Camera className="h-3.5 w-3.5" />
              Das fotos do cliente
              {photos.length > 0 && (
                <span className="text-[10px] px-1.5 rounded-full bg-gray-200 text-gray-600">{photos.length}</span>
              )}
            </button>

            <button
              onClick={() => setTab('ai_info')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'ai_info' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <TagIcon className="h-3.5 w-3.5" />
              Das tags de análise
              {aiSources.length > 0 && (
                <span className="text-[10px] px-1.5 rounded-full bg-violet-100 text-violet-700">{aiSources.length}</span>
              )}
            </button>

            <button
              onClick={() => setTab('upload')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'upload' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload novo
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {/* ── Aba: fotos do cliente ───────────────────────────────── */}
          {tab === 'existing' && (
            <>
              {loadingPhotos ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin h-7 w-7 border-2 border-rose-400 border-t-transparent rounded-full" />
                </div>
              ) : photosError ? (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700">{photosError}</p>
                </div>
              ) : photos.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">
                  <ImageIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  Nenhuma foto enviada pelo cliente ainda.
                  <br />
                  Use as outras abas para anexar uma imagem.
                </div>
              ) : (
                <div className="space-y-6">
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
                              onClick={() => setSelectedPhotoId(p.id)}
                              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                                selected ? 'border-rose-500 ring-2 ring-rose-200' : 'border-transparent hover:border-gray-300'
                              }`}
                            >
                              <img
                                src={p.url}
                                alt={p.photo_name}
                                loading="lazy"
                                className="w-full h-full object-cover"
                              />
                              {selected && (
                                <div className="absolute top-1 right-1 h-6 w-6 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg">
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

          {/* ── Aba: tags de análise ────────────────────────────────── */}
          {tab === 'ai_info' && (
            <>
              {loadingAi ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin h-7 w-7 border-2 border-violet-400 border-t-transparent rounded-full" />
                </div>
              ) : aiError ? (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700">{aiError}</p>
                </div>
              ) : aiSources.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">
                  <TagIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  Nenhuma tag de análise do tipo imagem preenchida pra este cliente.
                  <br />
                  Volte à aba <strong>Resultado</strong> do cliente e selecione uma opção que tenha imagem.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {aiSources.map(src => {
                    const selected = selectedAiKey === src.templateId
                    return (
                      <button
                        key={src.templateId}
                        onClick={() => setSelectedAiKey(src.templateId)}
                        className={`group relative rounded-lg overflow-hidden border-2 transition-all text-left ${
                          selected ? 'border-rose-500 ring-2 ring-rose-200' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="aspect-square bg-gray-50 overflow-hidden">
                          <img
                            src={src.imageUrl}
                            alt={src.selectedLabel}
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="px-2 py-1.5 bg-white">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 truncate">
                            {src.templateName}
                          </p>
                          <p className="text-xs font-medium text-gray-800 truncate">
                            {src.selectedLabel}
                          </p>
                        </div>
                        {selected && (
                          <div className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg">
                            <Check className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Aba: upload novo ──────────────────────────────────── */}
          {tab === 'upload' && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => handleFileChange(e.target.files?.[0] || null)}
              />

              {!file ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`w-full border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                    dragOver ? 'border-rose-400 bg-rose-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-700">Clique ou arraste uma imagem aqui</p>
                  <p className="text-xs text-gray-500 mt-1">PNG, JPG ou WebP — até 10 MB</p>
                </button>
              ) : (
                <div className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                  {preview && (
                    <img src={preview} alt={file.name} className="h-20 w-20 object-cover rounded-lg border border-gray-100" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                    <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB · {file.type}</p>
                    <button
                      onClick={() => { setFile(null); setPreview(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                      className="text-xs text-red-600 hover:underline mt-1"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">{submitError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
          <Btn variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Btn>
          <Btn
            variant="primary"
            onClick={handleConfirm}
            loading={submitting}
            disabled={submitting || !canConfirm}
          >
            {submitting ? 'Salvando...' : 'Usar esta imagem'}
          </Btn>
        </div>
      </div>
    </div>
  )
}