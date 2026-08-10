// supabase/functions/chat-sync/index.ts
//
// Edge Function que persiste o histórico do GeminiChat na tabela
// ai_chat_history, em vez de localStorage no navegador. A mesma conversa
// fica disponível em qualquer aparelho/login — nada depende mais de
// storage do browser.
//
// ════════════════════════════════════════════════════════════════════════
// CONTRATO (POST /functions/v1/chat-sync)
// ════════════════════════════════════════════════════════════════════════
//   body: {
//     action: 'load' | 'save' | 'clear',
//     chatKey: string,           // mesma chave que antes era a key do localStorage
//                                //   'mscolors_chat_<clientId>'        (portal da cliente)
//                                //   'mscolors_chat_admin_<clientId>'  (admin, dentro do perfil da cliente)
//                                //   'ms_color_ia_<adminId>'           (admin, MS Color IA standalone)
//     portalToken?: string,      // presente => contexto cliente (sem JWT)
//     messages?: any[],          // obrigatório em action='save'
//   }
//
//   action 'load'  → resposta: { messages: any[] }
//   action 'save'  → resposta: { ok: true }
//   action 'clear' → resposta: { ok: true }
//
// Autorização (mesmo padrão de gemini-proxy e drive):
//   • Contexto ADMIN  → JWT no header Authorization. admin_id = auth.uid().
//   • Contexto CLIENTE → portalToken no body. admin_id/client_id resolvidos
//                        via clients.token.
//   A tabela ai_chat_history não tem policy pra anon/authenticated — TODO
//   acesso passa por aqui (service role), que valida a posse do chatKey
//   antes de ler/gravar (ver resolveOwnership).
//
// Deploy:
//   supabase functions deploy chat-sync
//
// Secrets necessários (já existem no projeto Supabase por padrão):
//   SUPABASE_URL              (auto)
//   SUPABASE_SERVICE_ROLE_KEY (auto)
// ════════════════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ──────────────────────────────────────────────────────────────
// CORS — mesma allowlist usada nas outras Edge Functions do projeto.
// Ajuste aqui se adicionar um novo domínio.
// ──────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://www.iacolor.online',
  'https://iacolor.online',
  'https://painel.mariliasantoscolor.com.br',
  // 'https://OUTRO_DOMINIO.com.br',   // ← descomente/adicione se houver mais

  'http://localhost:5173',
  'http://localhost:3000',
]

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

// ──────────────────────────────────────────────────────────────
// Helpers de infra
// ──────────────────────────────────────────────────────────────

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function adminSb(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

async function getAuthUserId(req: Request, sb: SupabaseClient): Promise<string | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user.id
}

// ──────────────────────────────────────────────────────────────
// Posse do chatKey — nunca confiamos na chave que vem do front sem
// confirmar que ela realmente pertence a quem está autenticado.
// ──────────────────────────────────────────────────────────────

async function resolveOwnership(
  req: Request, sb: SupabaseClient, chatKey: string, portalToken: string | undefined,
): Promise<{ adminId: string; clientId: string | null }> {
  if (portalToken) {
    // Contexto cliente: resolve admin/cliente dono via clients.token.
    const { data: client } = await sb
      .from('clients')
      .select('id, admin_id')
      .eq('token', portalToken)
      .maybeSingle()
    if (!client?.admin_id) throw new Error('Token de portal inválido.')
    if (chatKey !== `mscolors_chat_${client.id}`) {
      throw new Error('Chave de histórico não corresponde ao token informado.')
    }
    return { adminId: client.admin_id as string, clientId: client.id as string }
  }

  // Contexto admin: resolve pelo JWT.
  const adminId = await getAuthUserId(req, sb)
  if (!adminId) throw new Error('Não autenticado.')

  // Chat da MS Color IA (standalone, sem cliente vinculado).
  if (chatKey === `ms_color_ia_${adminId}`) return { adminId, clientId: null }

  // Chat do admin dentro do perfil de uma cliente específica.
  const m = chatKey.match(/^mscolors_chat_admin_(.+)$/)
  if (m) {
    const candidateClientId = m[1]
    const { data: client } = await sb
      .from('clients')
      .select('id')
      .eq('id', candidateClientId)
      .eq('admin_id', adminId)
      .maybeSingle()
    if (!client) throw new Error('Esta cliente não pertence a este usuário.')
    return { adminId, clientId: candidateClientId }
  }

  throw new Error('Chave de histórico inválida para este usuário.')
}

// ──────────────────────────────────────────────────────────────
// HANDLER
// ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido' }, 405, origin)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400, origin)
  }

  const action: string = body?.action
  const chatKey: string = body?.chatKey
  const portalToken: string | undefined = body?.portalToken || undefined

  if (!action) return json({ error: 'action obrigatório' }, 400, origin)
  if (!chatKey) return json({ error: 'chatKey obrigatório' }, 400, origin)

  const sb = adminSb()

  let owner: { adminId: string; clientId: string | null }
  try {
    owner = await resolveOwnership(req, sb, chatKey, portalToken)
  } catch (e: any) {
    const msg = e?.message || 'Falha ao resolver credenciais.'
    const status = /não autenticado/i.test(msg) ? 401 : 403
    return json({ error: msg }, status, origin)
  }

  try {
    if (action === 'load') {
      const { data, error } = await sb
        .from('ai_chat_history')
        .select('messages')
        .eq('chat_key', chatKey)
        .maybeSingle()
      if (error) throw error
      return json({ messages: data?.messages ?? [] }, 200, origin)
    }

    if (action === 'save') {
      const messages = body?.messages
      if (!Array.isArray(messages)) return json({ error: 'messages deve ser um array' }, 400, origin)
      const { error } = await sb.from('ai_chat_history').upsert(
        {
          chat_key:   chatKey,
          admin_id:   owner.adminId,
          client_id:  owner.clientId,
          messages,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'chat_key' },
      )
      if (error) throw error
      return json({ ok: true }, 200, origin)
    }

    if (action === 'clear') {
      const { error } = await sb.from('ai_chat_history').delete().eq('chat_key', chatKey)
      if (error) throw error
      return json({ ok: true }, 200, origin)
    }

    return json({ error: `action desconhecida: ${action}` }, 400, origin)
  } catch (e: any) {
    return json({ error: e?.message || 'Erro interno no chat-sync.' }, 500, origin)
  }
})
