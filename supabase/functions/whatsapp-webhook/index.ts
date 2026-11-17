// supabase/functions/whatsapp-webhook/index.ts
//
// Recebe os eventos da Cloud API da Meta e faz DUAS coisas:
//
// 1) Registra a SAÍDA de marketing:
//   • cliente responde SAIR / PARAR / STOP... (texto)
//   • cliente toca no botão "Parar de receber" do template
//   • a Meta avisa que a entrega falhou porque a cliente desativou
//     mensagens de marketing (código 131050)
//   Nos três casos: clients.whatsapp_marketing_opt_out_at = agora, e as mensagens
//   ainda pendentes dela em campanhas viram "puladas". Depois disso nenhuma
//   campanha envia mais pra ela (o prepare e o send respeitam esse campo).
//   Também responde uma confirmação curta (dentro da janela de 24h de atendimento).
//
// 2) RESPOSTA AUTOMÁTICA DE SUPORTE:
//   Quando alguém manda qualquer mensagem pra este número (que só dispara avisos),
//   responde um texto orientando a falar com o suporte. No máximo 1 vez a cada
//   AUTO_REPLY_COOLDOWN_HOURS por contato (tabela whatsapp_auto_replies, migration 008),
//   pra não responder a cada mensagem. Não responde a quem acabou de pedir pra sair
//   (essa pessoa já recebe a confirmação) nem a reações (👍).
//
// ───────────── CONFIGURAÇÃO (uma vez) ─────────────
// 1) Secrets:
//      supabase secrets set WA_VERIFY_TOKEN=<uma-frase-longa-que-você-inventa>
//      supabase secrets set META_APP_SECRET=<App Secret do app na Meta>
//    (App Secret: developers.facebook.com → seu app → Configurações → Básico)
// 2) Deploy SEM verificação de JWT (a Meta não manda JWT; quem garante a
//    autenticidade aqui é a assinatura HMAC do corpo):
//      supabase functions deploy whatsapp-webhook --no-verify-jwt
// 3) Na Meta: seu app → WhatsApp → Configuração → Webhook
//      URL de callback: https://<seu-projeto>.supabase.co/functions/v1/whatsapp-webhook
//      Token de verificação: o mesmo WA_VERIFY_TOKEN
//      Depois de verificar, assine o campo "messages".
// 4) Rode as migrations 007 (find_client_ids_by_phone) e 008 (whatsapp_auto_replies).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GRAPH_VERSION = Deno.env.get('WA_GRAPH_VERSION') ?? 'v22.0'
const VERIFY_TOKEN = Deno.env.get('WA_VERIFY_TOKEN') ?? ''
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? ''

const CONFIRMATION_TEXT =
  'Pronto! Você não vai mais receber nossas ofertas por aqui. Se mudar de ideia, é só nos avisar. 💛'

// Resposta automática de suporte. Pra mudar o texto, edite aqui e faça o deploy de novo.
const SUPPORT_TEXT = [
  'Olá! Este número é utilizado apenas para o envio de avisos e do seu resultado, por isso não conseguimos visualizar mensagens por aqui.',
  '',
  'Mas fique tranquilo(a)! Estamos à disposição para esclarecer suas dúvidas e oferecer todo o suporte que você precisar.',
  '',
  '📲 Para falar com a Marília e receber atendimento, chame no WhatsApp: +55 41 98467-2087.',
  '',
  'Será um prazer ajudar você! 🤍',
].join('\n')

// Intervalo mínimo entre duas respostas automáticas para o mesmo contato.
const AUTO_REPLY_COOLDOWN_HOURS = 24

// Frases (já normalizadas: minúsculas, sem acento nem pontuação) que contam
// como pedido de saída. Comparação EXATA — "quero sair da cidade" não conta.
const OPT_OUT_PHRASES = new Set([
  'sair', 'sair da lista', 'parar', 'pare', 'stop', 'cancelar', 'cancela',
  'descadastrar', 'remover', 'parar de receber', 'nao quero receber',
  'nao quero mais receber', 'nao quero mais', 'desativar mensagens',
])

const OPT_OUT_ERROR_CODE = 131050

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Confere a assinatura HMAC-SHA256 que a Meta manda em x-hub-signature-256. */
async function validSignature(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET || !header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
  const given = header.slice('sha256='.length)
  if (expected.length !== given.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

interface OptOutEvent {
  phone: string // só dígitos, como a Meta manda (ex: 5541999998888)
  phoneNumberId: string | null
  reason: string
}

interface IncomingEvent {
  phone: string
  phoneNumberId: string
}

/** Extrai do payload da Meta quem pediu pra sair. */
function collectOptOuts(payload: any): OptOutEvent[] {
  const out = new Map<string, OptOutEvent>()

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {}
      const phoneNumberId: string | null = value?.metadata?.phone_number_id ?? null

      // Mensagens que a cliente enviou (texto ou toque em botão do template)
      for (const m of value?.messages ?? []) {
        const candidates: string[] = []
        if (m?.type === 'text' && m.text?.body) candidates.push(m.text.body)
        if (m?.type === 'button') candidates.push(m.button?.text ?? '', m.button?.payload ?? '')
        if (m?.type === 'interactive') {
          candidates.push(m.interactive?.button_reply?.title ?? '', m.interactive?.list_reply?.title ?? '')
        }
        const hit = candidates.map(normalizeText).find((c) => c && OPT_OUT_PHRASES.has(c))
        if (hit && m?.from) {
          const phone = String(m.from).replace(/\D/g, '')
          out.set(phone, { phone, phoneNumberId, reason: `resposta: "${hit}"` })
        }
      }

      // Falha de entrega porque a cliente desativou marketing no WhatsApp
      for (const st of value?.statuses ?? []) {
        const code = st?.errors?.[0]?.code
        if (st?.status === 'failed' && code === OPT_OUT_ERROR_CODE && st?.recipient_id) {
          const phone = String(st.recipient_id).replace(/\D/g, '')
          out.set(phone, { phone, phoneNumberId, reason: 'desativou marketing no WhatsApp (131050)' })
        }
      }
    }
  }
  return [...out.values()]
}

/** Extrai do payload quem MANDOU mensagem pra este número (candidatas à resposta automática). */
function collectIncoming(payload: any): IncomingEvent[] {
  const out = new Map<string, IncomingEvent>()
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {}
      const phoneNumberId: string | null = value?.metadata?.phone_number_id ?? null
      if (!phoneNumberId) continue
      for (const m of value?.messages ?? []) {
        if (!m?.from) continue
        // Reação (👍 numa mensagem nossa) não é pedido de atendimento.
        if (m.type === 'reaction') continue
        const phone = String(m.from).replace(/\D/g, '')
        if (phone) out.set(phone, { phone, phoneNumberId })
      }
    }
  }
  return [...out.values()]
}

type Db = ReturnType<typeof createClient>

/** Access Token do número (guardado em admin_content/whatsapp_settings). */
async function getAccessToken(
  db: Db,
  phoneNumberId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(phoneNumberId)) return cache.get(phoneNumberId) ?? null
  const { data: cfgRow } = await db
    .from('admin_content')
    .select('content')
    .eq('type', 'whatsapp_settings')
    .eq('content->>phoneNumberId', phoneNumberId)
    .limit(1)
    .maybeSingle()
  const token = (cfgRow?.content as { accessToken?: string } | null)?.accessToken ?? null
  cache.set(phoneNumberId, token)
  return token
}

async function sendText(token: string, phoneNumberId: string, to: string, body: string): Promise<boolean> {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    console.warn('[whatsapp-webhook] Meta recusou o envio:', resp.status, detail.slice(0, 300))
  }
  return resp.ok
}

/**
 * Resposta automática de suporte, no máximo 1 vez por contato a cada
 * AUTO_REPLY_COOLDOWN_HOURS. Nunca lança: falha aqui não pode virar 500
 * (a Meta reenviaria o evento e o opt-out seria processado de novo).
 */
async function maybeAutoReply(db: Db, ev: IncomingEvent, tokenCache: Map<string, string | null>) {
  try {
    const since = Date.now() - AUTO_REPLY_COOLDOWN_HOURS * 3600_000

    const { data: last } = await db
      .from('whatsapp_auto_replies')
      .select('last_replied_at')
      .eq('phone', ev.phone)
      .maybeSingle()
    if (last?.last_replied_at && new Date(last.last_replied_at).getTime() > since) return

    const token = await getAccessToken(db, ev.phoneNumberId, tokenCache)
    if (!token) return

    // Reserva ANTES de enviar: se a Meta reenviar o mesmo evento, não responde duas vezes.
    const { error: claimErr } = await db
      .from('whatsapp_auto_replies')
      .upsert({ phone: ev.phone, last_replied_at: new Date().toISOString() }, { onConflict: 'phone' })
    if (claimErr) {
      console.warn('[whatsapp-webhook] não consegui registrar a resposta automática:', claimErr.message)
      return
    }

    const ok = await sendText(token, ev.phoneNumberId, ev.phone, SUPPORT_TEXT)
    if (!ok) {
      // Falhou o envio: libera a reserva pra uma próxima mensagem tentar de novo.
      await db.from('whatsapp_auto_replies').delete().eq('phone', ev.phone)
    }
  } catch (e) {
    console.warn('[whatsapp-webhook] falha na resposta automática:', e)
  }
}

Deno.serve(async (req) => {
  // ── Verificação inicial do webhook (a Meta chama via GET) ──
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
      return text(challenge)
    }
    return text('Forbidden', 403)
  }

  if (req.method !== 'POST') return text('Method not allowed', 405)

  // ── Eventos ──
  const raw = await req.text()
  if (!APP_SECRET) {
    console.error('[whatsapp-webhook] META_APP_SECRET não configurado — recusando eventos.')
    return text('Server misconfigured', 500)
  }
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) {
    return text('Invalid signature', 401)
  }

  try {
    const payload = JSON.parse(raw)
    const optOuts = collectOptOuts(payload)
    const incoming = collectIncoming(payload)
    if (optOuts.length === 0 && incoming.length === 0) return text('ok')

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )
    const tokenCache = new Map<string, string | null>()

    // ── 1) Saídas de marketing ──
    for (const ev of optOuts) {
      const { data: matches, error } = await db.rpc('find_client_ids_by_phone', { p_digits: ev.phone })
      if (error) throw new Error(error.message)
      const ids = ((matches ?? []) as { id: string }[]).map((r) => r.id)

      if (ids.length > 0) {
        // Confere o erro de cada gravação: sem isso, uma falha passava em silêncio, a
        // Meta recebia "ok" e o pedido de saída se perdia (a cliente seguia na lista).
        const { error: optErr } = await db
          .from('clients')
          .update({ whatsapp_marketing_opt_out_at: new Date().toISOString() })
          .in('id', ids)
          .is('whatsapp_marketing_opt_out_at', null)
        if (optErr) throw new Error(optErr.message)

        const { error: skipErr } = await db
          .from('whatsapp_campaign_messages')
          .update({ status: 'skipped', skip_reason: 'cliente pediu para sair', claimed_at: null })
          .in('client_id', ids)
          .eq('status', 'pending')
        if (skipErr) throw new Error(skipErr.message)
      }
      console.info(`[whatsapp-webhook] saída registrada (${ev.reason}); clientes: ${ids.length}`)

      // Confirmação curta. Só se achamos a cliente — evita responder número desconhecido.
      if (ids.length > 0 && ev.phoneNumberId) {
        try {
          const token = await getAccessToken(db, ev.phoneNumberId, tokenCache)
          if (token) await sendText(token, ev.phoneNumberId, ev.phone, CONFIRMATION_TEXT)
        } catch (e) {
          console.warn('[whatsapp-webhook] falha ao enviar confirmação:', e)
        }
      }
    }

    // ── 2) Resposta automática de suporte ──
    // Quem acabou de pedir pra sair já recebeu a confirmação acima: não manda o aviso também.
    const optedOutPhones = new Set(optOuts.map((o) => o.phone))
    for (const ev of incoming) {
      if (optedOutPhones.has(ev.phone)) continue
      await maybeAutoReply(db, ev, tokenCache)
    }

    return text('ok')
  } catch (e) {
    // 500 faz a Meta tentar de novo mais tarde — certo pra erro transitório de banco.
    console.error('[whatsapp-webhook] exceção:', e)
    return text('error', 500)
  }
})