// src/components/admin/TagsManager.tsx
import React, { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Tag, ChevronDown, ChevronUp, X, Upload, Image as ImageIcon, Type } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ─── Tipos ─────────────────────────────────────────────────────────────────
type TagType = 'text' | 'image'

interface TagOptionImage { label: string; imagePath: string }
type TagOption = string | TagOptionImage

interface TagTemplate {
  id: string
  name: string
  type: TagType
  options: TagOption[]
  sort_order: number
}

// ─── Constantes ────────────────────────────────────────────────────────────
const OPTION_IMAGE_BUCKET = 'ai-tag-option-images'
const MAX_FILE_SIZE       = 2 * 1024 * 1024   // 2 MB
const MAX_IMAGE_DIMENSION = 800               // px (lado maior, redim. client-side)

// ─── Helpers ───────────────────────────────────────────────────────────────
const getOptionImageUrl = (imagePath: string): string => {
  if (!imagePath) return ''
  const { data } = supabase.storage.from(OPTION_IMAGE_BUCKET).getPublicUrl(imagePath)
  return data.publicUrl
}

const normalizeOption = (opt: TagOption): TagOptionImage => {
  if (typeof opt === 'string') return { label: opt, imagePath: '' }
  return { label: opt?.label ?? '', imagePath: opt?.imagePath ?? '' }
}

// Redimensiona client-side via canvas, retorna Blob JPEG (qualidade 0.85).
// Reduz tráfego de upload e padroniza orientação/formato.
async function resizeImage(file: File, maxDim: number): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload  = () => resolve(el)
      el.onerror = () => reject(new Error('Falha ao ler imagem'))
      el.src = url
    })
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width  * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((res, rej) => {
      canvas.toBlob(
        b => b ? res(b) : rej(new Error('Falha ao converter imagem')),
        'image/jpeg',
        0.85
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function uploadOptionImage(tagId: string, file: File): Promise<string> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Imagem maior que ${MAX_FILE_SIZE / 1024 / 1024}MB (atual: ${(file.size / 1024 / 1024).toFixed(1)}MB)`)
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Arquivo precisa ser uma imagem')
  }
  const blob     = await resizeImage(file, MAX_IMAGE_DIMENSION)
  const safeName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'img'
  const filename = `${Date.now()}_${safeName}.jpg`
  const path     = `${tagId}/${filename}`
  const { error } = await supabase.storage.from(OPTION_IMAGE_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return path
}

async function deleteStorageFile(imagePath: string) {
  if (!imagePath) return
  await supabase.storage.from(OPTION_IMAGE_BUCKET).remove([imagePath])
}

async function deleteAllTagImages(tagId: string) {
  const { data: files } = await supabase.storage.from(OPTION_IMAGE_BUCKET).list(tagId)
  if (files && files.length > 0) {
    const paths = files.map(f => `${tagId}/${f.name}`)
    await supabase.storage.from(OPTION_IMAGE_BUCKET).remove(paths)
  }
}

// ─── Componente ────────────────────────────────────────────────────────────
export function TagsManager() {
  const [tags, setTags]               = useState<TagTemplate[]>([])
  const [loading, setLoading]         = useState(true)
  const [openTag, setOpenTag]         = useState<string | null>(null)

  // ── Criação de tag ──
  const [newTagName, setNewTagName]   = useState('')
  const [newTagType, setNewTagType]   = useState<TagType>('text')
  const [creatingTag, setCreatingTag] = useState(false)

  // ── Form de nova opção (texto OU imagem). Só a tag aberta usa. ──
  const [newOption, setNewOption]               = useState('')
  const [newImageLabel, setNewImageLabel]       = useState('')
  const [newImageFile, setNewImageFile]         = useState<File | null>(null)
  const [newImagePreview, setNewImagePreview]   = useState<string>('')
  const [uploadingOption, setUploadingOption]   = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [])

  // Reseta o form ao trocar a tag aberta
  useEffect(() => {
    if (newImagePreview) URL.revokeObjectURL(newImagePreview)
    setNewOption('')
    setNewImageLabel('')
    setNewImageFile(null)
    setNewImagePreview('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTag])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('ai_info_templates')
      .select('id, name, type, options, sort_order')
      .order('sort_order')
    setTags((data || []).map((t: any) => ({
      ...t,
      type: t.type === 'image' ? 'image' : 'text',
      options: Array.isArray(t.options) ? t.options : [],
    })))
    setLoading(false)
  }

  // ─── Tag CRUD ────────────────────────────────────────────────────────
  const addTag = async () => {
    if (!newTagName.trim() || creatingTag) return
    setCreatingTag(true)
    try {
      const { data, error } = await supabase
        .from('ai_info_templates')
        .insert({
          name: newTagName.trim(),
          type: newTagType,
          options: [],
          sort_order: tags.length,
        })
        .select('id')
        .single()
      if (error) throw error
      setNewTagName('')
      setNewTagType('text')
      await load()
      // Auto-expande a recém-criada — facilita já adicionar opções
      if (data?.id) setOpenTag(data.id)
    } catch (e: any) {
      alert('Erro ao criar tag: ' + e.message)
    } finally {
      setCreatingTag(false)
    }
  }

  const deleteTag = async (id: string) => {
    if (!confirm('Remover esta tag e todas as suas opções (e imagens, se houver)?')) return
    try {
      // 1. Apagar arquivos do storage (não-bloqueante: se falhar, o registro sai mesmo assim)
      await deleteAllTagImages(id).catch(() => {})
      // 2. Apagar registro
      const { error } = await supabase.from('ai_info_templates').delete().eq('id', id)
      if (error) throw error
      if (openTag === id) setOpenTag(null)
      await load()
    } catch (e: any) {
      alert('Erro ao remover tag: ' + e.message)
    }
  }

  const renameTag = async (id: string, name: string) => {
    setTags(prev => prev.map(t => t.id === id ? { ...t, name } : t))
    await supabase.from('ai_info_templates').update({ name }).eq('id', id)
  }

  // ─── Opções: tag TEXTO ──────────────────────────────────────────────
  const addTextOption = async (tagId: string) => {
    if (!newOption.trim()) return
    const tag = tags.find(t => t.id === tagId)
    if (!tag) return
    const updated = [...tag.options, newOption.trim()]
    const { error } = await supabase.from('ai_info_templates').update({ options: updated }).eq('id', tagId)
    if (error) { alert('Erro ao salvar: ' + error.message); return }
    setTags(prev => prev.map(t => t.id === tagId ? { ...t, options: updated } : t))
    setNewOption('')
  }

  // ─── Opções: tag IMAGEM ─────────────────────────────────────────────
  const handleSelectImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_FILE_SIZE) {
      alert(`Imagem muito grande (max ${MAX_FILE_SIZE / 1024 / 1024}MB). Esta tem ${(file.size / 1024 / 1024).toFixed(1)}MB.`)
      return
    }
    if (!file.type.startsWith('image/')) {
      alert('Selecione um arquivo de imagem.')
      return
    }
    if (newImagePreview) URL.revokeObjectURL(newImagePreview)
    setNewImageFile(file)
    setNewImagePreview(URL.createObjectURL(file))
  }

  const clearImageSelection = () => {
    if (newImagePreview) URL.revokeObjectURL(newImagePreview)
    setNewImageFile(null)
    setNewImagePreview('')
  }

  const addImageOption = async (tagId: string) => {
    const label = newImageLabel.trim()
    if (!label) { alert('Digite uma label para a opção.'); return }
    setUploadingOption(true)
    try {
      let imagePath = ''
      if (newImageFile) {
        imagePath = await uploadOptionImage(tagId, newImageFile)
      }
      const tag = tags.find(t => t.id === tagId)
      if (!tag) throw new Error('Tag não encontrada')
      const newOpt: TagOptionImage = { label, imagePath }
      const updated = [...tag.options, newOpt]
      const { error } = await supabase.from('ai_info_templates').update({ options: updated }).eq('id', tagId)
      if (error) {
        // rollback: se o DB falhou, apaga o arquivo recém-uploaded
        if (imagePath) await deleteStorageFile(imagePath).catch(() => {})
        throw error
      }
      setTags(prev => prev.map(t => t.id === tagId ? { ...t, options: updated } : t))
      setNewImageLabel('')
      clearImageSelection()
    } catch (e: any) {
      alert('Erro ao adicionar opção: ' + e.message)
    } finally {
      setUploadingOption(false)
    }
  }

  const removeOption = async (tagId: string, idx: number) => {
    const tag = tags.find(t => t.id === tagId)
    if (!tag) return
    const removed = tag.options[idx]
    const updated = tag.options.filter((_, i) => i !== idx)
    const { error } = await supabase.from('ai_info_templates').update({ options: updated }).eq('id', tagId)
    if (error) { alert('Erro ao remover: ' + error.message); return }
    setTags(prev => prev.map(t => t.id === tagId ? { ...t, options: updated } : t))
    // Apaga arquivo do storage se for opção-imagem
    if (typeof removed === 'object' && removed?.imagePath) {
      deleteStorageFile(removed.imagePath).catch(() => {})
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────
  const inp = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin h-6 w-6 border-2 border-violet-400 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
            <Tag className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Tags de Informação</h2>
            <p className="text-sm text-gray-500">Crie categorias (texto ou imagem) com opções para vincular às clientes</p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">
        <p className="text-xs text-gray-500">
          Crie tags como "Coloração Pessoal" (texto) ou "Base" (imagem) e adicione opções. Na aba <strong>Resultado</strong> de cada cliente, selecione a opção correta de cada tag.
        </p>

        {/* Lista de tags */}
        <div className="space-y-2">
          {tags.map(tag => {
            const isOpen     = openTag === tag.id
            const isImageTag = tag.type === 'image'
            return (
              <div key={tag.id} className="border border-gray-200 rounded-xl overflow-hidden">
                {/* Cabeçalho colapsável */}
                <div
                  className={`px-4 py-3 flex items-center gap-3 cursor-pointer ${isOpen ? 'bg-emerald-50' : 'bg-white hover:bg-gray-50'}`}
                  onClick={() => setOpenTag(isOpen ? null : tag.id)}
                >
                  <Tag className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <span className="font-medium text-sm text-gray-800 flex-1 truncate">{tag.name}</span>

                  {/* Badge de tipo */}
                  {isImageTag ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                      <ImageIcon className="h-3 w-3" /> Imagem
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      <Type className="h-3 w-3" /> Texto
                    </span>
                  )}

                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{tag.options.length} opções</span>
                  <button onClick={e => { e.stopPropagation(); deleteTag(tag.id) }} className="text-gray-300 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>

                {/* Painel expandido */}
                {isOpen && (
                  <div className="px-4 py-3 border-t border-gray-100 space-y-3">
                    {/* Rename */}
                    <div>
                      <label className="text-xs text-gray-500">Nome da tag</label>
                      <input
                        value={tag.name}
                        onChange={e => renameTag(tag.id, e.target.value)}
                        className={`${inp} text-sm`}
                      />
                    </div>

                    {/* Tipo (readonly) */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">Tipo:</span>
                      {isImageTag ? (
                        <span className="inline-flex items-center gap-1 font-medium text-violet-700">
                          <ImageIcon className="h-3 w-3" /> Imagem
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-blue-700">
                          <Type className="h-3 w-3" /> Texto
                        </span>
                      )}
                      <span className="text-gray-400">(definido na criação, não pode ser alterado)</span>
                    </div>

                    {/* Opções cadastradas */}
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-2">Opções cadastradas:</label>

                      {tag.options.length === 0 && (
                        <span className="text-xs text-gray-400 italic">Nenhuma opção</span>
                      )}

                      {/* Tag TEXTO: pílulas */}
                      {!isImageTag && tag.options.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {tag.options.map((opt, idx) => {
                            const label = typeof opt === 'string' ? opt : (opt?.label ?? '')
                            return (
                              <span key={idx} className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-xs px-2.5 py-1 rounded-full">
                                {label}
                                <button onClick={() => removeOption(tag.id, idx)} className="hover:text-red-500">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )
                          })}
                        </div>
                      )}

                      {/* Tag IMAGEM: grade de cards */}
                      {isImageTag && tag.options.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {tag.options.map((rawOpt, idx) => {
                            const opt = normalizeOption(rawOpt)
                            return (
                              <div key={idx} className="relative aspect-square rounded-lg border border-gray-200 overflow-hidden group">
                                {opt.imagePath ? (
                                  <img
                                    src={getOptionImageUrl(opt.imagePath)}
                                    alt={opt.label}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-gray-50 text-[10px] text-gray-400 text-center px-2">
                                    sem imagem
                                  </div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[11px] font-medium px-2 py-1 truncate">
                                  {opt.label}
                                </div>
                                <button
                                  onClick={() => removeOption(tag.id, idx)}
                                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Remover opção"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Form: nova opção (texto) */}
                    {!isImageTag && (
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Nova opção:</label>
                        <div className="flex gap-1.5">
                          <input
                            value={newOption}
                            onChange={e => setNewOption(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addTextOption(tag.id) }}
                            placeholder="Nova opção (ex: Verão Suave)"
                            className={`${inp} flex-1 text-xs`}
                          />
                          <button
                            onClick={() => addTextOption(tag.id)}
                            disabled={!newOption.trim()}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium disabled:opacity-40 flex items-center gap-1"
                          >
                            <Plus className="h-3 w-3" /> Adicionar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Form: nova opção (imagem) */}
                    {isImageTag && (
                      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                        <label className="text-xs font-medium text-gray-600 block">Nova opção:</label>

                        {/* Label */}
                        <input
                          value={newImageLabel}
                          onChange={e => setNewImageLabel(e.target.value)}
                          placeholder="Label (ex: Pele negra)"
                          className={`${inp} text-xs`}
                        />

                        {/* Seleção de arquivo + preview + botão Adicionar */}
                        <div className="flex items-center gap-2">
                          {newImagePreview ? (
                            <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">
                              <img src={newImagePreview} alt="preview" className="w-full h-full object-cover" />
                              <button
                                onClick={clearImageSelection}
                                className="absolute top-0 right-0 w-5 h-5 bg-black/60 text-white flex items-center justify-center rounded-bl-lg"
                                title="Remover seleção"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
                              type="button"
                            >
                              <Upload className="h-3.5 w-3.5" /> Escolher imagem
                            </button>
                          )}
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleSelectImageFile}
                          />

                          <button
                            onClick={() => addImageOption(tag.id)}
                            disabled={!newImageLabel.trim() || uploadingOption}
                            className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium disabled:opacity-40 flex items-center gap-1 ml-auto"
                          >
                            {uploadingOption ? (
                              <>
                                <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                                Enviando...
                              </>
                            ) : (
                              <>
                                <Plus className="h-3 w-3" /> Adicionar
                              </>
                            )}
                          </button>
                        </div>

                        <p className="text-[10px] text-gray-400">
                          Imagem opcional · max 2MB · redimensionada pra 800px no maior lado
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {tags.length === 0 && (
            <p className="text-sm text-center py-4 text-gray-400 italic">Nenhuma tag cadastrada.</p>
          )}
        </div>

        {/* Criar nova tag */}
        <div className="border-t border-gray-100 pt-4 space-y-2">
          <p className="text-xs font-medium text-gray-600">Nova tag:</p>

          {/* Toggle de tipo */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setNewTagType('text')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                newTagType === 'text'
                  ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              <Type className="h-3.5 w-3.5" /> Texto
            </button>
            <button
              type="button"
              onClick={() => setNewTagType('image')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                newTagType === 'image'
                  ? 'bg-violet-100 text-violet-700 ring-1 ring-violet-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" /> Imagem
            </button>
            <span className="text-[10px] text-gray-400 ml-1">
              {newTagType === 'image' ? 'opções serão imagens com label' : 'opções serão textos'}
            </span>
          </div>

          <div className="flex gap-2 flex-wrap">
            <input
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTag()}
              placeholder="Nome da tag (ex: Tipo de Cabelo)"
              className={`${inp} flex-1`}
            />
            <button
              onClick={addTag}
              disabled={!newTagName.trim() || creatingTag}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1"
            >
              {creatingTag
                ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                : <Plus className="h-4 w-4" />}
              Criar tag
            </button>
          </div>

          <p className="text-[10px] text-gray-400">
            ⚠️ O tipo (texto/imagem) é definido na criação e não pode ser alterado depois.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800">
            💡 Na aba <strong>Resultado</strong> de cada cliente, você seleciona a opção correta de cada tag. A IA usa essas informações para responder com precisão.
          </p>
        </div>
      </div>
    </div>
  )
}