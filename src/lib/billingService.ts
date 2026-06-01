// src/lib/billingService.ts
//
// Leitura do medidor (cada admin lê a PRÓPRIA linha via RLS) e configuração
// (só super_admin, via RPC set_admin_billing). Modelo POR IA: openai | gemini.
// Aqui NÃO existe chave nenhuma — só modo + cota + uso.

import { supabase } from './supabase'

export type GenMode = 'prepaid' | 'postpaid'
export type Provider = 'openai' | 'gemini'

export interface BillingProfile {
  admin_id: string
  openai_mode: GenMode
  openai_quota: number
  openai_used: number
  gemini_mode: GenMode
  gemini_quota: number
  gemini_used: number
  period: 'once' | 'monthly'
  cycle_start?: string
}

export const DEFAULT_BILLING: Omit<BillingProfile, 'admin_id'> = {
  openai_mode: 'postpaid', openai_quota: 0, openai_used: 0,
  gemini_mode: 'postpaid', gemini_quota: 0, gemini_used: 0,
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
    openai_quota?: number
    gemini_mode?: GenMode
    gemini_quota?: number
    period?: 'once' | 'monthly'
    reset?: boolean
  }): Promise<BillingProfile> {
    const { data, error } = await supabase.rpc('set_admin_billing', {
      p_admin_id:     adminId,
      p_openai_mode:  patch.openai_mode  ?? null,
      p_openai_quota: patch.openai_quota ?? null,
      p_gemini_mode:  patch.gemini_mode  ?? null,
      p_gemini_quota: patch.gemini_quota ?? null,
      p_period:       patch.period       ?? null,
      p_reset:        patch.reset        ?? false,
    })
    if (error) throw error
    return data as BillingProfile
  },
}

export const remaining = (quota: number, used: number) => Math.max(0, quota - used)
export const isPrepaidExhausted = (mode: GenMode, quota: number, used: number) =>
  mode === 'prepaid' && used >= quota
