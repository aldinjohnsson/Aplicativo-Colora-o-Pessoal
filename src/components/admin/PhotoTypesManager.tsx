// src/components/admin/PhotoTypesManager.tsx
import React, { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, Pencil, Check, X, Layers } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PhotoType {
  id: string
  name: string
  icon: string
  color: string
  sort_order: number
}

const PRESET_ICONS = ['✂️', '👗', '📷', '💄', '💍', '👠', '🎨', '🌸', '💅', '🧴', '👒', '🕶️']
const PRESET_COLORS = [
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#F43F5E', // rose
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#06B6D4', // cyan
  '#3B82F6', // blue
  '#6B7280', // gray
  '#A855F7', // purple
]

// ─────────────────────────────────────────────────────────────────────────────
// Helper: upsert seguro sem depender de UNIQUE constraint no banco.
// Resolve o erro 400 do Supabase quando não há constraint UNIQUE em 'type'.
// Não usa updated_at para ser compatível com tabelas sem essa coluna.
// ─────────────────────────────────────────────────────────────────────────────

async function safeUpsertAdminContent(type: string, content: any): Promise<void> {
  const { error } = await supabase
    .from('admin_content')
    .upsert(
      { type, content },
      { onConflict: 'type' }
    )

  if (error) {
    console.error('[PhotoTypes] Erro no upsert:', error)
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export const photoTypesService = {
  async getAll(): Promise<PhotoType[]> {
    const { data } = await supabase
      .from('admin_content')
      .select('content')
      .eq('type', 'photo_types')
      .maybeSingle()

    if (data?.content && Array.isArray(data.content)) {
      return (data.content as PhotoType[]).sort((a, b) => a.sort_order - b.sort_order)
    }

    // defaults se ainda não configurou
    return [
      { id: 'cabelo',    name: 'Cabelo',       icon: '✂️', color: '#8B5CF6', sort_order: 0 },
      { id: 'roupa',     name: 'Roupas / Look', icon: '👗', color: '#EC4899', sort_order: 1 },
      { id: 'maquiagem', name: 'Maquiagem',     icon: '💄', color: '#F43F5E', sort_order: 2 },
      { id: 'geral',     name: 'Geral / Rosto', icon: '📷', color: '#6B7280', sort_order: 3 },
    ]
  },

  async save(types: PhotoType[]): Promise<void> {
    await safeUpsertAdminContent('photo_types', types)
  },

  // Mapeamento categoria → type (salvo separado)
  async getCategoryTypeMap(): Promise<Record<string, string>> {
    const { data } = await supabase
      .from('admin_content')
      .select('content')
      .eq('type', 'category_type_map')
      .maybeSingle()
    return (data?.content as Record<string, string>) || {}
  },

  async saveCategoryTypeMap(map: Record<string, string>): Promise<void> {
    await safeUpsertAdminContent('category_type_map', map)
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function PhotoTypesManager() {
  const [types, setTypes] = useState<PhotoType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // estado de edição inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<PhotoType>>({})

  // novo type
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('📷')
  const [newColor, setNewColor] = useState('#8B5CF6')
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const data = await photoTypesService.getAll()
    setTypes(data)
    setLoading(false)
  }

  const persist = async (updated: PhotoType[]) => {
    setSaving(true)
    try {
      await photoTypesService.save(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      alert('Erro ao salvar: ' + (err?.message || 'verifique o console'))
    } finally {
      setSaving(false)
    }
  }

  // ── Adicionar ──────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!newName.trim()) return
    const id = newName.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents first (ó→o, ç→c, etc.)
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
    if (types.find(t => t.id === id)) {
      alert('Já existe um type com esse nome.')
      return
    }
    const updated = [...types, { id, name: newName.trim(), icon: newIcon, color: newColor, sort_order: types.length }]
    setTypes(updated)
    setNewName('')
    setNewIcon('📷')
    setNewColor('#8B5CF6')
    await persist(updated)
  }

  // ── Deletar ────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Remover este type? Fotos de referência vinculadas a ele serão preservadas, mas o type não aparecerá mais na lista.')) return
    const updated = types.filter(t => t.id !== id).map((t, i) => ({ ...t, sort_order: i }))
    setTypes(updated)
    await persist(updated)
  }

  // ── Edição inline ──────────────────────────────────────────────────────────
  const startEdit = (t: PhotoType) => {
    setEditingId(t.id)
    setEditDraft({ name: t.name, icon: t.icon, color: t.color })
  }

  const confirmEdit = async (id: string) => {
    const updated = types.map(t =>
      t.id === id ? { ...t, ...editDraft } : t
    )
    setTypes(updated)
    setEditingId(null)
    setEditDraft({})
    await persist(updated)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft({})
  }

  // ── Mover ordem ────────────────────────────────────────────────────────────
  const moveUp = async (idx: number) => {
    if (idx === 0) return
    const arr = [...types]
    ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
    const updated = arr.map((t, i) => ({ ...t, sort_order: i }))
    setTypes(updated)
    await persist(updated)
  }

  const moveDown = async (idx: number) => {
    if (idx === types.length - 1) return
    const arr = [...types]
    ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
    const updated = arr.map((t, i) => ({ ...t, sort_order: i }))
    setTypes(updated)
    await persist(updated)
  }

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
      <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-purple-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Layers className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Types de Foto</h2>
              <p className="text-sm text-gray-500">Defina os tipos usados nas categorias, fotos de referência e PDFs</p>
            </div>
          </div>
          {saved && (
            <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full flex items-center gap-1">
              <Check className="h-3 w-3" /> Salvo
            </span>
          )}
          {saving && (
            <span className="text-xs text-gray-500">Salvando...</span>
          )}
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        <p className="text-xs text-gray-500">
          Cada type representa uma <strong>categoria de análise</strong>. A IA usa a foto de referência correta para cada type.
          O PDF será gerado <strong>separado por type</strong>.
        </p>

        {/* Lista de types */}
        <div className="space-y-2">
          {types.map((t, idx) => (
            <div key={t.id} className="border border-gray-200 rounded-xl overflow-hidden">
              {editingId === t.id ? (
                // ── Modo edição ──
                <div className="px-4 py-3 bg-violet-50 space-y-3">
                  <div className="flex items-center gap-3">
                    {/* Ícone */}
                    <div className="relative">
                      <button
                        onClick={() => setShowIconPicker(v => !v)}
                        className="w-10 h-10 text-xl bg-white border border-gray-300 rounded-lg flex items-center justify-center hover:border-violet-400"
                      >
                        {editDraft.icon}
                      </button>
                      {showIconPicker && (
                        <div className="absolute z-10 top-12 left-0 bg-white border border-gray-200 rounded-xl p-2 shadow-lg grid grid-cols-6 gap-1 w-48">
                          {PRESET_ICONS.map(ic => (
                            <button key={ic} onClick={() => { setEditDraft(d => ({ ...d, icon: ic })); setShowIconPicker(false) }}
                              className="w-7 h-7 text-lg hover:bg-violet-50 rounded flex items-center justify-center">{ic}</button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Nome */}
                    <input
                      value={editDraft.name || ''}
                      onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                      placeholder="Nome do type"
                      autoFocus
                    />

                    {/* Cor */}
                    <div className="relative">
                      <button
                        onClick={() => setShowColorPicker(v => !v)}
                        className="w-10 h-10 rounded-lg border border-gray-300 hover:border-violet-400"
                        style={{ backgroundColor: editDraft.color }}
                      />
                      {showColorPicker && (
                        <div className="absolute z-10 top-12 right-0 bg-white border border-gray-200 rounded-xl p-2 shadow-lg grid grid-cols-5 gap-1.5 w-40">
                          {PRESET_COLORS.map(c => (
                            <button key={c} onClick={() => { setEditDraft(d => ({ ...d, color: c })); setShowColorPicker(false) }}
                              className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform"
                              style={{ backgroundColor: c, borderColor: editDraft.color === c ? '#1f2937' : 'transparent' }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <button onClick={() => confirmEdit(t.id)} className="p-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={cancelEdit} className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-violet-600">
                    O ID <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-violet-200">{t.id}</span> não pode ser alterado (é a chave interna).
                  </p>
                </div>
              ) : (
                // ── Modo visualização ──
                <div className="px-4 py-3 flex items-center gap-3 bg-white hover:bg-gray-50">
                  {/* Reordenar */}
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveUp(idx)} disabled={idx === 0}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none text-xs">▲</button>
                    <button onClick={() => moveDown(idx)} disabled={idx === types.length - 1}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none text-xs">▼</button>
                  </div>

                  {/* Color dot + icon */}
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                    style={{ backgroundColor: t.color + '20', border: `2px solid ${t.color}40` }}>
                    {t.icon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{t.name}</p>
                    <p className="text-xs text-gray-400 font-mono">id: {t.id}</p>
                  </div>

                  {/* Color badge */}
                  <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />

                  {/* Actions */}
                  <button onClick={() => startEdit(t)} className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}

          {types.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Nenhum type configurado ainda.</p>
          )}
        </div>

        {/* Adicionar novo */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-600 mb-2">Novo type:</p>
          <div className="flex gap-2 items-center">
            {/* Ícone picker */}
            <div className="relative">
              <button
                onClick={() => setShowIconPicker(v => !v)}
                className="w-10 h-10 text-xl bg-white border border-gray-300 rounded-lg flex items-center justify-center hover:border-violet-400 flex-shrink-0"
                title="Escolher ícone"
              >
                {newIcon}
              </button>
              {showIconPicker && (
                <div className="absolute z-20 top-12 left-0 bg-white border border-gray-200 rounded-xl p-2 shadow-lg grid grid-cols-6 gap-1 w-48">
                  {PRESET_ICONS.map(ic => (
                    <button key={ic} onClick={() => { setNewIcon(ic); setShowIconPicker(false) }}
                      className="w-7 h-7 text-lg hover:bg-violet-50 rounded flex items-center justify-center">{ic}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Nome */}
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Nome (ex: Acessórios)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />

            {/* Cor picker */}
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(v => !v)}
                className="w-10 h-10 rounded-lg border border-gray-300 hover:border-violet-400 flex-shrink-0"
                style={{ backgroundColor: newColor }}
                title="Escolher cor"
              />
              {showColorPicker && (
                <div className="absolute z-20 top-12 right-0 bg-white border border-gray-200 rounded-xl p-2 shadow-lg grid grid-cols-5 gap-1.5 w-40">
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => { setNewColor(c); setShowColorPicker(false) }}
                      className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c, borderColor: newColor === c ? '#1f2937' : 'transparent' }}
                    />
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-40 flex items-center gap-1.5 flex-shrink-0"
            >
              <Plus className="h-4 w-4" /> Criar
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-xs text-blue-800">
            💡 Cada type gera um <strong>PDF separado</strong> com as seções e a foto de referência do tipo.
            Configure fotos de referência por type na aba <strong>IA</strong> de cada cliente.
          </p>
        </div>
      </div>
    </div>
  )
}