// src/components/admin/AdminProfile.tsx
//
// Perfil do admin autenticado.
// Permite alterar: nome, telefone, e senha.
//
// Integração:
//   • Adicione uma rota/tab no AdminDashboard e renderize <AdminProfile />.
//   • Para rota de redefinição via link de e-mail, crie /admin/reset-password
//     e renderize <AdminProfile initialView="reset-password" />.

import React, { useEffect, useState } from 'react'
import {
  User, Phone, Lock, Eye, EyeOff,
  CheckCircle2, Loader2, AlertCircle, Save,
} from 'lucide-react'
import { adminService, AdminUser } from '../../lib/services'
import { useTheme } from '../../lib/theme'

interface Props {
  /** 'profile' = tela padrão. 'reset-password' = abre direto em trocar senha
   *  (use quando o admin chega via link de e-mail de recuperação). */
  initialView?: 'profile' | 'reset-password'
}

export function AdminProfile({ initialView = 'profile' }: Props) {
  const { theme: t } = useTheme()

  const [admin, setAdmin]     = useState<AdminUser | null>(null)
  const [loadingAdmin, setLoadingAdmin] = useState(true)

  // ── Dados do perfil ────────────────────────────────────────────────
  const [nome, setNome]         = useState('')
  const [telefone, setTelefone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Troca de senha ────────────────────────────────────────────────
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [savingPwd, setSavingPwd] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    adminService.getCurrentAdmin().then(a => {
      setAdmin(a)
      if (a) {
        setNome(a.nome || '')
        setTelefone((a as any).telefone || '')
      }
      setLoadingAdmin(false)
    })
  }, [])

  // ── Salvar perfil ─────────────────────────────────────────────────
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    setProfileMsg(null)
    try {
      await adminService.updateAdminProfile({ nome: nome.trim(), telefone: telefone.trim() })
      setProfileMsg({ ok: true, text: 'Perfil atualizado com sucesso.' })
      setAdmin(prev => prev ? { ...prev, nome: nome.trim() } : prev)
    } catch (err: any) {
      setProfileMsg({ ok: false, text: err.message || 'Erro ao salvar perfil.' })
    } finally {
      setSavingProfile(false)
    }
  }

  // ── Trocar senha ──────────────────────────────────────────────────
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdMsg(null)

    if (newPassword.length < 6) {
      setPwdMsg({ ok: false, text: 'A senha deve ter pelo menos 6 caracteres.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPwdMsg({ ok: false, text: 'As senhas não coincidem.' })
      return
    }

    setSavingPwd(true)
    try {
      await adminService.updatePassword(newPassword)
      setPwdMsg({ ok: true, text: 'Senha alterada com sucesso.' })
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setPwdMsg({ ok: false, text: err.message || 'Erro ao alterar senha.' })
    } finally {
      setSavingPwd(false)
    }
  }

  // ── Estilos compartilhados ────────────────────────────────────────
  const card: React.CSSProperties = {
    background: t.cardBg,
    border: `1px solid ${t.border}`,
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    background: t.bg,
    color: t.text,
    border: `1px solid ${t.border}`,
    borderRadius: 10,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: t.text,
    marginBottom: 6,
  }

  const sectionTitle = (icon: React.ReactNode, text: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
      <div style={{
        width: 32, height: 32,
        background: `${t.accent}18`,
        borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: t.accent,
      }}>
        {icon}
      </div>
      <span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{text}</span>
    </div>
  )

  const Msg = ({ msg }: { msg: { ok: boolean; text: string } }) => (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '10px 14px',
      background: msg.ok ? '#10b98118' : '#ef444418',
      border: `1px solid ${msg.ok ? '#10b98144' : '#ef444444'}`,
      borderRadius: 8, marginBottom: 14,
    }}>
      {msg.ok
        ? <CheckCircle2 size={15} color="#10b981" style={{ flexShrink: 0, marginTop: 1 }} />
        : <AlertCircle  size={15} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
      }
      <p style={{ margin: 0, fontSize: 13, color: msg.ok ? '#059669' : '#ef4444' }}>{msg.text}</p>
    </div>
  )

  const SaveBtn = ({ loading, label }: { loading: boolean; label: string }) => (
    <button
      type="submit"
      disabled={loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '9px 20px',
        background: loading
          ? `${t.accent}88`
          : `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)`,
        color: t.accentFg,
        border: 'none',
        borderRadius: 10,
        fontSize: 13, fontWeight: 600,
        cursor: loading ? 'not-allowed' : 'pointer',
        boxShadow: loading ? 'none' : `0 4px 12px ${t.accent}40`,
        transition: 'all 0.15s',
      }}
    >
      {loading
        ? <Loader2 size={14} className="animate-spin" />
        : <Save size={14} />
      }
      {label}
    </button>
  )

  // ── Loading ───────────────────────────────────────────────────────
  if (loadingAdmin) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
        <Loader2 size={28} className="animate-spin" color={t.accent} />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560, width: '100%', margin: '0 auto', padding: '0 16px', boxSizing: 'border-box' }}>

      {/* Cabeçalho */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>Meu Perfil</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: t.text2 }}>
          {admin?.email}
        </p>
      </div>

      {/* ── Seção: Dados pessoais ──────────────────────────────────── */}
      <div style={card}>
        {sectionTitle(<User size={16} />, 'Dados pessoais')}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          {/* Nome */}
          <div>
            <label style={labelStyle}>Nome</label>
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Seu nome"
              style={inputStyle}
            />
          </div>

          {/* E-mail (somente leitura) */}
          <div>
            <label style={labelStyle}>E-mail</label>
            <input
              type="email"
              value={admin?.email || ''}
              readOnly
              disabled
              style={{ ...inputStyle, opacity: 0.55, cursor: 'not-allowed' }}
            />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: t.text2 }}>
              O e-mail não pode ser alterado por aqui.
            </p>
          </div>

          {/* Telefone */}
          <div>
            <label style={labelStyle}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Phone size={12} color={t.accent} /> Telefone / WhatsApp
              </span>
            </label>
            <input
              type="tel"
              value={telefone}
              onChange={e => setTelefone(e.target.value)}
              placeholder="(11) 99999-9999"
              style={inputStyle}
            />
          </div>

          {profileMsg && <Msg msg={profileMsg} />}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <SaveBtn loading={savingProfile} label="Salvar dados" />
          </div>
        </form>
      </div>

      {/* ── Seção: Segurança ──────────────────────────────────────── */}
      <div style={card}>
        {sectionTitle(<Lock size={16} />, 'Alterar senha')}

        <form onSubmit={handleSavePassword} className="space-y-4">
          {/* Nova senha */}
          <div>
            <label style={labelStyle}>Nova senha</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Mínimo 6 caracteres"
                style={{ ...inputStyle, paddingRight: 40, fontFamily: 'monospace' }}
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: t.text2, display: 'flex', padding: 0,
                }}
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirmar */}
          <div>
            <label style={labelStyle}>Confirmar nova senha</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                placeholder="Repita a nova senha"
                style={{ ...inputStyle, paddingRight: 40, fontFamily: 'monospace' }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: t.text2, display: 'flex', padding: 0,
                }}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Indicador de match */}
          {newPassword && confirmPassword && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12,
              color: newPassword === confirmPassword ? '#10b981' : '#ef4444',
            }}>
              {newPassword === confirmPassword
                ? <><CheckCircle2 size={13} /> Senhas coincidem</>
                : <><AlertCircle  size={13} /> Senhas não coincidem</>
              }
            </div>
          )}

          {pwdMsg && <Msg msg={pwdMsg} />}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <SaveBtn loading={savingPwd} label="Alterar senha" />
          </div>
        </form>
      </div>

    </div>
  )
}