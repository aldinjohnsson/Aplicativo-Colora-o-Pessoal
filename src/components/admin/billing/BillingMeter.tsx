// src/components/admin/billing/BillingMeter.tsx
//
// Medidor mostrado no SettingsEditor quando alguma IA está em PRÉ-PAGO.
// ★ POOL ÚNICO: uma barra só — OpenAI e Gemini descontam do mesmo saldo,
//   então o admin vê "X restantes de Y", sem distinção por IA.

import React from 'react'
import { Sparkles, ImageIcon } from 'lucide-react'
import type { BillingProfile } from '../../../lib/billingService'
import { remaining, hasPrepaid } from '../../../lib/billingService'

export function BillingMeter({ billing }: { billing: BillingProfile }) {
  if (!hasPrepaid(billing)) return null

  const { quota, used } = billing
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
  const left = remaining(quota, used)
  const low = quota > 0 && left <= Math.max(1, Math.ceil(quota * 0.1))

  return (
    <div className="rounded-2xl border border-gray-200 p-5 bg-white">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-emerald-500" />
        <h2 className="text-base font-semibold text-gray-900">Geração inclusa no seu plano</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Já está tudo configurado, é só usar. Suas imagens valem para qualquer
        recurso de IA, chat, simulações e dossiês descontam do mesmo saldo.
      </p>

      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium text-gray-700">Imagens do seu plano</span>
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

      {billing.period === 'monthly' && (
        <p className="text-xs text-gray-400 mt-3 flex items-center gap-1">
          <ImageIcon className="h-3 w-3" /> Renova no início de cada mês.
        </p>
      )}
    </div>
  )
}