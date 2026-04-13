// src/components/admin/TagsManager.tsx
import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Tag, ChevronDown, ChevronUp, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface TagTemplate {
  id: string; name: string; options: string[]; sort_order: number
}

export function TagsManager() {
  const [tags, setTags] = useState<TagTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [newOption, setNewOption] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('ai_info_templates').select('*').order('sort_order')
    setTags((data || []).map(t => ({ ...t, options: Array.isArray(t.options) ? t.options : [] })))
    setLoading(false)
  }

  const addTag = async () => {
    if (!newTagName.trim()) return
    await supabase.from('ai_info_templates').insert({ name: newTagName.trim(), options: [], sort_order: tags.length })
    setNewTagName('')
    load()
  }

  const deleteTag = async (id: string) => {
    if (!confirm('Remover esta tag e todas as opções?')) return
    await supabase.from('ai_info_templates').delete().eq('id', id)
    if (openTag === id) setOpenTag(null)
    load()
  }

  const renameTag = async (id: string, name: string) => {
    await supabase.from('ai_info_templates').update({ name }).eq('id', id)
    setTags(prev => prev.map(t => t.id === id ? { ...t, name } : t))
  }

  const addOption = async (tagId: string) => {
    if (!newOption.trim()) return
    const tag = tags.find(t => t.id === tagId)
    if (!tag) return
    const updated = [...tag.options, newOption.trim()]
    await supabase.from('ai_info_templates').update({ options: updated }).eq('id', tagId)
    setTags(prev => prev.map(t => t.id === tagId ? { ...t, options: updated } : t))
    setNewOption('')
  }

  const removeOption = async (tagId: string, idx: number) => {
    const tag = tags.find(t => t.id === tagId)
    if (!tag) return
    const updated = tag.options.filter((_, i) => i !== idx)
    await supabase.from('ai_info_templates').update({ options: updated }).eq('id', tagId)
    setTags(prev => prev.map(t => t.id === tagId ? { ...t, options: updated } : t))
  }

  const inp = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"

  if (loading) return <div className="flex items-center justify-center py-8"><div className="animate-spin h-6 w-6 border-2 border-violet-400 border-t-transparent rounded-full" /></div>

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
            <Tag className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Tags de Informação</h2>
            <p className="text-sm text-gray-500">Crie categorias com opções para vincular às clientes</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        <p className="text-xs text-gray-500">
          Crie tags como "Coloração Pessoal" e adicione opções (Verão Suave, Outono Quente...). Na aba IA de cada cliente, selecione a opção correta.
        </p>

        {/* Tags list */}
        <div className="space-y-2">
          {tags.map(tag => {
            const isOpen = openTag === tag.id
            return (
              <div key={tag.id} className="border border-gray-200 rounded-xl overflow-hidden">
                <div
                  className={`px-4 py-3 flex items-center gap-3 cursor-pointer ${isOpen ? 'bg-emerald-50' : 'bg-white hover:bg-gray-50'}`}
                  onClick={() => setOpenTag(isOpen ? null : tag.id)}
                >
                  <Tag className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <span className="font-medium text-sm text-gray-800 flex-1">{tag.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{tag.options.length} opções</span>
                  <button onClick={e => { e.stopPropagation(); deleteTag(tag.id) }} className="text-gray-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>

                {isOpen && (
                  <div className="px-4 py-3 border-t border-gray-100 space-y-3">
                    {/* Rename */}
                    <div>
                      <label className="text-xs text-gray-500">Nome da tag</label>
                      <input value={tag.name} onChange={e => renameTag(tag.id, e.target.value)} className={`${inp} text-sm`} />
                    </div>

                    {/* Options */}
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Opções cadastradas:</label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {tag.options.map((opt, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-xs px-2.5 py-1 rounded-full">
                            {opt}
                            <button onClick={() => removeOption(tag.id, idx)} className="hover:text-red-500"><X className="h-3 w-3" /></button>
                          </span>
                        ))}
                        {tag.options.length === 0 && <span className="text-xs text-gray-400">Nenhuma opção</span>}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          value={newOption}
                          onChange={e => setNewOption(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addOption(tag.id) }}
                          placeholder="Nova opção (ex: Verão Suave)"
                          className={`${inp} flex-1 text-xs`}
                        />
                        <button onClick={() => addOption(tag.id)} disabled={!newOption.trim()}
                          className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium disabled:opacity-40 flex items-center gap-1">
                          <Plus className="h-3 w-3" /> Adicionar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add new tag */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-600 mb-2">Nova tag:</p>
          <div className="flex gap-2">
            <input
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTag()}
              placeholder="Nome da tag (ex: Tipo de Cabelo)"
              className={`${inp} flex-1`}
            />
            <button onClick={addTag} disabled={!newTagName.trim()}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1">
              <Plus className="h-4 w-4" /> Criar tag
            </button>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800">
            💡 Na aba <strong>IA</strong> de cada cliente, você seleciona a opção correta de cada tag. A IA usa essas informações para responder com precisão.
          </p>
        </div>
      </div>
    </div>
  )
}