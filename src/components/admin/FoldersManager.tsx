// src/components/admin/FoldersManager.tsx
import React, { useState, useEffect, useRef } from 'react'
import {
  FolderOpen, Plus, Trash2, Save, CheckCircle, AlertCircle,
  ChevronDown, ChevronUp, X, Scissors, Palette, Shirt, Gem,
  Image, FileText, Upload, ArrowLeft, Sparkles, Copy, Link2, Camera, Layout
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { CategoryTypeModal, usePhotoTypes } from './CategoryTypeModal'
import { PDFLayoutEditor, ItemLayout } from '../PDFLayoutEditor'


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
  pdfLayout?: ItemLayout      // layout padrão do PDF para este prompt
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
  lengths: [], textures: [], pdfLayout: undefined,
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
  const [layoutCtx, setLayoutCtx] = useState<{ catId: string; pId: string } | null>(null)
  const [copyFormatSrc, setCopyFormatSrc] = useState<{ catId: string; pId: string } | null>(null)
  // Set of prompt IDs currently showing the block editor for tintReference
  const [blockEditorIds, setBlockEditorIds] = useState<Set<string>>(new Set())

  // Prompt picker (reusar prompt de outra pasta)
  interface FolderPromptEntry { folderId: string; folderName: string; catId: string; catName: string; prompt: Prompt }
  const [promptPicker, setPromptPicker] = useState<{ catId: string } | null>(null)
  const [allFolderPrompts, setAllFolderPrompts] = useState<FolderPromptEntry[]>([])
  const [loadingPrompts, setLoadingPrompts] = useState(false)

  // ── Modais de entrada/confirmação (substituem window.prompt e confirm) ──
  interface InputModalState {
    title: string
    message?: string
    placeholder?: string
    defaultValue?: string
    confirmLabel?: string
    resolve: (value: string | null) => void
  }
  interface ConfirmModalState {
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    resolve: (value: boolean) => void
  }
  const [inputModal, setInputModal] = useState<InputModalState | null>(null)
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)

  const askInput = (opts: Omit<InputModalState, 'resolve'>): Promise<string | null> =>
    new Promise(resolve => setInputModal({ ...opts, resolve }))

  const askConfirm = (opts: Omit<ConfirmModalState, 'resolve'>): Promise<boolean> =>
    new Promise(resolve => setConfirmModal({ ...opts, resolve }))

  // ── Snapshots de prompts (para funcionalidade de Salvar/Cancelar) ──
  // Ao abrir um prompt guardamos uma cópia do seu estado inicial.
  // Cancelar -> restaura o snapshot. Salvar -> apenas fecha (mudanças já aplicadas via autosave).
  const [promptSnapshots, setPromptSnapshots] = useState<Record<string, Prompt>>({})

  // ── Abas da tela inicial (pastas / comprimentos / texturas) ──
  type TopTab = 'pastas' | 'comprimentos' | 'texturas'
  const [activeTab, setActiveTab] = useState<TopTab>('pastas')

  // Estado do modal de edição de uma sub-option (length/texture) na aba global
  interface GlobalEditState {
    kind: 'length' | 'texture'
    /** dbId null = criação; string = edição de item existente */
    dbId: string | null
    name: string
    instruction: string
    thumbnail: PromptImage | null
    images: PromptImage[]
  }
  const [globalEdit, setGlobalEdit] = useState<GlobalEditState | null>(null)
  const [savingGlobal, setSavingGlobal] = useState(false)

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

  const createFolder = async () => {
    const name = await askInput({
      title: 'Nova pasta',
      message: 'Informe um nome para a nova pasta',
      placeholder: 'Ex: Verão Suave',
      confirmLabel: 'Criar',
    })
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
    const name = await askInput({
      title: 'Duplicar pasta',
      message: 'Informe o nome da cópia',
      defaultValue: f.name + ' (cópia)',
      confirmLabel: 'Duplicar',
    })
    if (!name?.trim()) return
    const c: FolderConfig = typeof f.config === 'string' ? JSON.parse(f.config) : { ...f.config }
    const clonedCategories = await Promise.all(
      (c.categories || []).map(async cat => ({
        ...cat,
        prompts: await Promise.all((cat.prompts || []).map((p, i) => clonePrompt(p as Prompt, i)))
      }))
    )
    await supabase.from('ai_folders').insert({ name: name.trim(), config: { ...c, folderName: name.trim(), categories: clonedCategories } })
    loadFolders()
  }

  const deleteFolder = async (id: string) => {
    const ok = await askConfirm({
      title: 'Excluir pasta',
      message: 'Esta ação não pode ser desfeita. Deseja continuar?',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return
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

  const removeCategory = async (catId: string) => {
    const ok = await askConfirm({
      title: 'Remover categoria',
      message: 'Os prompts desta categoria também serão removidos. Deseja continuar?',
      confirmLabel: 'Remover',
      danger: true,
    })
    if (!ok) return
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

  const addPrompt = async (catId: string) => {
    const name = await askInput({
      title: 'Novo prompt',
      message: 'Informe um nome para o novo prompt',
      placeholder: 'Ex: Loiro Bege',
      confirmLabel: 'Criar',
    })
    if (!name?.trim()) return
    const cat = config.categories.find(c => c.id === catId)
    if (!cat) return
    const p = newPrompt(cat.prompts.length)
    p.name = name.trim()
    updateCat(catId, { prompts: [...cat.prompts, p] })
    // ao criar já entra em modo edição e com snapshot
    setPromptSnapshots(prev => ({ ...prev, [p.id]: JSON.parse(JSON.stringify(p)) }))
    setActivePrompt(p.id)
  }

  const removePrompt = async (catId: string, pId: string) => {
    const ok = await askConfirm({
      title: 'Remover prompt',
      message: 'Este prompt será excluído. Deseja continuar?',
      confirmLabel: 'Remover',
      danger: true,
    })
    if (!ok) return
    const cat = config.categories.find(c => c.id === catId)
    if (!cat) return
    updateCat(catId, { prompts: cat.prompts.filter(p => p.id !== pId) })
    if (activePrompt === pId) setActivePrompt(null)
    setPromptSnapshots(prev => { const n = { ...prev }; delete n[pId]; return n })
  }

  const updatePrompt = (catId: string, pId: string, u: Partial<Prompt>) => {
    const cat = config.categories.find(c => c.id === catId)
    if (!cat) return
    updateCat(catId, { prompts: cat.prompts.map(p => p.id === pId ? { ...p, ...u } : p) })
  }

  /** Substitui um prompt inteiro (usado ao cancelar edição e restaurar snapshot) */
  const replacePrompt = (catId: string, pId: string, newPrompt: Prompt) => {
    setConfig(prev => ({
      ...prev,
      categories: prev.categories.map(c =>
        c.id === catId
          ? { ...c, prompts: c.prompts.map(p => p.id === pId ? newPrompt : p) }
          : c
      ),
    }))
  }

  /** Abre um prompt para edição — guarda snapshot para permitir cancelamento */
  const openPromptForEdit = (catId: string, pId: string) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (prompt && !promptSnapshots[pId]) {
      setPromptSnapshots(prev => ({ ...prev, [pId]: JSON.parse(JSON.stringify(prompt)) }))
    }
    setActivePrompt(pId)
  }

  /** Confirma as alterações do prompt atual (fecha e remove snapshot) */
  const confirmPromptChanges = (pId: string) => {
    setPromptSnapshots(prev => { const n = { ...prev }; delete n[pId]; return n })
    setActivePrompt(null)
  }

  /** Descarta as alterações feitas no prompt — restaura o snapshot guardado ao abrir */
  const cancelPromptChanges = (catId: string, pId: string) => {
    const snap = promptSnapshots[pId]
    if (snap) replacePrompt(catId, pId, snap)
    setPromptSnapshots(prev => { const n = { ...prev }; delete n[pId]; return n })
    setActivePrompt(null)
  }

  // ── Layout Format Copy ─────────────────────────────────────

  /** Extracts only the styling info from a layout (no text) */
  function extractLayoutFormat(layout: ItemLayout) {
    return {
      style: layout.style,
      layoutMode: layout.layoutMode ?? 'flow',
      photo: layout.photo,
      pageMarginH: layout.pageMarginH,
      labelConfig: layout.labelConfig,
      blockStyles: layout.blocks.map(b => ({
        marginBelow: b.marginBelow,
        fontFamily: b.fontFamily,
        headerSize: b.headerSize,
        bodySize: b.bodySize,
        headerColor: b.headerColor,
        bodyColor: b.bodyColor,
        blockVariant: b.blockVariant,
        blockBgColor: b.blockBgColor,
        titleAlign: b.titleAlign,
        textAlign: b.textAlign,
        isSection: b.isSection,
        // Dimensões e posição do bloco (freeform)
        w: b.w,
        h: b.h,
        x: b.x,
        y: b.y,
      })),
    }
  }

  /** Applies a format template to a target prompt — keeps rawLines, replaces styles */
  function applyLayoutFormat(
    template: ReturnType<typeof extractLayoutFormat>,
    targetPrompt: Prompt,
    catType: string,
  ): ItemLayout {
    const captionText = catType === 'cabelo'
      ? (targetPrompt.tintReference || '')
      : (targetPrompt.reference || '')

    // Texto SEMPRE vem da Referência atual (tintReference/reference) do prompt alvo.
    // Nunca reusar existingBlocks: os rawLines salvos podem estar desatualizados
    // se o usuário editou a Referência depois de já ter criado um Layout PDF.
    // Formato copia apenas estilos, cores, fontes, margens e posições — nunca texto.
    const baseBlocks = parseRefToBlocks(captionText)

    const fallbackStyle = template.blockStyles[template.blockStyles.length - 1] ?? {}
    const styledBlocks: EditorBlock[] = baseBlocks.map((b, i) => {
      const s = template.blockStyles[i] ?? fallbackStyle
      return {
        ...b,
        marginBelow: s.marginBelow ?? 8,
        fontFamily: s.fontFamily,
        headerSize: s.headerSize,
        bodySize: s.bodySize,
        headerColor: s.headerColor,
        bodyColor: s.bodyColor,
        blockVariant: s.blockVariant,
        blockBgColor: s.blockBgColor,
        titleAlign: s.titleAlign,
        textAlign: s.textAlign,
        isSection: s.isSection ?? b.isSection,
        // Copia dimensões e posição (freeform)
        w: s.w,
        h: s.h,
        x: s.x,
        y: s.y,
      }
    })

    return {
      blocks: styledBlocks,
      style: template.style,
      layoutMode: template.layoutMode,
      photo: template.photo,
      pageMarginH: template.pageMarginH,
      labelConfig: template.labelConfig,
    }
  }

  const applyFormatToPrompts = (
    srcCatId: string, srcPId: string,
    targets: Array<{ catId: string; pId: string }>,
  ) => {
    const srcCat = config.categories.find(c => c.id === srcCatId)
    const srcPrompt = srcCat?.prompts.find(p => p.id === srcPId)
    if (!srcPrompt?.pdfLayout) return

    const template = extractLayoutFormat(srcPrompt.pdfLayout)

    setConfig(prev => ({
      ...prev,
      categories: prev.categories.map(cat => ({
        ...cat,
        prompts: cat.prompts.map(p => {
          const isTarget = targets.some(t => t.catId === cat.id && t.pId === p.id)
          if (!isTarget) return p
          return { ...p, pdfLayout: applyLayoutFormat(template, p, cat.type) }
        }),
      })),
    }))
  }

  // ── Block editor helpers (tintReference / reference) ───────

  const BLOCK_EMOJI_RE_TEST = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}]/u

  function parseRefToBlocks(text: string): Array<{ id: string; rawLines: string[]; isSection: boolean }> {
    if (!text.trim()) return [{ id: `b-${Date.now()}`, rawLines: [''], isSection: false }]
    const paragraphs = text.split(/\n[ \t]*\n/)
    return paragraphs.map((raw, i) => {
      const lines = raw.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0)
      if (!lines.length) return null
      const first = lines[0]
      const isSection = BLOCK_EMOJI_RE_TEST.test(first)
        || (first === first.toUpperCase() && first.replace(/[^A-Za-z]/g, '').length >= 4)
      return { id: `b-${i}-${Date.now()}`, rawLines: lines, isSection }
    }).filter(Boolean) as any[]
  }

  function blockLinesToText(blocks: Array<{ rawLines: string[] }>): string {
    return blocks.map(b => b.rawLines.join('\n')).join('\n\n')
  }

  const toggleBlockEditor = (pId: string) => {
    setBlockEditorIds(prev => {
      const n = new Set(prev)
      n.has(pId) ? n.delete(pId) : n.add(pId)
      return n
    })
  }

  // ── Prompt picker (reusar de outras pastas) ────────────────

  const openPromptPicker = async (catId: string) => {
    setPromptPicker({ catId })
    setLoadingPrompts(true)
    const { data } = await supabase.from('ai_folders').select('*').order('name')
    const entries: FolderPromptEntry[] = []
    for (const folder of (data || [])) {
      if (folder.id === editingFolder?.id) continue
      const fc: FolderConfig = typeof folder.config === 'string' ? JSON.parse(folder.config) : folder.config
      for (const cat of (fc.categories || [])) {
        for (const p of (cat.prompts || [])) {
          entries.push({ folderId: folder.id, folderName: folder.name, catId: cat.id, catName: cat.name, prompt: p })
        }
      }
    }
    setAllFolderPrompts(entries)
    setLoadingPrompts(false)
  }

  const importPrompt = async (catId: string, source: FolderPromptEntry) => {
    const cat = config.categories.find(c => c.id === catId)
    if (!cat) return
    const copy = await clonePrompt(source.prompt as Prompt, cat.prompts.length)
    updateCat(catId, { prompts: [...cat.prompts, copy] })
    setActivePrompt(copy.id)
    setPromptPicker(null)
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

  // ── Aba global: CRUD de comprimentos/texturas (ai_sub_options) ──

  /** Abre o modal para criar um novo item global */
  const openCreateGlobal = (kind: 'length' | 'texture') => {
    setGlobalEdit({ kind, dbId: null, name: '', instruction: '', thumbnail: null, images: [] })
  }

  /** Abre o modal para editar um item global existente */
  const openEditGlobal = (item: GlobalSubOpt) => {
    setGlobalEdit({
      kind: item.kind, dbId: item.dbId ?? null,
      name: item.name, instruction: item.instruction,
      thumbnail: item.thumbnail, images: [...item.images],
    })
  }

  /** Salva (insert ou update) o item global e recarrega a lista */
  const saveGlobalEdit = async () => {
    if (!globalEdit || !globalEdit.name.trim()) return
    setSavingGlobal(true)
    try {
      const payload = {
        kind: globalEdit.kind,
        name: globalEdit.name.trim(),
        instruction: globalEdit.instruction,
        thumbnail: globalEdit.thumbnail,
        images: globalEdit.images,
      }
      if (globalEdit.dbId) {
        const { error } = await supabase.from('ai_sub_options').update(payload).eq('id', globalEdit.dbId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('ai_sub_options').insert(payload)
        if (error) throw error
      }
      setGlobalEdit(null)
      await loadGlobalSubOpts()
    } catch (e: any) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setSavingGlobal(false)
    }
  }

  /** Exclui um item global — avisa que pode afetar prompts vinculados */
  const deleteGlobalItem = async (item: GlobalSubOpt) => {
    const label = item.kind === 'length' ? 'comprimento' : 'textura'
    const ok = await askConfirm({
      title: `Excluir ${label}`,
      message: `"${item.name}" será removido do banco. Prompts que já usam este ${label} manterão uma cópia local, mas o item não estará mais disponível para vincular em novos prompts.`,
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok || !item.dbId) return
    try {
      const { error } = await supabase.from('ai_sub_options').delete().eq('id', item.dbId)
      if (error) throw error
      await loadGlobalSubOpts()
    } catch (e: any) {
      alert('Erro ao excluir: ' + e.message)
    }
  }

  /** Upload de thumbnail dentro do modal global */
  const handleGlobalThumbUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !globalEdit) return; e.target.value = ''
    try {
      const { storagePath, url } = await uploadFile(file, `global_${globalEdit.kind}_thumb`)
      setGlobalEdit(prev => prev ? { ...prev, thumbnail: { storagePath, url, label: 'thumbnail' } } : prev)
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  /** Upload de imagem de referência dentro do modal global */
  const handleGlobalImgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !globalEdit) return; e.target.value = ''
    const defaultLabel = file.name.replace(/\.[^.]+$/, '')
    const label = await askInput({
      title: 'Descrição da imagem',
      message: 'Este texto ajuda a IA a entender o conteúdo da imagem',
      defaultValue: defaultLabel,
      confirmLabel: 'Adicionar',
    }) || defaultLabel
    try {
      const { storagePath, url } = await uploadFile(file, `global_${globalEdit.kind}_ref`)
      setGlobalEdit(prev => prev ? { ...prev, images: [...prev.images, { storagePath, url, label }] } : prev)
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  /** Remove a thumbnail do item global em edição */
  const removeGlobalThumb = () => {
    setGlobalEdit(prev => prev ? { ...prev, thumbnail: null } : prev)
  }

  /** Remove uma imagem de referência do item global em edição */
  const removeGlobalImg = (idx: number) => {
    setGlobalEdit(prev => prev ? { ...prev, images: prev.images.filter((_, i) => i !== idx) } : prev)
  }

  // Carrega a lista global assim que a tela de listagem aparece
  // (garante que os contadores das abas Comprimentos/Texturas já apareçam corretos).
  useEffect(() => {
    if (!editingFolder) {
      loadGlobalSubOpts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingFolder])

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

  const duplicateSubOption = async (catId: string, pId: string, field: 'lengths' | 'textures', subId: string) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    const sub = (prompt?.[field] || []).find((s: SubOption) => s.id === subId)
    if (!sub) return
    const copy = await cloneSubOption(sub, field)
    updatePrompt(catId, pId, { [field]: [...(prompt![field] || []), copy] })
    if (field === 'lengths') setOpenLengthId(copy.id)
    else setOpenTextureId(copy.id)
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
    const defaultLabel = file.name.replace(/\.[^.]+$/, '')
    const label = await askInput({
      title: 'Descrição da imagem',
      message: 'Este texto ajuda a IA a entender o conteúdo da imagem',
      defaultValue: defaultLabel,
      placeholder: 'Ex: Referência de cor',
      confirmLabel: 'Adicionar',
    }) || defaultLabel
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
    // Não deleta do Storage — o arquivo pode estar sendo usado por prompts copiados
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

  // ── Helpers de clonagem de imagens ────────────────────────
  // Ao copiar um prompt, cada imagem é re-enviada para um novo
  // storagePath independente, evitando que a remoção de uma
  // referência quebre outras cópias que usam o mesmo arquivo.

  const cloneImage = async (img: PromptImage, prefix: string): Promise<PromptImage> => {
    try {
      const res = await fetch(img.url)
      const blob = await res.blob()
      const ext = img.url.split('.').pop()?.split('?')[0] || 'jpg'
      const path = `ai-materials/folders/${prefix}_${Date.now()}_${uid()}.${ext}`
      const { error } = await supabase.storage.from('client-photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true })
      if (error) return img
      return { storagePath: path, url: supabase.storage.from('client-photos').getPublicUrl(path).data.publicUrl, label: img.label }
    } catch {
      return img
    }
  }

  const cloneSubOption = async (sub: SubOption, prefix: string): Promise<SubOption> => {
    const thumbnail = sub.thumbnail ? await cloneImage(sub.thumbnail, `${prefix}_thumb`) : null
    const images = await Promise.all(sub.images.map((img, i) => cloneImage(img, `${prefix}_img${i}`)))
    return { ...sub, id: uid(), dbId: undefined, thumbnail, images }
  }

  const clonePrompt = async (prompt: Prompt, order: number): Promise<Prompt> => {
    const thumbnail = prompt.thumbnail ? await cloneImage(prompt.thumbnail, 'thumb') : null
    const images = await Promise.all((prompt.images || []).map((img, i) => cloneImage(img, `img${i}`)))
    const lengths = await Promise.all((prompt.lengths || []).map((l, i) => cloneSubOption(l, `len${i}`)))
    const textures = await Promise.all((prompt.textures || []).map((t, i) => cloneSubOption(t, `tex${i}`)))
    return { ...prompt, id: uid(), order, thumbnail, images, lengths, textures }
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
    const defaultLabel = file.name.replace(/\.[^.]+$/, '')
    const label = await askInput({
      title: 'Descrição da imagem',
      message: 'Este texto ajuda a IA a entender o conteúdo da imagem',
      defaultValue: defaultLabel,
      placeholder: 'Ex: Inspiração de corte',
      confirmLabel: 'Adicionar',
    }) || defaultLabel
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
    // Não deleta do Storage — o arquivo pode estar sendo usado por prompts copiados
    updatePrompt(catId, pId, { images: prompt.images.filter((_, i) => i !== idx) })
  }

  const removeThumb = async (catId: string, pId: string) => {
    const cat = config.categories.find(c => c.id === catId)
    const prompt = cat?.prompts.find(p => p.id === pId)
    if (!prompt?.thumbnail) return
    // Não deleta do Storage — o arquivo pode estar sendo usado por prompts copiados
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
        <div className="flex flex-wrap items-center justify-between gap-2">
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
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mb-2">
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

  // Modais globais — renderizados em ambas as telas (lista de pastas e editor)
  const modals = (
    <>
      {inputModal && (
        <InputModal
          title={inputModal.title}
          message={inputModal.message}
          placeholder={inputModal.placeholder}
          defaultValue={inputModal.defaultValue}
          confirmLabel={inputModal.confirmLabel}
          onSubmit={v => { inputModal.resolve(v); setInputModal(null) }}
          onCancel={() => { inputModal.resolve(null); setInputModal(null) }}
        />
      )}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          cancelLabel={confirmModal.cancelLabel}
          danger={confirmModal.danger}
          onConfirm={() => { confirmModal.resolve(true); setConfirmModal(null) }}
          onCancel={() => { confirmModal.resolve(false); setConfirmModal(null) }}
        />
      )}
    </>
  )

  // ── Tela inicial com abas (Pastas / Comprimentos / Texturas) ──

  if (!editingFolder) {
    const lengths = globalSubOpts.filter(o => o.kind === 'length')
    const textures = globalSubOpts.filter(o => o.kind === 'texture')

    const tabConfig: Array<{ id: TopTab; label: string; icon: string; count: number }> = [
      { id: 'pastas', label: 'Pastas', icon: '📁', count: folders.length },
      { id: 'comprimentos', label: 'Comprimentos', icon: '✂️', count: lengths.length },
      { id: 'texturas', label: 'Texturas', icon: '🌀', count: textures.length },
    ]

    return (
      <>
        <div className="space-y-4 sm:space-y-6">
          {/* Abas de navegação */}
          <div className="border-b border-gray-200">
            <div className="flex gap-1 overflow-x-auto -mb-px">
              {tabConfig.map(tab => {
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      active
                        ? 'border-violet-600 text-violet-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      active ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Conteúdo das abas */}
          {activeTab === 'pastas' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Pastas de Prompts IA</h2>
                  <p className="text-sm text-gray-500">Crie pastas globais com prompts, Drive e fotos por categoria</p>
                </div>
                <button onClick={createFolder} className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700">
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
            </>
          )}

          {activeTab === 'comprimentos' && (
            <SubOptionsTabView
              kind="length"
              items={lengths}
              loading={loadingGlobal}
              onCreate={() => openCreateGlobal('length')}
              onEdit={openEditGlobal}
              onDelete={deleteGlobalItem}
            />
          )}

          {activeTab === 'texturas' && (
            <SubOptionsTabView
              kind="texture"
              items={textures}
              loading={loadingGlobal}
              onCreate={() => openCreateGlobal('texture')}
              onEdit={openEditGlobal}
              onDelete={deleteGlobalItem}
            />
          )}
        </div>

        {/* Modal de edição/criação de item global */}
        {globalEdit && (
          <GlobalSubOptEditModal
            state={globalEdit}
            saving={savingGlobal}
            onChange={setGlobalEdit}
            onSave={saveGlobalEdit}
            onCancel={() => setGlobalEdit(null)}
            onThumbUpload={handleGlobalThumbUpload}
            onImgUpload={handleGlobalImgUpload}
            onThumbRemove={removeGlobalThumb}
            onImgRemove={removeGlobalImg}
          />
        )}

        {modals}
      </>
    )
  }

  // ── Folder editor ──────────────────────────────────────────

  return (
    <div className="space-y-4 sm:space-y-6">
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
        <div className="flex flex-wrap items-center justify-between gap-2">
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
              <div className={`px-3 sm:px-4 py-3 cursor-pointer ${isOpen ? 'bg-violet-50' : 'bg-white hover:bg-gray-50'}`}
                onClick={() => { setActiveCat(isOpen ? null : cat.id); setActivePrompt(null) }}>
                {/* Linha 1: ícone + nome + contador + ações */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <Icon className="h-4 w-4 text-violet-500 flex-shrink-0" />
                  <span className="font-medium text-sm text-gray-800 flex-1 truncate min-w-0">{cat.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{cat.prompts.length}</span>
                  <button onClick={e => { e.stopPropagation(); removeCategory(cat.id) }} className="text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                </div>
                {/* Linha 2: badges (quebram se necessário, ficam abaixo em mobile) */}
                {(catType || refType) && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-6">
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
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="px-3 sm:px-4 py-3 border-t border-gray-100 space-y-3">
                  {/* Nome */}
                  <div>
                    <label className="text-xs text-gray-500">Nome</label>
                    <input value={cat.name} onChange={e => updateCat(cat.id, { name: e.target.value })} className={`${inp} text-sm`} />
                  </div>

                  {/* Tipo + Foto da cliente — grid responsivo (empilha em mobile) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
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
                    <div>
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
                      <div
                        className="px-3 py-2 flex items-center gap-2 cursor-pointer"
                        onClick={() => {
                          if (activePrompt === prompt.id) {
                            // clicar no header quando aberto = salvar alterações e fechar
                            confirmPromptChanges(prompt.id)
                          } else {
                            openPromptForEdit(cat.id, prompt.id)
                          }
                        }}
                      >
                        {prompt.thumbnail ? (
                          <img src={prompt.thumbnail.url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0 border" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0"><Image className="h-4 w-4 text-gray-300" /></div>
                        )}
                        <span className="text-sm text-gray-800 font-medium flex-1 truncate min-w-0">{prompt.name || '(sem nome)'}</span>
                        <button onClick={e => { e.stopPropagation(); removePrompt(cat.id, prompt.id) }} className="text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 className="h-3 w-3" /></button>
                        {activePrompt === prompt.id ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
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
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                <label className="text-xs font-medium text-gray-600">🎨 Referência de tinta</label>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => toggleBlockEditor(prompt.id)}
                                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                                      blockEditorIds.has(prompt.id)
                                        ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                    }`}
                                    title="Alternar modo blocos"
                                  >
                                    🧱 Blocos
                                  </button>
                                  <button
                                    onClick={() => setLayoutCtx({ catId: cat.id, pId: prompt.id })}
                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                                  >
                                    <Layout className="h-3 w-3" />
                                    {prompt.pdfLayout ? 'Editar Layout PDF' : 'Criar Layout PDF'}
                                  </button>
                                </div>
                              </div>
                              {prompt.pdfLayout && (
                                <div className="mb-2 px-2.5 py-1.5 bg-violet-50 border border-violet-200 rounded-lg flex items-center gap-2">
                                  <Layout className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
                                  <span className="text-xs text-violet-700 flex-1">
                                    Layout salvo · {prompt.pdfLayout.layoutMode === 'freeform' ? '🆓 Modo livre' : '🔀 Modo fluxo'} · {prompt.pdfLayout.blocks?.length ?? 0} blocos
                                  </span>
                                  <button
                                    onClick={() => setCopyFormatSrc({ catId: cat.id, pId: prompt.id })}
                                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-violet-100 text-violet-600 rounded-md hover:bg-violet-200 transition-colors"
                                    title="Copiar este formato para outros prompts"
                                  >
                                    <Copy className="h-3 w-3" /> Copiar formato
                                  </button>
                                  <button
                                    onClick={() => updatePrompt(cat.id, prompt.id, { pdfLayout: undefined })}
                                    className="text-violet-400 hover:text-red-500"
                                    title="Remover layout"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                              <p className="text-[10px] text-gray-400 mb-1">Use emojis, parágrafos e quebras de linha. O layout do PDF é configurado pelo botão acima.</p>
                              {blockEditorIds.has(prompt.id) ? (
                                <TintBlockEditor
                                  value={prompt.tintReference}
                                  onChange={v => updatePrompt(cat.id, prompt.id, { tintReference: v })}
                                  parseRefToBlocks={parseRefToBlocks}
                                  blockLinesToText={blockLinesToText}
                                />
                              ) : (
                                <textarea value={prompt.tintReference} onChange={e => updatePrompt(cat.id, prompt.id, { tintReference: e.target.value })}
                                  rows={5} placeholder={"Ex:\n🎨 TINTA RECOMENDADA\n\nWella Koleston 9/1 + 10/1\nProporção: 2:1 com OX 30vol\n\n✨ Para as mechas:\nWella Blondor 40g"}
                                  className={`${inp} resize-y text-xs font-mono`} />
                              )}
                            </div>
                            </div>
                          )}

                          {/* Referência geral (para todos os outros tipos) */}
                          {cat.type !== 'cabelo' && (
                            <div>
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                <label className="text-xs font-medium text-gray-600">📌 Referência (opcional)</label>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => toggleBlockEditor(prompt.id)}
                                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                                      blockEditorIds.has(prompt.id)
                                        ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                    }`}
                                    title="Alternar modo blocos"
                                  >
                                    🧱 Blocos
                                  </button>
                                  <button
                                    onClick={() => setLayoutCtx({ catId: cat.id, pId: prompt.id })}
                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                                  >
                                    <Layout className="h-3 w-3" />
                                    {prompt.pdfLayout ? 'Editar Layout PDF' : 'Criar Layout PDF'}
                                  </button>
                                </div>
                              </div>
                              {prompt.pdfLayout && (
                                <div className="mb-2 px-2.5 py-1.5 bg-violet-50 border border-violet-200 rounded-lg flex items-center gap-2">
                                  <Layout className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
                                  <span className="text-xs text-violet-700 flex-1">
                                    Layout salvo · {prompt.pdfLayout.layoutMode === 'freeform' ? '🆓 Modo livre' : '🔀 Modo fluxo'} · {prompt.pdfLayout.blocks?.length ?? 0} blocos
                                  </span>
                                  <button
                                    onClick={() => setCopyFormatSrc({ catId: cat.id, pId: prompt.id })}
                                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-violet-100 text-violet-600 rounded-md hover:bg-violet-200 transition-colors"
                                    title="Copiar este formato para outros prompts"
                                  >
                                    <Copy className="h-3 w-3" /> Copiar formato
                                  </button>
                                  <button
                                    onClick={() => updatePrompt(cat.id, prompt.id, { pdfLayout: undefined })}
                                    className="text-violet-400 hover:text-red-500"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                              {blockEditorIds.has(prompt.id) ? (
                                <TintBlockEditor
                                  value={prompt.reference}
                                  onChange={v => updatePrompt(cat.id, prompt.id, { reference: v })}
                                  parseRefToBlocks={parseRefToBlocks}
                                  blockLinesToText={blockLinesToText}
                                />
                              ) : (
                                <input value={prompt.reference} onChange={e => updatePrompt(cat.id, prompt.id, { reference: e.target.value })}
                                  placeholder="Ex: Marca, produto, código de cor..." className={inp} />
                              )}
                            </div>
                          )}

                          {/* Footer: Salvar / Cancelar */}
                          <div className="flex gap-2 pt-3 mt-2 border-t border-gray-200">
                            <button
                              onClick={() => cancelPromptChanges(cat.id, prompt.id)}
                              className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => confirmPromptChanges(prompt.id)}
                              className="flex-1 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 flex items-center justify-center gap-1.5 transition-colors"
                            >
                              <Save className="h-3.5 w-3.5" /> Salvar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <div className="flex gap-2">
                    <button onClick={() => addPrompt(cat.id)}
                      className="flex-1 py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:text-violet-600 flex items-center justify-center gap-1">
                      <Plus className="h-3 w-3" /> Novo prompt
                    </button>
                    <button onClick={() => openPromptPicker(cat.id)}
                      className="flex-1 py-2 border border-dashed border-blue-300 rounded-lg text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 flex items-center justify-center gap-1">
                      <Copy className="h-3 w-3" /> Usar existente
                    </button>
                  </div>
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
      {layoutCtx && (() => {
  const cat = config.categories.find(c => c.id === layoutCtx.catId)
  const prompt = cat?.prompts.find(p => p.id === layoutCtx.pId)
  if (!cat || !prompt) return null

  const caption = cat.type === 'cabelo'
    ? (prompt.tintReference || '')
    : (prompt.reference || '')

  return (
    <PDFLayoutEditor
      caption={caption}
      clientName="Pré-visualização"
      sectionTitle={cat.name}
      initialStyle={{}}
      initialLayout={prompt.pdfLayout}
      onSave={layout => {
        updatePrompt(layoutCtx.catId, layoutCtx.pId, { pdfLayout: layout })
        setLayoutCtx(null)
      }}
      onClose={() => setLayoutCtx(null)}
    />
  )
})()}
      <CategoryTypeModal
        open={typeModalOpen}
        onSelect={handleTypeSelected}
        onCancel={handleTypeModalCancel}
      />

      {/* ── Prompt Picker Modal ── */}
      {promptPicker && (
        <PromptPickerModal
          entries={allFolderPrompts}
          loading={loadingPrompts}
          onSelect={entry => importPrompt(promptPicker.catId, entry)}
          onClose={() => setPromptPicker(null)}
        />
      )}

      {/* ── Global Sub-Option Picker Modal ── */}
      {subPicker && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
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
                    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
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
      {/* ── Copy Format Modal ── */}
      {copyFormatSrc && (() => {
        const srcCat = config.categories.find(c => c.id === copyFormatSrc.catId)
        const srcPrompt = srcCat?.prompts.find(p => p.id === copyFormatSrc.pId)
        if (!srcCat || !srcPrompt?.pdfLayout) return null
        const allTargets = config.categories.flatMap(cat =>
          cat.prompts
            .filter(p => !(cat.id === copyFormatSrc.catId && p.id === copyFormatSrc.pId))
            .map(p => ({ catId: cat.id, pId: p.id, catName: cat.name, promptName: p.name, hasLayout: !!p.pdfLayout }))
        )
        return (
          <CopyFormatModal
            srcPrompt={srcPrompt}
            allTargets={allTargets}
            onApply={targets => {
              applyFormatToPrompts(copyFormatSrc.catId, copyFormatSrc.pId, targets)
              setCopyFormatSrc(null)
            }}
            onClose={() => setCopyFormatSrc(null)}
          />
        )
      })()}

      {/* ── Input Modal + Confirm Modal (compartilhados com a tela de lista) ── */}
      {modals}
    </div>
  )
}
// ─── TintBlockEditor ─────────────────────────────────────────────────────────
// Inline block editor for the tintReference / reference text field.
// Parses the text into visual blocks (same structure as PDFLayoutEditor) and
// lets the user edit each block individually, then syncs back to plain text.

interface TintBlock {
  id: string
  lines: string[]
  isSection: boolean
}

interface TintBlockEditorProps {
  value: string
  onChange: (v: string) => void
  parseRefToBlocks: (text: string) => Array<{ id: string; rawLines: string[]; isSection: boolean }>
  blockLinesToText: (blocks: Array<{ rawLines: string[] }>) => string
}

function TintBlockEditor({ value, onChange, parseRefToBlocks, blockLinesToText }: TintBlockEditorProps) {
  const [blocks, setBlocks] = React.useState<TintBlock[]>(() =>
    parseRefToBlocks(value).map(b => ({ id: b.id, lines: b.rawLines, isSection: b.isSection }))
  )

  // Keep text in sync whenever blocks change
  const updateBlocks = (next: TintBlock[]) => {
    setBlocks(next)
    onChange(blockLinesToText(next.map(b => ({ rawLines: b.lines }))))
  }

  const updateBlockText = (id: string, text: string) => {
    const lines = text.split('\n')
    updateBlocks(blocks.map(b => {
      if (b.id !== id) return b
      const first = lines[0] ?? ''
      const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}]/u
      const isSection = EMOJI_RE.test(first) || (first === first.toUpperCase() && first.replace(/[^A-Za-z]/g, '').length >= 4)
      return { ...b, lines, isSection }
    }))
  }

  const addBlock = (afterId?: string) => {
    const newBlock: TintBlock = { id: `b-${Date.now()}`, lines: [''], isSection: false }
    if (!afterId) {
      updateBlocks([...blocks, newBlock])
    } else {
      const i = blocks.findIndex(b => b.id === afterId)
      const next = [...blocks]
      next.splice(i + 1, 0, newBlock)
      updateBlocks(next)
    }
  }

  const removeBlock = (id: string) => {
    if (blocks.length <= 1) { updateBlocks([{ id: blocks[0].id, lines: [''], isSection: false }]); return }
    updateBlocks(blocks.filter(b => b.id !== id))
  }

  const moveBlock = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex(b => b.id === id)
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    const next = [...blocks]; [next[i], next[j]] = [next[j], next[i]]
    updateBlocks(next)
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => (
        <div
          key={block.id}
          className={`border rounded-lg overflow-hidden ${block.isSection ? 'border-violet-300 bg-violet-50/40' : 'border-gray-200 bg-white'}`}
        >
          {/* Block header */}
          <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-100 bg-gray-50/60">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
              block.isSection ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {block.isSection ? '📌 Título' : `📄 Corpo ${i + 1}`}
            </span>
            <div className="flex-1" />
            <button onClick={() => moveBlock(block.id, -1)} disabled={i === 0}
              className="text-gray-300 hover:text-gray-500 disabled:opacity-20 p-0.5">▲</button>
            <button onClick={() => moveBlock(block.id, 1)} disabled={i === blocks.length - 1}
              className="text-gray-300 hover:text-gray-500 disabled:opacity-20 p-0.5">▼</button>
            <button onClick={() => addBlock(block.id)}
              className="text-violet-400 hover:text-violet-600 p-0.5 text-xs font-bold" title="Adicionar bloco abaixo">+</button>
            <button onClick={() => removeBlock(block.id)}
              className="text-gray-300 hover:text-red-400 p-0.5">
              <X className="h-3 w-3" />
            </button>
          </div>
          <textarea
            value={block.lines.join('\n')}
            onChange={e => updateBlockText(block.id, e.target.value)}
            rows={Math.max(2, block.lines.length)}
            className="w-full px-3 py-2 text-xs font-mono bg-transparent border-0 outline-none resize-none text-gray-700 placeholder-gray-300"
            placeholder={block.isSection ? 'Ex: 🎨 TINTA RECOMENDADA' : 'Ex: Wella 9/1 + OX 30vol'}
          />
        </div>
      ))}
      <button
        onClick={() => addBlock()}
        className="w-full py-2 border border-dashed border-amber-300 rounded-lg text-xs text-amber-600 hover:bg-amber-50 flex items-center justify-center gap-1"
      >
        <Plus className="h-3 w-3" /> Adicionar bloco
      </button>
      <p className="text-[10px] text-gray-400">Cada caixa = um bloco no PDF. Linha em branco separa blocos no texto plano.</p>
    </div>
  )
}

// ─── PromptPickerModal ────────────────────────────────────────────────────────

interface FolderPromptEntry { folderId: string; folderName: string; catId: string; catName: string; prompt: { id: string; name: string; thumbnail: any; instructions: string; [key: string]: any } }

interface PromptPickerModalProps {
  entries: FolderPromptEntry[]
  loading: boolean
  onSelect: (entry: FolderPromptEntry) => void
  onClose: () => void
}

function PromptPickerModal({ entries, loading, onSelect, onClose }: PromptPickerModalProps) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? entries.filter(e =>
        e.prompt.name.toLowerCase().includes(search.toLowerCase()) ||
        e.folderName.toLowerCase().includes(search.toLowerCase()) ||
        e.catName.toLowerCase().includes(search.toLowerCase())
      )
    : entries

  // Group by folder
  const grouped = filtered.reduce<Record<string, { folderName: string; items: FolderPromptEntry[] }>>((acc, e) => {
    if (!acc[e.folderId]) acc[e.folderId] = { folderName: e.folderName, items: [] }
    acc[e.folderId].items.push(e)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-gray-900">📋 Usar prompt existente</p>
            <p className="text-xs text-gray-400 mt-0.5">Uma cópia será adicionada a esta categoria</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, pasta ou categoria..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full" />
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              {entries.length === 0 ? 'Nenhum prompt em outras pastas' : 'Nenhum resultado encontrado'}
            </p>
          ) : (
            Object.values(grouped).map(group => (
              <div key={group.folderName}>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <FolderOpen className="h-3 w-3" /> {group.folderName}
                </p>
                <div className="space-y-1.5">
                  {group.items.map(entry => (
                    <button
                      key={entry.prompt.id}
                      onClick={() => onSelect(entry)}
                      className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all text-left"
                    >
                      {entry.prompt.thumbnail ? (
                        <img src={entry.prompt.thumbnail.url} alt="" className="w-10 h-10 rounded-lg object-cover border flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <FileText className="h-4 w-4 text-gray-300" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{entry.prompt.name || '(sem nome)'}</p>
                        <p className="text-xs text-gray-400 truncate">{entry.catName}</p>
                      </div>
                      <Copy className="h-4 w-4 text-blue-400 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── CopyFormatModal ──────────────────────────────────────────────────────────
// Extracted as a proper component so useState is called at the top level,
// respecting the Rules of Hooks (never inside an IIFE or nested function).

interface CopyFormatTarget {
  catId: string; pId: string; catName: string; promptName: string; hasLayout: boolean
}

interface CopyFormatModalProps {
  srcPrompt: Prompt
  allTargets: CopyFormatTarget[]
  onApply: (targets: Array<{ catId: string; pId: string }>) => void
  onClose: () => void
}

function CopyFormatModal({ srcPrompt, allTargets, onApply, onClose }: CopyFormatModalProps) {
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set())
  const fmt = srcPrompt.pdfLayout!

  const key = (catId: string, pId: string) => `${catId}::${pId}`

  const toggle = (catId: string, pId: string) => setSelectedTargets(prev => {
    const n = new Set(prev); const k = key(catId, pId)
    n.has(k) ? n.delete(k) : n.add(k); return n
  })

  const handleApply = () => {
    const targets = allTargets
      .filter(t => selectedTargets.has(key(t.catId, t.pId)))
      .map(t => ({ catId: t.catId, pId: t.pId }))
    onApply(targets)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-gray-900">📋 Copiar formato</p>
            <p className="text-xs text-gray-400 mt-0.5">
              De: <span className="font-medium text-gray-600">{srcPrompt.name || '(sem nome)'}</span>
              {' · '}{fmt.layoutMode === 'freeform' ? '🆓 Livre' : '🔀 Fluxo'}{' · '}{fmt.blocks?.length ?? 0} blocos
            </p>
            <p className="text-[10px] text-amber-600 mt-1 bg-amber-50 px-2 py-0.5 rounded-full inline-block">
              Copia estilo, cores e variantes — não copia o texto
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {allTargets.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Nenhum outro prompt disponível</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                <span className="text-xs text-gray-400">Selecione os prompts que receberão este formato:</span>
                <button
                  onClick={() => setSelectedTargets(
                    selectedTargets.size === allTargets.length
                      ? new Set()
                      : new Set(allTargets.map(t => key(t.catId, t.pId)))
                  )}
                  className="text-xs text-violet-600 hover:underline whitespace-nowrap ml-2"
                >
                  {selectedTargets.size === allTargets.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>
              {allTargets.map(t => {
                const sel = selectedTargets.has(key(t.catId, t.pId))
                return (
                  <button
                    key={key(t.catId, t.pId)}
                    onClick={() => toggle(t.catId, t.pId)}
                    className={`w-full flex items-center gap-3 p-3 border-2 rounded-xl transition-all text-left
                      ${sel ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-300 hover:bg-violet-50/50'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{t.promptName || '(sem nome)'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{t.catName}</span>
                        {t.hasLayout && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded-full">tem layout</span>
                        )}
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors
                      ${sel ? 'border-violet-500 bg-violet-500' : 'border-gray-300'}`}>
                      {sel && <span className="text-white text-[10px] font-bold">✓</span>}
                    </div>
                  </button>
                )
              })}
            </>
          )}
        </div>

        {selectedTargets.size > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleApply}
              className="flex-1 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              <Copy className="h-4 w-4" />
              Aplicar em {selectedTargets.size} {selectedTargets.size === 1 ? 'prompt' : 'prompts'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
// ─── InputModal ───────────────────────────────────────────────────────────────
// Substitui o window.prompt nativo por um modal estilizado e responsivo.

interface InputModalProps {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

function InputModal({
  title, message, placeholder, defaultValue = '',
  confirmLabel = 'Confirmar', onSubmit, onCancel,
}: InputModalProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 50)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!value.trim()) return
    onSubmit(value.trim())
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="font-semibold text-gray-900">{title}</p>
            {message && <p className="text-xs text-gray-500 mt-1">{message}</p>}
          </div>
          <div className="px-5 py-4">
            <input
              ref={inputRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={placeholder}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
            />
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────
// Substitui o window.confirm nativo. Aceita variante "danger" para ações destrutivas.

interface ConfirmModalProps {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({
  title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  danger, onConfirm, onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="font-semibold text-gray-900 flex items-center gap-2">
            {danger && <AlertCircle className="h-4 w-4 text-red-500" />}
            {title}
          </p>
          {message && <p className="text-sm text-gray-500 mt-1">{message}</p>}
        </div>
        <div className="px-5 py-3 flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SubOptionsTabView ────────────────────────────────────────────────────────
// Lista comprimentos ou texturas cadastrados globalmente em ai_sub_options.
// Permite criar novo, editar e excluir. Usado nas abas "Comprimentos" e "Texturas".

interface SubOptionsTabViewProps {
  kind: 'length' | 'texture'
  items: Array<SubOption & { kind: 'length' | 'texture' }>
  loading: boolean
  onCreate: () => void
  onEdit: (item: SubOption & { kind: 'length' | 'texture' }) => void
  onDelete: (item: SubOption & { kind: 'length' | 'texture' }) => void
}

function SubOptionsTabView({ kind, items, loading, onCreate, onEdit, onDelete }: SubOptionsTabViewProps) {
  const label = kind === 'length' ? 'Comprimento' : 'Textura'
  const labelLower = kind === 'length' ? 'comprimento' : 'textura'
  const labelPlural = kind === 'length' ? 'comprimentos' : 'texturas'
  const icon = kind === 'length' ? '✂️' : '🌀'
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? items.filter(i =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        (i.instruction || '').toLowerCase().includes(search.toLowerCase())
      )
    : items

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <span>{icon}</span> {labelPlural.charAt(0).toUpperCase() + labelPlural.slice(1)}
          </h2>
          <p className="text-sm text-gray-500">
            {labelPlural.charAt(0).toUpperCase() + labelPlural.slice(1)} compartilhados entre todas as pastas
          </p>
        </div>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" /> Novo {label}
        </button>
      </div>

      {/* Busca */}
      {items.length > 0 && (
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Buscar ${labelLower}...`}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin h-6 w-6 border-2 border-violet-400 border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-gray-50 rounded-xl p-8 text-center">
          <div className="text-4xl mb-2">{icon}</div>
          <p className="text-gray-500 text-sm">Nenhum {labelLower} cadastrado</p>
          <p className="text-gray-400 text-xs mt-1">Crie o primeiro clicando em "Novo {label}"</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Nenhum resultado para "{search}"</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(item => (
            <div
              key={item.dbId}
              className="bg-white border border-gray-200 rounded-xl p-3 flex gap-3 hover:border-violet-300 transition-colors"
            >
              {item.thumbnail ? (
                <img
                  src={item.thumbnail.url}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover border flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Image className="h-5 w-5 text-gray-300" />
                </div>
              )}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-start gap-1.5">
                  <p className="font-medium text-sm text-gray-900 truncate flex-1">{item.name}</p>
                </div>
                {item.instruction && (
                  <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{item.instruction}</p>
                )}
                <div className="flex items-center gap-2 mt-auto pt-1.5">
                  {item.images.length > 0 && (
                    <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                      <Image className="h-3 w-3" /> {item.images.length}
                    </span>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => onEdit(item)}
                    className="text-xs px-2.5 py-1 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => onDelete(item)}
                    className="text-gray-300 hover:text-red-500"
                    title="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─── GlobalSubOptEditModal ────────────────────────────────────────────────────
// Modal para criar ou editar um comprimento/textura no banco global (ai_sub_options).

interface GlobalEditStateShape {
  kind: 'length' | 'texture'
  dbId: string | null
  name: string
  instruction: string
  thumbnail: PromptImage | null
  images: PromptImage[]
}

interface GlobalSubOptEditModalProps {
  state: GlobalEditStateShape
  saving: boolean
  onChange: (next: GlobalEditStateShape) => void
  onSave: () => void
  onCancel: () => void
  onThumbUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onImgUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onThumbRemove: () => void
  onImgRemove: (idx: number) => void
}

function GlobalSubOptEditModal({
  state, saving, onChange, onSave, onCancel,
  onThumbUpload, onImgUpload, onThumbRemove, onImgRemove,
}: GlobalSubOptEditModalProps) {
  const label = state.kind === 'length' ? 'Comprimento' : 'Textura'
  const labelLower = state.kind === 'length' ? 'comprimento' : 'textura'
  const icon = state.kind === 'length' ? '✂️' : '🌀'
  const isEdit = state.dbId !== null
  const inp = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"

  return (
    <div
      className="fixed inset-0 z-[55] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900 flex items-center gap-2">
              <span>{icon}</span>
              {isEdit ? `Editar ${labelLower}` : `Novo ${labelLower}`}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {isEdit
                ? `Alterações afetam todos os prompts que usam este ${labelLower}`
                : `Ficará disponível para vincular em qualquer prompt de cabelo`}
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Nome */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Nome (aparece para a cliente)
            </label>
            <input
              value={state.name}
              onChange={e => onChange({ ...state, name: e.target.value })}
              placeholder={state.kind === 'length' ? 'Ex: Longo' : 'Ex: Cacheado'}
              className={inp}
              autoFocus
            />
          </div>

          {/* Thumbnail */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              📸 Imagem de capa (aparece no chat)
            </label>
            {state.thumbnail ? (
              <div className="flex items-center gap-3">
                <img
                  src={state.thumbnail.url}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover border"
                />
                <div className="flex gap-2">
                  <label className="text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg cursor-pointer hover:bg-violet-200">
                    <input type="file" accept="image/*" className="hidden" onChange={onThumbUpload} />
                    Trocar
                  </label>
                  <button
                    onClick={onThumbRemove}
                    className="text-xs px-3 py-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
                  >
                    Remover
                  </button>
                </div>
              </div>
            ) : (
              <label className="block border border-dashed border-violet-300 rounded-lg py-3 text-center cursor-pointer hover:bg-violet-50 text-xs text-violet-600">
                <input type="file" accept="image/*" className="hidden" onChange={onThumbUpload} />
                + Adicionar imagem de capa
              </label>
            )}
          </div>

          {/* Instruction */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Instruções para a IA
            </label>
            <textarea
              value={state.instruction}
              onChange={e => onChange({ ...state, instruction: e.target.value })}
              rows={3}
              placeholder={state.kind === 'length' ? 'Ex: Cabelo longo até o ombro' : 'Ex: Cacheado crespo volumoso'}
              className={`${inp} resize-y`}
            />
          </div>

          {/* Imagens de referência */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Imagens de referência (enviadas à IA)
            </label>
            {state.images.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-2">
                {state.images.map((img, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={img.url}
                      alt=""
                      className="w-full aspect-square object-cover rounded-lg border"
                    />
                    <button
                      onClick={() => onImgRemove(idx)}
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="block border border-dashed border-gray-300 rounded-lg py-2 text-center cursor-pointer hover:bg-gray-50 text-xs text-gray-500">
              <input type="file" accept="image/*" className="hidden" onChange={onImgUpload} />
              + Imagem de referência
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving || !state.name.trim()}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <div className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />}
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : `Criar ${labelLower}`)}
          </button>
        </div>
      </div>
    </div>
  )
}