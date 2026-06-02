// src/components/admin/SuperAdminPanel.tsx
//
// Painel do super_admin pra gerenciar contas.
//
// Melhorias v2:
//   • Fix bug crítico: textDim usava headerTextDim (branco em temas claros) →
//     agora usa t.text2 corretamente
//   • Permite alterar o plano (role) no modo edição, com alerta de confirmação
//   • Vencimento visível na linha: mostra "X dias restantes" com cor de urgência
//   • StatCards com ícones e visual mais profissional
//   • Layout de linha expandido: plano + expiração bem destacados

import React, { useEffect, useState, useMemo, useRef } from 'react'
import { AdminBillingControls, type AdminBillingHandle } from './billing/AdminBillingControls'
import { supabase } from '../../lib/supabase'
import {
  Shield, Plus, Search, Mail, Calendar,
  CheckCircle2, XCircle, AlertTriangle,
  MoreVertical, Edit2, Trash2, Loader2, AlertCircle,
  X, Users as UsersIcon, Sparkles, Clock, RefreshCw,
  Store, Zap, Award,
} from 'lucide-react'
import { adminService, AdminUser } from '../../lib/services'
import { useTheme } from '../../lib/theme'

const CHAT_ADMIN_ACCENT = '#06b6d4'
const FULL_ADMIN_ACCENT = '#8b5cf6'

const ROLE_LABEL: Record<AdminUser['role'], string> = {
  super_admin: 'Super',
  admin:       'Ms Color Premium',
  chat_admin:  'MS Color IA',
  full_admin:  'Ms Color Full IA',
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Dias restantes até expirar. Negativo = já expirou. null = sem vencimento. */
function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function expiryLabel(dateStr: string | null | undefined): { text: string; color: string; bg: string } {
  if (!dateStr) return { text: 'Sem vencimento', color: '#6b7280', bg: 'transparent' }
  const days = daysUntil(dateStr)!
  const date = new Date(dateStr).toLocaleDateString('pt-BR')
  if (days < 0) return { text: `Venceu ${date}`, color: '#ef4444', bg: '#ef444415' }
  if (days === 0) return { text: 'Vence hoje!', color: '#f59e0b', bg: '#f59e0b15' }
  if (days <= 7) return { text: `${days}d restantes`, color: '#f59e0b', bg: '#f59e0b15' }
  if (days <= 30) return { text: `${days}d restantes`, color: '#10b981', bg: '#10b98115' }
  return { text: date, color: '#6b7280', bg: 'transparent' }
}

// ─── Componente principal ─────────────────────────────────────────────────

export function SuperAdminPanel() {
  const { theme: t } = useTheme()
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [billingMap, setBillingMap] = useState<Record<string, { openai_mode: string; gemini_mode: string }>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null)

  useEffect(() => {
    load()
    adminService.getCurrentAdmin().then(a => setCurrentAdminId(a?.id ?? null))
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const data = await adminService.listAdmins()
      setAdmins(data)
      supabase.from('admin_billing').select('admin_id, openai_mode, gemini_mode').then(({ data: rows }) => {
        const map: Record<string, { openai_mode: string; gemini_mode: string }> = {}
        for (const r of (rows || []) as any[]) map[r.admin_id] = { openai_mode: r.openai_mode, gemini_mode: r.gemini_mode }
        setBillingMap(map)
      })
    } catch (err) {
      console.error('Erro ao listar admins:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (a: AdminUser) => {
    try {
      await adminService.toggleAdminLicense(a.id, !a.license_active)
      setAdmins(prev => prev.map(x => x.id === a.id ? { ...x, license_active: !a.license_active } : x))
    } catch (err: any) {
      alert('Erro: ' + err.message)
    }
  }

  const handleRenew = async (a: AdminUser, days: number) => {
    try {
      await adminService.renewAdminLicense(a.id, days)
      await load()
    } catch (err: any) {
      alert('Erro: ' + err.message)
    }
  }

  const handleDelete = async (a: AdminUser) => {
    if (a.role === 'super_admin') {
      alert('Não é possível excluir um super admin pelo painel.')
      return
    }
    if (!confirm(
      `Excluir o admin "${a.nome || a.email}"?\n\n` +
      `Os clientes/planos vinculados a ele serão APAGADOS por cascade.\n` +
      `Esta ação é irreversível.`
    )) return

    try {
      await adminService.deleteAdmin(a.id)
      setAdmins(prev => prev.filter(x => x.id !== a.id))
      alert(
        'Admin removido. Lembre de excluir o usuário em ' +
        'Authentication > Users no Supabase Dashboard pra limpeza completa.'
      )
    } catch (err: any) {
      alert('Erro: ' + err.message)
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return admins
    return admins.filter(a =>
      (a.nome || '').toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q)
    )
  }, [admins, search])

  const stats = useMemo(() => {
    const sal  = admins.filter(a => a.role === 'admin')
    const chat = admins.filter(a => a.role === 'chat_admin')
    const full = admins.filter(a => a.role === 'full_admin')
    const now = Date.now()
    const isActive = (a: AdminUser) => a.license_active &&
      (!a.license_expires_at || new Date(a.license_expires_at).getTime() > now)
    const expiringSoon = (a: AdminUser) => {
      if (!a.license_expires_at || !a.license_active) return false
      const d = daysUntil(a.license_expires_at)
      return d !== null && d >= 0 && d <= 30
    }
    return {
      salTotal:   sal.length,
      salActive:  sal.filter(isActive).length,
      chatTotal:  chat.length,
      chatActive: chat.filter(isActive).length,
      fullTotal:  full.length,
      fullActive: full.filter(isActive).length,
      expiringSoon: admins.filter(expiringSoon).length,
      totalActive: admins.filter(a => a.role !== 'super_admin').filter(isActive).length,
    }
  }, [admins])

  // ★ FIX: usar t.text2 em vez de headerTextDim (que é branco em temas claros)
  const cardBg  = t.cardBg
  const textDim = t.text2
  const border  = t.border

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="flex items-center gap-3">
          <div style={{
            width: 42, height: 42,
            background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)`,
            borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 14px ${t.accent}40`,
          }}>
            <Shield size={20} color={t.accentFg} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>
              Administradores
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: textDim }}>
              Gerencie contas, planos e licenças
            </p>
          </div>
        </div>

        {stats.expiringSoon > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            background: '#f59e0b18', border: '1px solid #f59e0b44',
            fontSize: 12, fontWeight: 600, color: '#f59e0b',
          }}>
            <AlertTriangle size={14} />
            {stats.expiringSoon} licença{stats.expiringSoon > 1 ? 's' : ''} vencendo em breve
          </div>
        )}
      </div>

      {/* Stats — 2 linhas: resumo geral + por tipo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 20 }}>
        <StatCard
          label="Total ativo"
          value={stats.totalActive}
          icon={<Award size={16} />}
          accent="#10b981"
          cardBg={cardBg} border={border} textDim={textDim}
          subtitle={`de ${admins.filter(a => a.role !== 'super_admin').length} cadastros`}
        />
        <StatCard
          label="Ms Color Premium"
          value={stats.salActive}
          icon={<Store size={16} />}
          accent={t.accent}
          cardBg={cardBg} border={border} textDim={textDim}
          subtitle={`${stats.salTotal} total`}
        />
        <StatCard
          label="MS Color IA"
          value={stats.chatActive}
          icon={<Sparkles size={16} />}
          accent={CHAT_ADMIN_ACCENT}
          cardBg={cardBg} border={border} textDim={textDim}
          subtitle={`${stats.chatTotal} total`}
        />
        <StatCard
          label="Ms Color Full IA"
          value={stats.fullActive}
          icon={<Zap size={16} />}
          accent={FULL_ADMIN_ACCENT}
          cardBg={cardBg} border={border} textDim={textDim}
          subtitle={`${stats.fullTotal} total`}
        />
        <StatCard
          label="Vencendo em 30d"
          value={stats.expiringSoon}
          icon={<Clock size={16} />}
          accent={stats.expiringSoon > 0 ? '#f59e0b' : '#10b981'}
          cardBg={cardBg} border={border} textDim={textDim}
          subtitle="requer renovação"
        />
      </div>

      {/* Action bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: textDim }} />
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 38px',
              background: cardBg, color: t.text,
              border: `1px solid ${border}`,
              borderRadius: 10, fontSize: 14, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          style={{
            padding: '9px 18px',
            background: `linear-gradient(135deg, ${t.accent}, ${t.accent}dd)`,
            color: t.accentFg, border: 'none', borderRadius: 10,
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            justifyContent: 'center', whiteSpace: 'nowrap',
            boxShadow: `0 4px 12px ${t.accent}40`,
          }}
        >
          <Plus size={16} />
          Nova Conta
        </button>
      </div>

      {/* List */}
      <div style={{
        background: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 size={24} className="animate-spin" color={t.accent} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center" style={{ color: textDim }}>
            <UsersIcon size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: 14 }}>
              {search ? 'Nenhuma conta corresponde à busca.' : 'Nenhuma conta cadastrada ainda.'}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((a, idx) => (
              <AdminRow
                key={a.id}
                admin={a}
                billing={billingMap[a.id]}
                isCurrent={a.id === currentAdminId}
                isLast={idx === filtered.length - 1}
                onToggle={() => handleToggle(a)}
                onRenew={(days) => handleRenew(a, days)}
                onEdit={() => { setEditing(a); setShowForm(true) }}
                onDelete={() => handleDelete(a)}
                t={t}
                cardBg={cardBg}
                border={border}
                textDim={textDim}
              />
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <AdminFormModal
          admin={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSaved={() => { setShowForm(false); setEditing(null); load() }}
          t={t}
          cardBg={cardBg}
          border={border}
          textDim={textDim}
        />
      )}
    </div>
  )
}

// ─── StatCard melhorado ──────────────────────────────────────────────

function StatCard({
  label, value, accent, icon, cardBg, border, textDim, subtitle,
}: {
  label: string
  value: number
  accent: string
  icon: React.ReactNode
  cardBg: string
  border: string
  textDim: string
  subtitle?: string
}) {
  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${border}`,
      borderRadius: 12,
      padding: '14px 16px',
      borderLeft: `3px solid ${accent}`,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </p>
        <span style={{ color: accent, opacity: 0.7 }}>{icon}</span>
      </div>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: accent, lineHeight: 1 }}>
        {value}
      </p>
      {subtitle && (
        <p style={{ margin: 0, fontSize: 11, color: textDim }}>{subtitle}</p>
      )}
    </div>
  )
}

// ─── AdminRow ─────────────────────────────────────────────────────────────

function AdminRow({
  admin, isCurrent, isLast, onToggle, onRenew, onEdit, onDelete, t, cardBg, border, textDim, billing,
}: {
  admin: AdminUser
  billing?: { openai_mode: string; gemini_mode: string }
  isCurrent: boolean
  isLast: boolean
  onToggle: () => void
  onRenew: (days: number) => void
  onEdit: () => void
  onDelete: () => void
  t: any
  cardBg: string
  border: string
  textDim: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const expired = !!admin.license_expires_at && new Date(admin.license_expires_at) < new Date()
  const valid   = admin.license_active && !expired
  const expiry  = expiryLabel(admin.license_expires_at)

  const initials = (admin.nome || admin.email).charAt(0).toUpperCase()
  const isSuper     = admin.role === 'super_admin'
  const isChatAdmin = admin.role === 'chat_admin'
  const isFullAdmin = admin.role === 'full_admin'

  const roleAccent =
    isSuper     ? t.accent          :
    isChatAdmin ? CHAT_ADMIN_ACCENT  :
    isFullAdmin ? FULL_ADMIN_ACCENT  :
    t.accent

  const avatarBg = isSuper || (!isChatAdmin && !isFullAdmin)
    ? `linear-gradient(135deg, ${t.accent}, ${t.accent}99)`
    : isChatAdmin
    ? `linear-gradient(135deg, ${CHAT_ADMIN_ACCENT}, ${CHAT_ADMIN_ACCENT}99)`
    : `linear-gradient(135deg, ${FULL_ADMIN_ACCENT}, ${FULL_ADMIN_ACCENT}99)`

  const menuItems = (onClose: () => void) => (
    <>
      <button
        onClick={() => { onClose(); onEdit() }}
        style={{
          width: '100%', padding: '8px 12px',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none',
          fontSize: 13, color: t.text,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <Edit2 size={13} /> Editar / Renovar
      </button>
      {!isSuper && (
        <button
          onClick={() => { onClose(); onDelete() }}
          style={{
            width: '100%', padding: '8px 12px',
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'transparent', border: 'none',
            fontSize: 13, color: '#ef4444',
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          <Trash2 size={13} /> Excluir conta
        </button>
      )}
    </>
  )

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: isLast ? 'none' : `1px solid ${border}`,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
      }}
    >
      {/* Avatar + info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 200px', minWidth: 0 }}>
        <div style={{
          width: 40, height: 40,
          background: avatarBg,
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 14,
          flexShrink: 0,
        }}>
          {isChatAdmin || isFullAdmin ? <Sparkles size={16} /> : initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
              {admin.nome || admin.email.split('@')[0]}
            </span>
            {isSuper     && <RoleBadge label="Super"              color={t.accent}          bg={`${t.accent}26`} />}
            {isChatAdmin && <RoleBadge label="MS Color IA"        color={CHAT_ADMIN_ACCENT} bg={`${CHAT_ADMIN_ACCENT}1f`} />}
            {isFullAdmin && <RoleBadge label="Ms Color Full IA"   color={FULL_ADMIN_ACCENT} bg={`${FULL_ADMIN_ACCENT}1f`} />}
            {isCurrent   && <RoleBadge label="Você"               color="#3b82f6"           bg="rgba(59,130,246,0.15)" />}
            {!isSuper && (
              (billing && (billing.openai_mode === 'prepaid' || billing.gemini_mode === 'prepaid'))
                ? <RoleBadge label="Pré-pago" color="#b45309" bg="rgba(245,158,11,0.16)" />
                : <RoleBadge label="Pós-pago" color="#6b7280" bg="rgba(107,114,128,0.14)" />
            )}
          </div>
          <span style={{ fontSize: 12, color: textDim, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Mail size={11} /> {admin.email}
          </span>
        </div>
      </div>

      {/* Licença + ações */}
      {!isSuper && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {/* Status */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: valid ? '#10b98122' : (expired ? '#f59e0b22' : '#ef444422'),
            color:      valid ? '#10b981'   : (expired ? '#f59e0b'   : '#ef4444'),
          }}>
            {valid
              ? <><CheckCircle2 size={12} /> Ativa</>
              : expired
              ? <><AlertTriangle size={12} /> Vencida</>
              : <><XCircle size={12} /> Inativa</>
            }
          </span>

          {/* Expiração — label colorido com urgência */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500,
            background: expiry.bg,
            color: expiry.color,
          }}>
            <Calendar size={11} /> {expiry.text}
          </span>

          {/* Ativar/Desativar */}
          <button
            onClick={onToggle}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              background: admin.license_active ? '#ef444415' : '#10b98115',
              color:      admin.license_active ? '#ef4444'   : '#10b981',
            }}
          >
            {admin.license_active ? 'Desativar' : 'Ativar'}
          </button>

          {/* Renovar rápido */}
          <select
            onChange={e => {
              const v = e.target.value
              if (v) onRenew(Number(v))
              e.target.value = ''
            }}
            defaultValue=""
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 12,
              background: cardBg, color: t.text,
              border: `1px solid ${border}`,
              cursor: 'pointer',
            }}
          >
            <option value="" disabled>+ Renovar</option>
            <option value="30">+ 30 dias</option>
            <option value="90">+ 90 dias</option>
            <option value="180">+ 180 dias</option>
            <option value="365">+ 1 ano</option>
          </select>
        </div>
      )}

      {/* Menu de ações */}
      {!isCurrent && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              padding: 6, background: 'transparent', border: 'none',
              cursor: 'pointer', color: textDim, borderRadius: 6,
              display: 'flex',
            }}
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setMenuOpen(false)} />
              <div style={{
                position: 'absolute', right: 0, top: 34,
                background: cardBg, border: `1px solid ${border}`,
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                minWidth: 160, zIndex: 40, overflow: 'hidden',
              }}>
                {menuItems(() => setMenuOpen(false))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────

function RoleBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: 4,
      background: bg, color, letterSpacing: 0.5,
    }}>
      {label}
    </span>
  )
}

// ─── Modal de criação/edição ──────────────────────────────────────────────

function AdminFormModal({
  admin, onClose, onSaved, t, cardBg, border, textDim,
}: {
  admin: AdminUser | null
  onClose: () => void
  onSaved: () => void
  t: any
  cardBg: string
  border: string
  textDim: string
}) {
  const isEdit = !!admin

  const [form, setForm] = useState({
    email: admin?.email ?? '',
    nome:  admin?.nome  ?? '',
    password: '',
    role: (['chat_admin', 'full_admin'].includes(admin?.role ?? '')
      ? admin!.role
      : (admin?.role === 'admin' ? 'admin' : 'admin')
    ) as 'admin' | 'chat_admin' | 'full_admin',
    license_active: admin?.license_active ?? true,
    license_expires_at: admin?.license_expires_at?.split('T')[0] ?? '',
    observacoes: admin?.observacoes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const billingRef = useRef<AdminBillingHandle>(null)

  // ★ NOVO: permitir trocar plano no modo edição
  const handleRoleChange = (newRole: 'admin' | 'chat_admin' | 'full_admin') => {
    if (isEdit && newRole !== form.role) {
      if (!confirm(
        `Trocar o plano de "${ROLE_LABEL[form.role]}" para "${ROLE_LABEL[newRole]}"?\n\n` +
        `Isso altera o nível de acesso do usuário imediatamente após salvar.`
      )) return
    }
    setForm({ ...form, role: newRole })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      if (isEdit) {
        await adminService.updateAdminInfo(admin.id, {
          nome: form.nome,
          observacoes: form.observacoes,
          // ★ inclui role no update se houver mudança
          ...(form.role !== admin.role ? { role: form.role } : {}),
        })
        await adminService.toggleAdminLicense(admin.id, form.license_active)
        await adminService.setAdminLicenseExpiry(
          admin.id,
          form.license_expires_at
            ? new Date(form.license_expires_at + 'T00:00:00').toISOString()
            : null
        )
        await billingRef.current?.save()   // salva a cobrança de IA junto
      } else {
        if (form.password.length < 6) throw new Error('Senha deve ter pelo menos 6 caracteres.')
        const created = await adminService.createAdmin({
          email:   form.email,
          password: form.password,
          nome:    form.nome,
          role:    form.role,
          license_active: form.license_active,
          license_expires_at: form.license_expires_at
            ? new Date(form.license_expires_at + 'T00:00:00').toISOString()
            : null,
          observacoes: form.observacoes || undefined,
        })
        // Descobre o id do admin recém-criado pra salvar a cobrança.
        let newId: string | undefined = (created as any)?.id
        if (!newId) {
          const { data: row } = await supabase.from('admin_users').select('id').eq('email', form.email).maybeSingle()
          newId = (row as any)?.id
        }
        if (newId) await billingRef.current?.save(newId)
      }
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  // ★ FIX: background usa t.surface2 (levemente diferente do modal) → visível em todos os temas
  const inputBaseStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    background: t.surface2,
    color: t.text,
    border: `1px solid ${border}`,
    borderRadius: 8,
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }

  const daysLeft = daysUntil(form.license_expires_at || null)
  const expiryInfo = form.license_expires_at ? expiryLabel(form.license_expires_at) : null

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, zIndex: 100,
    }}>
      <div style={{
        background: t.bg, borderRadius: 14,
        maxWidth: 520, width: '100%',
        maxHeight: '92vh', overflow: 'auto',
        boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
      }}>
        {/* Header do modal */}
        <div style={{
          padding: '18px 20px',
          borderBottom: `1px solid ${border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.text }}>
              {isEdit ? 'Editar Conta' : 'Nova Conta'}
            </h2>
            {isEdit && admin && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: textDim }}>
                {admin.email}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: textDim, padding: 4, borderRadius: 6, display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 20 }}>

          {/* Tipo de conta — disponível na criação E na edição */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 6 }}>
              Plano / tipo de conta {!isEdit && <span style={{ color: '#ef4444' }}>*</span>}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <RoleOption
                label="Ms Color Premium"
                description="Clientes, planos, documentos e todas as funções de salão"
                selected={form.role === 'admin'}
                accent={t.accent}
                onClick={() => handleRoleChange('admin')}
                t={t} border={border} textDim={textDim}
              />
              <RoleOption
                label="MS Color IA"
                description="Chat IA + configurações (Gemini + PDF)"
                selected={form.role === 'chat_admin'}
                accent={CHAT_ADMIN_ACCENT}
                onClick={() => handleRoleChange('chat_admin')}
                t={t} border={border} textDim={textDim}
              />
              <RoleOption
                label="Ms Color Full IA"
                description="Chat IA + geração de imagem + dossiê PDF + capa/contracapa"
                selected={form.role === 'full_admin'}
                accent={FULL_ADMIN_ACCENT}
                onClick={() => handleRoleChange('full_admin')}
                t={t} border={border} textDim={textDim}
              />
            </div>
            {isEdit && (
              <p style={{ margin: '5px 0 0', fontSize: 11, color: textDim }}>
                Alterar o plano muda o nível de acesso imediatamente.
              </p>
            )}
          </div>

          {/* E-mail */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 6 }}>
              E-mail <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="email"
              required
              disabled={isEdit}
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              style={{ ...inputBaseStyle, opacity: isEdit ? 0.55 : 1 }}
            />
            {isEdit && (
              <p style={{ margin: '3px 0 0', fontSize: 11, color: textDim }}>
                E-mail não pode ser alterado.
              </p>
            )}
          </div>

          {/* Nome */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 6 }}>
              Nome <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              required
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              style={inputBaseStyle}
            />
          </div>

          {/* Senha (só criação) */}
          {!isEdit && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 6 }}>
                Senha inicial <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                required
                minLength={6}
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                style={{ ...inputBaseStyle, fontFamily: 'monospace' }}
                placeholder="Mínimo 6 caracteres"
              />
              <p style={{ margin: '4px 0 0', fontSize: 11, color: textDim }}>
                Compartilhe esta senha com o cliente. Ele pode trocá-la depois.
              </p>
            </div>
          )}

          {/* Licença */}
          <div style={{
            margin: '16px 0',
            padding: 16,
            background: `${t.accent}0d`,
            border: `1px solid ${t.accent}33`,
            borderRadius: 10,
          }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: t.text, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Shield size={14} color={t.accent} /> Licença
            </p>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.license_active}
                onChange={e => setForm({ ...form, license_active: e.target.checked })}
                style={{ accentColor: t.accent, width: 16, height: 16 }}
              />
              <span style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>Licença ativa</span>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 6 }}>
                  Data de vencimento
                </label>
                <input
                  type="date"
                  value={form.license_expires_at}
                  onChange={e => setForm({ ...form, license_expires_at: e.target.value })}
                  style={inputBaseStyle}
                />
              </div>
              {/* Atalhos de data rápidos */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { label: '+30d', days: 30 },
                  { label: '+90d', days: 90 },
                  { label: '+1a', days: 365 },
                ].map(({ label, days }) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => {
                      const base = form.license_expires_at
                        ? new Date(form.license_expires_at + 'T00:00:00')
                        : new Date()
                      // se já venceu, conta a partir de hoje
                      const from = base < new Date() ? new Date() : base
                      from.setDate(from.getDate() + days)
                      setForm({ ...form, license_expires_at: from.toISOString().split('T')[0] })
                    }}
                    style={{
                      padding: '4px 10px', borderRadius: 6,
                      background: `${t.accent}18`, color: t.accent,
                      border: `1px solid ${t.accent}44`,
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview do vencimento */}
            {form.license_expires_at ? (
              <div style={{
                marginTop: 8, padding: '6px 10px', borderRadius: 6,
                background: expiryInfo?.bg || 'transparent',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <Clock size={12} color={expiryInfo?.color || textDim} />
                <span style={{ fontSize: 12, color: expiryInfo?.color || textDim, fontWeight: 500 }}>
                  {expiryInfo?.text}
                  {daysLeft !== null && daysLeft > 0 && ` (${daysLeft} dias)`}
                </span>
              </div>
            ) : (
              <p style={{ margin: '8px 0 0', fontSize: 11, color: textDim }}>
                Em branco = sem data de vencimento.
              </p>
            )}
          </div>

          {/* Observações */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 6 }}>
              Observações
            </label>
            <textarea
              rows={2}
              value={form.observacoes}
              onChange={e => setForm({ ...form, observacoes: e.target.value })}
              style={{ ...inputBaseStyle, resize: 'none', fontFamily: 'inherit' }}
              placeholder="Notas internas..."
            />
          </div>

          {/* Cobrança de IA — só na edição (admin já existe) */}
          <div style={{ marginBottom: 14, paddingTop: 14, borderTop: `1px solid ${border}` }}>
            <AdminBillingControls ref={billingRef} adminId={admin?.id} />
          </div>

          {/* Erro */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: 12, marginBottom: 14,
              background: '#ef444422', border: '1px solid #ef444466', borderRadius: 8,
            }}>
              <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 13, color: '#ef4444' }}>{error}</p>
            </div>
          )}

          {/* Rodapé */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            paddingTop: 14, borderTop: `1px solid ${border}`,
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '8px 18px', borderRadius: 8,
                background: 'transparent', border: `1px solid ${border}`,
                color: t.text, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '8px 18px', borderRadius: 8,
                background: `linear-gradient(135deg, ${
                  form.role === 'chat_admin' ? CHAT_ADMIN_ACCENT :
                  form.role === 'full_admin' ? FULL_ADMIN_ACCENT :
                  t.accent
                }, ${
                  form.role === 'chat_admin' ? `${CHAT_ADMIN_ACCENT}cc` :
                  form.role === 'full_admin' ? `${FULL_ADMIN_ACCENT}cc` :
                  `${t.accent}dd`
                })`,
                color: t.accentFg, border: 'none',
                fontSize: 13, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Salvar alterações' : (
                form.role === 'chat_admin' ? 'Criar MS Color IA' :
                form.role === 'full_admin' ? 'Criar Ms Color Full IA' :
                'Criar Ms Color Premium'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── RoleOption ───────────────────────────────────────────────────────────

function RoleOption({
  label, description, selected, accent, onClick, t, border, textDim,
}: {
  label: string
  description: string
  selected: boolean
  accent: string
  onClick: () => void
  t: any
  border: string
  textDim: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 12px',
        background: selected ? `${accent}14` : 'transparent',
        border: `2px solid ${selected ? accent : border}`,
        borderRadius: 8, textAlign: 'left', cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: selected ? accent : t.text }}>
        {label}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: 11, color: textDim, lineHeight: 1.35 }}>
        {description}
      </p>
    </button>
  )
}