// src/lib/whatsappService.ts
//
// Dispara a notificação de conclusão pra cliente via edge function.
// É fire-and-forget de propósito: se o WhatsApp falhar, NÃO trava nem
// reverte a mudança de etapa. O e-mail/portal continuam sendo a fonte
// de verdade; o WhatsApp é um plus.

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
