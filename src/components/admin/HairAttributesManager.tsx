// src/components/admin/HairAttributesManager.tsx
import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Upload, Scissors, ChevronDown, ChevronUp, Save, CheckCircle, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Types ──────────────────────────────────────────────────────

export interface HairLength {
  id: string
  name: string
  photoUrl: string
  storagePath: string
  instruction: string
}

export interface HairTexture {
  id: string
  name: string
  photoUrl: string
  storagePath: string
  instruction: string
}

// ── Helpers ────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 10)

async function uploadHairPhoto(
  file: File,
  subfolder: 'lengths' | 'textures',
  id: string
): Promise<{ url: string; storagePath: string } | null> {
  try {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `hair-attributes/${subfolder}/${id}_${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('client-photos')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (error) throw error
    const url = supabase.storage.from('client-photos').getPublicUrl(path).data.publicUrl
    return { url, storagePath: path }
  } catch {
    return null
  }
}

async function loadItems<T>(type: string): Promise<T[]> {
  const { data } = await supabase
    .from('admin_content')
    .select('content')
    .eq('type', type)
    .maybeSingle()
  if (data?.content && Array.isArray(data.content)) return data.content as T[]
  return []
}

async function saveItems(type: string, items: any[]) {
  const { data: existing } = await supabase
    .from('admin_content')
    .select('id')
    .eq('type', type)
    .maybeSingle()

  if (existing?.id) {
    await supabase.from('admin_content').update({ content: items as any }).eq('id', existing.id)
  } else {
    await supabase.from('admin_content').insert({ type, content: items as any })
  }
}

// ── ItemEditor — shared between lengths and textures ───────────

interface ItemEditorProps {
  item: HairLength | HairTexture
  subfolder: 'lengths' | 'textures'
  onUpdate: (updated: HairLength | HairTexture) => void
  onDelete: () => void
}

function ItemEditor({ item, subfolder, onUpdate, onDelete }: ItemEditorProps) {
  const [uploading, setUploading] = useState(false)

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    const result = await uploadHairPhoto(file, subfolder, item.id)
    if (result) onUpdate({ ...item, photoUrl: result.url, storagePath: result.storagePath })
    setUploading(false)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        {/* Foto de referência */}
        <div className="flex-shrink-0">
          <label className="cursor-pointer block">
            <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            {item.photoUrl ? (
              <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-violet-200 group">
                <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <Upload className="h-4 w-4 text-white" />
                </div>
              </div>
            ) : (
              <div className={`w-20 h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 ${uploading ? 'border-violet-400 bg-violet-50' : 'border-gray-300 hover:border-violet-400 hover:bg-violet-50'} transition-colors`}>
                {uploading ? (
                  <div className="animate-spin h-4 w-4 border-2 border-violet-500 border-t-transparent rounded-full" />
                ) : (
                  <>
                    <Upload className="h-4 w-4 text-gray-400" />
                    <span className="text-[10px] text-gray-400 text-center leading-tight">Foto ref.</span>
                  </>
                )}
              </div>
            )}
          </label>
          {item.photoUrl && (
            <p className="text-[10px] text-center text-violet-600 mt-1">Clique p/ trocar</p>
          )}
        </div>

        {/* Campos */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={item.name}
              onChange={e => onUpdate({ ...item, name: e.target.value })}
              placeholder="Nome (ex: Curto, Liso Natural...)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <button onClick={onDelete} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <textarea
            value={item.instruction}
            onChange={e => onUpdate({ ...item, instruction: e.target.value })}
            placeholder="Instrução para a IA (ex: Aplique cabelo curto até a nuca, com volume nas pontas...)"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
          />
        </div>
      </div>
    </div>
  )
}

// ── Section — collapses a group of items ───────────────────────

interface SectionProps {
  title: string
  subtitle: string
  icon: React.ReactNode
  color: string
  items: (HairLength | HairTexture)[]
  subfolder: 'lengths' | 'textures'
  onAdd: () => void
  onUpdate: (id: string, item: HairLength | HairTexture) => void
  onDelete: (id: string) => void
}

function Section({ title, subtitle, icon, color, items, subfolder, onAdd, onUpdate, onDelete }: SectionProps) {
  const [open, setOpen] = useState(true)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full px-6 py-4 border-b border-gray-100 flex items-center justify-between ${color}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ background: subfolder === 'lengths' ? 'linear-gradient(135deg, #7c3aed, #a855f7)' : 'linear-gradient(135deg, #0891b2, #06b6d4)' }}>
            {icon}
          </div>
          <div className="text-left">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">{items.length} opções</span>
          {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="px-6 py-5 space-y-3">
          <p className="text-xs text-gray-500">
            Cada opção aparecerá com foto para a cliente escolher. A instrução é enviada para a IA junto com o prompt de cor.
          </p>

          {items.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-xl">
              Nenhuma opção cadastrada ainda
            </p>
          )}

          <div className="space-y-3">
            {items.map(item => (
              <ItemEditor
                key={item.id}
                item={item}
                subfolder={subfolder}
                onUpdate={updated => onUpdate(item.id, updated)}
                onDelete={() => onDelete(item.id)}
              />
            ))}
          </div>

          <button
            onClick={onAdd}
            className="w-full py-2.5 border border-dashed border-gray-300 rounded-xl text-sm font-medium text-gray-500 hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Adicionar opção
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────

export function HairAttributesManager() {
  const [lengths, setLengths] = useState<HairLength[]>([])
  const [textures, setTextures] = useState<HairTexture[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [l, t] = await Promise.all([
        loadItems<HairLength>('hair_lengths'),
        loadItems<HairTexture>('hair_textures'),
      ])
      setLengths(l)
      setTextures(t)
      setLoading(false)
    }
    load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await Promise.all([
        saveItems('hair_lengths', lengths),
        saveItems('hair_textures', textures),
      ])
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <div className="animate-spin h-6 w-6 border-2 border-violet-400 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Scissors className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Atributos de Cabelo</h2>
            <p className="text-sm text-gray-500">Comprimentos e texturas com foto + instrução para a IA</p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
          ) : status === 'saved' ? (
            <CheckCircle className="h-4 w-4" />
          ) : status === 'error' ? (
            <AlertCircle className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {status === 'saved' ? 'Salvo!' : status === 'error' ? 'Erro' : 'Salvar tudo'}
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-xs text-blue-800">
          💡 Quando a cliente seleciona um <strong>prompt de cabelo</strong>, ela verá primeiro as opções de
          <strong> comprimento</strong> (com fotos), depois as de <strong>textura</strong>. A IA recebe a instrução do
          prompt + instrução do comprimento + instrução da textura para gerar a imagem.
        </p>
      </div>

      {/* Comprimentos */}
      <Section
        title="Comprimentos"
        subtitle="Curto, Médio, Longo, etc."
        icon={<Scissors className="h-5 w-5" />}
        color="bg-gradient-to-r from-violet-50 to-purple-50"
        items={lengths}
        subfolder="lengths"
        onAdd={() => setLengths(prev => [...prev, { id: uid(), name: '', photoUrl: '', storagePath: '', instruction: '' }])}
        onUpdate={(id, updated) => setLengths(prev => prev.map(l => l.id === id ? updated as HairLength : l))}
        onDelete={id => setLengths(prev => prev.filter(l => l.id !== id))}
      />

      {/* Texturas */}
      <Section
        title="Texturas"
        subtitle="Liso, Ondulado, Cacheado, etc."
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12c0-4 3-7 6-7s6 3 6 7-3 7-6 7" /><path d="M9 12c0-2 1.5-3.5 3-3.5" />
          </svg>
        }
        color="bg-gradient-to-r from-cyan-50 to-teal-50"
        items={textures}
        subfolder="textures"
        onAdd={() => setTextures(prev => [...prev, { id: uid(), name: '', photoUrl: '', storagePath: '', instruction: '' }])}
        onUpdate={(id, updated) => setTextures(prev => prev.map(t => t.id === id ? updated as HairTexture : t))}
        onDelete={id => setTextures(prev => prev.filter(t => t.id !== id))}
      />

      {/* Save reminder */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
        <Save className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <p className="text-xs text-amber-800">
          Lembre de clicar em <strong>Salvar tudo</strong> após adicionar ou editar as opções.
        </p>
      </div>
    </div>
  )
}