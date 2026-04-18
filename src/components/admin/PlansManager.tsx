// src/components/admin/PlansManager.tsx
import React, { useState, useEffect } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import {
  Plus, Pencil, Trash2, ChevronRight, FileText, ClipboardList,
  Camera, Save, ArrowLeft, GripVertical, X, Check, Image, User, Mail, Phone,
  Share2, Copy, CheckCircle, ChevronUp, ChevronDown
} from 'lucide-react'
import { adminService, Plan, PlanContract, PlanForm, PhotoCategory } from '../../lib/services'
import { PhotoCategoryInstructionsEditor, migrateToInstructionItems, InstructionItem } from './PhotoCategoryInstructionsEditor'
import { supabase } from '../../lib/supabase'

// ── Shared tiny UI ──────────────────────────────────────────

const Btn = ({ children, onClick, variant = 'primary', size = 'md', loading = false, disabled = false, className = '' }: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
    danger: 'text-red-600 hover:bg-red-50'
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ── Plans List ───────────────────────────────────────────────

function PlansList() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newPlan, setNewPlan] = useState({ name: '', description: '', deadline_days: 5 })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try { setPlans(await adminService.getPlans()) } finally { setLoading(false) }
  }

  const handleShare = async (plan: Plan) => {
    try {
      // Get or generate share_token
      const { data: row } = await supabase.from('plans').select('share_token').eq('id', plan.id).single()
      let token = row?.share_token
      if (!token) {
        token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
        await supabase.from('plans').update({ share_token: token }).eq('id', plan.id)
      }
      const url = `${window.location.origin}/p/${token}`
      await navigator.clipboard.writeText(url)
      setCopiedId(plan.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch { alert('Erro ao copiar link') }
  }

  const handleCreate = async () => {
    if (!newPlan.name.trim()) return
    try {
      const plan = await adminService.createPlan({ ...newPlan, is_active: true })
      setCreating(false)
      setNewPlan({ name: '', description: '', deadline_days: 5 })
      navigate(`/admin/plans/${plan.id}`)
    } catch (e: any) { alert(e.message) }
  }

  const handleDelete = async (plan: Plan) => {
    if (!confirm(`Excluir o plano "${plan.name}"? Esta ação não pode ser desfeita.`)) return
    await adminService.deletePlan(plan.id)
    load()
  }

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Planos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configure contrato, formulário e instruções de foto por plano</p>
        </div>
        <Btn onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Novo Plano
        </Btn>
      </div>

      {creating && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-900">Novo Plano</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
              <input value={newPlan.name} onChange={e => setNewPlan({ ...newPlan, name: e.target.value })}
                placeholder="Ex: Análise Individual"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prazo (dias úteis)</label>
              <input type="number" min={1} max={30} value={newPlan.deadline_days}
                onChange={e => setNewPlan({ ...newPlan, deadline_days: parseInt(e.target.value) || 5 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
            <input value={newPlan.description} onChange={e => setNewPlan({ ...newPlan, description: e.target.value })}
              placeholder="Breve descrição do plano"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
          </div>
          <div className="flex gap-2">
            <Btn onClick={handleCreate}>Criar Plano</Btn>
            <Btn variant="outline" onClick={() => setCreating(false)}>Cancelar</Btn>
          </div>
        </div>
      )}

      {plans.length === 0 && !creating ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Layers className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Nenhum plano criado ainda</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map(plan => (
            <div key={plan.id} className="bg-white border border-gray-200 rounded-xl p-5 flex items-center justify-between hover:border-rose-200 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-rose-50 rounded-lg flex items-center justify-center">
                  <Layers className="h-5 w-5 text-rose-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${plan.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {plan.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{plan.deadline_days} dias úteis{plan.description ? ` · ${plan.description}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Btn variant="outline" size="sm" onClick={() => handleShare(plan)}>
                  {copiedId === plan.id ? <><CheckCircle className="h-3.5 w-3.5 text-green-500" /> Copiado!</> : <><Share2 className="h-3.5 w-3.5" /> Compartilhar</>}
                </Btn>
                <Btn variant="outline" size="sm" onClick={() => navigate(`/admin/plans/${plan.id}`)}>
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => handleDelete(plan)} className="text-red-500 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Plan Editor ──────────────────────────────────────────────

type Tab = 'general' | 'contract' | 'form' | 'photos'

function PlanEditor() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [tab, setTab] = useState<Tab>('general')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminService.getPlans().then(plans => {
      const p = plans.find(p => p.id === planId)
      if (p) setPlan(p)
      setLoading(false)
    })
  }, [planId])

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" /></div>
  if (!plan) return <div className="text-center py-20 text-gray-500">Plano não encontrado</div>

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'general', label: 'Geral', icon: Layers },
    { id: 'contract', label: 'Contrato', icon: FileText },
    { id: 'form', label: 'Formulário', icon: ClipboardList },
    { id: 'photos', label: 'Fotos', icon: Camera },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin/plans')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{plan.name}</h1>
          <p className="text-sm text-gray-500">{plan.deadline_days} dias úteis</p>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralTab plan={plan} onUpdate={setPlan} />}
      {tab === 'contract' && <ContractTab planId={plan.id} />}
      {tab === 'form' && <FormTab planId={plan.id} />}
      {tab === 'photos' && <PhotosTab planId={plan.id} />}
    </div>
  )
}

// ── General Tab ──────────────────────────────────────────────

function GeneralTab({ plan, onUpdate }: { plan: Plan; onUpdate: (p: Plan) => void }) {
  const [form, setForm] = useState({ name: plan.name, description: plan.description || '', deadline_days: plan.deadline_days, is_active: plan.is_active })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await adminService.updatePlan(plan.id, form)
      onUpdate({ ...plan, ...form })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Plano</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Prazo (dias úteis)</label>
          <input type="number" min={1} max={30} value={form.deadline_days}
            onChange={e => setForm({ ...form, deadline_days: parseInt(e.target.value) || 5 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder="Breve descrição"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })}
          className="h-4 w-4 text-rose-500 rounded focus:ring-rose-400" />
        <span className="text-sm text-gray-700">Plano ativo</span>
      </label>
      <Btn onClick={save} loading={saving}>
        {saved ? <><Check className="h-4 w-4" /> Salvo!</> : <><Save className="h-4 w-4" /> Salvar</>}
      </Btn>
    </div>
  )
}

// ── Contract Tab ─────────────────────────────────────────────

function ContractTab({ planId }: { planId: string }) {
  const [data, setData] = useState<PlanContract>({ title: '', sections: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    adminService.getPlanContract(planId).then(c => {
      if (c) setData(c)
      setLoading(false)
    })
  }, [planId])

  const addSection = () => {
    const newId = Date.now().toString()
    setData(d => ({ ...d, sections: [...d.sections, { id: newId, title: 'Nova Cláusula', content: '', order: d.sections.length + 1 }] }))
  }

  const updateSection = (id: string, updates: any) => {
    setData(d => ({ ...d, sections: d.sections.map(s => s.id === id ? { ...s, ...updates } : s) }))
  }

  const removeSection = (id: string) => {
    setData(d => ({ ...d, sections: d.sections.filter(s => s.id !== id) }))
  }

  const save = async () => {
    setSaving(true)
    try {
      await adminService.savePlanContract(planId, data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-rose-400 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 max-w-3xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Título do Contrato</label>
          <input value={data.title} onChange={e => setData({ ...data, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Cláusulas</h3>
            <Btn size="sm" variant="outline" onClick={addSection}><Plus className="h-3.5 w-3.5" /> Adicionar</Btn>
          </div>

          {data.sections.sort((a, b) => a.order - b.order).map((section) => (
            <div key={section.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2">
                <input value={section.title} onChange={e => updateSection(section.id, { title: e.target.value })}
                  placeholder="Título da cláusula"
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-rose-400" />
                <button onClick={() => removeSection(section.id)} className="text-red-400 hover:text-red-600 mt-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <textarea value={section.content} onChange={e => updateSection(section.id, { content: e.target.value })}
                rows={3} placeholder="Conteúdo da cláusula..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
            </div>
          ))}

          {data.sections.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">Nenhuma cláusula adicionada</p>
          )}
        </div>

        <Btn onClick={save} loading={saving}>
          {saved ? <><Check className="h-4 w-4" /> Salvo!</> : <><Save className="h-4 w-4" /> Salvar Contrato</>}
        </Btn>
      </div>
    </div>
  )
}

// ── Form Tab ─────────────────────────────────────────────────

// Tipos de campo disponíveis
const FIELD_TYPES = [
  { value: 'full_name', label: '👤 Nome Completo', icon: '👤' },
  { value: 'email',     label: '✉️ E-mail',        icon: '✉️' },
  { value: 'phone',     label: '📱 Telefone',       icon: '📱' },
  { value: 'text',      label: '📝 Texto curto',    icon: '📝' },
  { value: 'textarea',  label: '📄 Texto longo',    icon: '📄' },
  { value: 'select',    label: '🔽 Lista suspensa', icon: '🔽' },
  { value: 'radio',     label: '🔘 Múltipla escolha', icon: '🔘' },
  { value: 'checkbox',  label: '☑️ Caixas de seleção', icon: '☑️' },
  { value: 'image',     label: '🖼️ Upload de imagem', icon: '🖼️' },
]

// Tipos que têm comportamento fixo (label não é editável pelo admin, pois é autoexplicativo)
const FIXED_TYPES = ['full_name', 'email', 'phone']

// Tipos que exigem opções de seleção
const OPTION_TYPES = ['radio', 'checkbox', 'select']

function FormTab({ planId }: { planId: string }) {
  const [data, setData] = useState<PlanForm>({ title: '', description: null, fields: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    adminService.getPlanForm(planId).then(f => {
      if (f) setData(f)
      setLoading(false)
    })
  }, [planId])

  const addField = (type: string) => {
    const labels: Record<string, string> = {
      full_name: 'Nome Completo',
      email: 'E-mail',
      phone: 'Telefone',
      text: 'Nova pergunta',
      textarea: 'Nova pergunta longa',
      select: 'Selecione uma opção',
      radio: 'Escolha uma opção',
      checkbox: 'Selecione todas que se aplicam',
      image: 'Envie uma imagem',
    }
    const newField: any = {
      id: Date.now().toString(),
      type,
      label: labels[type] || 'Nova pergunta',
      placeholder: '',
      required: FIXED_TYPES.includes(type),
      order: data.fields.length + 1,
      ...(OPTION_TYPES.includes(type) ? { options: ['Opção 1', 'Opção 2'] } : {}),
      ...(type === 'image' ? { imageInstructions: '' } : {}),
    }
    setData(d => ({ ...d, fields: [...d.fields, newField] }))
  }

  const updateField = (id: string, updates: any) => {
    setData(d => ({ ...d, fields: d.fields.map(f => f.id === id ? { ...f, ...updates } : f) }))
  }

  const removeField = (id: string) => {
    setData(d => ({ ...d, fields: d.fields.filter(f => f.id !== id) }))
  }

  const moveField = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1
    setData(d => {
      const sorted = [...d.fields].sort((a, b) => a.order - b.order)
      if (target < 0 || target >= sorted.length) return d
      ;[sorted[index], sorted[target]] = [sorted[target], sorted[index]]
      return { ...d, fields: sorted.map((f, i) => ({ ...f, order: i + 1 })) }
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      await adminService.savePlanForm(planId, data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-rose-400 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Título e descrição do formulário */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Título do Formulário</label>
            <input value={data.title} onChange={e => setData({ ...data, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
            <input value={data.description || ''} onChange={e => setData({ ...data, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
          </div>
        </div>
      </div>

      {/* Campos */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Campos ({data.fields.length})</h3>
        </div>

        {/* Botões de adicionar campo */}
        <div className="flex flex-wrap gap-2 p-4 bg-gray-50 rounded-xl border border-dashed border-gray-300">
          <p className="w-full text-xs font-medium text-gray-500 mb-1">Clique para adicionar um campo:</p>
          {FIELD_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => addField(t.value)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Lista de campos */}
        <div className="space-y-3">
          {data.fields.sort((a, b) => a.order - b.order).map((field, idx) => (
            <FieldEditor
              key={field.id}
              field={field}
              index={idx + 1}
              total={data.fields.length}
              onUpdate={updates => updateField(field.id, updates)}
              onRemove={() => removeField(field.id)}
              onMoveUp={() => moveField(idx, 'up')}
              onMoveDown={() => moveField(idx, 'down')}
            />
          ))}

          {data.fields.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">Nenhum campo adicionado. Use os botões acima.</p>
          )}
        </div>

        <Btn onClick={save} loading={saving}>
          {saved ? <><Check className="h-4 w-4" /> Salvo!</> : <><Save className="h-4 w-4" /> Salvar Formulário</>}
        </Btn>
      </div>
    </div>
  )
}

function FieldEditor({ field, index, total, onUpdate, onRemove, onMoveUp, onMoveDown }: {
  field: any; index: number; total: number
  onUpdate: (u: any) => void; onRemove: () => void
  onMoveUp: () => void; onMoveDown: () => void
}) {
  const isFixed = FIXED_TYPES.includes(field.type)
  const hasOptions = OPTION_TYPES.includes(field.type)
  const isImage = field.type === 'image'
  const isText = field.type === 'text' || field.type === 'textarea'

  const typeLabel = FIELD_TYPES.find(t => t.value === field.type)?.label || field.type

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400 w-5">#{index}</span>
          {/* Setas de reordenação */}
          <div className="flex flex-col">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 1}
              title="Mover para cima"
              className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronUp className="h-3.5 w-3.5 text-gray-500" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === total}
              title="Mover para baixo"
              className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
            </button>
          </div>
          <span className="text-xs px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full font-medium">{typeLabel}</span>
          {isFixed && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">campo padrão</span>}
        </div>
        <button onClick={onRemove} className="text-red-400 hover:text-red-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Label (editável, exceto para campos fixos que já têm label óbvio) */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {isImage ? 'Texto acima do upload' : 'Pergunta / Label'}
        </label>
        <input
          value={field.label}
          onChange={e => onUpdate({ label: e.target.value })}
          placeholder={isImage ? 'Ex: Envie uma foto do seu rosto sem maquiagem' : 'Texto da pergunta'}
          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
        />
      </div>

      {/* Placeholder (só para text/textarea) */}
      {isText && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Placeholder</label>
          <input
            value={field.placeholder || ''}
            onChange={e => onUpdate({ placeholder: e.target.value })}
            placeholder="Texto de exemplo dentro do campo"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
          />
        </div>
      )}

      {/* Quantidade máxima de fotos + instruções (só para imagem) */}
      {isImage && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade máxima de fotos</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={20}
                value={field.maxImages ?? 1}
                onChange={e => {
                  const val = parseInt(e.target.value)
                  onUpdate({ maxImages: isNaN(val) || val < 1 ? 1 : val })
                }}
                className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
              <span className="text-sm text-gray-500">
                {(field.maxImages ?? 1) === 1 ? 'foto por resposta' : 'fotos por resposta'}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Instruções adicionais (opcional)</label>
            <textarea
              value={field.imageInstructions || ''}
              onChange={e => onUpdate({ imageInstructions: e.target.value })}
              rows={2}
              placeholder="Ex: A foto deve estar em boa iluminação, sem filtros..."
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
            />
          </div>
        </>
      )}

      {/* Opções (radio / checkbox / select) */}
      {hasOptions && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-600">Opções:</label>
          {(field.options || []).map((opt: string, idx: number) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={opt}
                onChange={e => {
                  const opts = [...(field.options || [])]
                  opts[idx] = e.target.value
                  onUpdate({ options: opts })
                }}
                className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-rose-400"
              />
              <button
                onClick={() => onUpdate({ options: (field.options || []).filter((_: any, i: number) => i !== idx) })}
                className="text-red-400 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => onUpdate({ options: [...(field.options || []), 'Nova opção'] })}
            className="text-xs text-rose-500 hover:text-rose-600 font-medium"
          >
            + Adicionar opção
          </button>
        </div>
      )}

      {/* Obrigatório */}
      <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={field.required}
          disabled={isFixed}
          onChange={e => onUpdate({ required: e.target.checked })}
          className="h-3.5 w-3.5 text-rose-500 rounded"
        />
        Obrigatório {isFixed && <span className="text-xs text-gray-400">(sempre)</span>}
      </label>
    </div>
  )
}

// ── Photos Tab ───────────────────────────────────────────────

const EMPTY_CAT = { title: '', description: '', max_photos: 10, instruction_items: [] as InstructionItem[] }

function PhotosTab({ planId }: { planId: string }) {
  const [categories, setCategories] = useState<PhotoCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newCat, setNewCat] = useState(EMPTY_CAT)
  const [editCat, setEditCat] = useState<any>(null)

  useEffect(() => { load() }, [planId])

  const load = async () => {
    setLoading(true)
    try { setCategories(await adminService.getPhotoCategories(planId)) }
    finally { setLoading(false) }
  }

  const handleAdd = async () => {
    if (!newCat.title.trim()) return
    await adminService.savePhotoCategory({
      plan_id: planId,
      title: newCat.title,
      description: newCat.description || null,
      instruction_items: newCat.instruction_items,
      max_photos: newCat.max_photos,
      order_index: categories.length
    })
    setAdding(false)
    setNewCat(EMPTY_CAT)
    load()
  }

  const handleEdit = (cat: PhotoCategory) => {
    setEditingId(cat.id)
    setEditCat({
      title: cat.title,
      description: cat.description || '',
      max_photos: cat.max_photos,
      instruction_items: migrateToInstructionItems(
        (cat as any).video_url,
        (cat as any).instructions,
        (cat as any).instruction_items
      )
    })
  }

  const handleSaveEdit = async () => {
    if (!editCat.title.trim() || !editingId) return
    await adminService.updatePhotoCategory(editingId, {
      title: editCat.title,
      description: editCat.description || null,
      instruction_items: editCat.instruction_items,
      max_photos: editCat.max_photos,
    })
    setEditingId(null)
    setEditCat(null)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta categoria?')) return
    await adminService.deletePhotoCategory(id)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-rose-400 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">Categorias de fotos que o cliente vai enviar</p>
        <Btn size="sm" onClick={() => { setAdding(true); setEditingId(null) }}>
          <Plus className="h-3.5 w-3.5" /> Nova Categoria
        </Btn>
      </div>

      {/* Formulário de nova categoria */}
      {adding && (
        <CategoryForm
          title="Nova Categoria"
          data={newCat}
          onChange={setNewCat}
          onSave={handleAdd}
          onCancel={() => { setAdding(false); setNewCat(EMPTY_CAT) }}
        />
      )}

      {/* Lista de categorias */}
      {categories.map(cat => (
        <div key={cat.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {editingId === cat.id ? (
            <CategoryForm
              title={`Editar: ${cat.title}`}
              data={editCat}
              onChange={setEditCat}
              onSave={handleSaveEdit}
              onCancel={() => { setEditingId(null); setEditCat(null) }}
            />
          ) : (
            <div className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">{cat.title}</h4>
                  {cat.description && <p className="text-sm text-gray-500 mt-0.5">{cat.description}</p>}
                  {(() => {
                    const items = migrateToInstructionItems(
                      (cat as any).video_url,
                      (cat as any).instructions,
                      (cat as any).instruction_items
                    )
                    const texts = items.filter(it => it.type === 'text')
                    const videos = items.filter(it => it.type === 'video')
                    const images = items.filter(it => it.type === 'image')
                    return (
                      <>
                        <div className="flex flex-wrap gap-3 mt-2">
                          <span className="text-xs text-gray-400">📸 Máx. {cat.max_photos} foto{cat.max_photos !== 1 ? 's' : ''}</span>
                          {videos.length > 0 && <span className="text-xs text-blue-500">▶ {videos.length} vídeo{videos.length !== 1 ? 's' : ''}</span>}
                          {images.length > 0 && <span className="text-xs text-purple-500">🖼 {images.length} imagem{images.length !== 1 ? 'ns' : ''}</span>}
                          {texts.length > 0 && <span className="text-xs text-gray-400">📋 {texts.length} instrução{texts.length !== 1 ? 'ões' : ''}</span>}
                        </div>
                        {texts.length > 0 && (
                          <ul className="mt-2 space-y-0.5">
                            {texts.slice(0, 3).map(it => (
                              <li key={it.id} className="text-sm text-gray-600 flex items-start gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-1.5 flex-shrink-0" />
                                {it.content}
                              </li>
                            ))}
                            {texts.length > 3 && <li className="text-xs text-gray-400">+{texts.length - 3} mais...</li>}
                          </ul>
                        )}
                      </>
                    )
                  })()}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Btn variant="outline" size="sm" onClick={() => handleEdit(cat)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Btn>
                  <button onClick={() => handleDelete(cat.id)} className="text-red-400 hover:text-red-600 p-1">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {categories.length === 0 && !adding && (
        <p className="text-center text-gray-400 text-sm py-8">Nenhuma categoria de foto configurada</p>
      )}
    </div>
  )
}

function CategoryForm({ title, data, onChange, onSave, onCancel }: {
  title: string
  data: any
  onChange: (d: any) => void
  onSave: () => void
  onCancel: () => void
}) {
  const uploadFile = async (file: File): Promise<{ storagePath: string; url: string }> => {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const storagePath = `instructions/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`
    const { error } = await supabase.storage
      .from('category-instructions')
      .upload(storagePath, file, { upsert: false, contentType: file.type })
    if (error) throw error
    const { data: urlData } = supabase.storage
      .from('category-instructions')
      .getPublicUrl(storagePath)
    return { storagePath, url: urlData.publicUrl }
  }

  return (
    <div className="bg-white border border-rose-200 rounded-xl p-6 space-y-4">
      <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Título *</label>
          <input value={data.title} onChange={e => onChange({ ...data, title: e.target.value })}
            placeholder="Ex: Foto sem maquiagem"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Máx. de fotos</label>
          <input type="number" min={1} value={data.max_photos}
            onChange={e => onChange({ ...data, max_photos: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
        <input value={data.description} onChange={e => onChange({ ...data, description: e.target.value })}
          placeholder="Breve descrição desta categoria"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
      </div>

      {/* ── Editor unificado: texto + vídeo YouTube + imagem ── */}
      <PhotoCategoryInstructionsEditor
        items={data.instruction_items ?? []}
        onChange={items => onChange({ ...data, instruction_items: items })}
        onUpload={uploadFile}
      />

      <div className="flex gap-2">
        <Btn onClick={onSave}>Salvar</Btn>
        <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
      </div>
    </div>
  )
}

// ── Layers icon workaround ───────────────────────────────────

const Layers = ({ className }: any) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
)

// ── Router ───────────────────────────────────────────────────

export function PlansManager() {
  return (
    <Routes>
      <Route index element={<PlansList />} />
      <Route path=":planId" element={<PlanEditor />} />
    </Routes>
  )
}