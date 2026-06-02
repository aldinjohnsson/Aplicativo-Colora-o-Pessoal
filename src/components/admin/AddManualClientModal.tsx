// src/components/admin/AddManualClientModal.tsx
// Modal para cadastro manual de clientes — pula o fluxo de contrato/portal
// e coloca a cliente diretamente na etapa desejada.

import React, { useState, useEffect, useRef } from 'react'
import {
  X, UserPlus, ChevronDown, Check, Loader2,
  User, Mail, Phone, Calendar, FileText, Layers,
  AlertTriangle,
} from 'lucide-react'
import { adminService, Plan } from '../../lib/services'
import { useTheme } from '../../lib/theme'

// ─── Ordem e config das etapas (espelha ClientsManager) ──────────────────
const STAGE_OPTIONS: { key: string; label: string; color: string; desc: string }[] = [
  { key: 'awaiting_contract', label: 'Clientes',           color: '#f59e0b', desc: 'Aguardando assinar contrato' },
  { key: 'awaiting_form',     label: 'Assinou Contrato',   color: '#3b82f6', desc: 'Contrato assinado, formulário pendente' },
  { key: 'awaiting_photos',   label: 'Formulário Enviado', color: '#a855f7', desc: 'Formulário preenchido, fotos pendentes' },
  { key: 'photos_submitted',  label: 'Analisar Fotos',     color: '#ec4899', desc: 'Fotos enviadas, aguardando aprovação' },
  { key: 'in_analysis',       label: 'Análise',            color: '#f97316', desc: 'Em processo de análise de coloração' },
  { key: 'preparing_materials', label: 'Fazer Dossiê',     color: '#14b8a6', desc: 'Preparando materiais do dossiê' },
  { key: 'validating_materials', label: 'Validar Dossiê',  color: '#6366f1', desc: 'Dossiê em validação interna' },
  { key: 'sending_dossier',   label: 'Enviar Dossiê',      color: '#0ea5e9', desc: 'Pronto para enviar dossiê à cliente' },
  { key: 'awaiting_ai_photo', label: 'Aguardando Foto IA', color: '#a855f7', desc: 'Aguardando foto para simulação IA' },
  { key: 'simulating',        label: 'Simulações',         color: '#8b5cf6', desc: 'Criando simulações de imagem' },
  { key: 'making_capillary_dossier', label: 'Fazer Dossiê Capilar', color: '#10b981', desc: 'Preparando dossiê capilar' },
  { key: 'validating_capillary_dossier', label: 'Validar Dossiê Capilar', color: '#d946ef', desc: 'Validando dossiê capilar' },
  { key: 'sending_capillary_dossier', label: 'Enviar Dossiê Capilar', color: '#06b6d4', desc: 'Pronto para enviar dossiê capilar' },
  { key: 'completed',         label: 'Finalizado',         color: '#22c55e', desc: 'Processo concluído' },
]

interface Props {
  plans: Plan[]
  onClose: () => void
  onCreated: (clientId: string) => void
}

export function AddManualClientModal({ plans, onClose, onCreated }: Props) {
  const { theme: t } = useTheme()

  const [fullName,   setFullName]   = useState('')
  const [email,      setEmail]      = useState('')
  const [phone,      setPhone]      = useState('')
  const [birthDate,  setBirthDate]  = useState('')
  const [notes,      setNotes]      = useState('')
  const [planId,     setPlanId]     = useState('')
  const [initialStatus, setInitialStatus] = useState('awaiting_contract')

  const [planOpen,  setPlanOpen]  = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  const planDropRef  = useRef<HTMLDivElement>(null)
  const stageDropRef = useRef<HTMLDivElement>(null)

  // Fecha dropdowns ao clicar fora
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (planDropRef.current  && !planDropRef.current.contains(e.target as Node))  setPlanOpen(false)
      if (stageDropRef.current && !stageDropRef.current.contains(e.target as Node)) setStageOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Fecha com Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const selectedPlan  = plans.find(p => p.id === planId)
  const selectedStage = STAGE_OPTIONS.find(s => s.key === initialStatus)!

  const isSkippingStages = initialStatus !== 'awaiting_contract'

  const handleSubmit = async () => {
    if (!fullName.trim())  return setError('Nome completo é obrigatório.')
    if (!email.trim())     return setError('E-mail é obrigatório.')
    if (!birthDate)        return setError('Data de nascimento é obrigatória.')
    if (!planId)           return setError('Selecione um plano.')
    setError('')
    setSaving(true)
    try {
      // 1. Cria o cliente (sempre entra em awaiting_contract por padrão)
      const client = await adminService.createClient({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        birth_date: birthDate,
        plan_id: planId,
        notes: notes.trim(),
      } as any)

      // 2. Se a etapa escolhida não for a padrão, avança via jumpToStep
      if (initialStatus !== 'awaiting_contract') {
        await adminService.jumpToStep(client.id, initialStatus)
      }

      onCreated(client.id)
    } catch (e: any) {
      setError(e?.message || 'Erro ao criar cliente. Tente novamente.')
      setSaving(false)
    }
  }

  // ── Helpers de estilo ────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 9,
    border: `1.5px solid ${t.border}`, background: t.surface2,
    fontSize: 13, color: t.text, outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700,
    color: t.text3, textTransform: 'uppercase', letterSpacing: 0.7,
    marginBottom: 5,
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <div
        style={{
          width: '100%', maxWidth: 540,
          background: t.surface, borderRadius: 18,
          border: `1px solid ${t.border}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
          display: 'flex', flexDirection: 'column',
          maxHeight: '92dvh', overflow: 'hidden',
          animation: 'modalSlideIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <style>{`
          @keyframes modalSlideIn {
            from { opacity: 0; transform: scale(0.93) translateY(10px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '18px 20px 14px',
          borderBottom: `1px solid ${t.border}`,
          flexShrink: 0,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: 'linear-gradient(135deg, #e91e63, #f06292)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(233,30,99,0.28)',
          }}>
            <UserPlus size={18} color="white" />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: t.text, letterSpacing: -0.3 }}>
              Cadastro Manual
            </p>
            <p style={{ margin: 0, fontSize: 12, color: t.text3, marginTop: 1 }}>
              Adiciona cliente direto, sem passar pelo portal
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 6, borderRadius: 8, color: t.text3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = t.surface2)}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Form body ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Nome */}
            <div>
              <label style={labelStyle}>
                <User size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                Nome Completo *
              </label>
              <input
                style={inputStyle}
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Ex: Maria Silva Santos"
                autoFocus
                onFocus={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.boxShadow = `0 0 0 3px ${t.accent}22` }}
                onBlur={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            {/* E-mail + Telefone lado a lado */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>
                  <Mail size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  E-mail *
                </label>
                <input
                  style={inputStyle}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                  onFocus={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.boxShadow = `0 0 0 3px ${t.accent}22` }}
                  onBlur={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.boxShadow = 'none' }}
                />
              </div>
              <div>
                <label style={labelStyle}>
                  <Phone size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  Telefone
                </label>
                <input
                  style={inputStyle}
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="(00) 00000-0000"
                  onFocus={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.boxShadow = `0 0 0 3px ${t.accent}22` }}
                  onBlur={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.boxShadow = 'none' }}
                />
              </div>
            </div>

            {/* Data de nascimento */}
            <div>
              <label style={labelStyle}>
                <Calendar size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                Data de Nascimento *
              </label>
              <input
                style={inputStyle}
                type="date"
                value={birthDate}
                onChange={e => setBirthDate(e.target.value)}
                onFocus={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.boxShadow = `0 0 0 3px ${t.accent}22` }}
                onBlur={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            {/* Plano */}
            <div ref={planDropRef} style={{ position: 'relative' }}>
              <label style={labelStyle}>
                <FileText size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                Plano *
              </label>
              <button
                onClick={() => setPlanOpen(v => !v)}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 9,
                  border: `1.5px solid ${planOpen ? t.accent : t.border}`,
                  background: t.surface2, fontSize: 13, color: selectedPlan ? t.text : t.text3,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  outline: 'none', boxSizing: 'border-box',
                  boxShadow: planOpen ? `0 0 0 3px ${t.accent}22` : 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                  textAlign: 'left',
                }}
              >
                <span>{selectedPlan ? selectedPlan.name : 'Selecione um plano…'}</span>
                <ChevronDown size={14} style={{ color: t.text3, flexShrink: 0, transform: planOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
              </button>
              {planOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
                  background: t.surface, border: `1.5px solid ${t.accent}`,
                  borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                  overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
                }}>
                  {plans.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: 13, color: t.text3 }}>Nenhum plano ativo.</div>
                  ) : plans.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setPlanId(p.id); setPlanOpen(false) }}
                      style={{
                        width: '100%', padding: '10px 14px', border: 'none',
                        background: planId === p.id ? t.accentLight : 'none',
                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', gap: 8,
                        fontSize: 13, color: planId === p.id ? t.accent : t.text,
                        fontWeight: planId === p.id ? 700 : 400, textAlign: 'left',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (planId !== p.id) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                      onMouseLeave={e => { if (planId !== p.id) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                    >
                      <span>{p.name}</span>
                      {planId === p.id && <Check size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Etapa inicial */}
            <div ref={stageDropRef} style={{ position: 'relative' }}>
              <label style={labelStyle}>
                <Layers size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                Etapa Inicial
              </label>
              <button
                onClick={() => setStageOpen(v => !v)}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 9,
                  border: `1.5px solid ${stageOpen ? t.accent : t.border}`,
                  background: t.surface2, fontSize: 13, color: t.text,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 8,
                  outline: 'none', boxSizing: 'border-box',
                  boxShadow: stageOpen ? `0 0 0 3px ${t.accent}22` : 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: selectedStage.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{selectedStage.label}</span>
                  <span style={{ fontSize: 11, color: t.text3, fontWeight: 400 }}>{selectedStage.desc}</span>
                </div>
                <ChevronDown size={14} style={{ color: t.text3, flexShrink: 0, transform: stageOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
              </button>
              {stageOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
                  background: t.surface, border: `1.5px solid ${t.accent}`,
                  borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                  overflow: 'hidden', maxHeight: 300, overflowY: 'auto',
                }}>
                  {STAGE_OPTIONS.map((stage, idx) => (
                    <button
                      key={stage.key}
                      onClick={() => { setInitialStatus(stage.key); setStageOpen(false) }}
                      style={{
                        width: '100%', padding: '9px 14px', border: 'none',
                        borderTop: idx > 0 ? `1px solid ${t.border}` : 'none',
                        background: initialStatus === stage.key ? t.accentLight : 'none',
                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                        gap: 10, textAlign: 'left', transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (initialStatus !== stage.key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                      onMouseLeave={e => { if (initialStatus !== stage.key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                    >
                      <div style={{ width: 9, height: 9, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: initialStatus === stage.key ? 700 : 500, color: initialStatus === stage.key ? t.accent : t.text, display: 'block' }}>
                          {stage.label}
                        </span>
                        <span style={{ fontSize: 11, color: t.text3 }}>{stage.desc}</span>
                      </div>
                      {initialStatus === stage.key && <Check size={13} color={t.accent} style={{ flexShrink: 0 }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Aviso quando pula etapas */}
            {isSkippingStages && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '11px 14px', borderRadius: 10,
                background: 'rgba(245,158,11,0.09)',
                border: '1.5px solid rgba(245,158,11,0.3)',
              }}>
                <AlertTriangle size={15} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                  A cliente será criada diretamente em <strong>{selectedStage.label}</strong>.
                  As etapas anteriores serão marcadas como cumpridas — sem contrato, formulário ou fotos reais salvas.
                </p>
              </div>
            )}

            {/* Observações */}
            <div>
              <label style={labelStyle}>Observações internas</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Opcional -  anotações visíveis só para a equipe…"
                onFocus={e => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = t.accent; (e.currentTarget as HTMLTextAreaElement).style.boxShadow = `0 0 0 3px ${t.accent}22` }}
                onBlur={e => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = t.border; (e.currentTarget as HTMLTextAreaElement).style.boxShadow = 'none' }}
              />
            </div>

          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: '14px 20px',
          borderTop: `1px solid ${t.border}`,
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {/* Badge "manual" */}
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
            background: 'rgba(99,102,241,0.12)', color: '#6366f1',
            border: '1px solid rgba(99,102,241,0.25)', letterSpacing: 0.5,
            textTransform: 'uppercase', flexShrink: 0,
          }}>
            🔧 Cadastro manual
          </span>

          <div style={{ flex: 1 }} />

          {error && (
            <p style={{ margin: 0, fontSize: 12, color: '#ef4444', textAlign: 'right', flex: 1 }}>
              {error}
            </p>
          )}

          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '9px 18px', borderRadius: 9,
              border: `1px solid ${t.border}`, background: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 500, color: t.text2,
              transition: 'background 0.15s', flexShrink: 0,
              opacity: saving ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (!saving) (e.currentTarget.style.background = t.surface2) }}
            onMouseLeave={e => { (e.currentTarget.style.background = 'none') }}
          >
            Cancelar
          </button>

          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '9px 20px', borderRadius: 9, border: 'none',
              background: saving ? '#f9a8d4' : 'linear-gradient(135deg, #e91e63, #f06292)',
              color: 'white', cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 700, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 7,
              boxShadow: saving ? 'none' : '0 4px 14px rgba(233,30,99,0.28)',
              transition: 'filter 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'none' }}
          >
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Criando…</>
              : <><UserPlus size={14} /> Criar Cliente</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}