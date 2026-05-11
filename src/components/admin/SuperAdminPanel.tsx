// src/components/admin/SuperAdminPanel.tsx
import React, { useEffect, useState, useMemo } from 'react'
import {
  Shield, Plus, Search, Mail, Calendar,
  CheckCircle2, XCircle, AlertTriangle,
  MoreVertical, Edit2, Trash2, Loader2, AlertCircle,
  X, Users as UsersIcon,
} from 'lucide-react'
import { adminService, AdminUser } from '../../lib/services'
import { useTheme } from '../../lib/theme'

export function SuperAdminPanel() {
  const { theme: t } = useTheme()
  const [admins, setAdmins] = useState<AdminUser[]>([])
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

  // Estatísticas (apenas admins comuns, exclui super)
  const stats = useMemo(() => {
    const adminsOnly = admins.filter(a => a.role === 'admin')
    const now = Date.now()
    const active = adminsOnly.filter(a =>
      a.license_active &&
      (!a.license_expires_at || new Date(a.license_expires_at).getTime() > now)
    ).length
    const expired = adminsOnly.filter(a => {
      const isExpired = a.license_expires_at && new Date(a.license_expires_at).getTime() < now
      return !a.license_active || isExpired
    }).length
    return { total: adminsOnly.length, active, expired }
  }, [admins])

  // Tokens de tema com fallback (caso o seu theme.tsx não tenha cardBg/textDim/border)
  const cardBg = (t as any).cardBg || (t as any).bg2 || 'rgba(255,255,255,0.04)'
  const textDim = (t as any).textDim || (t as any).headerTextDim || 'rgba(0,0,0,0.5)'
  const border = (t as any).border || 'rgba(0,0,0,0.1)'

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div style={{
          width: 38, height: 38,
          background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)`,
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 12px ${t.accent}40`,
        }}>
          <Shield size={20} color={t.accentFg} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>
            Administradores
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: textDim }}>
            Gerencie contas e licenças
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-5">
        <StatCard label="Total de admins" value={stats.total} accent={t.accent} cardBg={cardBg} border={border} textDim={textDim} />
        <StatCard label="Licenças ativas" value={stats.active} accent="#10b981" cardBg={cardBg} border={border} textDim={textDim} />
        <StatCard label="Vencidas / Inativas" value={stats.expired} accent="#ef4444" cardBg={cardBg} border={border} textDim={textDim} />
      </div>

      {/* Action bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: textDim }}
          />
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px 10px 38px',
              background: cardBg,
              color: t.text,
              border: `1px solid ${border}`,
              borderRadius: 10,
              fontSize: 14,
              outline: 'none',
            }}
          />
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          style={{
            padding: '10px 16px',
            background: `linear-gradient(135deg, ${t.accent}, ${t.accent}dd)`,
            color: t.accentFg,
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            justifyContent: 'center',
            boxShadow: `0 4px 12px ${t.accent}40`,
          }}
        >
          <Plus size={16} />
          Novo Admin
        </button>
      </div>

      {/* List */}
      <div style={{
        background: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 12,
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
              {search ? 'Nenhum admin corresponde à busca.' : 'Nenhum admin cadastrado ainda.'}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((a, idx) => (
              <AdminRow
                key={a.id}
                admin={a}
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

// ─── Componentes auxiliares ──────────────────────────────────────────

function StatCard({
  label, value, accent, cardBg, border, textDim,
}: { label: string; value: number; accent: string; cardBg: string; border: string; textDim: string }) {
  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${border}`,
      borderRadius: 12,
      padding: 16,
    }}>
      <p style={{ margin: 0, fontSize: 12, color: textDim, marginBottom: 4 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: accent, lineHeight: 1.1 }}>
        {value}
      </p>
    </div>
  )
}

function AdminRow({
  admin, isCurrent, isLast, onToggle, onRenew, onEdit, onDelete, t, cardBg, border, textDim,
}: {
  admin: AdminUser
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
  const valid = admin.license_active && !expired
  const expiresText = admin.license_expires_at
    ? new Date(admin.license_expires_at).toLocaleDateString('pt-BR')
    : 'Sem validade'

  const initials = (admin.nome || admin.email).charAt(0).toUpperCase()
  const isSuper = admin.role === 'super_admin'

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center"
      style={{
        padding: 14,
        borderBottom: isLast ? 'none' : `1px solid ${border}`,
        gap: 12,
      }}
    >
      {/* Avatar + info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 220px' }}>
        <div style={{
          width: 38, height: 38,
          background: isSuper
            ? `linear-gradient(135deg, ${t.accent}, ${t.accent}99)`
            : `linear-gradient(135deg, ${t.accent}88, ${t.accent}55)`,
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: t.accentFg, fontWeight: 700, fontSize: 14,
          flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: t.text, wordBreak: 'break-word' }}>
              {admin.nome || admin.email.split('@')[0]}
            </p>
            {isSuper && (
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                padding: '2px 6px', borderRadius: 4,
                background: `${t.accent}26`, color: t.accent, letterSpacing: 0.5,
              }}>
                Super
              </span>
            )}
            {isCurrent && (
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                padding: '2px 6px', borderRadius: 4,
                background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', letterSpacing: 0.5,
              }}>
                Você
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px', marginTop: 2 }}>
            <span style={{
              fontSize: 12, color: textDim, display: 'flex', alignItems: 'center', gap: 4,
              minWidth: 0, wordBreak: 'break-all',
            }}>
              <Mail size={11} style={{ flexShrink: 0 }} /> {admin.email}
            </span>
          </div>
        </div>

        {/* Menu de ações — fica colado ao avatar/info no mobile, no fim da linha no desktop */}
        {!isCurrent && (
          <div className="sm:hidden" style={{ position: 'relative', flexShrink: 0 }}>
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
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                  onClick={() => setMenuOpen(false)}
                />
                <div style={{
                  position: 'absolute', right: 0, top: 32,
                  background: cardBg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  minWidth: 140, zIndex: 40,
                  overflow: 'hidden',
                }}>
                  <button
                    onClick={() => { setMenuOpen(false); onEdit() }}
                    style={{
                      width: '100%', padding: '8px 12px',
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'transparent', border: 'none',
                      fontSize: 13, color: t.text,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <Edit2 size={13} /> Editar
                  </button>
                  {!isSuper && (
                    <button
                      onClick={() => { setMenuOpen(false); onDelete() }}
                      style={{
                        width: '100%', padding: '8px 12px',
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'transparent', border: 'none',
                        fontSize: 13, color: '#ef4444',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <Trash2 size={13} /> Excluir
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status + ações da licença (só pra admin comum) */}
      {!isSuper && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: valid ? '#10b98122' : (expired ? '#f59e0b22' : '#ef444422'),
            color: valid ? '#10b981' : (expired ? '#f59e0b' : '#ef4444'),
          }}>
            {valid
              ? <><CheckCircle2 size={12} /> Ativa</>
              : (expired
                ? <><AlertTriangle size={12} /> Vencida</>
                : <><XCircle size={12} /> Inativa</>
              )}
          </div>

          <span style={{
            fontSize: 11, color: textDim,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Calendar size={11} /> {expiresText}
          </span>

          <button
            onClick={onToggle}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              background: admin.license_active ? '#ef444422' : '#10b98122',
              color: admin.license_active ? '#ef4444' : '#10b981',
            }}
          >
            {admin.license_active ? 'Desativar' : 'Ativar'}
          </button>

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
            <option value="" disabled>Renovar...</option>
            <option value="30">+ 30 dias</option>
            <option value="90">+ 90 dias</option>
            <option value="180">+ 180 dias</option>
            <option value="365">+ 1 ano</option>
          </select>
        </div>
      )}

      {/* Menu de ações — visível apenas em sm+ (em mobile o menu está colado ao avatar acima) */}
      {!isCurrent && (
        <div className="hidden sm:block" style={{ position: 'relative' }}>
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
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                onClick={() => setMenuOpen(false)}
              />
              <div style={{
                position: 'absolute', right: 0, top: 32,
                background: cardBg,
                border: `1px solid ${border}`,
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                minWidth: 140, zIndex: 40,
                overflow: 'hidden',
              }}>
                <button
                  onClick={() => { setMenuOpen(false); onEdit() }}
                  style={{
                    width: '100%', padding: '8px 12px',
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'transparent', border: 'none',
                    fontSize: 13, color: t.text,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <Edit2 size={13} /> Editar
                </button>
                {!isSuper && (
                  <button
                    onClick={() => { setMenuOpen(false); onDelete() }}
                    style={{
                      width: '100%', padding: '8px 12px',
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'transparent', border: 'none',
                      fontSize: 13, color: '#ef4444',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <Trash2 size={13} /> Excluir
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Modal de criação/edição ─────────────────────────────────────────

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
    nome: admin?.nome ?? '',
    password: '',
    license_active: admin?.license_active ?? true,
    license_expires_at: admin?.license_expires_at?.split('T')[0] ?? '',
    observacoes: admin?.observacoes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      if (isEdit) {
        await adminService.updateAdminInfo(admin.id, {
          nome: form.nome,
          observacoes: form.observacoes,
        })
        await adminService.toggleAdminLicense(admin.id, form.license_active)
        await adminService.setAdminLicenseExpiry(
          admin.id,
          form.license_expires_at
            ? new Date(form.license_expires_at + 'T00:00:00').toISOString()
            : null
        )
      } else {
        if (form.password.length < 6) {
          throw new Error('Senha deve ter pelo menos 6 caracteres.')
        }
        await adminService.createAdmin({
          email: form.email,
          password: form.password,
          nome: form.nome,
          license_active: form.license_active,
          license_expires_at: form.license_expires_at
            ? new Date(form.license_expires_at + 'T00:00:00').toISOString()
            : null,
          observacoes: form.observacoes || undefined,
        })
      }
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const inputBaseStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    background: cardBg,
    color: t.text,
    border: `1px solid ${border}`,
    borderRadius: 8,
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, zIndex: 100,
    }}>
      <div style={{
        background: t.bg,
        borderRadius: 14,
        maxWidth: 480, width: '100%',
        maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          padding: '18px 20px',
          borderBottom: `1px solid ${border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.text }}>
            {isEdit ? 'Editar Administrador' : 'Novo Administrador'}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: textDim, padding: 4, borderRadius: 6, display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
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
              style={{ ...inputBaseStyle, opacity: isEdit ? 0.6 : 1 }}
            />
            {isEdit && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: textDim }}>
                E-mail não pode ser alterado.
              </p>
            )}
          </div>

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

          <div style={{
            margin: '16px 0',
            padding: 14,
            background: `${t.accent}0d`,
            border: `1px solid ${t.accent}33`,
            borderRadius: 10,
          }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: t.text }}>
              Licença
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.license_active}
                onChange={e => setForm({ ...form, license_active: e.target.checked })}
                style={{ accentColor: t.accent }}
              />
              <span style={{ fontSize: 13, color: t.text }}>Licença ativa</span>
            </label>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 6 }}>
              Vence em
            </label>
            <input
              type="date"
              value={form.license_expires_at}
              onChange={e => setForm({ ...form, license_expires_at: e.target.value })}
              style={inputBaseStyle}
            />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: textDim }}>
              Em branco = sem vencimento.
            </p>
          </div>

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

          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: 12, marginBottom: 14,
              background: '#ef444422',
              border: '1px solid #ef444466',
              borderRadius: 8,
            }}>
              <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 13, color: '#ef4444' }}>{error}</p>
            </div>
          )}

          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            paddingTop: 14, borderTop: `1px solid ${border}`,
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '8px 16px', borderRadius: 8,
                background: 'transparent',
                border: `1px solid ${border}`,
                color: t.text, fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '8px 16px', borderRadius: 8,
                background: `linear-gradient(135deg, ${t.accent}, ${t.accent}dd)`,
                color: t.accentFg, border: 'none',
                fontSize: 13, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Salvar' : 'Criar Admin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}