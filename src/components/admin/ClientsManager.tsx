// src/components/admin/ClientsManager.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import {
  Plus, Search, Eye, Trash2, ArrowLeft, Copy, CheckCircle,
  Clock, FileText, Camera, Upload, X, ExternalLink,
  Check, Download, Send, User, Phone, Mail,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  FolderOpen, Image, ClipboardList, Wand2,
  LayoutGrid, List, Filter, ChevronDown, Calendar,
  AlertTriangle, Save, MessageSquare, Link2, Tag,
  Lock, Unlock, ChevronRight as ChevronRightIcon
} from 'lucide-react'
import { adminService, Client, Plan } from '../../lib/services'
import { supabase } from '../../lib/supabase'
import { formatDeadlineDate, businessDaysUntil } from '../../lib/deadlineCalculator'
import { AIPromptConfig } from './AIPromptConfig'

// ── Tiny UI ──────────────────────────────────────────────────

const Btn = ({ children, onClick, variant = 'primary', size = 'md', loading = false, disabled = false, className = '' }: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
    green: 'bg-green-500 text-white hover:bg-green-600',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100'
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${v[variant]} ${s[size]} ${className}`}>
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

const STATUS_CONFIG: Record<string, { label: string; shortLabel: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  awaiting_contract: {
    label: 'Aguardando Contrato',
    shortLabel: 'Contrato',
    color: 'bg-amber-100 text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: <FileText className="h-4 w-4 text-amber-500" />,
  },
  awaiting_form: {
    label: 'Aguardando Formulário',
    shortLabel: 'Formulário',
    color: 'bg-blue-100 text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: <ClipboardList className="h-4 w-4 text-blue-500" />,
  },
  awaiting_photos: {
    label: 'Aguardando Fotos',
    shortLabel: 'Fotos',
    color: 'bg-purple-100 text-purple-700',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    icon: <Camera className="h-4 w-4 text-purple-500" />,
  },
  in_analysis: {
    label: 'Em Análise',
    shortLabel: 'Análise',
    color: 'bg-orange-100 text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    icon: <Clock className="h-4 w-4 text-orange-500" />,
  },
  completed: {
    label: 'Concluído',
    shortLabel: 'Concluído',
    color: 'bg-green-100 text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: <CheckCircle className="h-4 w-4 text-green-500" />,
  },
}

const COLUMN_ORDER = ['awaiting_contract', 'awaiting_form', 'awaiting_photos', 'in_analysis', 'completed']

// ── Kanban Card ──────────────────────────────────────────────

function KanbanCard({ client, deadline, onView, onDelete }: {
  client: Client
  deadline?: { deadline_date: string; photos_sent_at: string } | null
  onView: () => void
  onDelete: () => void
}) {
  const createdDate = new Date(client.created_at).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short',
  })

  // Calcular dias restantes do prazo
  let daysLeft: number | null = null
  let deadlineLabel = ''
  let deadlineUrgency: 'normal' | 'warning' | 'danger' | 'done' = 'normal'

  if (deadline?.deadline_date && client.status !== 'completed') {
    const deadlineDate = new Date(deadline.deadline_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    deadlineDate.setHours(0, 0, 0, 0)
    daysLeft = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysLeft < 0) {
      deadlineLabel = `${Math.abs(daysLeft)}d atrasado`
      deadlineUrgency = 'danger'
    } else if (daysLeft === 0) {
      deadlineLabel = 'Vence hoje'
      deadlineUrgency = 'danger'
    } else if (daysLeft <= 3) {
      deadlineLabel = `${daysLeft}d restante${daysLeft > 1 ? 's' : ''}`
      deadlineUrgency = 'warning'
    } else {
      deadlineLabel = `${daysLeft}d restante${daysLeft > 1 ? 's' : ''}`
      deadlineUrgency = 'normal'
    }
  } else if (client.status === 'completed') {
    deadlineUrgency = 'done'
  }

  const urgencyStyles = {
    normal: 'bg-gray-100 text-gray-500',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-600 font-semibold',
    done: '',
  }

  return (
    <div
      onClick={onView}
      className={`bg-white rounded-xl border p-4 cursor-pointer
        hover:shadow-md transition-all group ${
          deadlineUrgency === 'danger' ? 'border-red-200 hover:border-red-300' :
          deadlineUrgency === 'warning' ? 'border-amber-200 hover:border-amber-300' :
          'border-gray-200 hover:border-rose-200'
        }`}
    >
      {/* Header: Avatar + Name */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 bg-gradient-to-br from-rose-100 to-pink-100 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-rose-600 font-semibold text-sm">{client.full_name[0].toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate leading-tight">{client.full_name}</p>
          {client.plan && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{client.plan.name}</p>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 rounded transition-all"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Info */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Mail className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span className="truncate">{client.email}</span>
        </div>
        {client.phone && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Phone className="h-3 w-3 text-gray-400 flex-shrink-0" />
            <span>{client.phone}</span>
          </div>
        )}
      </div>

      {/* Footer with deadline */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        {deadline?.deadline_date && deadlineUrgency !== 'done' ? (
          <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${urgencyStyles[deadlineUrgency]}`}>
            {deadlineUrgency === 'danger' && <AlertTriangle className="h-3 w-3" />}
            <Clock className="h-3 w-3" />
            {deadlineLabel}
          </span>
        ) : (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Calendar className="h-3 w-3" /> {createdDate}
          </span>
        )}
        <span className="text-xs text-rose-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          Ver <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  )
}

// ── Kanban Column ────────────────────────────────────────────

function KanbanColumn({ statusKey, clients, deadlines, onView, onDelete }: {
  statusKey: string
  clients: Client[]
  deadlines: Record<string, { deadline_date: string; photos_sent_at: string }>
  onView: (id: string) => void
  onDelete: (client: Client) => void
}) {
  const cfg = STATUS_CONFIG[statusKey]
  if (!cfg) return null

  return (
    <div className="flex flex-col min-w-[280px] max-w-[320px] w-full flex-shrink-0">
      {/* Column header */}
      <div className={`rounded-xl px-4 py-3 mb-3 border ${cfg.border} ${cfg.bg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {cfg.icon}
            <span className="text-sm font-semibold text-gray-800">{cfg.shortLabel}</span>
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.color}`}>
            {clients.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-3 overflow-y-auto pb-4 pr-1" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        {clients.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
            <p className="text-xs text-gray-400">Nenhum cliente</p>
          </div>
        ) : (
          clients.map(client => (
            <KanbanCard
              key={client.id}
              client={client}
              deadline={deadlines[client.id] || null}
              onView={() => onView(client.id)}
              onDelete={() => onDelete(client)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Clients List (Board + List) ──────────────────────────────

function ClientsList() {
  const [clients, setClients] = useState<Client[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [deadlines, setDeadlines] = useState<Record<string, { deadline_date: string; photos_sent_at: string }>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterPlan, setFilterPlan] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [creating, setCreating] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', birth_date: '', plan_id: '', notes: '' })
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [c, p, dl] = await Promise.all([
      adminService.getClients(),
      adminService.getPlans(),
      supabase.from('client_deadlines').select('client_id, deadline_date, photos_sent_at'),
    ])
    setClients(c)
    setPlans(p.filter((p: any) => p.is_active))
    
    // Montar mapa de deadlines por client_id
    const dlMap: Record<string, { deadline_date: string; photos_sent_at: string }> = {}
    ;(dl.data || []).forEach((d: any) => {
      dlMap[d.client_id] = { deadline_date: d.deadline_date, photos_sent_at: d.photos_sent_at }
    })
    setDeadlines(dlMap)
    setLoading(false)
  }

  const handleCreate = async () => {
    if (!form.full_name || !form.email || !form.birth_date || !form.plan_id)
      return alert('Preencha nome, e-mail, data de nascimento e plano.')
    try {
      const client = await adminService.createClient(form as any)
      setCreating(false)
      setForm({ full_name: '', email: '', phone: '', birth_date: '', plan_id: '', notes: '' })
      navigate(`/admin/clients/${client.id}`)
    } catch (e: any) { alert(e.message) }
  }

  const handleDelete = async (client: Client) => {
    if (!confirm(`Excluir "${client.full_name}"? Todos os dados e arquivos serão removidos.`)) return
    await adminService.deleteClient(client.id)
    load()
  }

  // ── Filtering ──────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return clients.filter(c => {
      const matchSearch = !q || 
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q))
      const matchPlan = !filterPlan || c.plan_id === filterPlan
      const matchStatus = !filterStatus || c.status === filterStatus
      return matchSearch && matchPlan && matchStatus
    })
  }, [clients, search, filterPlan, filterStatus])

  // ── Group by status for Kanban ─────────────────────────
  const groupedByStatus = useMemo(() => {
    const groups: Record<string, Client[]> = {}
    COLUMN_ORDER.forEach(s => { groups[s] = [] })
    filtered.forEach(c => {
      if (groups[c.status]) groups[c.status].push(c)
      else groups[c.status] = [c]
    })
    // Ordenar cada coluna: clientes com prazo mais próximo primeiro
    Object.keys(groups).forEach(status => {
      groups[status].sort((a, b) => {
        const dlA = deadlines[a.id]
        const dlB = deadlines[b.id]
        // Quem tem prazo vem antes de quem não tem
        if (dlA && !dlB) return -1
        if (!dlA && dlB) return 1
        if (!dlA && !dlB) return 0
        // Ambos com prazo: mais próximo primeiro
        return new Date(dlA.deadline_date).getTime() - new Date(dlB.deadline_date).getTime()
      })
    })
    return groups
  }, [filtered, deadlines])

  const activeFilters = [filterPlan, filterStatus].filter(Boolean).length

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clientes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {clients.length} cliente{clients.length !== 1 ? 's' : ''} cadastrado{clients.length !== 1 ? 's' : ''}
            {filtered.length !== clients.length && (
              <span className="text-rose-500 ml-1">· {filtered.length} filtrado{filtered.length !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('board')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'board' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title="Visualização em quadro"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title="Visualização em lista"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <Btn onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo Cliente</Btn>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 shadow-sm">
          <h3 className="font-semibold text-gray-900">Novo Cliente</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome completo *</label>
              <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
                placeholder="Maria Silva"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail *</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="maria@email.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="(11) 99999-9999"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Data de Nascimento * <span className="text-gray-400 font-normal text-xs">(senha de acesso)</span>
              </label>
              <input type="date" value={form.birth_date} onChange={e => setForm({ ...form, birth_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plano *</label>
              <select value={form.plan_id} onChange={e => setForm({ ...form, plan_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400">
                <option value="">Selecione um plano</option>
                {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observações internas</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
              placeholder="Notas internas (não visível para o cliente)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
          </div>
          <div className="flex gap-2">
            <Btn onClick={handleCreate}>Criar e Abrir</Btn>
            <Btn variant="outline" onClick={() => setCreating(false)}>Cancelar</Btn>
          </div>
        </div>
      )}

      {/* Search + Filters bar */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone..."
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors ${
              showFilters || activeFilters > 0
                ? 'border-rose-300 bg-rose-50 text-rose-600'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-4 w-4" />
            Filtros
            {activeFilters > 0 && (
              <span className="bg-rose-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 bg-gray-50 rounded-xl p-4 border border-gray-200">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Plano</label>
              <select
                value={filterPlan}
                onChange={e => setFilterPlan(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 bg-white"
              >
                <option value="">Todos os planos</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {viewMode === 'list' && (
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 bg-white"
                >
                  <option value="">Todos os status</option>
                  {COLUMN_ORDER.map(s => (
                    <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                  ))}
                </select>
              </div>
            )}
            {activeFilters > 0 && (
              <div className="flex items-end">
                <button
                  onClick={() => { setFilterPlan(''); setFilterStatus('') }}
                  className="text-xs text-rose-500 hover:text-rose-600 font-medium px-3 py-2"
                >
                  Limpar filtros
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Board View ────────────────────────────────────── */}
      {viewMode === 'board' && (
        <>
          {filtered.length === 0 && !search && !filterPlan ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <User className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Nenhum cliente cadastrado ainda</p>
              <p className="text-sm text-gray-400 mt-1">Clique em "Novo Cliente" para começar</p>
            </div>
          ) : (
            <div className="overflow-x-auto pb-4 -mx-4 px-4">
              <div className="flex gap-4" style={{ minWidth: `${COLUMN_ORDER.length * 300}px` }}>
                {COLUMN_ORDER.map(statusKey => (
                  <KanbanColumn
                    key={statusKey}
                    statusKey={statusKey}
                    clients={groupedByStatus[statusKey] || []}
                    deadlines={deadlines}
                    onView={id => navigate(`/admin/clients/${id}`)}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── List View ─────────────────────────────────────── */}
      {viewMode === 'list' && (
        <>
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <User className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">{search || filterPlan || filterStatus ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...filtered].sort((a, b) => {
                const dlA = deadlines[a.id]
                const dlB = deadlines[b.id]
                if (dlA && !dlB) return -1
                if (!dlA && dlB) return 1
                if (!dlA && !dlB) return 0
                return new Date(dlA.deadline_date).getTime() - new Date(dlB.deadline_date).getTime()
              }).map(client => {
                const status = STATUS_CONFIG[client.status]
                const dl = deadlines[client.id]
                let dlLabel = ''
                let dlColor = ''
                if (dl?.deadline_date && client.status !== 'completed') {
                  const deadlineDate = new Date(dl.deadline_date)
                  const today = new Date()
                  today.setHours(0, 0, 0, 0)
                  deadlineDate.setHours(0, 0, 0, 0)
                  const diff = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                  if (diff < 0) { dlLabel = `${Math.abs(diff)}d atrasado`; dlColor = 'text-red-600 bg-red-50' }
                  else if (diff === 0) { dlLabel = 'Vence hoje'; dlColor = 'text-red-600 bg-red-50' }
                  else if (diff <= 3) { dlLabel = `${diff}d restante${diff > 1 ? 's' : ''}`; dlColor = 'text-amber-700 bg-amber-50' }
                  else { dlLabel = `${diff}d restante${diff > 1 ? 's' : ''}`; dlColor = 'text-gray-500 bg-gray-50' }
                }
                return (
                  <div key={client.id}
                    className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:border-rose-100 transition-colors">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 bg-gradient-to-br from-rose-100 to-pink-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-rose-600 font-semibold text-sm">{client.full_name[0].toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 truncate">{client.full_name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status?.color}`}>{status?.label}</span>
                          {dlLabel && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${dlColor}`}>
                              <Clock className="h-3 w-3" /> {dlLabel}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                          <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{client.email}</span>
                          {client.phone && <span className="hidden sm:flex items-center gap-1"><Phone className="h-3 w-3" />{client.phone}</span>}
                          {client.plan && <span className="hidden md:inline">· {client.plan.name}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      <Btn variant="outline" size="sm" onClick={() => navigate(`/admin/clients/${client.id}`)}>
                        <Eye className="h-3.5 w-3.5" /> Ver
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => handleDelete(client)} className="text-red-500 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Btn>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Form Response Modal ──────────────────────────────────────

function FormResponseModal({ formSubmission, planForm, onClose }: {
  formSubmission: any
  planForm: any
  onClose: () => void
}) {
  const formData = formSubmission?.form_data || {}
  const fields: any[] = planForm?.fields || []

  const fieldMap = Object.fromEntries(fields.map((f: any) => [f.id, f]))

  const getLabel = (key: string) => fieldMap[key]?.label || key
  const getValue = (value: any) => {
    if (value === null || value === undefined || value === '') return '—'
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const handleDownloadPDF = () => {
    const win = window.open('', '_blank')
    if (!win) return
    const rows = Object.entries(formData).map(([key, value]) => `
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#555;background:#f9f9f9;border:1px solid #eee;width:35%">${getLabel(key)}</td>
        <td style="padding:8px 12px;border:1px solid #eee">${getValue(value)}</td>
      </tr>
    `).join('')
    win.document.write(`
      <html><head><title>Formulário - ${formSubmission?.submitted_at ? new Date(formSubmission.submitted_at).toLocaleDateString('pt-BR') : ''}</title>
      <style>body{font-family:Arial,sans-serif;padding:32px}h1{font-size:18px;margin-bottom:4px}p{color:#888;font-size:13px;margin-bottom:20px}table{width:100%;border-collapse:collapse}</style>
      </head><body>
      <h1>Respostas do Formulário</h1>
      <p>Enviado em: ${formSubmission?.submitted_at ? new Date(formSubmission.submitted_at).toLocaleString('pt-BR') : '—'}</p>
      <table>${rows}</table>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <ClipboardList className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Respostas do Formulário</h2>
              {formSubmission?.submitted_at && (
                <p className="text-xs text-gray-400">Enviado em {new Date(formSubmission.submitted_at).toLocaleString('pt-BR')}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Btn variant="outline" size="sm" onClick={handleDownloadPDF}>
              <Download className="h-3.5 w-3.5" /> Baixar PDF
            </Btn>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {Object.entries(formData).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sem respostas</p>
          ) : (
            Object.entries(formData).map(([key, value]: any) => {
              const field = fieldMap[key]
              const isImage = field?.type === 'image'

              return (
                <div key={key} className="border-b border-gray-50 pb-4 last:border-0">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{getLabel(key)}</p>
                  {isImage && typeof value === 'string' && value.startsWith('http') ? (
                    <a href={value} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
                      <Image className="h-4 w-4" /> Ver imagem anexada
                    </a>
                  ) : (
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{getValue(value)}</p>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ── Photo Lightbox ───────────────────────────────────────────

function PhotoLightbox({ photos, initialIndex, onClose }: {
  photos: any[]
  initialIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)

  const prev = useCallback(() => { setIndex(i => (i - 1 + photos.length) % photos.length); setZoom(1) }, [photos.length])
  const next = useCallback(() => { setIndex(i => (i + 1) % photos.length); setZoom(1) }, [photos.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.5, 4))
      if (e.key === '-') setZoom(z => Math.max(z - 0.5, 0.5))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prev, next, onClose])

  const photo = photos[index]

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = photo.url
    a.download = photo.photo_name
    a.target = '_blank'
    a.click()
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 bg-black/40 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <p className="text-white text-sm font-medium truncate max-w-xs">{photo.photo_name}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom(z => Math.max(z - 0.5, 0.5))} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-white/70 text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(z + 0.5, 4))} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={handleDownload} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg">
            <Download className="h-4 w-4" />
          </button>
          <span className="text-white/40 text-xs">{index + 1}/{photos.length}</span>
          <button onClick={onClose} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg ml-1">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden relative" onClick={e => e.stopPropagation()}>
        {photos.length > 1 && (
          <button onClick={prev} className="absolute left-4 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <img
          src={photo.url}
          alt={photo.photo_name}
          className="max-w-full max-h-full object-contain select-none transition-transform duration-200"
          style={{ transform: `scale(${zoom})`, cursor: zoom > 1 ? 'move' : 'default' }}
          draggable={false}
        />
        {photos.length > 1 && (
          <button onClick={next} className="absolute right-4 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {photos.length > 1 && (
        <div className="flex-shrink-0 bg-black/60 py-3 px-4" onClick={e => e.stopPropagation()}>
          <div className="flex gap-2 justify-center overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => { setIndex(i); setZoom(1) }}
                className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all ${i === index ? 'ring-2 ring-rose-400 opacity-100' : 'opacity-50 hover:opacity-80'}`}>
                <img src={p.url} alt={p.photo_name} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Photos View (by category) ────────────────────────────────

function PhotosView({ clientId, photos, photoCategories }: {
  clientId: string
  photos: any[]
  photoCategories: any[]
}) {
  const [photosWithUrls, setPhotosWithUrls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<{ photos: any[]; index: number } | null>(null)

  useEffect(() => {
    adminService.getClientPhotosWithUrls(clientId).then(p => {
      setPhotosWithUrls(p)
      setLoading(false)
    })
  }, [clientId])

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-rose-400 border-t-transparent rounded-full" /></div>

  if (photosWithUrls.length === 0) return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
      <Camera className="h-10 w-10 text-gray-300 mx-auto mb-3" />
      <p className="text-gray-500">Nenhuma foto enviada ainda</p>
    </div>
  )

  const photosByCat: Record<string, any[]> = {}
  const uncategorized: any[] = []

  photosWithUrls.forEach(p => {
    if (p.category_id) {
      if (!photosByCat[p.category_id]) photosByCat[p.category_id] = []
      photosByCat[p.category_id].push(p)
    } else {
      uncategorized.push(p)
    }
  })

  const downloadAll = (catPhotos: any[], catName: string) => {
    catPhotos.forEach((p, i) => {
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = p.url
        a.download = p.photo_name
        a.target = '_blank'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }, i * 300)
    })
  }

  const renderGrid = (catPhotos: any[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {catPhotos.map((photo, idx) => (
        <div key={photo.id}
          className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 cursor-pointer group hover:ring-2 hover:ring-rose-400 transition-all"
          onClick={() => setLightbox({ photos: catPhotos, index: idx })}>
          <img src={photo.url} alt={photo.photo_name} className="w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
            <Maximize2 className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <div className="space-y-5">
        {photoCategories.map(cat => {
          const catPhotos = photosByCat[cat.id] || []
          if (catPhotos.length === 0) return null
          return (
            <div key={cat.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{cat.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{catPhotos.length} foto{catPhotos.length !== 1 ? 's' : ''}</p>
                </div>
                <Btn variant="outline" size="sm" onClick={() => downloadAll(catPhotos, cat.title)}>
                  <Download className="h-3.5 w-3.5" /> Baixar todas
                </Btn>
              </div>
              <div className="p-5">{renderGrid(catPhotos)}</div>
            </div>
          )
        })}

        {uncategorized.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Fotos sem categoria</h3>
                <p className="text-xs text-gray-400 mt-0.5">{uncategorized.length} foto{uncategorized.length !== 1 ? 's' : ''}</p>
              </div>
              <Btn variant="outline" size="sm" onClick={() => downloadAll(uncategorized, 'sem-categoria')}>
                <Download className="h-3.5 w-3.5" /> Baixar todas
              </Btn>
            </div>
            <div className="p-5">{renderGrid(uncategorized)}</div>
          </div>
        )}
      </div>

      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
}

// ── Client Detail ────────────────────────────────────────────

function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'overview' | 'photos' | 'result' | 'ai'>('overview')
  const [showFormModal, setShowFormModal] = useState(false)

  const [resultForm, setResultForm] = useState({ observations: '' })
  const [savingResult, setSavingResult] = useState(false)
  const [releasingResult, setReleasingResult] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Pastas IA + Tags — gerenciados na aba Resultado
  const [aiFolders, setAiFolders] = useState<any[]>([])
  const [tagTemplates, setTagTemplates] = useState<any[]>([])
  const [clientTags, setClientTags] = useState<{ templateId: string; name: string; value: string }[]>([])
  const [linkedFolderId, setLinkedFolderId] = useState<string | null>(null)
  const [linkedFolderConfig, setLinkedFolderConfig] = useState<any>(null)
  const [savingAI, setSavingAI] = useState(false)
  const [aiSaveStatus, setAiSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // Notes (observações internas)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)

  // Deadline editing
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [savingDeadline, setSavingDeadline] = useState(false)

  useEffect(() => { load() }, [clientId])

  // ── Constrói system prompt (usado ao salvar pasta/tags) ────
  const buildSystemPrompt = (name: string, folderConfig: any, tags: { name: string; value: string }[]): string => {
    const filled = tags.filter(t => t.value.trim())
    let tagSection = ''
    if (filled.length > 0) {
      tagSection = `\n═══ INFORMAÇÕES DA ANÁLISE DESTA CLIENTE ═══\n${filled.map(t => `${t.name}: ${t.value}`).join('\n')}\n\nUse ESTAS informações como base para TODAS as respostas.`
    }
    if (!folderConfig && !filled.length) return ''

    let categoriesSection = ''
    if (folderConfig) {
      const catLines = (folderConfig.categories || []).map((cat: any) => {
        const prompts = (cat.prompts || []).map((p: any) => {
          let d = '  - ' + p.name
          if (p.options?.length) d += ' [' + p.options.join(', ') + ']'
          if (p.instructions) d += ' → ' + p.instructions
          return d
        }).join('\n')
        return '📌 ' + cat.name + ':\n' + (prompts || '  (vazio)')
      }).join('\n\n')
      categoriesSection = '\n═══ CATEGORIAS ═══\n' + catLines
    }

    const parts: string[] = [
      'Você é a "MS Color IA", assistente virtual de coloração pessoal.',
      'Atende a cliente ' + name + '.',
      '',
      '═══ REGRAS ABSOLUTAS ═══',
      '1. FOTO: Já está anexada. NUNCA peça foto.',
      '2. ROSTO: Mantenha feições idênticas ao gerar imagens.',
      '3. RESPOSTAS: Baseie-se EXCLUSIVAMENTE nas informações abaixo.',
      '4. ESCOPO: Só coloração pessoal, moda, estilo, cabelo, maquiagem, acessórios.',
      '5. TOM: Entusiasmada, positiva. Português brasileiro.',
      tagSection,
      categoriesSection,
      '═══ GERAÇÃO ═══',
      '- Use a foto da categoria correta (cabelo/roupa/geral) como base.',
    ]
    return parts.join('\n')
  }

  const load = async () => {
    if (!clientId) return
    setLoading(true)
    const [detail, foldersRes, templatesRes] = await Promise.all([
      adminService.getClientDetail(clientId),
      supabase.from('ai_folders').select('id, name, config').order('name'),
      supabase.from('ai_info_templates').select('id, name, options').order('sort_order'),
    ])
    setData(detail)
    setNotes(detail.client.notes || '')
    if (detail.result) {
      setResultForm({ observations: detail.result.observations || '' })
    }

    // Pastas e tags
    const folders = foldersRes.data || []
    setAiFolders(folders)
    const tpls = (templatesRes.data || []).map((t: any) => ({ ...t, options: Array.isArray(t.options) ? t.options : [] }))
    setTagTemplates(tpls)

    const folderId = detail.client.ai_folder_id || null
    setLinkedFolderId(folderId)
    if (folderId) {
      const fc = folders.find((f: any) => f.id === folderId)
      setLinkedFolderConfig(fc ? (typeof fc.config === 'string' ? JSON.parse(fc.config) : fc.config) : null)
    }

    const savedTags: any[] = detail.client.ai_info_tags || []
    setClientTags(tpls.map((t: any) => {
      const saved = savedTags.find((s: any) => s.templateId === t.id)
      return { templateId: t.id, name: t.name, value: saved?.value || '' }
    }))

    setLoading(false)
  }

  const handleSaveNotes = async () => {
    setSavingNotes(true)
    try {
      await adminService.updateClient(clientId!, { notes } as any)
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    } catch (e: any) { alert(e.message) }
    finally { setSavingNotes(false) }
  }

  const handleSaveDeadline = async () => {
    if (!deadlineInput) return
    setSavingDeadline(true)
    try {
      await supabase
        .from('client_deadlines')
        .update({ deadline_date: deadlineInput })
        .eq('client_id', clientId!)
      setEditingDeadline(false)
      load()
    } catch (e: any) { alert(e.message) }
    finally { setSavingDeadline(false) }
  }

  const copyLink = () => {
    const link = `${window.location.origin}/c/${data.client.token}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSaveResult = async () => {
    setSavingResult(true)
    try { await adminService.saveResult(clientId!, resultForm); load() }
    catch (e: any) { alert(e.message) } finally { setSavingResult(false) }
  }

  const handleReleaseResult = async () => {
    const hasContent = resultForm.observations.trim() || resultFiles.length > 0 || linkedFolderId
    if (!hasContent) {
      const proceed = confirm(
        '⚠️ Nenhum conteúdo adicionado (pasta, PDF ou observações).\n\nDeseja liberar mesmo assim?'
      )
      if (!proceed) return
    } else {
      if (!confirm('Liberar o resultado para a cliente?')) return
    }
    setReleasingResult(true)
    try { await adminService.releaseResult(clientId!); load() }
    catch (e: any) { alert(e.message) } finally { setReleasingResult(false) }
  }

  // Salva pasta vinculada + tags na aba Resultado
  const handleSaveAIConfig = async () => {
    setSavingAI(true); setAiSaveStatus('idle')
    try {
      const prompt = buildSystemPrompt(data.client.full_name, linkedFolderConfig, clientTags)
      await supabase.from('clients').update({
        ai_folder_id: linkedFolderId,
        ai_info_tags: clientTags,
        ai_prompt: prompt,
      }).eq('id', clientId)
      // Atualiza folder_url no resultado com o driveLink da pasta vinculada
      const driveLink = linkedFolderConfig?.driveLink || ''
      if (driveLink) await adminService.saveResult(clientId!, { ...resultForm, folder_url: driveLink })
      setAiSaveStatus('saved'); setTimeout(() => setAiSaveStatus('idle'), 3000)
    } catch { setAiSaveStatus('error') }
    finally { setSavingAI(false) }
  }

  const handleLinkFolder = async (folderId: string | null) => {
    setLinkedFolderId(folderId)
    if (folderId) {
      const fc = aiFolders.find((f: any) => f.id === folderId)
      const config = fc ? (typeof fc.config === 'string' ? JSON.parse(fc.config) : fc.config) : null
      setLinkedFolderConfig(config)
    } else {
      setLinkedFolderConfig(null)
    }
  }

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingFile(true)
    try { await adminService.uploadResultFile(clientId!, file); load() }
    catch (e: any) { alert(e.message) } finally {
      setUploadingFile(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeleteFile = async (fileId: string, storagePath: string) => {
    if (!confirm('Remover este arquivo?')) return
    await adminService.deleteResultFile(fileId, storagePath)
    load()
  }

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" /></div>
  if (!data) return <div className="text-center py-20 text-gray-500">Cliente não encontrado</div>

  const { client, contract, formSubmission, photos, deadline, result, resultFiles, photoCategories, planForm } = data
  const status = STATUS_CONFIG[client.status]
  const portalLink = `${window.location.origin}/c/${client.token}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin/clients')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="w-12 h-12 bg-gradient-to-br from-rose-100 to-pink-100 rounded-full flex items-center justify-center">
            <span className="text-rose-600 font-bold text-lg">{client.full_name[0].toUpperCase()}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{client.full_name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status?.color}`}>{status?.label}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
              <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{client.email}</span>
              {client.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{client.phone}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Btn variant="outline" size="sm" onClick={copyLink}>
            {copied ? <><Check className="h-3.5 w-3.5" /> Copiado!</> : <><FileText className="h-3.5 w-3.5" /> Copiar Link</>}
          </Btn>
          <a href={portalLink} target="_blank" rel="noopener noreferrer">
            <Btn variant="ghost" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Abrir Portal</Btn>
          </a>
        </div>
      </div>

      {/* Portal link */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 mb-0.5">Link de acesso do cliente</p>
          <p className="text-sm font-mono text-gray-700 truncate">{portalLink}</p>
        </div>
        <Btn variant="outline" size="sm" onClick={copyLink}><Copy className="h-3.5 w-3.5" /></Btn>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {[
          { id: 'overview', label: 'Visão Geral' },
          { id: 'photos', label: `Fotos (${photos.length})` },
          { id: 'result', label: 'Resultado' },
          { id: 'ai', label: '✨ IA' },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Progress */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Progresso</h3>
            <div className="space-y-3">
              {[
                { label: 'Contrato assinado', done: !!contract, date: contract?.signed_at },
                { label: 'Formulário enviado', done: !!formSubmission, date: formSubmission?.submitted_at },
                { label: `Fotos enviadas (${photos.length})`, done: photos.length > 0 && client.status !== 'awaiting_photos' },
                { label: 'Em análise', done: ['in_analysis', 'completed'].includes(client.status) },
                { label: 'Resultado liberado', done: result?.is_released },
              ].map(({ label, done, date }: any) => (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-100' : 'bg-gray-100'}`}>
                    {done ? <Check className="h-3.5 w-3.5 text-green-600" /> : <div className="w-2 h-2 rounded-full bg-gray-300" />}
                  </div>
                  <div className="flex-1">
                    <span className={`text-sm ${done ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{label}</span>
                    {date && <span className="text-xs text-gray-400 ml-2">{new Date(date).toLocaleDateString('pt-BR')}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Deadline */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Prazo</h3>
              {deadline && !editingDeadline && (
                <Btn variant="outline" size="sm" onClick={() => {
                  setDeadlineInput(deadline.deadline_date)
                  setEditingDeadline(true)
                }}>
                  <Calendar className="h-3.5 w-3.5" /> Editar
                </Btn>
              )}
            </div>
            {deadline ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Fotos enviadas em</p>
                  <p className="text-sm font-medium text-gray-800">{new Date(deadline.photos_sent_at).toLocaleString('pt-BR')}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Prazo de entrega</p>
                  {editingDeadline ? (
                    <div className="space-y-2">
                      <input
                        type="date"
                        value={deadlineInput}
                        onChange={e => setDeadlineInput(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                      />
                      <div className="flex gap-2">
                        <Btn size="sm" onClick={handleSaveDeadline} loading={savingDeadline}>
                          <Check className="h-3.5 w-3.5" /> Salvar
                        </Btn>
                        <Btn variant="outline" size="sm" onClick={() => setEditingDeadline(false)}>
                          Cancelar
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-800">{formatDeadlineDate(new Date(deadline.deadline_date))}</p>
                      {client.status !== 'completed' && (
                        <p className="text-xs text-orange-600 mt-0.5">{businessDaysUntil(new Date(deadline.deadline_date))} dias úteis restantes</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Prazo calculado após envio das fotos</p>
            )}
          </div>

          {/* Plan */}
          {client.plan && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 mb-2">Plano</h3>
              <p className="text-sm text-gray-700">{client.plan.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{client.plan.deadline_days} dias úteis</p>
            </div>
          )}

          {/* Notes - editable */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-gray-400" />
                Observações Internas
              </h3>
              <Btn
                variant={notesSaved ? 'green' : 'outline'}
                size="sm"
                onClick={handleSaveNotes}
                loading={savingNotes}
                disabled={notes === (client.notes || '')}
              >
                {notesSaved
                  ? <><Check className="h-3.5 w-3.5" /> Salvo</>
                  : <><Save className="h-3.5 w-3.5" /> Salvar</>}
              </Btn>
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Anotações internas sobre a cliente (não visível para ela)..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none bg-gray-50 focus:bg-white transition-colors"
            />
            {notes !== (client.notes || '') && (
              <p className="text-xs text-amber-500 mt-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Alterações não salvas
              </p>
            )}
          </div>

          {/* Form submission card */}
          <div className={`border rounded-xl p-5 md:col-span-2 ${formSubmission ? 'bg-white border-gray-200' : 'bg-gray-50 border-dashed border-gray-300'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${formSubmission ? 'bg-blue-50' : 'bg-gray-100'}`}>
                  <ClipboardList className={`h-5 w-5 ${formSubmission ? 'text-blue-500' : 'text-gray-400'}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Formulário</h3>
                  {formSubmission ? (
                    <p className="text-xs text-gray-400">Enviado em {new Date(formSubmission.submitted_at).toLocaleDateString('pt-BR')}</p>
                  ) : (
                    <p className="text-xs text-gray-400">Aguardando envio do cliente</p>
                  )}
                </div>
              </div>
              {formSubmission && (
                <Btn variant="outline" size="sm" onClick={() => setShowFormModal(true)}>
                  <Eye className="h-3.5 w-3.5" /> Ver Respostas
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photos Tab */}
      {tab === 'photos' && (
        <PhotosView clientId={clientId!} photos={photos} photoCategories={photoCategories} />
      )}

      {/* Result Tab */}
      {tab === 'result' && (
        <div className="space-y-5 max-w-3xl">
          {/* Status liberação */}
          {result?.is_released ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800">Resultado liberado</p>
                <p className="text-xs text-green-600">A cliente pode visualizar desde {new Date(result.released_at).toLocaleString('pt-BR')}</p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
              <Lock className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Resultado ainda não liberado</p>
                <p className="text-xs text-amber-600">Preencha abaixo e libere pela aba ✨ IA quando estiver pronto</p>
              </div>
            </div>
          )}

          {/* Seletor de pasta */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-violet-500" /> Pasta vinculada
            </h3>
            <p className="text-xs text-gray-500 -mt-2">Selecione a pasta criada em Pastas IA — o link do Drive e os prompts serão usados automaticamente</p>

            <div className="space-y-2">
              {/* Opção nenhuma */}
              <button
                onClick={() => handleLinkFolder(null)}
                className={"w-full flex items-center gap-3 p-3 rounded-xl border text-left " + (linkedFolderId === null ? 'bg-gray-100 border-gray-300' : 'bg-white border-gray-200 hover:border-gray-300')}
              >
                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FolderOpen className="h-4 w-4 text-gray-400" />
                </div>
                <span className="text-sm text-gray-500">Nenhuma pasta vinculada</span>
                {linkedFolderId === null && <CheckCircle className="h-4 w-4 text-gray-400 ml-auto" />}
              </button>

              {aiFolders.map((f: any) => {
                const cfg = typeof f.config === 'string' ? JSON.parse(f.config) : f.config
                const isLinked = linkedFolderId === f.id
                return (
                  <button
                    key={f.id}
                    onClick={() => handleLinkFolder(f.id)}
                    className={"w-full flex items-center gap-3 p-3 rounded-xl border text-left " + (isLinked ? 'bg-violet-50 border-violet-300' : 'bg-white border-gray-200 hover:border-violet-200')}
                  >
                    <div className={"w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 " + (isLinked ? 'bg-violet-100' : 'bg-gray-50')}>
                      <FolderOpen className={"h-4 w-4 " + (isLinked ? 'text-violet-600' : 'text-gray-400')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={"text-sm font-medium " + (isLinked ? 'text-violet-800' : 'text-gray-800')}>{f.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-400">{cfg?.categories?.length || 0} cat · {cfg?.categories?.reduce((s: number, c: any) => s + (c.prompts?.length || 0), 0) || 0} prompts</span>
                        {cfg?.driveLink && (
                          <a href={cfg.driveLink} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-violet-500 flex items-center gap-1 hover:underline">
                            <Link2 className="h-3 w-3" /> Drive
                          </a>
                        )}
                      </div>
                    </div>
                    {isLinked && <CheckCircle className="h-4 w-4 text-violet-600 flex-shrink-0" />}
                  </button>
                )
              })}
              {aiFolders.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">Crie pastas em <strong>Pastas IA</strong> para vincular aqui</p>
              )}
            </div>

            {/* Drive link da pasta vinculada */}
            {linkedFolderConfig?.driveLink && (
              <div className="flex items-center gap-2 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                <Link2 className="h-4 w-4 text-violet-500 flex-shrink-0" />
                <span className="text-xs text-violet-700 font-medium truncate flex-1">{linkedFolderConfig.driveLink}</span>
                <a href={linkedFolderConfig.driveLink} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg whitespace-nowrap">Abrir Drive</a>
              </div>
            )}
          </div>

          {/* Informações da análise (tags) */}
          {tagTemplates.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Tag className="h-4 w-4 text-emerald-500" /> Informações da análise
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {clientTags.map(tag => {
                  const template = tagTemplates.find(t => t.id === tag.templateId)
                  const options = template?.options || []
                  return (
                    <div key={tag.templateId}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">{tag.name}</label>
                      {options.length > 0 ? (
                        <select
                          value={tag.value}
                          onChange={e => setClientTags(prev => prev.map(t => t.templateId === tag.templateId ? { ...t, value: e.target.value } : t))}
                          className={"w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 " + (tag.value ? 'text-gray-800' : 'text-gray-400')}
                        >
                          <option value="">— Selecione —</option>
                          {options.map((opt: string, i: number) => <option key={i} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input
                          value={tag.value}
                          onChange={e => setClientTags(prev => prev.map(t => t.templateId === tag.templateId ? { ...t, value: e.target.value } : t))}
                          placeholder="Digite o valor..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Observações */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900">Observações e arquivos</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
              <textarea value={resultForm.observations} onChange={e => setResultForm({ ...resultForm, observations: e.target.value })}
                rows={4} placeholder="Comentários, recomendações, paleta de cores..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700">Arquivos PDF</label>
                <Btn variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} loading={uploadingFile}>
                  <Upload className="h-3.5 w-3.5" /> Upload PDF
                </Btn>
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleUploadFile} />
              </div>
              {resultFiles.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">Nenhum arquivo adicionado</p>
              ) : (
                <div className="space-y-2">
                  {resultFiles.map((f: any) => (
                    <div key={f.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{f.file_name}</span>
                        <span className="text-xs text-gray-400">{(f.file_size / 1024).toFixed(0)} KB</span>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        <a href={adminService.getResultFileUrl(f.storage_path)} target="_blank" rel="noopener noreferrer">
                          <Btn variant="ghost" size="sm"><Download className="h-3.5 w-3.5" /></Btn>
                        </a>
                        <Btn variant="ghost" size="sm" onClick={() => handleDeleteFile(f.id, f.storage_path)} className="text-red-500 hover:bg-red-50">
                          <X className="h-3.5 w-3.5" />
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Salvar resultado + tags juntos */}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <Btn
                onClick={async () => { await handleSaveResult(); await handleSaveAIConfig() }}
                loading={savingResult || savingAI}
              >
                <Save className="h-4 w-4" /> Salvar
              </Btn>
              {aiSaveStatus === 'saved' && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Salvo!
                </span>
              )}
              <span className="text-xs text-gray-400 ml-auto flex items-center gap-1">
                <Lock className="h-3 w-3" /> Liberação somente na aba ✨ IA
              </span>
            </div>
          </div>
        </div>
      )}

      {/* IA Tab */}
      {tab === 'ai' && (
        <div className="max-w-3xl">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <AIPromptConfig
              clientId={clientId!}
              clientName={client.full_name}
              isReleased={result?.is_released || false}
              onRelease={handleReleaseResult}
              releasingResult={releasingResult}
            />
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showFormModal && formSubmission && (
        <FormResponseModal
          formSubmission={formSubmission}
          planForm={planForm}
          onClose={() => setShowFormModal(false)}
        />
      )}
    </div>
  )
}

// ── Router ───────────────────────────────────────────────────

export function ClientsManager() {
  return (
    <Routes>
      <Route index element={<ClientsList />} />
      <Route path=":clientId" element={<ClientDetail />} />
    </Routes>
  )
}