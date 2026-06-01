// src/components/admin/billing/AdminBillingControls.tsx
//
// Bloco que vai DENTRO do AdminFormModal (SuperAdminPanel). Dado um adminId,
// carrega o billing dele e deixa o super_admin definir, POR IA:
//   modo (pré/pós-pago) + cota + ciclo, e "zerar uso".

import React, { useEffect, useState } from 'react'
import { billingService, type BillingProfile, type GenMode } from '../../../lib/billingService'

interface Props { adminId: string }

export function AdminBillingControls({ adminId }: Props) {
  const [b, setB] = useState<BillingProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    billingService.getFor(adminId)
      .then(p => { if (alive) setB(p) })
      .catch(e => { if (alive) setErr(e?.message || 'Erro ao carregar billing') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [adminId])

  const patch = (p: Partial<BillingProfile>) => setB(prev => prev ? { ...prev, ...p } : prev)

  const save = async (extra?: { reset?: boolean }) => {
    if (!b) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const updated = await billingService.set(adminId, {
        openai_mode:  b.openai_mode,
        openai_quota: b.openai_quota,
        gemini_mode:  b.gemini_mode,
        gemini_quota: b.gemini_quota,
        period:       b.period,
        reset:        extra?.reset ?? false,
      })
      setB(updated)
      setMsg(extra?.reset ? 'Uso zerado e salvo.' : 'Salvo.')
    } catch (e: any) {
      setErr(e?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-gray-400 py-3">Carregando cobrança…</div>
  if (!b) return null

  const AiBlock = ({
    title, mode, quota, used, onMode, onQuota,
  }: {
    title: string; mode: GenMode; quota: number; used: number
    onMode: (m: GenMode) => void; onQuota: (n: number) => void
  }) => (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <span className="text-xs text-gray-400">usado: {used}</span>
      </div>
      <div className="flex gap-2 items-center">
        <select
          value={mode}
          onChange={e => onMode(e.target.value as GenMode)}
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="postpaid">Pós-pago (chave própria)</option>
          <option value="prepaid">Pré-pago (chave geral + cota)</option>
        </select>
        <input
          type="number" min={0}
          value={quota}
          disabled={mode !== 'prepaid'}
          onChange={e => onQuota(Math.max(0, parseInt(e.target.value || '0', 10)))}
          className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
          placeholder="cota"
        />
        <span className="text-xs text-gray-400">{mode === 'prepaid' ? 'imagens/ciclo' : '—'}</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cobrança de IA</p>

      <AiBlock
        title="OpenAI (imagens)"
        mode={b.openai_mode} quota={b.openai_quota} used={b.openai_used}
        onMode={m => patch({ openai_mode: m })} onQuota={n => patch({ openai_quota: n })}
      />
      <AiBlock
        title="Gemini (chat / simulações)"
        mode={b.gemini_mode} quota={b.gemini_quota} used={b.gemini_used}
        onMode={m => patch({ gemini_mode: m })} onQuota={n => patch({ gemini_quota: n })}
      />

      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-700">Ciclo:</label>
        <select
          value={b.period}
          onChange={e => patch({ period: e.target.value as 'once' | 'monthly' })}
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="monthly">Mensal (renova todo mês)</option>
          <option value="once">Balde único (recarga manual)</option>
        </select>
      </div>

      {(msg || err) && (
        <p className={`text-xs ${err ? 'text-rose-600' : 'text-emerald-600'}`}>{err || msg}</p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => save()} disabled={saving}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar cobrança'}
        </button>
        <button
          onClick={() => save({ reset: true })} disabled={saving}
          className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Zerar uso
        </button>
      </div>
    </div>
  )
}
