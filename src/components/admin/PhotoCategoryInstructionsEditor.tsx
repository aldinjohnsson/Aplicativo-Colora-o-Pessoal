// src/components/admin/PhotoCategoryInstructionsEditor.tsx
//
// Substitui os campos: video_url (string) + instructions (string[])
// por um array unificado instruction_items: InstructionItem[]
//
// Cada item pode ser: text | video | image
// Renderiza um carousel de preview e permite reordenar, adicionar e remover.
//
// INTEGRAÇÃO: use este componente no lugar dos campos "Link do Vídeo YouTube"
// e "Instruções para o cliente" no editor de categoria de fotos.
//
// EXEMPLO DE USO:
//   <PhotoCategoryInstructionsEditor
//     items={category.instruction_items || []}
//     onChange={items => updateCategory({ instruction_items: items })}
//     onUpload={uploadFile}   // async (file) => { storagePath, url }
//   />

import React, { useState, useRef } from 'react'
import {
  Plus, Trash2, GripVertical, Image as ImageIcon, Video, Type,
  ChevronLeft, ChevronRight, Play, X, Upload, Eye, EyeOff,
  Youtube, FileImage, AlignLeft, ArrowUp, ArrowDown
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstructionItem {
  id: string
  type: 'text' | 'video' | 'image'
  content: string        // text / YouTube URL / caption
  imageUrl?: string      // for type === 'image'
  storagePath?: string   // for type === 'image'
}

interface PhotoCategoryInstructionsEditorProps {
  items: InstructionItem[]
  onChange: (items: InstructionItem[]) => void
  /** Called with a File; must return { storagePath, url }. Match your supabase uploadFile helper. */
  onUpload: (file: File) => Promise<{ storagePath: string; url: string }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9)

function getYouTubeEmbed(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/
  )
  return match ? `https://www.youtube.com/embed/${match[1]}?rel=0&modestbranding=1` : null
}

function getYouTubeThumbnail(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/
  )
  return match ? `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg` : null
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PhotoCategoryInstructionsEditor({
  items,
  onChange,
  onUpload,
}: PhotoCategoryInstructionsEditorProps) {
  const [previewIndex, setPreviewIndex] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingItemId = useRef<string | null>(null)

  // ── CRUD ────────────────────────────────────────────────────────────────────

  const addItem = (type: 'text' | 'video' | 'image') => {
    const item: InstructionItem = { id: uid(), type, content: '' }
    onChange([...items, item])
  }

  const updateItem = (id: string, patch: Partial<InstructionItem>) => {
    onChange(items.map(it => (it.id === id ? { ...it, ...patch } : it)))
  }

  const removeItem = (id: string) => {
    onChange(items.filter(it => it.id !== id))
    if (previewIndex >= items.length - 1) setPreviewIndex(Math.max(0, items.length - 2))
  }

  const moveItem = (id: string, dir: -1 | 1) => {
    const i = items.findIndex(it => it.id === id)
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  // ── Image Upload ─────────────────────────────────────────────────────────────

  const triggerImageUpload = (itemId: string) => {
    pendingItemId.current = itemId
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const id = pendingItemId.current
    if (!file || !id) return
    e.target.value = ''
    setUploadingId(id)
    try {
      const { url, storagePath } = await onUpload(file)
      updateItem(id, { imageUrl: url, storagePath })
    } catch (err: any) {
      alert('Erro ao enviar imagem: ' + err.message)
    } finally {
      setUploadingId(null)
      pendingItemId.current = null
    }
  }

  // ── Preview carousel items (only video + image) ───────────────────────────

  const mediaItems = items.filter(it => it.type === 'video' || it.type === 'image')

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium text-gray-700">
          Instruções para o cliente
        </label>

        <div className="flex items-center gap-2">
          {mediaItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPreview(v => !v)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-colors"
            >
              {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showPreview ? 'Ocultar' : 'Preview'}
            </button>
          )}
        </div>
      </div>

      {/* Preview carousel (admin) */}
      {showPreview && mediaItems.length > 0 && (
        <MediaCarouselPreview
          mediaItems={mediaItems}
          index={previewIndex}
          setIndex={setPreviewIndex}
        />
      )}

      {/* Items list */}
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="border-2 border-dashed border-gray-200 rounded-xl py-6 text-center">
            <p className="text-sm text-gray-400">Nenhuma instrução ainda</p>
            <p className="text-xs text-gray-300 mt-1">Adicione texto, vídeo ou imagem</p>
          </div>
        )}

        {items.map((item, idx) => (
          <InstructionItemRow
            key={item.id}
            item={item}
            index={idx}
            total={items.length}
            uploading={uploadingId === item.id}
            onUpdate={patch => updateItem(item.id, patch)}
            onRemove={() => removeItem(item.id)}
            onMove={dir => moveItem(item.id, dir)}
            onTriggerUpload={() => triggerImageUpload(item.id)}
          />
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => addItem('text')}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <AlignLeft className="h-3.5 w-3.5" />
          + Texto
        </button>
        <button
          type="button"
          onClick={() => addItem('video')}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
        >
          <Youtube className="h-3.5 w-3.5" />
          + Vídeo YouTube
        </button>
        <button
          type="button"
          onClick={() => addItem('image')}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <FileImage className="h-3.5 w-3.5" />
          + Imagem
        </button>
      </div>

      {items.length > 0 && (
        <p className="text-xs text-gray-400">
          💡 Vídeos e imagens aparecem como carousel para o cliente
        </p>
      )}
    </div>
  )
}

// ─── InstructionItemRow ───────────────────────────────────────────────────────

interface ItemRowProps {
  item: InstructionItem
  index: number
  total: number
  uploading: boolean
  onUpdate: (patch: Partial<InstructionItem>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  onTriggerUpload: () => void
}

function InstructionItemRow({
  item, index, total, uploading, onUpdate, onRemove, onMove, onTriggerUpload
}: ItemRowProps) {
  const TYPE_CONFIG = {
    text:  { label: 'Texto',   icon: AlignLeft,  bg: 'bg-gray-100',  text: 'text-gray-600',  border: 'border-gray-200' },
    video: { label: 'Vídeo',   icon: Youtube,    bg: 'bg-red-50',    text: 'text-red-600',   border: 'border-red-200' },
    image: { label: 'Imagem',  icon: FileImage,  bg: 'bg-blue-50',   text: 'text-blue-600',  border: 'border-blue-200' },
  }
  const cfg = TYPE_CONFIG[item.type]
  const Icon = cfg.icon
  const thumb = item.type === 'video'
    ? getYouTubeThumbnail(item.content)
    : item.imageUrl

  return (
    <div className={`border ${cfg.border} rounded-xl overflow-hidden bg-white`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 ${cfg.bg}`}>
        <Icon className={`h-3.5 w-3.5 ${cfg.text} flex-shrink-0`} />
        <span className={`text-xs font-medium ${cfg.text} flex-1`}>
          {cfg.label}
        </span>
        {/* Thumb preview */}
        {thumb && (
          <img src={thumb} alt="" className="w-8 h-6 rounded object-cover flex-shrink-0 border" />
        )}
        {/* Order controls */}
        <div className="flex gap-0.5">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 text-gray-300 hover:text-red-500 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-3 space-y-2">
        {item.type === 'text' && (
          <textarea
            value={item.content}
            onChange={e => onUpdate({ content: e.target.value })}
            placeholder="Ex: Foto de frente, sem maquiagem, com boa iluminação"
            rows={2}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
          />
        )}

        {item.type === 'video' && (
          <div className="space-y-2">
            <input
              type="url"
              value={item.content}
              onChange={e => onUpdate({ content: e.target.value })}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            {item.content && getYouTubeEmbed(item.content) ? (
              <div className="aspect-video rounded-lg overflow-hidden bg-black">
                <iframe
                  src={getYouTubeEmbed(item.content)!}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : item.content ? (
              <p className="text-xs text-red-500">URL do YouTube inválida</p>
            ) : null}
            <input
              type="text"
              value={item.content ? (getYouTubeEmbed(item.content) ? item.imageUrl || '' : '') : ''}
              onChange={e => onUpdate({ imageUrl: e.target.value })}
              placeholder="Legenda do vídeo (opcional)"
              className="w-full text-xs px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>
        )}

        {item.type === 'image' && (
          <div className="space-y-2">
            {item.imageUrl ? (
              <div className="relative">
                <img
                  src={item.imageUrl}
                  alt="instrução"
                  className="w-full max-h-48 object-contain rounded-lg border border-gray-200 bg-gray-50"
                />
                <div className="absolute top-2 right-2 flex gap-1">
                  <button
                    type="button"
                    onClick={onTriggerUpload}
                    className="p-1.5 bg-white/90 rounded-lg shadow text-gray-600 hover:text-gray-900 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdate({ imageUrl: undefined, storagePath: undefined })}
                    className="p-1.5 bg-white/90 rounded-lg shadow text-red-500 hover:text-red-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onTriggerUpload}
                disabled={uploading}
                className="w-full border-2 border-dashed border-blue-200 rounded-xl py-6 flex flex-col items-center gap-2 hover:border-blue-400 hover:bg-blue-50/50 transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <div className="animate-spin h-6 w-6 border-2 border-blue-400 border-t-transparent rounded-full" />
                ) : (
                  <FileImage className="h-7 w-7 text-blue-300" />
                )}
                <span className="text-sm text-blue-500">
                  {uploading ? 'Enviando...' : 'Clique para selecionar imagem'}
                </span>
              </button>
            )}
            <input
              type="text"
              value={item.content}
              onChange={e => onUpdate({ content: e.target.value })}
              placeholder="Legenda da imagem (opcional)"
              className="w-full text-xs px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── MediaCarouselPreview (admin only) ───────────────────────────────────────

function MediaCarouselPreview({
  mediaItems, index, setIndex,
}: {
  mediaItems: InstructionItem[]
  index: number
  setIndex: (i: number) => void
}) {
  const current = mediaItems[Math.min(index, mediaItems.length - 1)]
  const safeIndex = Math.min(index, mediaItems.length - 1)

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      {/* Media */}
      <div className="relative aspect-video">
        {current.type === 'video' && getYouTubeEmbed(current.content) ? (
          <iframe
            src={getYouTubeEmbed(current.content)!}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : current.type === 'image' && current.imageUrl ? (
          <img
            src={current.imageUrl}
            alt={current.content}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            <p className="text-sm">Sem mídia para exibir</p>
          </div>
        )}

        {/* Nav arrows */}
        {mediaItems.length > 1 && (
          <>
            <button
              onClick={() => setIndex((safeIndex - 1 + mediaItems.length) % mediaItems.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIndex((safeIndex + 1) % mediaItems.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Dots + caption */}
      <div className="px-4 py-3">
        {current.content && (
          <p className="text-xs text-gray-300 mb-2 text-center">{current.content}</p>
        )}
        {mediaItems.length > 1 && (
          <div className="flex items-center justify-center gap-1.5">
            {mediaItems.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className={`rounded-full transition-all ${
                  i === safeIndex ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/40'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Migration helper ──────────────────────────────────────────────────────────
// Converte o formato legado (video_url + instructions[]) para InstructionItem[]

export function migrateToInstructionItems(
  videoUrl?: string,
  instructions?: string[],
  existingItems?: InstructionItem[],
): InstructionItem[] {
  if (existingItems && existingItems.length > 0) return existingItems

  const result: InstructionItem[] = []
  if (videoUrl) {
    result.push({ id: uid(), type: 'video', content: videoUrl })
  }
  if (instructions) {
    for (const text of instructions) {
      if (text.trim()) result.push({ id: uid(), type: 'text', content: text })
    }
  }
  return result
}