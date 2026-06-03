// src/components/admin/StageController.tsx
import React, { useState } from 'react'
import {
  Check, FileText, ClipboardList, Camera, Eye, Sparkles, Package,
  ChevronRight, RotateCcw, ArrowRight, X, AlertTriangle, Loader2, Unlock, Lock, Calendar,
  Shuffle,
} from 'lucide-react'
import { adminService } from '../../lib/services'
import { notifyClientCompleted } from '../../lib/whatsappService'
import { supabase } from '../../lib/supabase'
import { useTheme } from '../../lib/theme'

// ─── Config ────────────────────────────────────────────────────────────────

type StepKey = 'contract' | 'form' | 'photos' | 'review' | 'analysis' | 'materials' | 'validate_materials' | 'send_dossier' | 'ai_photo' | 'simulations' | 'make_capillary' | 'validate_capillary' | 'send_capillary' | 'result'
type ReopenKey = 'contract' | 'form' | 'photos' | 'review' | 'analysis' | 'materials' | 'validate_materials' | 'send_dossier' | 'ai_photo' | 'simulations' | 'make_capillary' | 'validate_capillary' | 'send_capillary' | 'result'

interface StepDef {
  key: StepKey
  label: string
  icon: React.ElementType
  dotColor: string
  activeBg: string
  activeBorder: string
  activeStatus: string
  doneStatuses: string[]
  reopenKey: ReopenKey
}

const STEPS: StepDef[] = [
  {
    key: 'contract', label: 'Contrato', icon: FileText,
    dotColor: '#f59e0b',
    activeBg: 'rgba(245,158,11,0.12)',
    activeBorder: 'rgba(245,158,11,0.35)',
    activeStatus: 'awaiting_contract',
    doneStatuses: ['awaiting_form', 'awaiting_photos', 'photos_submitted', 'in_analysis', 'preparing_materials', 'validating_materials', 'sending_dossier', 'awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'contract',
  },
  {
    key: 'form', label: 'Formulário', icon: ClipboardList,
    dotColor: '#3b82f6',
    activeBg: 'rgba(59,130,246,0.12)',
    activeBorder: 'rgba(59,130,246,0.35)',
    activeStatus: 'awaiting_form',
    doneStatuses: ['awaiting_photos', 'photos_submitted', 'in_analysis', 'preparing_materials', 'validating_materials', 'sending_dossier', 'awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'form',
  },
  {
    key: 'photos', label: 'Fotos', icon: Camera,
    dotColor: '#a855f7',
    activeBg: 'rgba(168,85,247,0.12)',
    activeBorder: 'rgba(168,85,247,0.35)',
    activeStatus: 'awaiting_photos',
    doneStatuses: ['photos_submitted', 'in_analysis', 'preparing_materials', 'validating_materials', 'sending_dossier', 'awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'photos',
  },
  {
    key: 'review', label: 'Revisão', icon: Eye,
    dotColor: '#ec4899',
    activeBg: 'rgba(236,72,153,0.12)',
    activeBorder: 'rgba(236,72,153,0.35)',
    activeStatus: 'photos_submitted',
    doneStatuses: ['in_analysis', 'preparing_materials', 'validating_materials', 'sending_dossier', 'awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'review',
  },
  {
    key: 'analysis', label: 'Análise', icon: Sparkles,
    dotColor: '#f97316',
    activeBg: 'rgba(249,115,22,0.12)',
    activeBorder: 'rgba(249,115,22,0.35)',
    activeStatus: 'in_analysis',
    doneStatuses: ['preparing_materials', 'validating_materials', 'sending_dossier', 'awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'analysis',
  },
  {
    key: 'materials', label: 'Preparando Materiais', icon: Package,
    dotColor: '#14b8a6',
    activeBg: 'rgba(20,184,166,0.12)',
    activeBorder: 'rgba(20,184,166,0.35)',
    activeStatus: 'preparing_materials',
    doneStatuses: ['validating_materials', 'sending_dossier', 'awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'materials',
  },
  {
    key: 'validate_materials', label: 'Validar Dossiê', icon: ClipboardList,
    dotColor: '#6366f1',
    activeBg: 'rgba(99,102,241,0.12)',
    activeBorder: 'rgba(99,102,241,0.35)',
    activeStatus: 'validating_materials',
    doneStatuses: ['sending_dossier', 'awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'validate_materials',
  },
  {
    key: 'send_dossier', label: 'Enviar Dossiê', icon: Package,
    dotColor: '#0ea5e9',
    activeBg: 'rgba(14,165,233,0.12)',
    activeBorder: 'rgba(14,165,233,0.35)',
    activeStatus: 'sending_dossier',
    doneStatuses: ['awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'send_dossier',
  },
  {
    // ETAPA CONDICIONAL — só aparece como ativa se o plano tem categoria
    // de foto com is_ai_simulation=true. Se não tem, advanceStep do backend
    // pula direto pra 'simulating'. A coluna existe sempre no kanban; o
    // bloqueio é feito no front (handleDrop / handleAdvance).
    //
    // É AQUI que a admin libera o resultado parcial pra cliente — porque é
    // a etapa em que a cliente passa a ver o parcial no portal e ela própria
    // envia a foto adicional. Quando o plano não tem IA, a liberação acontece
    // no step 'simulations' (caminho equivalente).
    key: 'ai_photo', label: 'Aguardando Foto IA', icon: Camera,
    dotColor: '#a855f7',
    activeBg: 'rgba(168,85,247,0.12)',
    activeBorder: 'rgba(168,85,247,0.35)',
    activeStatus: 'awaiting_ai_photo',
    doneStatuses: ['simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'ai_photo',
  },
  {
    key: 'simulations', label: 'Simulações', icon: Sparkles,
    dotColor: '#8b5cf6',
    activeBg: 'rgba(139,92,246,0.12)',
    activeBorder: 'rgba(139,92,246,0.35)',
    activeStatus: 'simulating',
    doneStatuses: ['making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'simulations',
  },
  {
    key: 'make_capillary', label: 'Fazer Dossiê Capilar', icon: FileText,
    dotColor: '#10b981',
    activeBg: 'rgba(16,185,129,0.12)',
    activeBorder: 'rgba(16,185,129,0.35)',
    activeStatus: 'making_capillary_dossier',
    doneStatuses: ['validating_capillary_dossier', 'sending_capillary_dossier', 'completed'],
    reopenKey: 'make_capillary',
  },
  {
    key: 'validate_capillary', label: 'Validar Dossiê Capilar', icon: ClipboardList,
    dotColor: '#d946ef',
    activeBg: 'rgba(217,70,239,0.12)',
    activeBorder: 'rgba(217,70,239,0.35)',
    activeStatus: 'validating_capillary_dossier',
    doneStatuses: ['sending_capillary_dossier', 'completed'],
    reopenKey: 'validate_capillary',
  },
  {
    key: 'send_capillary', label: 'Enviar Dossiê Capilar', icon: Package,
    dotColor: '#06b6d4',
    activeBg: 'rgba(6,182,212,0.12)',
    activeBorder: 'rgba(6,182,212,0.35)',
    activeStatus: 'sending_capillary_dossier',
    doneStatuses: ['completed'],
    reopenKey: 'send_capillary',
  },
  {
    key: 'result', label: 'Resultado', icon: Check,
    dotColor: '#22c55e',
    activeBg: 'rgba(34,197,94,0.12)',
    activeBorder: 'rgba(34,197,94,0.35)',
    activeStatus: 'completed',
    doneStatuses: [],
    reopenKey: 'result',
  },
]

// ─── Helpers de data ────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return null }
}

/**
 * Retorna a data de conclusão de uma etapa:
 *  - contract  → contract.signed_at
 *  - form      → formSubmission.submitted_at
 *  - photos    → deadline.photos_sent_at (data que a cliente enviou as fotos)
 *  - demais    → stage_timestamps[stepKey] (gravado automaticamente ao avançar)
 */
function getStepDate(
  stepKey: StepKey,
  contract: any,
  formSubmission: any,
  deadline: any,
  stageTimestamps: Record<string, string>,
): string | null {
  if (stepKey === 'contract') return contract?.signed_at ?? null
  if (stepKey === 'form') return formSubmission?.submitted_at ?? null
  if (stepKey === 'photos') return deadline?.photos_sent_at ?? null
  return stageTimestamps[stepKey] ?? null
}

// ─── Modal de confirmação de reabertura ────────────────────────────────────

function ReopenModal({
  open, stepLabel, fromCompleted, onCancel, onConfirm,
}: {
  open: boolean
  stepLabel: string
  fromCompleted: boolean
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const { theme: t } = useTheme()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await onConfirm(reason.trim())
      setReason('')
    } catch (e: any) {
      alert(e?.message || 'Erro ao reabrir etapa')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        style={{ background: t.surface, border: `1px solid ${t.border}` }}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <RotateCcw className="h-5 w-5 flex-shrink-0" />
            <p className="font-semibold text-sm">Reabrir etapa: {stepLabel}</p>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20" disabled={submitting}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-3">
          <p className="text-sm" style={{ color: t.text2 }}>
            A cliente voltará para esta etapa e verá os dados atuais em modo de edição.
            <strong style={{ color: t.text }}> Nada é apagado</strong> — ela decide o que manter e o que trocar.
          </p>

          {fromCompleted && (
            <div
              className="rounded-lg p-3 flex gap-2 text-xs"
              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', color: '#b45309' }}
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <p>
                Esta cliente estava com o resultado liberado. Ao reabrir, o resultado deixa de ser
                exibido no portal. Ele será mostrado de novo quando você avançar até "Concluído".
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: t.text2 }}>
              Motivo (opcional)
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Ex: Preciso adicionar um campo novo ao formulário…"
              maxLength={500}
              className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none resize-none"
              style={{
                background: t.surface2,
                border: `1px solid ${t.border}`,
                color: t.text,
              }}
            />
            <p className="text-[10px] text-right mt-1" style={{ color: t.text3 }}>
              {reason.length}/500
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 flex gap-3"
          style={{ borderTop: `1px solid ${t.border}` }}
        >
          <button
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{
              background: t.surface2,
              border: `1px solid ${t.border}`,
              color: t.text2,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Reabrindo…</>
              : <><RotateCcw className="h-4 w-4" /> Reabrir</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Mover para etapa específica ────────────────────────────────────
//
// Diferente do ReopenModal (que volta etapas com confirmações específicas),
// este modal permite escolher QUALQUER etapa de destino — pra frente ou pra
// trás. Use jumpToStep no service, que muda só o status sem disparar
// efeitos colaterais (sem e-mails, sem cálculo de prazo, sem assinatura
// manual). Exceções tratadas no próprio jumpToStep:
//   - destino 'awaiting_contract' → hard reset (apaga TUDO)
//   - destino 'completed'         → libera resultado + e-mail final

function JumpToStepModal({
  open, currentStatus, planHasAiPhoto, clientName, onCancel, onConfirm,
}: {
  open: boolean
  currentStatus: string
  planHasAiPhoto: boolean
  clientName: string
  onCancel: () => void
  onConfirm: (targetStatus: string) => Promise<void>
}) {
  const { theme: t } = useTheme()
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const target = STEPS.find(s => s.activeStatus === selected) || null
  const currentIdx = STEPS.findIndex(s => s.activeStatus === currentStatus)
  const targetIdx = target ? STEPS.findIndex(s => s.key === target.key) : -1
  const goingForward = targetIdx > currentIdx
  const isHardReset = selected === 'awaiting_contract'
  const isReleaseFinal = selected === 'completed'

  const handleSubmit = async () => {
    if (!selected) return
    setSubmitting(true)
    try {
      await onConfirm(selected)
      setSelected(null)
    } catch (e: any) {
      alert(e?.message || 'Erro ao mover etapa')
    } finally {
      setSubmitting(false)
    }
  }

  // Mensagem contextual de acordo com a escolha
  const getContextMessage = (): { tone: 'danger' | 'info' | 'warn'; text: string } | null => {
    if (!target) return null
    if (isHardReset) {
      return {
        tone: 'danger',
        text: `Atenção: voltar para o contrato APAGA TUDO que ${clientName} já enviou (formulário, fotos, prazo, resultado e arquivos). Use só se for realmente recomeçar do zero.`,
      }
    }
    if (isReleaseFinal) {
      return {
        tone: 'info',
        text: `${clientName} será marcada como Concluída e o resultado será liberado no portal. Um e-mail de notificação será enviado pra ela.`,
      }
    }
    if (goingForward && targetIdx - currentIdx > 1) {
      return {
        tone: 'warn',
        text: `Vai pular ${targetIdx - currentIdx} etapas. As intermediárias ficam marcadas como concluídas, mas sem dados (sem prazo, sem fotos enviadas, sem e-mails). A cliente só vê a etapa atual no portal.`,
      }
    }
    if (!goingForward) {
      return {
        tone: 'info',
        text: `${clientName} volta para esta etapa. Os dados (formulário, fotos, prazo, resultado) ficam preservados — ela só ajusta o que precisar.`,
      }
    }
    return null
  }
  const ctx = getContextMessage()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
        style={{ background: t.surface, border: `1px solid ${t.border}`, maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-500 to-violet-500 text-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Shuffle className="h-5 w-5 flex-shrink-0" />
            <p className="font-semibold text-sm">Mover para etapa…</p>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20" disabled={submitting}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          <p className="text-xs leading-relaxed" style={{ color: t.text2 }}>
            Escolha a etapa de destino. Ela substitui a etapa atual sem disparar
            e-mails automáticos ou cálculo de prazo das etapas intermediárias —
            é um pulo direto.
          </p>

          {/* Lista de etapas */}
          <div className="space-y-1.5">
            {STEPS.map((step, idx) => {
              const isCurrent = step.activeStatus === currentStatus
              const isSelected = selected === step.activeStatus
              const isAiPhoto = step.key === 'ai_photo'
              const isContract = step.activeStatus === 'awaiting_contract'
              const isCompleted = step.activeStatus === 'completed'

              return (
                <button
                  key={step.key}
                  onClick={() => !isCurrent && setSelected(step.activeStatus)}
                  disabled={isCurrent || submitting}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all disabled:cursor-not-allowed"
                  style={{
                    background: isSelected
                      ? step.activeBg
                      : isCurrent
                        ? t.surface2
                        : 'transparent',
                    border: isSelected
                      ? `1.5px solid ${step.activeBorder}`
                      : `1px solid ${t.border}`,
                    opacity: isCurrent ? 0.55 : 1,
                  }}
                  onMouseEnter={e => {
                    if (!isCurrent && !isSelected) e.currentTarget.style.background = t.surface2
                  }}
                  onMouseLeave={e => {
                    if (!isCurrent && !isSelected) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                    style={{
                      background: isSelected ? step.dotColor : t.surface2,
                      color: isSelected ? '#fff' : t.text2,
                      border: isSelected ? 'none' : `1px solid ${t.border}`,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium" style={{ color: t.text }}>
                        {step.label}
                      </p>
                      {isCurrent && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={{ background: t.accent, color: t.accentFg }}
                        >
                          atual
                        </span>
                      )}
                      {isAiPhoto && !planHasAiPhoto && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(156,163,175,0.18)', color: '#6b7280', border: '1px solid rgba(156,163,175,0.3)' }}
                        >
                          plano sem IA
                        </span>
                      )}
                      {isContract && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(239,68,68,0.15)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.3)' }}
                        >
                          ⚠ apaga tudo
                        </span>
                      )}
                      {isCompleted && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(34,197,94,0.15)', color: '#15803d', border: '1px solid rgba(34,197,94,0.3)' }}
                        >
                          libera resultado
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Aviso contextual */}
          {ctx && (
            <div
              className="rounded-lg p-3 flex gap-2 text-xs leading-relaxed"
              style={
                ctx.tone === 'danger'
                  ? { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#b91c1c' }
                  : ctx.tone === 'warn'
                  ? { background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#b45309' }
                  : { background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#4338ca' }
              }
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <p>{ctx.text}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 flex gap-3 flex-shrink-0"
          style={{ borderTop: `1px solid ${t.border}` }}
        >
          <button
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{
              background: t.surface2,
              border: `1px solid ${t.border}`,
              color: t.text2,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selected}
            className="flex-1 py-2.5 text-white rounded-xl text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
            style={{
              background: isHardReset ? '#dc2626' : '#6366f1',
            }}
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Movendo…</>
              : isHardReset
                ? <><AlertTriangle className="h-4 w-4" /> Recomeçar do zero</>
                : <><Shuffle className="h-4 w-4" /> Mover</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

interface StageControllerProps {
  client: {
    id: string
    status: string
    full_name: string
    /** JSONB gravado automaticamente pelo StageController ao avançar etapas */
    stage_timestamps?: Record<string, string>
  }
  contract: any
  formSubmission: any
  photos: any[]
  result: any
  /** Dados de prazo — usado para exibir a data de envio de fotos */
  deadline?: { photos_sent_at?: string; deadline_date?: string } | null
  /** True se o plano da cliente tem categoria de foto com is_ai_simulation=true.
   *  Quando true, a etapa "Aguardando Foto IA" é onde o parcial é liberado.
   *  Quando false, a etapa é pulada e o parcial é liberado em "Simulações". */
  planHasAiPhoto?: boolean
  onChange: () => void | Promise<void>
}

export function StageController({
  client, contract, formSubmission, photos, result, deadline, planHasAiPhoto = false, onChange,
}: StageControllerProps) {
  const { theme: t } = useTheme()
  const [reopenTarget, setReopenTarget] = useState<StepDef | null>(null)
  const [jumpModalOpen, setJumpModalOpen] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [releasingPartial, setReleasingPartial] = useState(false)
  const [cancelingPartial, setCancelingPartial] = useState(false)
  const [revokingResult, setRevokingResult] = useState(false)

  const currentIdx = STEPS.findIndex(s => s.activeStatus === client.status)
  const fromCompleted = client.status === 'completed'
  const stageTimestamps: Record<string, string> = client.stage_timestamps || {}

  // ─── Grava timestamp no Supabase para a etapa recém-concluída ────────────
  // DEFENSIVO: se a coluna stage_timestamps ainda não existir no banco
  // (migration pendente), o erro é silenciado para não bloquear o fluxo.
  const recordTimestamp = async (stepKey: StepKey) => {
    // contract/form/photos têm datas próprias — não precisam de registro manual
    if (stepKey === 'contract' || stepKey === 'form' || stepKey === 'photos') return
    try {
      const updated = { ...stageTimestamps, [stepKey]: new Date().toISOString() }
      const { error } = await supabase
        .from('clients')
        .update({ stage_timestamps: updated })
        .eq('id', client.id)
      if (error) {
        if (error.message?.includes('stage_timestamps') || error.code === '42703') {
          console.warn('[StageController] stage_timestamps não existe no banco — execute a migration')
        } else {
          throw error
        }
      }
    } catch (e: any) {
      if (e?.message?.includes('stage_timestamps') || e?.code === '42703') {
        console.warn('[StageController] stage_timestamps não existe no banco — execute a migration')
      } else {
        throw e
      }
    }
  }

  // ─── Remove timestamps da etapa reaberta em diante ──────────────────────
  // DEFENSIVO: mesmo tratamento de coluna inexistente.
  const clearTimestampsFrom = async (stepKey: StepKey) => {
    const fromIdx = STEPS.findIndex(s => s.key === stepKey)
    if (fromIdx < 0) return
    try {
      const keysToRemove = STEPS.slice(fromIdx).map(s => s.key)
      const updated = { ...stageTimestamps }
      keysToRemove.forEach(k => delete updated[k])
      const { error } = await supabase
        .from('clients')
        .update({ stage_timestamps: updated })
        .eq('id', client.id)
      if (error) {
        if (error.message?.includes('stage_timestamps') || error.code === '42703') {
          console.warn('[StageController] stage_timestamps não existe no banco — execute a migration')
        } else {
          throw error
        }
      }
    } catch (e: any) {
      if (e?.message?.includes('stage_timestamps') || e?.code === '42703') {
        console.warn('[StageController] stage_timestamps não existe no banco — execute a migration')
      } else {
        throw e
      }
    }
  }

  const handleReopen = async (reason: string) => {
    if (!reopenTarget) return
    await adminService.reopenStep(client.id, reopenTarget.reopenKey, reason || undefined)
    await clearTimestampsFrom(reopenTarget.key)
    setReopenTarget(null)
    await onChange()
  }

  // Pulo direto pra qualquer etapa — silencioso (sem e-mails/efeitos
  // colaterais), exceto quando destino é 'awaiting_contract' (hard reset)
  // ou 'completed' (libera resultado + e-mail final). Lógica está no
  // adminService.jumpToStep.
  const handleJumpToStep = async (targetStatus: string) => {
    await adminService.jumpToStep(client.id, targetStatus)
    if (targetStatus === 'completed') notifyClientCompleted(client.id)
    setJumpModalOpen(false)
    await onChange()
  }

  const handleAdvance = async () => {
    const nextStep = STEPS[currentIdx + 1]
    if (!nextStep) return
    if (client.status === 'awaiting_form' && !formSubmission) {
      if (!confirm('A cliente ainda não enviou o formulário.\n\nTem certeza que quer avançar pulando essa etapa?')) return
    }
    if (client.status === 'awaiting_photos' && photos.length === 0) {
      if (!confirm('A cliente ainda não enviou fotos.\n\nTem certeza que quer avançar pulando essa etapa?')) return
    }
    if (client.status === 'photos_submitted') {
      if (!confirm(`Aprovar fotos de ${client.full_name} e iniciar análise?\n\nIsso calcula o prazo e envia e-mail para a cliente.`)) return
    }
    if (client.status === 'in_analysis') {
      if (!confirm('Mover para "Preparando Materiais"? O resultado ainda não será liberado para a cliente.')) return
    }
    if (client.status === 'preparing_materials') {
      if (!confirm('Mover para "Validar Materiais"? Esta etapa é interna — a cliente continua vendo "Preparando Materiais".')) return
    }
    if (client.status === 'validating_materials') {
      if (!confirm('Mover para "Enviar Dossiê"? Esta etapa é interna — a cliente continua vendo "Preparando Materiais".')) return
    }
    if (client.status === 'sending_dossier') {
      if (planHasAiPhoto) {
        if (!confirm('Mover para "Aguardando Foto IA"? A cliente passa a ver o resultado parcial (se já liberado) e pode enviar a foto pra simulação. Esta etapa só existe porque o plano dela inclui Foto IA.')) return
      } else {
        if (!confirm('Mover para "Simulações"? Esta etapa é interna — a cliente continua vendo "Preparando Materiais".\n\n(O plano desta cliente não tem etapa de Foto IA, então ela é pulada automaticamente.)')) return
      }
    }
    if (client.status === 'awaiting_ai_photo') {
      const aiPhotoSent = photos?.length > 0
      if (!aiPhotoSent) {
        if (!confirm('A cliente ainda não enviou a foto para simulação.\n\nTem certeza que quer avançar mesmo assim?')) return
      } else {
        if (!confirm('Mover para "Simulações"? A cliente passa a ver "simulações em andamento". Use isso depois de validar a foto enviada.')) return
      }
    }
    if (client.status === 'simulating') {
      if (!confirm('Mover para "Fazer Dossiê Capilar"? Esta etapa é interna — a cliente passa a ver "simulações sendo feitas". O resultado AINDA NÃO é liberado.')) return
    }
    if (client.status === 'making_capillary_dossier') {
      if (!confirm('Mover para "Validar Dossiê Capilar"? Esta etapa é interna — a cliente continua vendo "simulações sendo feitas".')) return
    }
    if (client.status === 'validating_capillary_dossier') {
      if (!confirm('Mover para "Enviar Dossiê Capilar"? Esta etapa é interna — a cliente continua vendo "simulações sendo feitas".')) return
    }
    if (client.status === 'sending_capillary_dossier') {
      if (!confirm('Liberar o resultado para a cliente? Isso enviará e-mail de notificação.')) return
    }

    setAdvancing(true)
    try {
      // Grava a data de conclusão da etapa atual antes de avançar
      const currentStep = STEPS[currentIdx]
      await recordTimestamp(currentStep.key)
      await adminService.advanceStep(client.id)
      if (nextStep?.activeStatus === 'completed') notifyClientCompleted(client.id)
      await onChange()
    } catch (e: any) {
      alert(e?.message || 'Erro ao avançar etapa')
    } finally {
      setAdvancing(false)
    }
  }

  const canAdvance = currentIdx >= 0 && currentIdx < STEPS.length - 1

  const handleReleasePartial = async () => {
    if (!confirm(`Liberar resultado parcial para ${client.full_name}?\n\nA cliente poderá ver o resultado no portal, mas a etapa de Simulações continuará aberta internamente.\n\nIsso enviará e-mail de notificação.`)) return
    setReleasingPartial(true)
    try {
      await adminService.releasePartialResult(client.id)
      await onChange()
    } catch (e: any) {
      alert(e?.message || 'Erro ao liberar resultado parcial')
    } finally {
      setReleasingPartial(false)
    }
  }

  const handleCancelPartial = async () => {
    if (!confirm(`Cancelar a prévia do resultado para ${client.full_name}?\n\nO resultado deixará de aparecer no portal até você liberar novamente.`)) return
    setCancelingPartial(true)
    try {
      await adminService.cancelPartialResult(client.id)
      await onChange()
    } catch (e: any) {
      alert(e?.message || 'Erro ao cancelar resultado parcial')
    } finally {
      setCancelingPartial(false)
    }
  }

  const handleRevokeResult = async () => {
    if (!confirm(`Revogar o resultado de ${client.full_name}?\n\nO resultado deixará de aparecer no portal e a etapa voltará para "Enviar Dossiê Capilar". Os dados (pasta, arquivos e observações) ficam intactos — basta avançar até "Resultado" novamente quando estiver pronto.`)) return
    setRevokingResult(true)
    try {
      await adminService.revokeResult(client.id)
      await onChange()
    } catch (e: any) {
      alert(e?.message || 'Erro ao revogar resultado')
    } finally {
      setRevokingResult(false)
    }
  }

  return (
    <div
      className="md:col-span-2 rounded-xl p-5"
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        transition: 'background 0.25s ease, border-color 0.25s ease',
      }}
    >
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold flex items-center gap-2" style={{ color: t.text }}>
            <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: t.text2 }} />
            Controle de etapas
          </h3>
          <p className="text-xs mt-0.5 leading-snug" style={{ color: t.text2 }}>
            Avance ou volte etapas manualmente. Ao voltar, os dados ficam preservados, a cliente só ajusta o que precisar.
          </p>
        </div>

        {/* Botões de ação no header. Layout responsivo: empilha em mobile,
            lado a lado em sm+. O "Mover para…" sempre aparece (admin pode
            pular pra qualquer etapa, inclusive quando não há próxima). */}
        <div className="flex flex-col sm:flex-row gap-2 sm:flex-shrink-0">
          <button
            onClick={() => setJumpModalOpen(true)}
            className="flex items-center justify-center gap-2 px-3 py-2.5 sm:py-2 rounded-lg text-xs font-medium transition-colors"
            style={{
              border: `1px solid ${t.border}`,
              color: t.text2,
              background: t.surface2,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = t.surface)}
            onMouseLeave={e => (e.currentTarget.style.background = t.surface2)}
            title="Pular para qualquer etapa (pra frente ou pra trás)"
          >
            <Shuffle className="h-3.5 w-3.5 flex-shrink-0" />
            Mover para…
          </button>

          {canAdvance && (
            <button
              onClick={handleAdvance}
              disabled={advancing}
              className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 text-left"
              style={{ wordBreak: 'break-word' }}
            >
              {advancing
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" /> Avançando…</>
                : <><ArrowRight className="h-3.5 w-3.5 flex-shrink-0" /> <span>Avançar para <strong>"{STEPS[currentIdx + 1]?.label}"</strong></span></>}
            </button>
          )}
        </div>
      </div>

      {/* Steps list */}
      <div className="space-y-2">
        {STEPS.map((step, idx) => {
          const isDone = step.doneStatuses.includes(client.status)
          const isCurrent = step.activeStatus === client.status
          const isFuture = !isDone && !isCurrent
          const canReopen = isDone || (isCurrent && step.key === 'result')
          const Icon = step.icon

          // Data de conclusão desta etapa
          const stepDateIso = isDone
            ? getStepDate(step.key, contract, formSubmission, deadline, stageTimestamps)
            : null
          const stepDateFmt = fmtDate(stepDateIso)

          // Dot styles
          const dotStyle: React.CSSProperties = isDone
            ? { background: '#22c55e', color: '#fff' }
            : isCurrent
            ? { background: step.dotColor, color: '#fff', boxShadow: `0 0 0 4px ${step.dotColor}33` }
            : { background: t.surface2, color: t.text3 }

          // Container styles
          const containerStyle: React.CSSProperties = isCurrent
            ? { background: step.activeBg, border: `1px solid ${step.activeBorder}` }
            : isDone
            ? { background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)' }
            : { background: t.surface2, border: `1px solid ${t.border}` }

          return (
            <div
              key={step.key}
              className="flex items-start gap-3 p-3 rounded-lg transition-colors"
              style={containerStyle}
            >
              {/* Dot */}
              <div
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={dotStyle}
              >
                {isDone
                  ? <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  : <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
              </div>

              {/* Label + badges + data — stacks on mobile */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p
                    className="text-sm font-medium"
                    style={{ color: isFuture ? t.text3 : t.text }}
                  >
                    {idx + 1}. {step.label}
                  </p>

                  {isCurrent && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: t.accent, color: t.accentFg }}
                    >
                      atual
                    </span>
                  )}

                  {isDone && (
                    <span className="text-[10px] font-medium" style={{ color: '#16a34a' }}>
                      concluída
                    </span>
                  )}

                  {/* Data de conclusão — exibida inline para etapas concluídas */}
                  {isDone && stepDateFmt && (
                    <span
                      className="text-[10px] flex items-center gap-0.5"
                      style={{ color: t.text3 }}
                    >
                      <Calendar className="h-2.5 w-2.5" />
                      {stepDateFmt}
                    </span>
                  )}

                  {step.key === 'validate_materials' && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(99,102,241,0.18)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.3)' }}
                    >
                      🔒 interno
                    </span>
                  )}
                  {step.key === 'send_dossier' && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(14,165,233,0.18)', color: '#0369a1', border: '1px solid rgba(14,165,233,0.3)' }}
                    >
                      🔒 interno
                    </span>
                  )}
                  {step.key === 'ai_photo' && (
                    planHasAiPhoto ? (
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(168,85,247,0.18)', color: '#7e22ce', border: '1px solid rgba(168,85,247,0.3)' }}
                      >
                        ✨ condicional
                      </span>
                    ) : isCurrent ? (
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(168,85,247,0.18)', color: '#7e22ce', border: '1px solid rgba(168,85,247,0.3)' }}
                        title="Plano não tem Foto IA, mas você ativou esta etapa manualmente"
                      >
                        🛠 manual
                      </span>
                    ) : (
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(156,163,175,0.18)', color: '#6b7280', border: '1px solid rgba(156,163,175,0.3)' }}
                      >
                        ⏭ pulada (plano sem IA)
                      </span>
                    )
                  )}
                  {step.key === 'simulations' && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(139,92,246,0.18)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }}
                    >
                      🔒 interno
                    </span>
                  )}
                  {step.key === 'make_capillary' && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(16,185,129,0.18)', color: '#059669', border: '1px solid rgba(16,185,129,0.3)' }}
                    >
                      🔒 interno
                    </span>
                  )}
                  {step.key === 'validate_capillary' && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(217,70,239,0.18)', color: '#a21caf', border: '1px solid rgba(217,70,239,0.3)' }}
                    >
                      🔒 interno
                    </span>
                  )}
                  {step.key === 'send_capillary' && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(6,182,212,0.18)', color: '#0e7490', border: '1px solid rgba(6,182,212,0.3)' }}
                    >
                      🔒 interno
                    </span>
                  )}
                </div>

                {/* Botão de liberação/cancelamento parcial.
                    Aparece em 'ai_photo' OU 'simulations' quando for a etapa
                    atual, independente do plano. Antes era condicional ao
                    planHasAiPhoto, mas com o pulo livre a admin pode usar
                    qualquer das duas etapas — então liberar parcial funciona
                    em ambas. */}
                {(
                  (step.key === 'ai_photo' && isCurrent) ||
                  (step.key === 'simulations' && isCurrent)
                ) && (
                  <div className="mt-2">
                    {result?.is_released ? (
                      <button
                        onClick={handleCancelPartial}
                        disabled={cancelingPartial}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        style={{
                          border: '1px solid rgba(239,68,68,0.4)',
                          color: '#b91c1c',
                          background: 'rgba(239,68,68,0.08)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                        title="Oculta o resultado do portal sem alterar a etapa"
                      >
                        {cancelingPartial
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Cancelando…</>
                          : <><Lock className="h-3 w-3" /> Cancelar prévia do resultado</>}
                      </button>
                    ) : (
                      <button
                        onClick={handleReleasePartial}
                        disabled={releasingPartial}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        style={{
                          border: '1px solid rgba(139,92,246,0.4)',
                          color: '#7c3aed',
                          background: 'rgba(139,92,246,0.1)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.1)')}
                        title="Libera o resultado no portal sem avançar a etapa"
                      >
                        {releasingPartial
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Liberando…</>
                          : <><Unlock className="h-3 w-3" /> Liberar resultado parcial</>}
                      </button>
                    )}
                  </div>
                )}

                {/* Botão de revogação */}
                {step.key === 'result' && isCurrent && (
                  <div className="mt-2">
                    <button
                      onClick={handleRevokeResult}
                      disabled={revokingResult}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      style={{
                        border: '1px solid rgba(239,68,68,0.4)',
                        color: '#b91c1c',
                        background: 'rgba(239,68,68,0.08)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                      title="Oculta o resultado do portal e volta para Simulações. Dados ficam intactos."
                    >
                      {revokingResult
                        ? <><Loader2 className="h-3 w-3 animate-spin" /> Revogando…</>
                        : <><Lock className="h-3 w-3" /> Revogar resultado</>}
                    </button>
                  </div>
                )}
              </div>

              {/* Reabrir */}
              {canReopen && (
                <div className="mt-2 sm:mt-0 sm:ml-auto sm:flex-shrink-0">
                <button
                  onClick={() => setReopenTarget(step)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors"
                  style={{
                    border: '1px solid rgba(245,158,11,0.4)',
                    color: '#b45309',
                    background: 'rgba(245,158,11,0.1)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.1)')}
                  title={`Voltar a cliente para ${step.label}`}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reabrir
                </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ReopenModal
        open={!!reopenTarget}
        stepLabel={reopenTarget?.label || ''}
        fromCompleted={fromCompleted}
        onCancel={() => setReopenTarget(null)}
        onConfirm={handleReopen}
      />

      <JumpToStepModal
        open={jumpModalOpen}
        currentStatus={client.status}
        planHasAiPhoto={planHasAiPhoto}
        clientName={client.full_name}
        onCancel={() => setJumpModalOpen(false)}
        onConfirm={handleJumpToStep}
      />
    </div>
  )
}