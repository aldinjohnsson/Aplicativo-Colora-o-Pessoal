// src/components/admin/FoldersManager.tsx
import React, { useState, useEffect, useRef } from 'react'
import {
  FolderOpen, Plus, Trash2, Save, CheckCircle, AlertCircle,
  ChevronDown, ChevronUp, X, Scissors, Palette, Shirt, Gem,
  Image, FileText, Upload, ArrowLeft, Sparkles, Copy, Link2, Camera
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { CategoryTypeModal, usePhotoTypes } from './CategoryTypeModal'


// ─── Types ───────────────────────────────────────────────────

interface PromptImage { storagePath: string; url: string; label: string }

interface Prompt {
  id: string; name: string; instructions: string
  images: PromptImage[]
  thumbnail: PromptImage | null
  options: string[]
  tintReference: string
  reference: string
  order: number
}

interface Category {
  id: string; name: string; icon: string
  type: string
  refPhotoType: string   // qual foto da cliente usar na IA
  order: number; prompts: Prompt[]
}

export interface FolderConfig {
  folderName: string
  baseInstructions: string
  driveLink: string             // link da pasta do Google Drive
  categories: Category[]
}

interface Folder { id: string; name: string; config: FolderConfig; created_at: string }

const uid = () => Math.random().toString(36).slice(2, 8)
const ICONS: Record<string, any> = { scissors: Scissors, palette: Palette, shirt: Shirt, gem: Gem, folder: FolderOpen }
const ICON_LIST = Object.keys(ICONS)

const DEFAULT_CATS: Category[] = [
  { id: uid(), name: 'Cabelos', icon: 'scissors', type: 'cabelo', refPhotoType: 'cabelo', order: 0, prompts: [] },
  { id: uid(), name: 'Maquiagem', icon: 'palette', type: 'maquiagem', refPhotoType: 'maquiagem', order: 1, prompts: [] },
  { id: uid(), name: 'Roupas', icon: 'shirt', type: 'roupa', refPhotoType: 'roupa', order: 2, prompts: [] },
  { id: uid(), name: 'Acessórios', icon: 'gem', type: 'maquiagem', refPhotoType: '', order: 3, prompts: [] },
]

const newPrompt = (order: number): Prompt => ({
  id: uid(), name: '', instructions: '', images: [],
  thumbnail: null, options: [], tintReference: '', reference: '', order,
})

const emptyConfig = (): FolderConfig => ({
  folderName: '', baseInstructions: '', driveLink: '', categories: [],
})

// ─── Component ───────────────────────────────────────────────

export function FoldersManager() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [config, setConfig] = useState<FolderConfig>(emptyConfig())
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [activePrompt, setActivePrompt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [newOpt, setNewOpt] = useState('')
  const [uploadingImg, setUploadingImg] = useState(false)
  const [uploadingThumb, setUploadingThumb] = useState(false)

  useEffect(() => { loadFolders() }, [])

  const loadFolders = async () => {
    setLoading(true)
    const { data } = await supabase.from('ai_folders').select('*').order('name')
    setFolders(data || [])
    setLoading(false)
  }
  const { types: photoTypes } = usePhotoTypes()
  const [typeModalOpen, setTypeModalOpen] = useState(false)

  // ── Folder CRUD ────────────────────────────────────────────

  const createFolder = () => {
    const name = window.prompt('Nome da pasta (ex: Verão Suave):')
    if (!name?.trim()) return
    setConfig({ ...emptyConfig(), folderName: name.trim(), categories: DEFAULT_CATS.map(c => ({ ...c, id: uid() })) })
    setEditingFolder({ id: 'new', name: name.trim(), config: emptyConfig(), created_at: '' })
    setActiveCat(null); setActivePrompt(null)
  }

  const openFolder = (f: Folder) => {
    const c: FolderConfig = typeof f.config === 'string' ? JSON.parse(f.config) : { ...f.config }
    // Migrar campos faltantes
    if (!c.driveLink) c.driveLink = ''
    if (c.categories) {
      c.categories = c.categories.map((cat: any) => ({
        ...cat,
        type: cat.type || (cat.icon === 'scissors' ? 'cabelo' : cat.icon === 'shirt' ? 'roupa' : 'maquiagem'),
        refPhotoType: cat.refPhotoType === 'geral' ? '' : (cat.refPhotoType || (cat.icon === 'scissors' ? 'cabelo' : cat.icon === 'shirt' ? 'roupa' : '')),
        prompts: (cat.prompts || []).map((p: any) => ({
          ...p,
          thumbnail: p.thumbnail || null,
          tintReference: p.tintReference || '',
          reference: p.reference || '',
          options: p.options || [],
        }))
      }))
    }
    setConfig(c)
    setEditingFolder(f)
    setActiveCat(null); setActivePrompt(null)
  }

  const duplicateFolder = async (f: Folder) => {
    const name = window.prompt('Nome da cópia:', f.name + ' (cópia)')
    if (!name?.trim()) return
    const c: FolderConfig = typeof f.config === 'string' ? JSON.parse(f.config) : { ...f.config }
    await supabase.from('ai_folders').insert({ name: name.trim(), config: { ...c, folderName: name.trim() } })
    loadFolders()
  }

  const deleteFolder = async (id: string) => {
    if (!confirm('Excluir pasta?')) return
    await supabase.from('ai_folders').delete().eq('id', id)
    if (editingFolder?.id === id) setEditingFolder(null)
    loadFolders()
  }

  const handleSave = async () => {
    if (!editingFolder) return
    setSaving(true); setSaveStatus('idle')
    try {
      if (editingFolder.id === 'new') {
        await supabase.from('ai_folders').insert({ name: config.folderName, config })
      } else {
        await supabase.from('ai_folders').update({ name: config.folderName, config, updated_at: new Date().toISOString() }).eq('id', editingFolder.id)
      }
      setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 3000)
      loadFolders()
      if (editingFolder.id === 'new') setEditingFolder(null)
    } catch { setSaveStatus('error') }
    finally { setSaving(false) }
  }

  // ── Category CRUD ──────────────────────────────────────────

  const handleAddCategoryClick = () => {
      setTypeModalOpen(true)
    }

    const handleTypeSelected = (typeId: string, typeName: string) => {
      setTypeModalOpen(false)

      const newCategory = {
        id: uid(),
        name: `Nova Categoria (${typeName})`,
        icon: 'folder',
        type: typeId,
        refPhotoType: typeId,
        order: config.categories.length,
        prompts: [],
      }

      setConfig(prev => ({
        ...prev,
        categories: [...prev.categories, newCategory],
      }))
    }

    const handleTypeModalCancel = () => {
      setTypeModalOpen(false)
      // Cancelled — no category created; user must try again
    }

  const removeCategory = (catId: string) => {
    if (!confirm('Remover categoria?')) return
    setConfig(prev => ({ ...prev, categories: prev.categories.filter(c => c.id !== catId) }))
    if (activeCat === catId) { setActiveCat(null); setActivePrompt(null) }
  }

  const updateCat = (catId: string, u: Partial<Category>) => {
    setConfig(prev => ({ ...prev, categories: prev.categories.map(c => c.id === catId ? { ...c, ...u } : c) }))
  }
  const handleCategoryTypeChange = (catId: string, typeId: string) => {
    setConfig(prev => ({
      ...prev,
      categories: prev.categories.map(c =>
        c.id === catId
          ? { ...c, type: typeId as any, refPhotoType: typeId as any }
          : c
      ),
    }))
  }

  // ── Prompt CRUD ────────────────────────────────────────────

  const addPrompt = (catId: string) => {
    const name = window.prompt('Nome do prompt (ex: Loiro Bege):')
    if (!name) return
    const cat = config.categories.find(c => c.id === catId)
    if (!cat) return
    const p = newPrompt(cat.prompts.length)
    p.name = name
    if (cat.type === 'cabelo') p.options = ['Curto', 'Médio', 'Longo']
    updateCat(catId, { prompts: [...cat.prompts, p] })
    setActivePrompt(p.id)
  }

  const removePrompt = (catId: string, pId: string) => {
    if (!confirm('Remover?')) return
    const cat = config.categories.find(c => c.id === catId)
    if (!cat) return
    updateCat(catId, { prompts: cat.prompts.filter(p => p.id !== pId) })
    if (activePrompt === pId) setActivePrompt(null)
  }

  const updatePrompt = (catId: string, pId: string, u: Partial<Prompt>) => {
    const cat = config.categories.find(c => c.id === catId)
    if (!cat) return
    updateCat(catId, { prompts: cat.prompts.map(p => p.id === pId ? { ...p, ...u } : p) })
  }

  // ── Uploads ────────────────────────────────────────────────

  const uploadFile = async (file: File, prefix: string): Promise<{ storagePath: string; url: string }> => {
    const path = `ai-materials/folders/${prefix}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    await supabase.storage.from('client-photos').upload(path, file, { contentType: file.type, upsert: true })
    return { storagePath: path, url: supabase.storage.from('client-photos').getPublicUrl(path).data.publicUrl }
  }

  const handleThumbUpload = async (catId: string, pId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    setUploadingThumb(true)
    try {
      const { storagePath, url } = await uploadFile(file, 'thumb')
      updatePrompt(catId, pId, { thumbnail: { storagePath, url, label: 'thumbnail' } })
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setUploadingThumb(false) }
  }

  const handleImgUpload = async (catId: string, pId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    const label = window.prompt('Descrição:', file.name.replace(/\.[^.]+$/, '')) || file.name
    setUploadingImg(true)
    try {
      const { storagePath, url } = await uploadFile(file, 'ref')
      const cat = config.categories.find(c => c.id === catId)
      const prompt = cat?.prompts.find(p => p.id === pId)
      if (prompt) updatePrompt(catId, pId, { images: [...prompt.images, { storagePath, url, label }] })
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setUploadingImg(false) }
  }

  const removeImg = async (catId: string, pId: string, idx: number) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt) return
    try { await supabase.storage.from('client-photos').remove([prompt.images[idx].storagePath]) } catch {}
    updatePrompt(catId, pId, { images: prompt.images.filter((_, i) => i !== idx) })
  }

  const removeThumb = async (catId: string, pId: string) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt?.thumbnail) return
    try { await supabase.storage.from('client-photos').remove([prompt.thumbnail.storagePath]) } catch {}
    updatePrompt(catId, pId, { thumbnail: null })
  }

  // ── Options ────────────────────────────────────────────────

  const addOpt = (catId: string, pId: string) => {
    if (!newOpt.trim()) return
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt) return
    updatePrompt(catId, pId, { options: [...prompt.options, newOpt.trim()] })
    setNewOpt('')
  }

  const removeOpt = (catId: string, pId: string, idx: number) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt) return
    updatePrompt(catId, pId, { options: prompt.options.filter((_, i) => i !== idx) })
  }

  // ── Render ─────────────────────────────────────────────────

  const inp = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-violet-400 border-t-transparent rounded-full" /></div>

  // ── Folder list ────────────────────────────────────────────

  if (!editingFolder) return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Pastas de Prompts IA</h2>
          <p className="text-sm text-gray-500">Crie pastas globais com prompts, Drive e fotos por categoria</p>
        </div>
        <button onClick={createFolder} className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700">
          <Plus className="h-4 w-4" /> Nova Pasta
        </button>
      </div>

      {folders.length === 0 ? (
        <div className="bg-gray-50 rounded-xl p-8 text-center">
          <FolderOpen className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Nenhuma pasta criada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {folders.map(f => {
            const c = (typeof f.config === 'string' ? JSON.parse(f.config) : f.config) as FolderConfig
            return (
              <div key={f.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <FolderOpen className="h-5 w-5 text-violet-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{f.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-xs text-gray-400">{c.categories?.length || 0} categorias · {c.categories?.reduce((s, cat) => s + (cat.prompts?.length || 0), 0) || 0} prompts</p>
                    {c.driveLink && (
                      <a href={c.driveLink} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-violet-500 flex items-center gap-1 hover:underline">
                        <Link2 className="h-3 w-3" /> Drive
                      </a>
                    )}
                  </div>
                </div>
                <button onClick={() => openFolder(f)} className="text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg">Editar</button>
                <button onClick={() => duplicateFolder(f)} className="text-gray-300 hover:text-violet-500"><Copy className="h-4 w-4" /></button>
                <button onClick={() => deleteFolder(f.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  // ── Folder editor ──────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => { setEditingFolder(null); loadFolders() }} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-5 w-5" /></button>
        <h2 className="text-lg font-semibold text-gray-900">{editingFolder.id === 'new' ? 'Nova Pasta' : editingFolder.name}</h2>
      </div>

      {/* ── Configurações da pasta ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Configurações da pasta</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome da pasta</label>
          <input value={config.folderName} onChange={e => setConfig(prev => ({ ...prev, folderName: e.target.value }))} placeholder="Ex: Verão Suave" className={inp} />
        </div>

        {/* Drive link */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
            <Link2 className="h-4 w-4 text-violet-500" /> Link da pasta do Drive
          </label>
          <div className="flex gap-2">
            <input
              value={config.driveLink || ''}
              onChange={e => setConfig(prev => ({ ...prev, driveLink: e.target.value }))}
              placeholder="https://drive.google.com/drive/folders/..."
              className={`${inp} flex-1`}
            />
            {config.driveLink && (
              <a href={config.driveLink} target="_blank" rel="noopener noreferrer"
                className="px-3 py-2 bg-violet-100 text-violet-700 rounded-lg text-sm flex items-center gap-1 hover:bg-violet-200">
                <Link2 className="h-4 w-4" /> Abrir
              </a>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">Será exibido na aba Resultado ao selecionar esta pasta</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Instruções base da IA</label>
          <textarea value={config.baseInstructions} onChange={e => setConfig(prev => ({ ...prev, baseInstructions: e.target.value }))} rows={3} placeholder="Ex: Subtom quente, pele dourada..." className={`${inp} resize-y`} />
        </div>
      </div>

      {/* ── Categorias ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Categorias</h3>
          <div className="flex gap-2">
            {config.categories.length === 0 && (
              <button onClick={() => setConfig(prev => ({ ...prev, categories: DEFAULT_CATS.map(c => ({ ...c, id: uid() })) }))}
                className="text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg"><Sparkles className="h-3 w-3 inline mr-1" />Padrão</button>
            )}
            <button onClick={handleAddCategoryClick} className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded-lg"><Plus className="h-3 w-3 inline mr-1" />Categoria</button>
          </div>
        </div>

        {config.categories.map(cat => {
          const Icon = ICONS[cat.icon] || FolderOpen
          const isOpen = activeCat === cat.id
          const catType = photoTypes.find(t => t.id === cat.type)
          const refType = photoTypes.find(t => t.id === cat.refPhotoType)

          return (
            <div key={cat.id} className="border border-gray-200 rounded-xl overflow-hidden">
              <div className={`px-4 py-3 flex items-center gap-3 cursor-pointer ${isOpen ? 'bg-violet-50' : 'bg-white hover:bg-gray-50'}`}
                onClick={() => { setActiveCat(isOpen ? null : cat.id); setActivePrompt(null) }}>
                <Icon className="h-4 w-4 text-violet-500" />
                <span className="font-medium text-sm text-gray-800 flex-1">{cat.name}</span>
                {catType ? (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: catType.color + '20', color: catType.color }}>
                    {catType.icon} {catType.name}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">sem tipo</span>
                )}
                {refType && (
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    {refType.icon} {refType.name}
                  </span>
                )}
                <span className="text-xs text-gray-400">{cat.prompts.length}</span>
                <button onClick={e => { e.stopPropagation(); removeCategory(cat.id) }} className="text-gray-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </div>

              {isOpen && (
                <div className="px-4 py-3 border-t border-gray-100 space-y-3">
                  {/* Nome */}
                  <div>
                    <label className="text-xs text-gray-500">Nome</label>
                    <input value={cat.name} onChange={e => updateCat(cat.id, { name: e.target.value })} className={`${inp} text-sm`} />
                  </div>

                  {/* Tipo + Foto da cliente — only these 2 */}
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex-1 min-w-[140px]">
                      <label className="text-xs text-gray-500 font-medium">Tipo</label>
                      <select
                        value={cat.type || ''}
                        onChange={e => handleCategoryTypeChange(cat.id, e.target.value)}
                        className={`${inp} text-sm`}
                      >
                        {(photoTypes || []).map(t => (
                          <option key={t.id} value={t.id}>
                            {t.icon} {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <label className="text-xs text-gray-500 font-medium flex items-center gap-1">
                        <Camera className="h-3 w-3" /> Foto da cliente (IA)
                      </label>
                      <select
                        value={cat.refPhotoType || ''}
                        onChange={e => updateCat(cat.id, { refPhotoType: e.target.value as any })}
                        className={`${inp} text-sm`}
                      >
                        <option value="">Nenhuma</option>
                        {(photoTypes || []).map(t => (
                          <option key={t.id} value={t.id}>
                            {t.icon} {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {cat.refPhotoType && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                      <span className="font-medium">Foto usada na IA:</span> A IA vai utilizar a foto de <strong>{photoTypes.find(t => t.id === cat.refPhotoType)?.name || cat.refPhotoType}</strong> da cliente ao gerar conteúdo nesta categoria
                    </div>
                  )}

                  {/* Prompts */}
                  {cat.prompts.map(prompt => (
                    <div key={prompt.id} className={`border rounded-lg overflow-hidden ${activePrompt === prompt.id ? 'border-violet-300 bg-violet-50/50' : 'border-gray-200'}`}>
                      <div className="px-3 py-2 flex items-center gap-2 cursor-pointer" onClick={() => setActivePrompt(activePrompt === prompt.id ? null : prompt.id)}>
                        {prompt.thumbnail ? (
                          <img src={prompt.thumbnail.url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0 border" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0"><Image className="h-4 w-4 text-gray-300" /></div>
                        )}
                        <span className="text-sm text-gray-800 font-medium flex-1">{prompt.name}</span>
                        <button onClick={e => { e.stopPropagation(); removePrompt(cat.id, prompt.id) }} className="text-gray-300 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                      </div>

                      {activePrompt === prompt.id && (
                        <div className="px-3 pb-3 space-y-3 border-t border-gray-100 pt-3">
                          <div>
                            <label className="text-xs font-medium text-gray-600">Nome (aparece para a cliente)</label>
                            <input value={prompt.name} onChange={e => updatePrompt(cat.id, prompt.id, { name: e.target.value })} className={inp} />
                          </div>

                          {/* Thumbnail */}
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1">📸 Imagem de capa (aparece no chat da cliente)</label>
                            {prompt.thumbnail ? (
                              <div className="flex items-center gap-3">
                                <img src={prompt.thumbnail.url} alt="" className="w-16 h-16 rounded-lg object-cover border" />
                                <div className="flex gap-2">
                                  <label className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded-lg cursor-pointer">
                                    <input type="file" accept="image/*" className="hidden" onChange={e => handleThumbUpload(cat.id, prompt.id, e)} /> Trocar
                                  </label>
                                  <button onClick={() => removeThumb(cat.id, prompt.id)} className="text-xs px-3 py-1.5 bg-red-100 text-red-600 rounded-lg">Remover</button>
                                </div>
                              </div>
                            ) : (
                              <label className="block border border-dashed border-violet-300 rounded-lg py-3 text-center cursor-pointer hover:bg-violet-50 text-xs text-violet-600">
                                <input type="file" accept="image/*" className="hidden" onChange={e => handleThumbUpload(cat.id, prompt.id, e)} />
                                {uploadingThumb ? 'Enviando...' : '+ Adicionar imagem de capa'}
                              </label>
                            )}
                          </div>

                          <div>
                            <label className="text-xs font-medium text-gray-600">Instruções para a IA</label>
                            <textarea value={prompt.instructions} onChange={e => updatePrompt(cat.id, prompt.id, { instructions: e.target.value })}
                              rows={3} placeholder="Ex: Aplicar loiro bege claro com raiz esfumada." className={`${inp} resize-y text-xs`} />
                          </div>

                          {/* Imagens de referência */}
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1">Imagens de referência (enviadas à IA)</label>
                            {prompt.images.length > 0 && (
                              <div className="grid grid-cols-4 gap-2 mb-2">
                                {prompt.images.map((img, idx) => (
                                  <div key={idx} className="relative group">
                                    <img src={img.url} alt="" className="w-full aspect-square object-cover rounded-lg border" />
                                    <button onClick={() => removeImg(cat.id, prompt.id, idx)}
                                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <label className="block border border-dashed border-gray-300 rounded-lg py-2 text-center cursor-pointer hover:bg-gray-50 text-xs text-gray-500">
                              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => handleImgUpload(cat.id, prompt.id, e)} />
                              {uploadingImg ? 'Enviando...' : '+ Imagem/PDF de referência'}
                            </label>
                          </div>

                          {/* CABELO: opções + tinta */}
                          {cat.type === 'cabelo' && (
                            <>
                              <div>
                                <label className="text-xs font-medium text-gray-600 block mb-1">Comprimentos (opções para a cliente)</label>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {prompt.options.map((opt, idx) => (
                                    <span key={idx} className="inline-flex items-center gap-1 bg-violet-100 text-violet-700 text-xs px-2.5 py-1 rounded-full">
                                      {opt} <button onClick={() => removeOpt(cat.id, prompt.id, idx)}><X className="h-3 w-3" /></button>
                                    </span>
                                  ))}
                                </div>
                                <div className="flex gap-1.5">
                                  <input value={newOpt} onChange={e => setNewOpt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addOpt(cat.id, prompt.id) }}
                                    placeholder="Ex: Curtíssimo" className={`${inp} flex-1 text-xs`} />
                                  <button onClick={() => addOpt(cat.id, prompt.id)} disabled={!newOpt.trim()}
                                    className="px-2 py-1 bg-violet-600 text-white rounded-lg text-xs disabled:opacity-40"><Plus className="h-3 w-3" /></button>
                                </div>
                              </div>
                              <div>
                                <label className="text-xs font-medium text-gray-600">🎨 Referência de tinta</label>
                                <input value={prompt.tintReference} onChange={e => updatePrompt(cat.id, prompt.id, { tintReference: e.target.value })}
                                  placeholder="Ex: Wella Koleston 9/1, Igora Royal 8-0" className={inp} />
                              </div>
                            </>
                          )}

                          {/* Referência geral (para todos os outros tipos) */}
                          {cat.type !== 'cabelo' && (
                            <div>
                              <label className="text-xs font-medium text-gray-600">📌 Referência (opcional)</label>
                              <input value={prompt.reference} onChange={e => updatePrompt(cat.id, prompt.id, { reference: e.target.value })}
                                placeholder="Ex: Marca, produto, código de cor..." className={inp} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  <button onClick={() => addPrompt(cat.id)}
                    className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:text-violet-600 flex items-center justify-center gap-1">
                    <Plus className="h-3 w-3" /> Adicionar prompt
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving || !config.folderName.trim()}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
          {saving ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar pasta'}
        </button>
        {saveStatus === 'saved' && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Salvo!</span>}
        {saveStatus === 'error' && <span className="text-sm text-red-600"><AlertCircle className="h-4 w-4 inline" /> Erro</span>}
      </div>
      <CategoryTypeModal
        open={typeModalOpen}
        onSelect={handleTypeSelected}
        onCancel={handleTypeModalCancel}
      />
    </div>
    
  )
}