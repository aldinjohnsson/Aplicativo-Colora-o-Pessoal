// src/components/admin/billing/AdminBillingControls.tsx
//
// Bloco dentro do AdminFormModal (SuperAdminPanel). Funciona na EDIÇÃO e na
// CRIAÇÃO. A gravação acontece junto com "Salvar alterações"/"Criar":
//   • edição:  modal chama billingRef.current.save()         (usa o adminId da prop)
//   • criação: modal chama billingRef.current.save(novoId)   (passa o id recém-criado)

import React, { useEffect, useState, forwardRef, useImperativeHandle } from 'react'
import { billingService, DEFAULT_BILLING, type BillingProfile, type GenMode } from '../../../lib/billingService'

export interface AdminBillingHandle { save: (targetId?: string) => Promise<void> }
interface Props { adminId?: string }   // ausente = modo criação

function AiBlock({ title, mode, quota, used, onMode, onQuota }: {
  title: string; mode: GenMode; quota: number; used: number
  onMode: (m: GenMode) => void; onQuota: (n: number) => void
}) {
  return (
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
}

export const AdminBillingControls = forwardRef<AdminBillingHandle, Props>(
  function AdminBillingControls({ adminId }, ref) {
    const isCreate = !adminId
    const [b, setB] = useState<BillingProfile>({ admin_id: adminId || '', ...DEFAULT_BILLING })
    const [loading, setLoading] = useState(!isCreate)
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState<string | null>(null)
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
      if (!adminId) { setLoading(false); return }
      let alive = true
      setLoading(true)
      billingService.getFor(adminId)
        .then(p => { if (alive) setB(p) })
        .catch(e => { if (alive) setErr(e?.message || 'Erro ao carregar cobrança') })
        .finally(() => { if (alive) setLoading(false) })
      return () => { alive = false }
    }, [adminId])

    const patch = (p: Partial<BillingProfile>) => setB(prev => ({ ...prev, ...p }))

    const persist = async (targetId?: string, reset = false): Promise<void> => {
      const id = targetId || adminId
      if (!id) return
      const updated = await billingService.set(id, {
        openai_mode:  b.openai_mode,
        openai_quota: b.openai_quota,
        gemini_mode:  b.gemini_mode,
        gemini_quota: b.gemini_quota,
        period:       b.period,
        reset,
      })
      setB(updated)
    }

    // Exposto ao modal: salva junto com o botão principal.
    useImperativeHandle(ref, () => ({ save: (targetId?: string) => persist(targetId, false) }), [b, adminId])

    const onReset = async () => {
      setBusy(true); setErr(null); setMsg(null)
      try { await persist(undefined, true); setMsg('Uso zerado.') }
      catch (e: any) { console.error('billing reset error', e); setErr(e?.message || 'Erro ao zerar uso') }
      finally { setBusy(false) }
    }

    if (loading) return <div className="text-sm text-gray-400 py-3">Carregando cobrança…</div>

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
          {!isCreate && (
            <button
              type="button" onClick={onReset} disabled={busy}
              className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Zerar uso
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400">
          A cobrança é salva ao clicar em <strong>{isCreate ? 'Criar conta' : 'Salvar alterações'}</strong>.
        </p>
        {(msg || err) && <p className={`text-xs ${err ? 'text-rose-600' : 'text-emerald-600'}`}>{err || msg}</p>}
      </div>
    )
  }
)