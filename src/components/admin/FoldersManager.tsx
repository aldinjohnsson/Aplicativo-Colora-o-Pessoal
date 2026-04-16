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

/** Sub-option for comprimento or textura inside a cabelo prompt */
interface SubOption {
  id: string
  dbId?: string               // uuid from ai_sub_options (set after first save)
  name: string                // shown to client in chat
  thumbnail: PromptImage | null  // cover image shown in chat
  instruction: string         // AI instruction appended to base prompt
  images: PromptImage[]       // reference images sent to AI
}

interface Prompt {
  id: string; name: string; instructions: string
  images: PromptImage[]
  thumbnail: PromptImage | null
  options: string[]           // legacy text-only list (kept for migration)
  tintReference: string
  reference: string
  order: number
  lengths: SubOption[]        // cabelo: comprimento options
  textures: SubOption[]       // cabelo: textura options
}

interface Category {
  id: string; name: string; icon: string
  type: string
  refPhotoType: string
  order: number; prompts: Prompt[]
}

export interface FolderConfig {
  folderName: string
  baseInstructions: string
  driveLink: string
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

const newSubOption = (): SubOption => ({
  id: uid(), name: '', thumbnail: null, instruction: '', images: [],
})

const newPrompt = (order: number): Prompt => ({
  id: uid(), name: '', instructions: '', images: [],
  thumbnail: null, options: [], tintReference: '', reference: '', order,
  lengths: [], textures: [],
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
  const [autoSaving, setAutoSaving] = useState(false)

  // Sub-option UI state
  const [openLengthId, setOpenLengthId] = useState<string | null>(null)
  const [openTextureId, setOpenTextureId] = useState<string | null>(null)
  const [uploadingSubThumb, setUploadingSubThumb] = useState(false)
  const [uploadingSubImg, setUploadingSubImg] = useState(false)
  const [savingSubId, setSavingSubId] = useState<string | null>(null)
  const [savedSubIds, setSavedSubIds] = useState<Set<string>>(new Set())

  // Global sub-option picker (comprimentos / texturas compartilhados)
  interface GlobalSubOpt extends SubOption { kind: 'length' | 'texture' }
  const [globalSubOpts, setGlobalSubOpts] = useState<GlobalSubOpt[]>([])
  const [loadingGlobal, setLoadingGlobal] = useState(false)
  const [subPicker, setSubPicker] = useState<{ catId: string; pId: string; field: 'lengths' | 'textures' } | null>(null)
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set())
  // ids of linked items where user acknowledged the "affects all" warning
  const [linkedEditOk, setLinkedEditOk] = useState<Set<string>>(new Set())

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)
  const editingFolderRef = useRef<Folder | null>(null)

  useEffect(() => { editingFolderRef.current = editingFolder }, [editingFolder])
  useEffect(() => { loadFolders() }, [])

  const loadFolders = async () => {
    setLoading(true)
    const { data } = await supabase.from('ai_folders').select('*').order('name')
    setFolders(data || [])
    setLoading(false)
  }

  // ── Auto-save ──────────────────────────────────────────────
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    const folder = editingFolderRef.current
    if (!folder || folder.id === 'new') return

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setAutoSaving(true)

    autoSaveTimer.current = setTimeout(async () => {
      try {
        await supabase
          .from('ai_folders')
          .update({ name: config.folderName, config, updated_at: new Date().toISOString() })
          .eq('id', folder.id)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } catch {
        setSaveStatus('error')
      } finally {
        setAutoSaving(false)
      }
    }, 1500)

    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [config])

  const { types: photoTypes } = usePhotoTypes()
  const [typeModalOpen, setTypeModalOpen] = useState(false)

  // ── Folder CRUD ────────────────────────────────────────────

  const createFolder = () => {
    const name = window.prompt('Nome da pasta (ex: Verão Suave):')
    if (!name?.trim()) return
    isFirstRender.current = true
    setConfig({ ...emptyConfig(), folderName: name.trim(), categories: DEFAULT_CATS.map(c => ({ ...c, id: uid() })) })
    setEditingFolder({ id: 'new', name: name.trim(), config: emptyConfig(), created_at: '' })
    setActiveCat(null); setActivePrompt(null)
  }

  const openFolder = (f: Folder) => {
    isFirstRender.current = true
    const c: FolderConfig = typeof f.config === 'string' ? JSON.parse(f.config) : { ...f.config }
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
          lengths: (p.lengths || []).map((l: any) => ({
            ...l,
            dbId: l.dbId || undefined,
            thumbnail: l.thumbnail || null,
            instruction: l.instruction || '',
            images: l.images || [],
          })),
          textures: (p.textures || []).map((t: any) => ({
            ...t,
            dbId: t.dbId || undefined,
            thumbnail: t.thumbnail || null,
            instruction: t.instruction || '',
            images: t.images || [],
          })),
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
        const { data, error } = await supabase
          .from('ai_folders')
          .insert({ name: config.folderName, config })
          .select()
          .single()
        if (error) throw error
        if (data) {
          isFirstRender.current = true
          setEditingFolder({ ...editingFolder, id: data.id })
        }
      } else {
        await supabase.from('ai_folders').update({ name: config.folderName, config, updated_at: new Date().toISOString() }).eq('id', editingFolder.id)
      }
      setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 3000)
      loadFolders()
    } catch { setSaveStatus('error') }
    finally { setSaving(false) }
  }

  // ── Category CRUD ──────────────────────────────────────────

  const handleAddCategoryClick = () => setTypeModalOpen(true)

  const handleTypeSelected = (typeId: string, typeName: string) => {
    setTypeModalOpen(false)
    setConfig(prev => ({
      ...prev,
      categories: [...prev.categories, {
        id: uid(), name: `Nova Categoria (${typeName})`, icon: 'folder',
        type: typeId, refPhotoType: typeId, order: prev.categories.length, prompts: [],
      }],
    }))
  }

  const handleTypeModalCancel = () => setTypeModalOpen(false)

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
        c.id === catId ? { ...c, type: typeId as any, refPhotoType: typeId as any } : c
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

  // ── Sub-option CRUD (lengths / textures) ───────────────────

  const addSubOption = (catId: string, pId: string, field: 'lengths' | 'textures') => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt) return
    const sub = newSubOption()
    updatePrompt(catId, pId, { [field]: [...(prompt[field] || []), sub] })
    if (field === 'lengths') setOpenLengthId(sub.id)
    else setOpenTextureId(sub.id)
  }

  const removeSubOption = (catId: string, pId: string, field: 'lengths' | 'textures', subId: string) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt) return
    updatePrompt(catId, pId, { [field]: (prompt[field] || []).filter((s: SubOption) => s.id !== subId) })
    if (field === 'lengths' && openLengthId === subId) setOpenLengthId(null)
    if (field === 'textures' && openTextureId === subId) setOpenTextureId(null)
  }

  // ── Global sub-option helpers ──────────────────────────────

  const loadGlobalSubOpts = async () => {
    setLoadingGlobal(true)
    const { data } = await supabase.from('ai_sub_options').select('*').order('name')
    if (data) {
      setGlobalSubOpts(data.map((d: any) => ({
        id: uid(), dbId: d.id, kind: d.kind,
        name: d.name, instruction: d.instruction || '',
        thumbnail: d.thumbnail || null, images: d.images || [],
      })))
    }
    setLoadingGlobal(false)
  }

  const openSubPicker = (catId: string, pId: string, field: 'lengths' | 'textures') => {
    loadGlobalSubOpts()
    setPickerSelected(new Set())
    setSubPicker({ catId, pId, field })
  }

  const linkSubOption = (catId: string, pId: string, field: 'lengths' | 'textures', global: any) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt) return
    const sub: SubOption = { id: uid(), dbId: global.dbId, name: global.name, instruction: global.instruction, thumbnail: global.thumbnail, images: global.images }
    updatePrompt(catId, pId, { [field]: [...(prompt[field] || []), sub] })
    // não abre automaticamente — o item entra colapsado
    setSubPicker(null)
  }

  const linkMultipleSubOptions = (catId: string, pId: string, field: 'lengths' | 'textures', globals: any[]) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt || globals.length === 0) return
    const newSubs: SubOption[] = globals.map(g => ({
      id: uid(), dbId: g.dbId, name: g.name,
      instruction: g.instruction, thumbnail: g.thumbnail, images: g.images,
    }))
    updatePrompt(catId, pId, { [field]: [...(prompt[field] || []), ...newSubs] })
    // nenhum item é aberto — todos entram colapsados
    setSubPicker(null)
  }

  const duplicateSubOption = (catId: string, pId: string, field: 'lengths' | 'textures', subId: string) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    const sub = (prompt?.[field] || []).find((s: SubOption) => s.id === subId)
    if (!sub) return
    const copy: SubOption = { ...sub, id: uid(), dbId: undefined }
    updatePrompt(catId, pId, { [field]: [...(prompt![field] || []), copy] })
    if (field === 'lengths') setOpenLengthId(copy.id)
    else setOpenTextureId(copy.id)
    // remove from "edit ok" so the copy starts fresh (not locked)
    setLinkedEditOk(prev => { const n = new Set(prev); n.delete(subId); return n })
  }

  const updateSubOption = (catId: string, pId: string, field: 'lengths' | 'textures', subId: string, u: Partial<SubOption>) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt) return
    updatePrompt(catId, pId, {
      [field]: (prompt[field] || []).map((s: SubOption) => s.id === subId ? { ...s, ...u } : s)
    })
  }

  const handleSubThumbUpload = async (catId: string, pId: string, field: 'lengths' | 'textures', subId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    setUploadingSubThumb(true)
    try {
      const { storagePath, url } = await uploadFile(file, `sub_thumb_${field}`)
      updateSubOption(catId, pId, field, subId, { thumbnail: { storagePath, url, label: 'thumbnail' } })
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setUploadingSubThumb(false) }
  }

  const handleSubImgUpload = async (catId: string, pId: string, field: 'lengths' | 'textures', subId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    const label = window.prompt('Descrição:', file.name.replace(/\.[^.]+$/, '')) || file.name
    setUploadingSubImg(true)
    try {
      const { storagePath, url } = await uploadFile(file, `sub_ref_${field}`)
      const cat = config.categories.find(c => c.id === catId)
      const prompt = cat?.prompts.find(p => p.id === pId)
      const sub = (prompt?.[field] || []).find((s: SubOption) => s.id === subId)
      if (sub) updateSubOption(catId, pId, field, subId, { images: [...sub.images, { storagePath, url, label }] })
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setUploadingSubImg(false) }
  }

  const removeSubImg = async (catId: string, pId: string, field: 'lengths' | 'textures', subId: string, idx: number) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    const sub = (prompt?.[field] || []).find((s: SubOption) => s.id === subId)
    if (!sub) return
    try { await supabase.storage.from('client-photos').remove([sub.images[idx].storagePath]) } catch {}
    updateSubOption(catId, pId, field, subId, { images: sub.images.filter((_: any, i: number) => i !== idx) })
  }

  const saveSubOptionToBank = async (
    catId: string, pId: string,
    field: 'lengths' | 'textures',
    sub: SubOption,
  ) => {
    setSavingSubId(sub.id)
    try {
      const kind = field === 'lengths' ? 'length' : 'texture'
      const payload = {
        kind,
        name: sub.name,
        instruction: sub.instruction,
        thumbnail: sub.thumbnail,
        images: sub.images,
      }

      let dbId = sub.dbId
      if (dbId) {
        // update existing row
        const { error } = await supabase
          .from('ai_sub_options')
          .update(payload)
          .eq('id', dbId)
        if (error) throw error
      } else {
        // insert new row and store returned id
        const { data, error } = await supabase
          .from('ai_sub_options')
          .insert(payload)
          .select('id')
          .single()
        if (error) throw error
        dbId = data.id
        // persist dbId back into config so next save does update, not insert
        updateSubOption(catId, pId, field, sub.id, { dbId })
      }

      setSavedSubIds(prev => new Set(prev).add(sub.id))
      setTimeout(() => setSavedSubIds(prev => { const n = new Set(prev); n.delete(sub.id); return n }), 3000)
    } catch (e: any) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setSavingSubId(null)
    }
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

  // ── Options (legacy) ───────────────────────────────────────

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

  // ── Render helpers ─────────────────────────────────────────

  const inp = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"

  /** Renders the sub-option list (shared between lengths and textures) */
  const renderSubOptions = (
    cat: Category,
    prompt: Prompt,
    field: 'lengths' | 'textures',
    label: string,
    icon: string,
    colorClass: { bg: string; text: string; border: string; dashed: string },
    openId: string | null,
    setOpenId: (id: string | null) => void,
  ) => {
    const items: SubOption[] = (prompt[field] as SubOption[]) || []
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-700">{icon} {label}</label>
          <button
            onClick={() => openSubPicker(cat.id, prompt.id, field)}
            className={`text-xs px-2.5 py-1 ${colorClass.bg} ${colorClass.text} rounded-lg flex items-center gap-1`}
          >
            <Plus className="h-3 w-3" /> Adicionar
          </button>
        </div>

        {items.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2 border border-dashed border-gray-200 rounded-lg">
            Nenhum {label.toLowerCase()} cadastrado
          </p>
        )}

        {items.map(sub => (
          <div key={sub.id} className={`border rounded-lg overflow-hidden ${openId === sub.id ? colorClass.border : 'border-gray-200'}`}>
            {/* Header row */}
            <div
              className={`px-3 py-2 flex items-center gap-2 cursor-pointer ${openId === sub.id ? `${colorClass.bg} bg-opacity-30` : 'bg-white hover:bg-gray-50'}`}
              onClick={() => setOpenId(openId === sub.id ? null : sub.id)}
            >
              {sub.thumbnail ? (
                <img src={sub.thumbnail.url} alt="" className="w-7 h-7 rounded object-cover border flex-shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Image className="h-3.5 w-3.5 text-gray-300" />
                </div>
              )}
              <span className="text-xs text-gray-800 font-medium flex-1">{sub.name || '(sem nome)'}</span>
              {sub.dbId && (
                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full flex items-center gap-0.5 flex-shrink-0">
                  <Link2 className="h-2.5 w-2.5" /> Global
                </span>
              )}
              <button
                onClick={e => { e.stopPropagation(); removeSubOption(cat.id, prompt.id, field, sub.id) }}
                className="text-gray-300 hover:text-red-500"
              ><Trash2 className="h-3 w-3" /></button>
              {openId === sub.id ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
            </div>

            {/* Expanded details */}
            {openId === sub.id && (
              <div className="px-3 py-3 border-t border-gray-100 space-y-3 bg-gray-50/50">

                {/* Global item warning */}
                {sub.dbId && !linkedEditOk.has(sub.id) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs text-amber-800 font-medium">🔗 Este item é compartilhado globalmente</p>
                    <p className="text-xs text-amber-700">Editar aqui irá alterar em <strong>TODOS</strong> os prompts que usam este {field === 'lengths' ? 'comprimento' : 'textura'}.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => duplicateSubOption(cat.id, prompt.id, field, sub.id)}
                        className="flex-1 text-xs px-2.5 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg flex items-center justify-center gap-1"
                      ><Copy className="h-3 w-3" /> Duplicar só aqui</button>
                      <button
                        onClick={() => setLinkedEditOk(prev => new Set(prev).add(sub.id))}
                        className="flex-1 text-xs px-2.5 py-1.5 bg-amber-600 text-white rounded-lg"
                      >Editar para todos</button>
                    </div>
                  </div>
                )}

                {/* Fields — locked until user acknowledges */}
                <fieldset disabled={!!(sub.dbId && !linkedEditOk.has(sub.id))} className="space-y-3 disabled:opacity-40 disabled:pointer-events-none">
                  {/* Name */}
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Nome (aparece para a cliente)</label>
                    <input
                      value={sub.name}
                      onChange={e => updateSubOption(cat.id, prompt.id, field, sub.id, { name: e.target.value })}
                      placeholder={field === 'lengths' ? 'Ex: Longo' : 'Ex: Cacheado'}
                      className={`${inp} text-xs`}
                    />
                  </div>

                  {/* Cover image */}
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">📸 Imagem de capa (aparece no chat)</label>
                    {sub.thumbnail ? (
                      <div className="flex items-center gap-3">
                        <img src={sub.thumbnail.url} alt="" className="w-14 h-14 rounded-lg object-cover border" />
                        <div className="flex gap-2">
                          <label className={`text-xs px-2.5 py-1.5 ${colorClass.bg} ${colorClass.text} rounded-lg cursor-pointer`}>
                            <input type="file" accept="image/*" className="hidden" onChange={e => handleSubThumbUpload(cat.id, prompt.id, field, sub.id, e)} />
                            {uploadingSubThumb ? 'Enviando...' : 'Trocar'}
                          </label>
                          <button
                            onClick={() => updateSubOption(cat.id, prompt.id, field, sub.id, { thumbnail: null })}
                            className="text-xs px-2.5 py-1.5 bg-red-100 text-red-600 rounded-lg"
                          >Remover</button>
                        </div>
                      </div>
                    ) : (
                      <label className={`block border border-dashed ${colorClass.dashed} rounded-lg py-2.5 text-center cursor-pointer hover:bg-gray-50 text-xs ${colorClass.text}`}>
                        <input type="file" accept="image/*" className="hidden" onChange={e => handleSubThumbUpload(cat.id, prompt.id, field, sub.id, e)} />
                        {uploadingSubThumb ? 'Enviando...' : '+ Imagem de capa'}
                      </label>
                    )}
                  </div>

                  {/* AI instruction */}
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Instruções para a IA</label>
                    <textarea
                      value={sub.instruction}
                      onChange={e => updateSubOption(cat.id, prompt.id, field, sub.id, { instruction: e.target.value })}
                      rows={2}
                      placeholder={field === 'lengths' ? 'Ex: Cabelo longo até o ombro' : 'Ex: Cacheado crespo volumoso'}
                      className={`${inp} text-xs resize-y`}
                    />
                  </div>

                  {/* Reference images */}
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Imagens de referência (enviadas à IA)</label>
                    {sub.images.length > 0 && (
                      <div className="grid grid-cols-4 gap-1.5 mb-2">
                        {sub.images.map((img, idx) => (
                          <div key={idx} className="relative group">
                            <img src={img.url} alt="" className="w-full aspect-square object-cover rounded-lg border" />
                            <button
                              onClick={() => removeSubImg(cat.id, prompt.id, field, sub.id, idx)}
                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"
                            ><X className="h-2.5 w-2.5" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <label className="block border border-dashed border-gray-300 rounded-lg py-2 text-center cursor-pointer hover:bg-gray-50 text-xs text-gray-400">
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleSubImgUpload(cat.id, prompt.id, field, sub.id, e)} />
                      {uploadingSubImg ? 'Enviando...' : '+ Imagem de referência'}
                    </label>
                  </div>
                </fieldset>

                {/* Save to ai_sub_options */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  {savedSubIds.has(sub.id) && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Salvo
                    </span>
                  )}
                  <button
                    onClick={() => saveSubOptionToBank(cat.id, prompt.id, field, sub)}
                    disabled={savingSubId === sub.id || !!(sub.dbId && !linkedEditOk.has(sub.id))}
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium disabled:opacity-50
                      ${colorClass.bg} ${colorClass.text}`}
                  >
                    {savingSubId === sub.id
                      ? <><div className="h-3 w-3 border border-current border-t-transparent rounded-full animate-spin" /> Salvando...</>
                      : sub.dbId
                        ? <><Save className="h-3 w-3" /> Salvar (afeta todos)</>
                        : <><Save className="h-3 w-3" /> Salvar {field === 'lengths' ? 'comprimento' : 'textura'}</>
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

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

                  {/* Tipo + Foto da cliente */}
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex-1 min-w-[140px]">
                      <label className="text-xs text-gray-500 font-medium">Tipo</label>
                      <select
                        value={cat.type || ''}
                        onChange={e => handleCategoryTypeChange(cat.id, e.target.value)}
                        className={`${inp} text-sm`}
                      >
                        {(photoTypes || []).map(t => (
                          <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
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
                          <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
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
                        {activePrompt === prompt.id ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                      </div>

                      {activePrompt === prompt.id && (
                        <div className="px-3 pb-3 space-y-4 border-t border-gray-100 pt-3">
                          {/* Name */}
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

                          {/* AI Instructions */}
                          <div>
                            <label className="text-xs font-medium text-gray-600">Instruções para a IA</label>
                            <textarea value={prompt.instructions} onChange={e => updatePrompt(cat.id, prompt.id, { instructions: e.target.value })}
                              rows={3} placeholder="Ex: Aplicar loiro bege claro com raiz esfumada." className={`${inp} resize-y text-xs`} />
                          </div>

                          {/* Reference images (base prompt) */}
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

                          {/* ── CABELO: Comprimentos + Texturas ── */}
                          {cat.type === 'cabelo' && (
                            <div className="space-y-4 pt-1">
                              <div className="border-t border-violet-100 pt-3">
                                <p className="text-xs font-semibold text-violet-700 mb-3">✂️ Opções de Comprimento e Textura</p>
                                <p className="text-xs text-gray-500 mb-3">
                                  No chat, após clicar neste prompt, a cliente escolhe o comprimento e depois a textura antes de gerar a imagem.
                                </p>

                                {/* Comprimentos */}
                                {renderSubOptions(
                                  cat, prompt, 'lengths',
                                  'Comprimentos', '✂️',
                                  { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-300', dashed: 'border-violet-300' },
                                  openLengthId, setOpenLengthId,
                                )}

                                {/* Texturas */}
                                <div className="mt-4">
                                  {renderSubOptions(
                                    cat, prompt, 'textures',
                                    'Texturas', '🌀',
                                    { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300', dashed: 'border-cyan-300' },
                                    openTextureId, setOpenTextureId,
                                  )}
                                </div>

                                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                                  <p className="text-xs text-amber-800">
                                    💡 A IA receberá: instruções do prompt + instrução do comprimento + instrução da textura + todas as imagens de referência combinadas.
                                  </p>
                                </div>
                              </div>

                              {/* Tint reference */}
                              <div>
                                <label className="text-xs font-medium text-gray-600">🎨 Referência de tinta</label>
                                <p className="text-[10px] text-gray-400 mb-1">Use emojis, parágrafos e quebras de linha para estruturar a mensagem que aparecerá no chat após gerar a imagem.</p>
                                <textarea value={prompt.tintReference} onChange={e => updatePrompt(cat.id, prompt.id, { tintReference: e.target.value })}
                                  rows={5} placeholder={"Ex:\n🎨 TINTA RECOMENDADA\n\nWella Koleston 9/1 + 10/1\nProporção: 2:1 com OX 30vol\n\n✨ Para as mechas:\nWella Blondor 40g"}
                                  className={`${inp} resize-y text-xs font-mono`} />
                              </div>
                            </div>
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
      <div className="flex items-center gap-3 flex-wrap">
        {editingFolder.id === 'new' ? (
          <button onClick={handleSave} disabled={saving || !config.folderName.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
            {saving ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando...' : 'Criar pasta'}
          </button>
        ) : (
          <button onClick={handleSave} disabled={saving || autoSaving || !config.folderName.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
            {saving ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando...' : 'Salvar agora'}
          </button>
        )}

        {autoSaving && (
          <span className="text-sm text-violet-500 flex items-center gap-1.5">
            <div className="animate-spin h-3.5 w-3.5 border-2 border-violet-400 border-t-transparent rounded-full" />
            Salvando automaticamente...
          </span>
        )}
        {!autoSaving && saveStatus === 'saved' && (
          <span className="text-sm text-green-600 flex items-center gap-1.5">
            <CheckCircle className="h-4 w-4" /> Salvo no banco
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-sm text-red-600 flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> Erro ao salvar
          </span>
        )}
        {editingFolder.id !== 'new' && !autoSaving && saveStatus === 'idle' && (
          <span className="text-xs text-gray-400">Auto-save ativo</span>
        )}
      </div>
      <CategoryTypeModal
        open={typeModalOpen}
        onSelect={handleTypeSelected}
        onCancel={handleTypeModalCancel}
      />

      {/* ── Global Sub-Option Picker Modal ── */}
      {subPicker && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">
                  {subPicker.field === 'lengths' ? '✂️ Comprimentos' : '🌀 Texturas'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Selecione um ou mais para vincular, ou crie novo</p>
              </div>
              <button onClick={() => setSubPicker(null)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {/* Create new */}
              <button
                onClick={() => { addSubOption(subPicker.catId, subPicker.pId, subPicker.field); setSubPicker(null) }}
                className="w-full flex items-center gap-3 p-3 border-2 border-dashed border-violet-300 rounded-xl text-violet-600 hover:bg-violet-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Plus className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">Criar novo</p>
                  <p className="text-xs text-violet-400">Disponível para vincular em outros prompts</p>
                </div>
              </button>

              {/* Divider + select-all */}
              {(() => {
                const filtered = globalSubOpts.filter(o => o.kind === (subPicker.field === 'lengths' ? 'length' : 'texture'))
                if (!loadingGlobal && filtered.length === 0) return (
                  <p className="text-xs text-gray-400 text-center py-4">
                    Nenhum {subPicker.field === 'lengths' ? 'comprimento' : 'textura'} cadastrado ainda
                  </p>
                )
                if (loadingGlobal) return (
                  <div className="py-6 flex items-center justify-center gap-2 text-gray-400">
                    <div className="h-4 w-4 border-2 border-violet-300 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Carregando...</span>
                  </div>
                )
                const allIds = filtered.map(o => o.dbId!)
                const allSelected = allIds.every(id => pickerSelected.has(id))
                return (
                  <>
                    <div className="flex items-center justify-between py-1">
                      <div className="flex-1 h-px bg-gray-200 mr-2" />
                      <span className="text-xs text-gray-400 whitespace-nowrap">existentes</span>
                      <div className="flex-1 h-px bg-gray-200 mx-2" />
                      <button
                        onClick={() => setPickerSelected(allSelected ? new Set() : new Set(allIds))}
                        className="text-xs text-violet-600 whitespace-nowrap hover:underline"
                      >
                        {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                      </button>
                    </div>

                    {filtered.map(o => {
                      const sel = pickerSelected.has(o.dbId!)
                      return (
                        <button
                          key={o.dbId}
                          onClick={() => setPickerSelected(prev => {
                            const n = new Set(prev)
                            sel ? n.delete(o.dbId!) : n.add(o.dbId!)
                            return n
                          })}
                          className={`w-full flex items-center gap-3 p-3 border-2 rounded-xl transition-all text-left
                            ${sel ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-300 hover:bg-violet-50/50'}`}
                        >
                          {o.thumbnail ? (
                            <img src={o.thumbnail.url} alt="" className="w-10 h-10 rounded-lg object-cover border flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                              <Image className="h-4 w-4 text-gray-300" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{o.name}</p>
                            {o.instruction && <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{o.instruction}</p>}
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors
                            ${sel ? 'border-violet-500 bg-violet-500' : 'border-gray-300'}`}>
                            {sel && <span className="text-white text-[10px] font-bold">✓</span>}
                          </div>
                        </button>
                      )
                    })}
                  </>
                )
              })()}
            </div>

            {/* Footer actions */}
            {pickerSelected.size > 0 && (
              <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
                <button
                  onClick={() => setPickerSelected(new Set())}
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50"
                >
                  Limpar
                </button>
                <button
                  onClick={() => {
                    const selected = globalSubOpts.filter(o => pickerSelected.has(o.dbId!))
                    linkMultipleSubOptions(subPicker.catId, subPicker.pId, subPicker.field, selected)
                  }}
                  className="flex-1 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar {pickerSelected.size} {pickerSelected.size === 1
                    ? (subPicker.field === 'lengths' ? 'comprimento' : 'textura')
                    : (subPicker.field === 'lengths' ? 'comprimentos' : 'texturas')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}