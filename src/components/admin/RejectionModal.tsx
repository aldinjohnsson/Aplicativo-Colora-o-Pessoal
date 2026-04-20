// src/components/admin/RejectionModal.tsx
//
// Modal para admin solicitar ajuste em fotos, formulário, ou ambos.
// Integra com adminService.rejectForm / rejectPhotos / rejectBoth.
//
// IMPORTANTE: rejeitar NÃO apaga nada — a cliente vê os dados atuais e decide
// o que manter e o que trocar.

import React, { useState, useEffect } from 'react'
import { X, AlertTriangle, Camera, ClipboardList, Check, Loader2 } from 'lucide-react'

interface RejectionConfirm {
  rejectForm: boolean
  formReason: string
  rejectPhotos: boolean
  photosReason: string
}

interface RejectionModalProps {
  open: boolean
  clientName: string
  hasForm: boolean
  hasPhotos: boolean
  onCancel: () => void
  onConfirm: (data: RejectionConfirm) => Promise<void>
}

export function RejectionModal({
  open, clientName, hasForm, hasPhotos, onCancel, onConfirm,
}: RejectionModalProps) {
  const [rejectForm, setRejectForm] = useState(false)
  const [rejectPhotos, setRejectPhotos] = useState(false)
  const [formReason, setFormReason] = useState('')
  const [photosReason, setPhotosReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setRejectForm(false)
      setRejectPhotos(hasPhotos)
      setFormReason('')
      setPhotosReason('')
      setSubmitting(false)
    }
  }, [open, hasPhotos])

  if (!open) return null

  const somethingSelected = rejectForm || rejectPhotos
  const canSubmit =
    (rejectForm ? formReason.trim().length > 0 : true) &&
    (rejectPhotos ? photosReason.trim().length > 0 : true) &&
    somethingSelected

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onConfirm({
        rejectForm, formReason: formReason.trim(),
        rejectPhotos, photosReason: photosReason.trim(),
      })
    } catch (e: any) {
      alert(e?.message || 'Erro ao solicitar ajustes')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

        <div className="px-5 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-sm">Solicitar ajustes</p>
              <p className="text-xs text-amber-50 truncate">{clientName}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20 transition-colors flex-shrink-0" disabled={submitting}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-sm text-gray-600">
            A etapa selecionada será reaberta com o motivo informado. Os dados atuais ficam preservados —
            a cliente decide o que manter e o que trocar.
          </p>

          {/* FOTOS */}
          <div className={`rounded-xl border-2 transition-colors ${
            !hasPhotos ? 'border-gray-100 bg-gray-50 opacity-60'
            : rejectPhotos ? 'border-purple-400 bg-purple-50'
            : 'border-gray-200 bg-white'
          }`}>
            <label className={`flex items-center gap-3 p-4 ${hasPhotos ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
              <input type="checkbox" checked={rejectPhotos} disabled={!hasPhotos}
                onChange={e => setRejectPhotos(e.target.checked)}
                className="h-4 w-4 rounded text-purple-600 focus:ring-purple-400" />
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-purple-100">
                <Camera className="h-5 w-5 text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">Pedir ajuste nas fotos</p>
                <p className="text-xs text-gray-500">
                  {hasPhotos
                    ? 'A cliente verá as fotos atuais e poderá remover/substituir o que precisar.'
                    : 'Sem fotos enviadas ainda.'}
                </p>
              </div>
            </label>
            {rejectPhotos && hasPhotos && (
              <div className="px-4 pb-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">Motivo *</label>
                <textarea value={photosReason} onChange={e => setPhotosReason(e.target.value)} rows={3}
                  placeholder="Ex: As fotos do rosto estão muito escuras. Por favor, troque-as por outras em luz natural…"
                  className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none bg-white"
                  maxLength={500} />
                <p className="text-[10px] text-gray-400 text-right mt-1">{photosReason.length}/500</p>
              </div>
            )}
          </div>

          {/* FORMULÁRIO */}
          <div className={`rounded-xl border-2 transition-colors ${
            !hasForm ? 'border-gray-100 bg-gray-50 opacity-60'
            : rejectForm ? 'border-blue-400 bg-blue-50'
            : 'border-gray-200 bg-white'
          }`}>
            <label className={`flex items-center gap-3 p-4 ${hasForm ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
              <input type="checkbox" checked={rejectForm} disabled={!hasForm}
                onChange={e => setRejectForm(e.target.checked)}
                className="h-4 w-4 rounded text-blue-600 focus:ring-blue-400" />
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-100">
                <ClipboardList className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">Pedir ajuste no formulário</p>
                <p className="text-xs text-gray-500">
                  {hasForm
                    ? 'A cliente verá o formulário pré-preenchido e ajustará apenas o necessário.'
                    : 'Formulário ainda não enviado.'}
                </p>
              </div>
            </label>
            {rejectForm && hasForm && (
              <div className="px-4 pb-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">Motivo *</label>
                <textarea value={formReason} onChange={e => setFormReason(e.target.value)} rows={3}
                  placeholder="Ex: Faltou complementar a pergunta sobre medicamentos em uso…"
                  className="w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none bg-white"
                  maxLength={500} />
                <p className="text-[10px] text-gray-400 text-right mt-1">{formReason.length}/500</p>
              </div>
            )}
          </div>

          {!somethingSelected && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Selecione ao menos um item para solicitar ajuste.
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 bg-gray-50">
          <button onClick={onCancel} disabled={submitting}
            className="flex-1 py-2.5 border border-gray-200 bg-white text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-100 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit || submitting}
            className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
              : <><Check className="h-4 w-4" /> Solicitar ajustes</>}
          </button>
        </div>
      </div>
    </div>
  )
}
