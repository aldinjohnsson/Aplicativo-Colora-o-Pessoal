// src/components/admin/PlansManager.tsx
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import {
  Plus, Pencil, Trash2, ChevronRight, FileText, ClipboardList,
  Camera, Save, ArrowLeft, GripVertical, X, Check, Image, User, Mail, Phone,
  Share2, Copy, CheckCircle, ChevronUp, ChevronDown, Globe
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

// ── Auto-resizing textarea ──────────────────────────────────
// Cresce automaticamente conforme o conteúdo (sem precisar arrastar).
// Útil para campos com conteúdo longo como cláusulas de contrato.

type AutoTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number
}

const AutoTextarea = React.forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  ({ className = '', minRows = 3, value, onInput, style, ...rest }, forwardedRef) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null)

    const setRef = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el
      if (typeof forwardedRef === 'function') forwardedRef(el)
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
    }

    const resize = () => {
      const el = innerRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }

    // Reajusta sempre que o valor controlado mudar (paste, programmatic change, etc.)
    useLayoutEffect(() => {
      resize()
    }, [value])

    // Reajusta na primeira montagem (caso o valor inicial seja longo)
    useLayoutEffect(() => {
      resize()
    }, [])

    return (
      <textarea
        ref={setRef}
        value={value}
        rows={minRows}
        onInput={e => {
          resize()
          onInput?.(e)
        }}
        style={{ overflow: 'hidden', resize: 'none', ...style }}
        className={className}
        {...rest}
      />
    )
  }
)
AutoTextarea.displayName = 'AutoTextarea'

// ── Campo de prazo de expiração da análise ─────────────────────────────
//
// Controla `plans.analysis_expiration_days`: quantos dias corridos, a
// partir da assinatura do contrato, a cliente tem pra concluir a análise
// antes do link expirar. NULL = sem expiração (padrão, comportamento antigo).
function ExpirationField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const enabled = value !== null
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled}
          onChange={e => onChange(e.target.checked ? 90 : null)}
          className="h-4 w-4 text-rose-500 rounded focus:ring-rose-400" />
        <span className="text-sm font-medium text-gray-700">Link expira após um prazo</span>
      </label>
      {enabled ? (
        <div className="flex items-center gap-2 pl-6">
          <input type="number" min={1} max={730} value={value}
            onChange={e => onChange(parseInt(e.target.value) || 1)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
          <span className="text-sm text-gray-500">dias corridos após o cliente assinar o contrato</span>
        </div>
      ) : (
        <p className="text-xs text-gray-400 pl-6">Cliente pode concluir a análise a qualquer momento, sem prazo final.</p>
      )}
    </div>
  )
}



function PlansList() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newPlan, setNewPlan] = useState<{ name: string; description: string; deadline_days: number; analysis_expiration_days: number | null }>({ name: '', description: '', deadline_days: 5, analysis_expiration_days: null })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [cloningId, setCloningId] = useState<string | null>(null)
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
      setNewPlan({ name: '', description: '', deadline_days: 5, analysis_expiration_days: null })
      navigate(`/admin/plans/${plan.id}`)
    } catch (e: any) { alert(e.message) }
  }

  const handleDelete = async (plan: Plan) => {
    if (!confirm(`Excluir o plano "${plan.name}"? Esta ação não pode ser desfeita.`)) return
    await adminService.deletePlan(plan.id)
    load()
  }

  const handleClone = async (plan: Plan) => {
    if (cloningId) return // evita duplo clique
    setCloningId(plan.id)
    try {
      const clone = await adminService.clonePlan(plan.id)
      await load()
      // Navega direto para o editor do clone. Comente esta linha se preferir
      // apenas recarregar a lista (o novo plano aparece no topo por created_at desc).
      navigate(`/admin/plans/${clone.id}`)
    } catch (e: any) {
      alert(`Erro ao duplicar plano: ${e.message}`)
    } finally {
      setCloningId(null)
    }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Planos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configure contrato, formulário e instruções de foto por plano</p>
        </div>
        <Btn onClick={() => setCreating(true)} className="shrink-0">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Novo Plano</span><span className="sm:hidden">Novo</span>
        </Btn>
      </div>

      {creating && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm space-y-4">
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
          <ExpirationField
            value={newPlan.analysis_expiration_days}
            onChange={v => setNewPlan({ ...newPlan, analysis_expiration_days: v })}
          />
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
            <div key={plan.id} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:border-rose-200 transition-colors">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 bg-rose-50 rounded-lg flex items-center justify-center shrink-0">
                  <Layers className="h-5 w-5 text-rose-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${plan.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {plan.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                    {plan.analysis_expiration_days != null && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Link expira em {plan.analysis_expiration_days}d
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{plan.deadline_days} dias úteis{plan.description ? ` · ${plan.description}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:ml-auto">
                <Btn variant="outline" size="sm" onClick={() => handleShare(plan)}>
                  {copiedId === plan.id
                    ? <><CheckCircle className="h-3.5 w-3.5 text-green-500" /><span className="hidden sm:inline">Copiado!</span></>
                    : <><Share2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Compartilhar</span></>}
                </Btn>
                <Btn variant="outline" size="sm" onClick={() => handleClone(plan)} loading={cloningId === plan.id}>
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Duplicar</span>
                </Btn>
                <Btn variant="outline" size="sm" onClick={() => navigate(`/admin/plans/${plan.id}`)}>
                  <Pencil className="h-3.5 w-3.5" /><span className="hidden sm:inline">Editar</span>
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
        <button onClick={() => navigate('/admin/plans')} className="text-gray-400 hover:text-gray-600 shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{plan.name}</h1>
          <p className="text-sm text-gray-500">{plan.deadline_days} dias úteis</p>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit min-w-full sm:min-w-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
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
  const [form, setForm] = useState({
    name: plan.name,
    description: plan.description || '',
    deadline_days: plan.deadline_days,
    analysis_expiration_days: plan.analysis_expiration_days ?? null,
    is_active: plan.is_active,
  })
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
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-5 max-w-2xl">
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
      <ExpirationField
        value={form.analysis_expiration_days}
        onChange={v => setForm({ ...form, analysis_expiration_days: v })}
      />
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
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4 max-w-3xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Título do Contrato</label>
          <input value={data.title} onChange={e => setData({ ...data, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-700">Cláusulas</h3>
            <Btn size="sm" variant="outline" onClick={addSection}><Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Adicionar</span></Btn>
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
              <AutoTextarea value={section.content} onChange={e => updateSection(section.id, { content: e.target.value })}
                minRows={3} placeholder="Conteúdo da cláusula..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
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
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4">
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
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4">
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
            <AutoTextarea
              value={field.imageInstructions || ''}
              onChange={e => onUpdate({ imageInstructions: e.target.value })}
              minRows={2}
              placeholder="Ex: A foto deve estar em boa iluminação, sem filtros..."
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
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

      {/* ── Campo condicional de observação (só para Múltipla Escolha) ── */}
      {field.type === 'radio' && (
        <div className="space-y-2 border-t border-gray-200 pt-3 mt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!field.conditionalTrigger}
              onChange={e => onUpdate(e.target.checked
                ? { conditionalTrigger: field.options?.[0] || '', conditionalLabel: 'Observação', conditionalRequired: false }
                : { conditionalTrigger: undefined, conditionalLabel: undefined, conditionalRequired: undefined }
              )}
              className="h-3.5 w-3.5 text-rose-500 rounded"
            />
            <span className="text-sm font-medium text-gray-700">Ativar campo de observação condicional</span>
          </label>

          {!!field.conditionalTrigger && (
            <div className="space-y-3 pl-4 border-l-2 border-rose-200 ml-1">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">Mostrar observação quando selecionado:</label>
                <select
                  value={field.conditionalTrigger}
                  onChange={e => onUpdate({ conditionalTrigger: e.target.value })}
                  className="block w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  {(field.options || []).map((opt: string, i: number) => (
                    <option key={i} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Pergunta do campo de observação</label>
                <input
                  value={field.conditionalLabel || ''}
                  onChange={e => onUpdate({ conditionalLabel: e.target.value })}
                  placeholder="Ex: Em qual salão você está marcado?"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!field.conditionalRequired}
                  onChange={e => onUpdate({ conditionalRequired: e.target.checked })}
                  className="h-3.5 w-3.5 text-rose-500 rounded"
                />
                <span className="text-sm text-gray-700">Observação obrigatória</span>
              </label>
            </div>
          )}
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

// ── Editor genérico de lista de checklist (add/remove/reordenar) ─────
//
// Usado dentro do formulário de CADA categoria (CategoryForm) — o checklist
// de confirmação de foto é por categoria, não por plano. Cada categoria
// mostra o seu próprio carrossel de confirmação no portal, antes da cliente
// escolher a foto. Vazio = pula o carrossel, vai direto pro seletor de arquivo.

// Traduções do checklist. Ficam em `instruction_items` como um item
// `type: 'checklist_i18n'` ({ translations: { en: string[], es: string[], ... } }),
// com os textos alinhados por posição aos de `checklist_items` (que é o texto
// base em português). Sem mudança de banco. Idioma sem tradução → portal mostra o texto base.
const CHECKLIST_I18N_TYPE = 'checklist_i18n'
const CHECKLIST_LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
]

/** Tira itens vazios do checklist mantendo as traduções alinhadas; remove o item i18n se ficar vazio. */
function compactChecklist(items: string[], instructionItems: any[]) {
  const keep = items.map((s, i) => (s.trim() ? i : -1)).filter(i => i >= 0)
  const cleaned = keep.map(i => items[i].trim())
  const out = (instructionItems ?? []).map(it => {
    if (it?.type !== CHECKLIST_I18N_TYPE) return it
    const tr: Record<string, string[]> = {}
    Object.entries(it.translations ?? {}).forEach(([lang, arr]) => {
      const a = keep.map(i => (((arr as string[])[i]) ?? '').trim())
      if (a.some(Boolean)) tr[lang] = a
    })
    return cleaned.length > 0 && Object.keys(tr).length > 0 ? { ...it, translations: tr } : null
  }).filter(Boolean)
  return { checklist_items: cleaned.length > 0 ? cleaned : null, instruction_items: out }
}

function ChecklistItemsEditor({ items, translations, onChange }: {
  items: string[]
  translations: Record<string, string[]>
  onChange: (items: string[], translations: Record<string, string[]>) => void
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const pad = (arr: string[] | undefined) => Array.from({ length: items.length }, (_, i) => arr?.[i] ?? '')
  const mapTr = (fn: (arr: string[]) => string[]) => {
    const next: Record<string, string[]> = {}
    Object.keys(translations).forEach(l => { next[l] = fn(pad(translations[l])) })
    return next
  }

  const updateItem = (i: number, value: string) => onChange(items.map((it, idx) => idx === i ? value : it), translations)
  const addItem = () => onChange([...items, ''], translations)
  const removeItem = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i), mapTr(arr => arr.filter((_, idx) => idx !== i)))
    setOpenIdx(null)
  }
  const moveItem = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next, mapTr(arr => { const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c }))
    setOpenIdx(o => (o === i ? j : o === j ? i : o))
  }
  const setTr = (lang: string, i: number, value: string) => {
    const arr = pad(translations[lang])
    arr[i] = value
    onChange(items, { ...translations, [lang]: arr })
  }
  const trCount = (i: number) => CHECKLIST_LANGS.filter(l => (translations[l.code]?.[i] ?? '').trim()).length

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div>
        <h4 className="font-semibold text-gray-900 text-sm">Checklist de confirmação (opcional)</h4>
        <p className="text-xs text-gray-500 mt-0.5">
          Aparece na tela de conferência, abaixo da instrução e da foto que a cliente acabou de escolher. Todos os itens precisam ser marcados para ela enviar. Se deixar vazio, ela só confirma que a foto está de acordo com o exemplo.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          O texto acima é o padrão (português). Toque no <Globe className="inline h-3 w-3 -mt-0.5" /> de um item para traduzir — quem usa outro idioma vê a tradução; sem tradução, vê o texto em português.
        </p>
      </div>

      {items.length === 0 && (
        <p className="text-xs text-gray-400 italic">Nenhum item — sem checklist nesta categoria.</p>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-1.5">
                <div className="flex flex-col">
                  <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  value={item}
                  onChange={e => updateItem(i, e.target.value)}
                  placeholder="Ex: Cabelo 100% preso para trás"
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
                <button type="button" onClick={() => setOpenIdx(o => (o === i ? null : i))}
                  title="Traduções"
                  className={`relative p-2 flex-shrink-0 rounded-lg ${openIdx === i ? 'bg-rose-50 text-rose-500' : 'text-gray-400 hover:text-rose-500'}`}>
                  <Globe className="h-3.5 w-3.5" />
                  {trCount(i) > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {trCount(i)}
                    </span>
                  )}
                </button>
                <button type="button" onClick={() => removeItem(i)} className="p-2 text-gray-400 hover:text-red-500 flex-shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {openIdx === i && (
                <div className="ml-6 rounded-lg border border-rose-100 bg-rose-50/40 p-3 space-y-2">
                  {CHECKLIST_LANGS.map(l => (
                    <div key={l.code} className="flex items-center gap-2">
                      <span className="w-16 flex-shrink-0 text-[11px] font-semibold text-gray-500 uppercase">{l.label}</span>
                      <input
                        value={translations[l.code]?.[i] ?? ''}
                        onChange={e => setTr(l.code, i, e.target.value)}
                        placeholder={item || 'Tradução…'}
                        className="flex-1 min-w-0 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Btn variant="outline" size="sm" onClick={addItem}>
        <Plus className="h-3.5 w-3.5" /> Adicionar item
      </Btn>
    </div>
  )
}

// ── Photos Tab ───────────────────────────────────────────────

const EMPTY_CAT = { title: '', description: '', max_photos: 10, is_ai_simulation: false, instruction_items: [] as InstructionItem[], checklist_items: [] as string[] }

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
    // Se está marcando como IA, valida que não existe outra categoria IA neste plano
    if (newCat.is_ai_simulation && categories.some(c => (c as any).is_ai_simulation)) {
      alert('Este plano já possui uma categoria de Foto para Simulação (IA). Edite a existente ou desmarque a outra antes.')
      return
    }
    const packed = compactChecklist(newCat.checklist_items, newCat.instruction_items as any[])
    await adminService.savePhotoCategory({
      plan_id: planId,
      title: newCat.title,
      description: newCat.description || null,
      instruction_items: packed.instruction_items,
      checklist_items: packed.checklist_items,
      max_photos: newCat.max_photos,
      is_ai_simulation: newCat.is_ai_simulation,
      order_index: categories.length
    } as any)
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
      is_ai_simulation: !!(cat as any).is_ai_simulation,
      checklist_items: ((cat as any).checklist_items as string[] | null) ?? [],
      instruction_items: (() => {
        const migrated = migrateToInstructionItems(
          (cat as any).video_url,
          (cat as any).instructions,
          (cat as any).instruction_items
        )
        // Garante que a foto de exemplo e as traduções do checklist não se percam
        // se o migrate filtrar tipos desconhecidos
        const raw = ((cat as any).instruction_items ?? []) as any[]
        const out: any[] = [...migrated]
        ;['example', CHECKLIST_I18N_TYPE].forEach(type => {
          const found = raw.find(i => i?.type === type)
          if (found && !out.some(i => i?.type === type)) out.push(found)
        })
        return out
      })()
    })
  }

  const handleSaveEdit = async () => {
    if (!editCat.title.trim() || !editingId) return
    // Se está marcando como IA agora, valida que não existe outra categoria IA neste plano
    if (editCat.is_ai_simulation && categories.some(c => c.id !== editingId && (c as any).is_ai_simulation)) {
      alert('Este plano já possui outra categoria de Foto para Simulação (IA). Desmarque a outra antes.')
      return
    }
    const packed = compactChecklist((editCat.checklist_items ?? []) as string[], editCat.instruction_items as any[])
    await adminService.updatePhotoCategory(editingId, {
      title: editCat.title,
      description: editCat.description || null,
      instruction_items: packed.instruction_items,
      checklist_items: packed.checklist_items,
      max_photos: editCat.max_photos,
      is_ai_simulation: editCat.is_ai_simulation,
    } as any)
    setEditingId(null)
    setEditCat(null)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta categoria?')) return
    await adminService.deletePhotoCategory(id)
    load()
  }

  const handleMove = async (index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= categories.length) return
    const prev = categories
    const next = [...categories]
    ;[next[index], next[j]] = [next[j], next[index]]
    // Atualiza na tela na hora; se o save falhar, volta a ordem anterior
    setCategories(next.map((c, i) => ({ ...c, order_index: i })))
    try {
      await adminService.reorderPhotoCategories(next.map(c => c.id))
    } catch (e) {
      setCategories(prev)
      alert('Não foi possível salvar a nova ordem. Tente novamente.')
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-rose-400 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">Categorias de fotos que o cliente vai enviar</p>
        <Btn size="sm" onClick={() => { setAdding(true); setEditingId(null) }}>
          <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Nova </span>Categoria
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
      {categories.map((cat, index) => (
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
            <div className="p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-gray-900">{cat.title}</h4>
                    {(cat as any).is_ai_simulation && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">
                        ✨ Foto p/ Simulação (IA)
                      </span>
                    )}
                  </div>
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
                    const hasExample = ((cat as any).instruction_items ?? []).some((it: any) => it?.type === 'example')
                    return (
                      <>
                        <div className="flex flex-wrap gap-3 mt-2">
                          <span className="text-xs text-gray-400">📸 Máx. {cat.max_photos} foto{cat.max_photos !== 1 ? 's' : ''}</span>
                          {videos.length > 0 && <span className="text-xs text-blue-500">▶ {videos.length} vídeo{videos.length !== 1 ? 's' : ''}</span>}
                          {images.length > 0 && <span className="text-xs text-purple-500">🖼 {images.length} imagem{images.length !== 1 ? 'ns' : ''}</span>}
                          {hasExample && <span className="text-xs text-pink-500">📷 foto de exemplo</span>}
                          {texts.length > 0 && <span className="text-xs text-gray-400">📋 {texts.length} instrução{texts.length !== 1 ? 'ões' : ''}</span>}
                          {((cat as any).checklist_items?.length ?? 0) > 0 && (
                            <span className="text-xs text-emerald-600">✅ {(cat as any).checklist_items.length} item{(cat as any).checklist_items.length !== 1 ? 's' : ''} no checklist</span>
                          )}
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
                <div className="flex items-center gap-2 sm:ml-4 self-start">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0}
                      title="Mover para cima"
                      className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="h-4 w-4 text-gray-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(index, 1)}
                      disabled={index === categories.length - 1}
                      title="Mover para baixo"
                      className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <ChevronDown className="h-4 w-4 text-gray-500" />
                    </button>
                  </div>
                  <Btn variant="outline" size="sm" onClick={() => handleEdit(cat)}>
                    <Pencil className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Editar</span>
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

// ── Foto de exemplo da categoria ─────────────────────────────
//
// Fica guardada em `instruction_items` como um item `type: 'example'` (sem
// mudança de banco). No portal aparece ao lado da imagem/PDF de instrução e
// é a foto usada na comparação depois que a cliente envia a dela.
function ExamplePhotoField({ item, onChange, onUpload }: {
  item: InstructionItem | null
  onChange: (item: InstructionItem | null) => void
  onUpload: (file: File) => Promise<{ storagePath: string; url: string }>
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const src: string = (item as any)?.imageUrl || (item as any)?.content || ''

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Escolha um arquivo de imagem (JPG, PNG...).'); return }
    setError('')
    setUploading(true)
    try {
      const { storagePath, url } = await onUpload(file)
      onChange({
        id: `example-${Date.now()}`, type: 'example', content: url, imageUrl: url, storagePath, fileName: file.name,
      } as unknown as InstructionItem)
    } catch (e: any) {
      setError(e?.message || 'Falha ao enviar a imagem.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div>
        <h4 className="font-semibold text-gray-900 text-sm">Foto de exemplo (opcional)</h4>
        <p className="text-xs text-gray-500 mt-0.5">
          Aparece ao lado da imagem/PDF de instrução para a cliente e é a foto usada na comparação depois que ela envia a dela.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => handleFile(e.target.files?.[0])}
      />

      {src ? (
        <div className="flex items-center gap-3">
          <img src={src} alt="Exemplo" className="w-24 aspect-[3/4] object-contain rounded-lg border border-gray-200 bg-gray-50 flex-shrink-0" />
          <div className="flex flex-col sm:flex-row gap-2 min-w-0">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {uploading ? 'Enviando…' : 'Trocar foto'}
            </button>
            <button type="button" onClick={() => onChange(null)} disabled={uploading}
              className="px-3 py-2 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
              Remover
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 hover:border-rose-300 hover:text-rose-500 transition-colors disabled:opacity-50">
          <Image className="h-6 w-6" />
          <span className="text-sm font-medium">{uploading ? 'Enviando…' : 'Adicionar foto de exemplo'}</span>
        </button>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
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

  // A foto de exemplo vive em instruction_items (type 'example'), mas é
  // editada num campo próprio — o editor de instruções só vê os demais itens.
  const allItems: InstructionItem[] = data.instruction_items ?? []
  const exampleItem = allItems.find(i => (i as any).type === 'example') ?? null
  const i18nItem = allItems.find(i => (i as any).type === CHECKLIST_I18N_TYPE) ?? null
  const otherItems = allItems.filter(i => (i as any).type !== 'example' && (i as any).type !== CHECKLIST_I18N_TYPE)
  const checklistTranslations: Record<string, string[]> = (i18nItem as any)?.translations ?? {}
  const compose = (others: InstructionItem[], ex: InstructionItem | null, i18n: InstructionItem | null): InstructionItem[] =>
    [...others, ...(ex ? [ex] : []), ...(i18n ? [i18n] : [])]

  return (
    <div className="bg-white border border-rose-200 rounded-xl p-4 sm:p-6 space-y-4">
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

      {/* Toggle: categoria IA (etapa condicional após Enviar Dossiê) */}
      <label className="flex items-start gap-3 p-3 rounded-lg border border-violet-200 bg-violet-50/40 cursor-pointer hover:bg-violet-50 transition-colors">
        <input
          type="checkbox"
          checked={!!data.is_ai_simulation}
          onChange={e => onChange({ ...data, is_ai_simulation: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900">
            ✨ Esta é a etapa de <strong>Foto para Simulação (IA)</strong>
          </p>
          <p className="text-xs text-gray-500 mt-0.5 leading-snug">
            Quando marcada, esta categoria vira uma etapa condicional do fluxo —
            a cliente envia esta foto entre "Enviar Dossiê" e "Simulações". Se desmarcado,
            é só uma categoria normal de fotos. Apenas <strong>uma</strong> categoria por plano pode ter esta marcação.
          </p>
        </div>
      </label>

      {/* ── Editor unificado: texto + vídeo YouTube + imagem ── */}
      <PhotoCategoryInstructionsEditor
        items={otherItems}
        onChange={items => onChange({ ...data, instruction_items: compose(items, exampleItem, i18nItem) })}
        onUpload={uploadFile}
      />

      {/* ── Foto de exemplo: ao lado da instrução e usada na comparação ── */}
      <ExamplePhotoField
        item={exampleItem}
        onChange={ex => onChange({ ...data, instruction_items: compose(otherItems, ex, i18nItem) })}
        onUpload={uploadFile}
      />

      {/* ── Checklist de confirmação: aparece na conferência, depois que a cliente escolhe a foto ── */}
      <ChecklistItemsEditor
        items={data.checklist_items ?? []}
        translations={checklistTranslations}
        onChange={(items, tr) => {
          const hasTr = Object.values(tr).some(arr => arr.some(v => (v ?? '').trim()))
          const nextI18n = hasTr
            ? ({ id: 'checklist-i18n', type: CHECKLIST_I18N_TYPE, content: '', translations: tr } as unknown as InstructionItem)
            : null
          onChange({ ...data, checklist_items: items, instruction_items: compose(otherItems, exampleItem, nextI18n) })
        }}
      />

      <div className="flex gap-2">
        <Btn onClick={onSave}>Salvar</Btn>
        <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
      </div>
    </div>
  )
}

// ──Layers icon workaround───────────────────────────────────

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