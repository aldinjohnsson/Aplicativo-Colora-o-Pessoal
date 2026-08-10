// src/lib/chatStorage.ts
//
// Sincroniza o histórico de conversas do GeminiChat com o banco (tabela
// ai_chat_history, via Edge Function `chat-sync`) — substitui a dependência
// de localStorage. Mesma conversa aparece em qualquer aparelho/login.
//
// Mesmo padrão de autenticação dual do driveStorage.ts:
//   • Admin (painel, JWT da sessão)      → authedFetch manda Authorization.
//   • Portal da cliente (sem sessão)     → manda portalToken no body.

import { getAccessToken } from './authSession'

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-sync`

async function callChatSync(body: Record<string, unknown>): Promise<Response> {
  const token = await getAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(FN, { method: 'POST', headers, body: JSON.stringify(body) })
}

export const chatStorage = {
  /** Carrega o histórico salvo no banco pra essa chave. Retorna [] se ainda não existir. */
  async load(chatKey: string, portalToken?: string): Promise<any[]> {
    const r = await callChatSync({ action: 'load', chatKey, portalToken })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Erro ao carregar histórico: HTTP ${r.status}`)
    }
    const { messages } = await r.json()
    return Array.isArray(messages) ? messages : []
  },

  /** Salva (upsert) o snapshot completo do histórico pra essa chave. */
  async save(chatKey: string, messages: unknown[], portalToken?: string): Promise<void> {
    const r = await callChatSync({ action: 'save', chatKey, portalToken, messages })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Erro ao salvar histórico: HTTP ${r.status}`)
    }
  },

  /** Apaga o histórico salvo pra essa chave (botão "Limpar histórico"). */
  async clear(chatKey: string, portalToken?: string): Promise<void> {
    const r = await callChatSync({ action: 'clear', chatKey, portalToken })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Erro ao limpar histórico: HTTP ${r.status}`)
    }
  },
}