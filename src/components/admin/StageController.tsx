// src/components/admin/StageController.tsx
//
// Painel de controle de etapas — permite ao admin avançar ou voltar em
// qualquer momento, inclusive após a cliente ter concluído tudo.
//
// Reaproveita o sistema de rejeição: ao voltar uma etapa, grava o motivo
// em `*_rejection_reason` e o portal da cliente já mostra o banner de ajuste
// automaticamente (nada precisa mudar no ClientPortal).
//
// Uso:
//   <StageController
//     client={client}
//     contract={contract}
//     formSubmission={formSubmission}
//     photos={photos}
//     result={result}
//     onChange={load}
//   />

import React, { useState } from 'react'
import {
  Check, FileText, ClipboardList, Camera, Eye, Sparkles,
  ChevronRight, RotateCcw, ArrowRight, X, AlertTriangle, Loader2,
} from 'lucide-react'
import { adminService } from '../../lib/services'

// ─── Config ────────────────────────────────────────────────────────────────

type StepKey = 'contract' | 'form' | 'photos' | 'review' | 'analysis' | 'result'

interface StepDef {
  key: StepKey
  label: string
  icon: React.ElementType
  /** classes estáticas para o círculo quando a etapa está ATUAL */
  currentDot: string
  /** classes estáticas para o container quando a etapa está ATUAL */
  currentBorder: string
  /** a partir de qual status da cliente esta etapa está "ativa" */
  activeStatus: string
  /** quais statuses significam que esta etapa JÁ está concluída */
  doneStatuses: string[]
  /** chave usada no reopenStep (null = não reabrível, ex: resultado) */
  reopenKey: 'contract' | 'form' | 'photos' | 'review' | null
}

const STEPS: StepDef[] = [
  {
    key: 'contract', label: 'Contrato', icon: FileText,
    currentDot: 'bg-amber-500 text-white ring-4 ring-amber-100',
    currentBorder: 'border-amber-200 bg-amber-50/50',
    activeStatus: 'awaiting_contract',
    doneStatuses: ['awaiting_form', 'awaiting_photos', 'photos_submitted', 'in_analysis', 'completed'],
    reopenKey: 'contract',
  },
  {
    key: 'form', label: 'Formulário', icon: ClipboardList,
    currentDot: 'bg-blue-500 text-white ring-4 ring-blue-100',
    currentBorder: 'border-blue-200 bg-blue-50/50',
    activeStatus: 'awaiting_form',
    doneStatuses: ['awaiting_photos', 'photos_submitted', 'in_analysis', 'completed'],
    reopenKey: 'form',
  },
  {
    key: 'photos', label: 'Fotos', icon: Camera,
    currentDot: 'bg-purple-500 text-white ring-4 ring-purple-100',
    currentBorder: 'border-purple-200 bg-purple-50/50',
    activeStatus: 'awaiting_photos',
    doneStatuses: ['photos_submitted', 'in_analysis', 'completed'],
    reopenKey: 'photos',
  },
  {
    key: 'review', label: 'Revisão', icon: Eye,
    currentDot: 'bg-pink-500 text-white ring-4 ring-pink-100',
    currentBorder: 'border-pink-200 bg-pink-50/50',
    activeStatus: 'photos_submitted',
    doneStatuses: ['in_analysis', 'completed'],
    reopenKey: 'review',
  },
  {
    key: 'analysis', label: 'Análise', icon: Sparkles,
    currentDot: 'bg-orange-500 text-white ring-4 ring-orange-100',
    currentBorder: 'border-orange-200 bg-orange-50/50',
    activeStatus: 'in_analysis',
    doneStatuses: ['completed'],
    reopenKey: null, // análise não se "reabre" diretamente — volta p/ revisão
  },
  {
    key: 'result', label: 'Resultado', icon: Check,
    currentDot: 'bg-green-500 text-white ring-4 ring-green-100',
    currentBorder: 'border-green-200 bg-green-50/50',
    activeStatus: 'completed',
    doneStatuses: [], // é a última etapa
    reopenKey: null,
  },
]

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <RotateCcw className="h-5 w-5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-sm">Reabrir etapa: {stepLabel}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20" disabled={submitting}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          <p className="text-sm text-gray-600">
            A cliente voltará para esta etapa e verá os dados atuais em modo de edição.
            <strong className="text-gray-800"> Nada é apagado</strong> — ela decide o que manter e o que trocar.
          </p>

          {fromCompleted && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-xs text-amber-800">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <p>
                Esta cliente estava com o resultado liberado. Ao reabrir, o resultado deixa de ser
                exibido no portal. Ele será mostrado de novo quando você avançar até "Concluído".
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Motivo (opcional)
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Ex: Preciso adicionar um campo novo ao formulário…"
              maxLength={500}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
            <p className="text-[10px] text-gray-400 text-right mt-1">{reason.length}/500</p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 bg-gray-50">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 py-2.5 border border-gray-200 bg-white text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
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

// ─── Main component ────────────────────────────────────────────────────────

interface StageControllerProps {
  client: { id: string; status: string; full_name: string }
  contract: any
  formSubmission: any
  photos: any[]
  result: any
  onChange: () => void | Promise<void>
}

export function StageController({
  client, contract, formSubmission, photos, result, onChange,
}: StageControllerProps) {
  const [reopenTarget, setReopenTarget] = useState<StepDef | null>(null)
  const [advancing, setAdvancing] = useState(false)

  const currentIdx = STEPS.findIndex(s => s.activeStatus === client.status)
  const fromCompleted = client.status === 'completed'

  const handleReopen = async (reason: string) => {
    if (!reopenTarget || !reopenTarget.reopenKey) return
    await adminService.reopenStep(client.id, reopenTarget.reopenKey, reason || undefined)
    setReopenTarget(null)
    await onChange()
  }

  const handleAdvance = async () => {
    const nextStep = STEPS[currentIdx + 1]
    if (!nextStep) return
    // Aviso extra para casos sensíveis
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
      if (!confirm('Liberar o resultado para a cliente?')) return
    }

    setAdvancing(true)
    try {
      await adminService.advanceStep(client.id)
      await onChange()
    } catch (e: any) {
      alert(e?.message || 'Erro ao avançar etapa')
    } finally {
      setAdvancing(false)
    }
  }

  const canAdvance = currentIdx < STEPS.length - 1

  return (
    <div className="md:col-span-2 bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ChevronRight className="h-4 w-4 text-gray-400" />
            Controle de etapas
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Avance ou volte etapas manualmente. Ao voltar, os dados ficam preservados — a cliente só ajusta o que precisar.
          </p>
        </div>

        {canAdvance && (
          <button
            onClick={handleAdvance}
            disabled={advancing}
            className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {advancing
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Avançando…</>
              : <><ArrowRight className="h-3.5 w-3.5" /> Avançar para "{STEPS[currentIdx + 1]?.label}"</>}
          </button>
        )}
      </div>

      {/* Barra de etapas */}
      <div className="space-y-2">
        {STEPS.map((step, idx) => {
          const isDone = step.doneStatuses.includes(client.status)
          const isCurrent = step.activeStatus === client.status
          const isFuture = !isDone && !isCurrent
          const canReopen = (isDone || isCurrent) && !!step.reopenKey
          const Icon = step.icon

          // Cor visual
          const dotClass = isDone
            ? 'bg-green-500 text-white'
            : isCurrent
              ? step.currentDot
              : 'bg-gray-100 text-gray-400'

          const containerClass = isCurrent
            ? step.currentBorder
            : isDone
              ? 'border-green-100 bg-green-50/30'
              : 'border-gray-100 bg-gray-50/30'

          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${containerClass}`}
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${dotClass}`}>
                {isDone
                  ? <Check className="h-4 w-4" />
                  : <Icon className="h-4 w-4" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium ${isFuture ? 'text-gray-400' : 'text-gray-800'}`}>
                    {idx + 1}. {step.label}
                  </p>
                  {isCurrent && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-white bg-gray-800 px-1.5 py-0.5 rounded">
                      atual
                    </span>
                  )}
                  {isDone && (
                    <span className="text-[10px] font-medium text-green-600">concluída</span>
                  )}
                </div>
              </div>

              {canReopen && (
                <button
                  onClick={() => setReopenTarget(step)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-amber-200 text-amber-700 bg-white rounded-lg hover:bg-amber-50"
                  title={`Voltar a cliente para ${step.label}`}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reabrir
                </button>
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
    </div>
  )
}
