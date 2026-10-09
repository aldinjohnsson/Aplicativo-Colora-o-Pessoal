// src/lib/whatsappService.ts
//
// Dispara a notificação de conclusão pra cliente via edge function.
// É fire-and-forget de propósito: se o WhatsApp falhar, NÃO trava nem
// reverte a mudança de etapa. O e-mail/portal continuam sendo a fonte
// de verdade; o WhatsApp é um plus.
//
// Também concentra as chamadas da CAMPANHA de marketing por plano
// (edge function 'send-whatsapp-campaign', só super_admin).

import { supabase } from './supabase'

/**
 * Notifica a cliente que a análise foi concluída.
 * Chame DEPOIS de confirmar que o status virou 'completed'.
 * Nunca lança erro pra fora — só loga.
 */
export async function notifyClientCompleted(clientId: string): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('send-whatsapp', {
      body: { clientId },
    })
    if (error) {
      console.warn('[whatsapp] falha ao notificar cliente:', error.message)
      return
    }
    if (data?.skipped) {
      console.info('[whatsapp] notificação pulada:', data.skipped)
    } else if (data?.ok) {
      console.info('[whatsapp] notificação enviada:', data.messageId)
    }
  } catch (e) {
    console.warn('[whatsapp] erro inesperado:', e)
  }
}

/** Envio de teste a partir das Configurações (super_admin). Retorna o resultado. */
export async function sendWhatsAppTest(to: string, planId?: string | null, name = 'Teste') {
  const { data, error } = await supabase.functions.invoke('send-whatsapp', {
    body: { to, planId: planId ?? null, name, test: true },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.detail || data.error)
  return data
}

// ─────────────────────────────────────────────────────────────
// Campanhas de marketing por WhatsApp
// ─────────────────────────────────────────────────────────────

/** Como cada variável do template ({{1}}, {{2}}, ...) é preenchida. */
export type CampaignVariable =
  | { kind: 'first_name' }
  | { kind: 'portal_link' }
  | { kind: 'text'; value: string }

export type CampaignStatus =
  | 'draft'
  | 'prepared'
  | 'sending'
  | 'paused'
  | 'completed'
  | 'cancelled'

export interface CampaignCounts {
  pending: number
  sending: number
  sent: number
  failed: number
  skipped: number
}

export interface PrepareCampaignResult extends CampaignCounts {
  ok: true
  /** Quantas clientes entraram no público antes de descartar inválidas/repetidas. */
  audience: number
}

export interface CampaignBatchResult extends CampaignCounts {
  ok: true
  /** Não sobrou nada pendente — campanha concluída. */
  done: boolean
  campaignStatus: CampaignStatus
  /** Quantos contatos ainda cabem na janela de 24h. */
  remainingToday: number
  /** Bateu o limite diário configurado na campanha. */
  limitReached: boolean
  /** A Meta pediu pra segurar (rate limit). */
  rateLimited: boolean
  /** Token/credencial recusado pela Meta. */
  authError: boolean
  /** Problema no template (inexistente, parâmetros errados, pausado) — texto da Meta. */
  templateError: string | null
  /** Quando volta a caber envio (ISO), se limitReached. */
  resumeAfter: string | null
}

/**
 * Chama a edge function de campanha. Diferente do notifyClientCompleted,
 * AQUI os erros sobem: a tela precisa mostrar o que deu errado.
 * Em respostas não-2xx o supabase-js só diz "non-2xx status code", então
 * lemos o corpo da resposta pra pegar a mensagem real.
 */
async function invokeCampaign<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('send-whatsapp-campaign', { body })
  if (error) {
    let detail = error.message
    try {
      const ctx = (error as any).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        detail = j?.detail || j?.error || detail
      }
    } catch {
      // mantém error.message
    }
    throw new Error(detail)
  }
  if (data?.error) throw new Error(data.detail || data.error)
  return data as T
}

/** Congela a lista de destinatárias (opt-in de marketing, plano/status escolhidos). */
export function prepareCampaign(campaignId: string) {
  return invokeCampaign<PrepareCampaignResult>({ action: 'prepare', campaignId })
}

/** Envia UM lote. Use runCampaign pra enviar tudo em loop. */
export function sendCampaignBatch(campaignId: string, resume = false) {
  return invokeCampaign<CampaignBatchResult>({ action: 'send', campaignId, resume })
}

/** Manda o template da campanha pra um número, sem registrar na campanha. */
export function sendCampaignTest(campaignId: string, to: string, name = 'Teste') {
  return invokeCampaign<{ ok: true; to: string; messageId: string | null }>({
    action: 'test',
    campaignId,
    to,
    name,
  })
}

/**
 * Envia a campanha em lotes até acabar, bater o limite diário, a Meta pedir
 * pra segurar, ou `shouldStop()` devolver true (botão "Pausar").
 * Devolve o resultado do último lote.
 */
export async function runCampaign(
  campaignId: string,
  opts: {
    resume?: boolean
    onProgress?: (r: CampaignBatchResult) => void
    shouldStop?: () => boolean
  } = {},
): Promise<CampaignBatchResult> {
  let resume = !!opts.resume
  let last: CampaignBatchResult

  while (true) {
    last = await sendCampaignBatch(campaignId, resume)
    resume = false
    opts.onProgress?.(last)

    if (last.done || last.limitReached || last.rateLimited || last.authError || last.templateError) return last
    if (opts.shouldStop?.()) return last

    // Respiro entre lotes — não martela a Cloud API nem a edge function.
    await new Promise((r) => setTimeout(r, 500))
  }
}