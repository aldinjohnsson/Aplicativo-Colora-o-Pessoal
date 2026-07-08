// src/lib/billingService.ts
//
// Leitura do medidor (cada admin lê a PRÓPRIA linha via RLS) e configuração
// (só super_admin, via RPC set_admin_billing). Aqui NÃO existe chave nenhuma
// — só modo + cota + uso.
//
// ★ POOL ÚNICO (novo): no pré-pago existe UMA cota compartilhada
//   (quota/used) — toda geração, seja OpenAI ou Gemini, desconta do mesmo
//   saldo. O MODO continua por IA (permite ex.: Gemini pré-pago + OpenAI
//   pós-pago com chave própria). Pós-pago é intocado.
//
// Campos legados (openai_quota/used, gemini_quota/used) ainda existem na
// tabela mas estão CONGELADOS — não são mais consumidos nem exibidos.

import { supabase } from './supabase'

export type GenMode = 'prepaid' | 'postpaid'
export type Provider = 'openai' | 'gemini'

export interface BillingProfile {
  admin_id: string
  openai_mode: GenMode
  gemini_mode: GenMode
  /** ★ Pool único: cota total de imagens do período (compartilhada entre as IAs). */
  quota: number
  /** ★ Pool único: quanto já foi consumido no período (todas as IAs somadas). */
  used: number
  period: 'once' | 'monthly'
  cycle_start?: string
}

export const DEFAULT_BILLING: Omit<BillingProfile, 'admin_id'> = {
  openai_mode: 'postpaid',
  gemini_mode: 'postpaid',
  quota: 0,
  used: 0,
  period: 'monthly',
}

export const billingService = {
  /** Perfil do admin logado (medidor + gating do SettingsEditor). */
  async getMine(): Promise<BillingProfile | null> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data, error } = await supabase
      .from('admin_billing').select('*').eq('admin_id', user.id).maybeSingle()
    if (error) throw error
    return (data as BillingProfile) ?? { admin_id: user.id, ...DEFAULT_BILLING }
  },

  /** Perfil de um admin específico (painel do super_admin). */
  async getFor(adminId: string): Promise<BillingProfile> {
    const { data, error } = await supabase
      .from('admin_billing').select('*').eq('admin_id', adminId).maybeSingle()
    if (error) throw error
    return (data as BillingProfile) ?? { admin_id: adminId, ...DEFAULT_BILLING }
  },

  /** Configuração — só super_admin (self-check no banco). */
  async set(adminId: string, patch: {
    openai_mode?: GenMode
    gemini_mode?: GenMode
    /** Cota do pool único (imagens/ciclo, compartilhada entre as IAs). */
    quota?: number
    period?: 'once' | 'monthly'
    reset?: boolean
  }): Promise<BillingProfile> {
    const { data, error } = await supabase.rpc('set_admin_billing', {
      p_admin_id:    adminId,
      p_openai_mode: patch.openai_mode ?? null,
      p_gemini_mode: patch.gemini_mode ?? null,
      p_quota:       patch.quota       ?? null,
      p_period:      patch.period      ?? null,
      p_reset:       patch.reset       ?? false,
    })
    if (error) throw error
    return data as BillingProfile
  },
}

export const remaining = (quota: number, used: number) => Math.max(0, quota - used)

/** True se QUALQUER IA está em pré-pago (o pool único se aplica). */
export const hasPrepaid = (b: Pick<BillingProfile, 'openai_mode' | 'gemini_mode'>) =>
  b.openai_mode === 'prepaid' || b.gemini_mode === 'prepaid'

/** True se o pool pré-pago acabou (só relevante quando hasPrepaid). */
export const isPrepaidExhausted = (b: Pick<BillingProfile, 'openai_mode' | 'gemini_mode' | 'quota' | 'used'>) =>
  hasPrepaid(b) && b.used >= b.quota