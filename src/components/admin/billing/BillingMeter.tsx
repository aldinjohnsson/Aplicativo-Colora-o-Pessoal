// src/components/admin/billing/BillingMeter.tsx
//
// Medidor mostrado no SettingsEditor quando uma IA está em PRÉ-PAGO.
// Substitui o card de chave dessa IA (no pré-pago o admin nem vê a chave).

import React from 'react'
import { Sparkles, ImageIcon } from 'lucide-react'
import type { BillingProfile } from '../../../lib/billingService'
import { remaining } from '../../../lib/billingService'

function Bar({ label, used, quota }: { label: string; used: number; quota: number }) {
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
  const left = remaining(quota, used)
  const low = quota > 0 && left <= Math.max(1, Math.ceil(quota * 0.1))
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium text-gray-700">{label}</span>
        <span className={low ? 'text-rose-600 font-semibold' : 'text-gray-500'}>
          {left} restantes <span className="text-gray-400">de {quota}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${low ? 'bg-rose-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function BillingMeter({ billing }: { billing: BillingProfile }) {
  const showOpenAi = billing.openai_mode === 'prepaid'
  const showGemini = billing.gemini_mode === 'prepaid'
  if (!showOpenAi && !showGemini) return null

  return (
    <div className="rounded-2xl border border-gray-200 p-5 bg-white">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-emerald-500" />
        <h2 className="text-base font-semibold text-gray-900">Geração inclusa no seu plano</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Já está tudo configurado, é só usar. Sem chave pra colar.
      </p>
      {showOpenAi && (
        <Bar label="Imagens (IA de imagem)" used={billing.openai_used} quota={billing.openai_quota} />
      )}
      {showGemini && (
        <Bar label="Simulações do chat" used={billing.gemini_used} quota={billing.gemini_quota} />
      )}
      {billing.period === 'monthly' && (
        <p className="text-xs text-gray-400 mt-3 flex items-center gap-1">
          <ImageIcon className="h-3 w-3" /> Renova no início de cada mês.
        </p>
      )}
    </div>
  )
}
