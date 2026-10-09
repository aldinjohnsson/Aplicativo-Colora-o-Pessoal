// supabase/functions/send-whatsapp-campaign/index.ts
//
// Campanhas de MARKETING por WhatsApp (Cloud API oficial da Meta), por plano.
// Só super_admin. Depende das migrations 001, 002 e 003.
//
// Ações (POST JSON, sempre com o JWT do usuário logado no Authorization):
//
//   { action: 'prepare', campaignId }
//       Congela a lista de destinatárias da campanha: clientes da admin, com
//       opt-in de MARKETING e sem opt-out, nos planos/status escolhidos.
//       Telefone inválido ou repetido vira 'skipped' (com o motivo).
//       Pode ser chamada de novo enquanto a campanha estiver em draft/prepared.
//
//   { action: 'send', campaignId, resume? }
//       Envia UM lote (até BATCH_MAX) respeitando o limite de contatos por
//       24h. O front chama em loop até `done`, `limitReached` ou `rateLimited`.
//       Cada cliente é revalidada na hora (consentimento pode ter sido retirado
//       entre o prepare e o send).
//
//   (Template com imagem no cabeçalho: a URL pública da imagem fica em
//    whatsapp_campaigns.header_image_url e vai junto de cada envio. Botões de
//    URL ESTÁTICA não precisam de parâmetro; botão de resposta rápida idem.)
//
//   { action: 'test', campaignId, to, name? }
//       Manda o template da campanha pra UM número, sem registrar nada.
//
// ⚠️ O limite diário da Meta conta TODA conversa iniciada pela empresa em 24h —
// inclusive os avisos "análise concluída" (send-whatsapp), que não passam por
// aqui. Deixe `daily_limit` da campanha abaixo do limite real do número.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GRAPH_VERSION = Deno.env.get('WA_GRAPH_VERSION') ?? 'v22.0'
const SITE_URL = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')

const BATCH_MAX = 100
const CONCURRENCY = 5
const STALE_CLAIM_MINUTES = 10
const PAGE_SIZE = 1000
const INSERT_CHUNK = 500
const GRAPH_TIMEOUT_MS = 20_000

// Erros da Meta que significam "pare e tente mais tarde" / "token inválido".
const RATE_LIMIT_CODES = new Set([4, 17, 80007, 130429, 131056])
const AUTH_ERROR_CODES = new Set([102, 190])
// A cliente desativou mensagens de marketing deste número no WhatsApp.
const OPT_OUT_CODES = new Set([131050])
// Problema no TEMPLATE (não existe, parâmetros errados, pausado...). Vale pra
// TODAS as mensagens: melhor parar a campanha do que marcar centenas como falha.
const TEMPLATE_ERROR_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

type Db = ReturnType<typeof createClient>

interface VariableDef {
  kind: 'first_name' | 'portal_link' | 'text'
  value?: string
}

interface Campaign {
  id: string
  admin_id: string
  name: string
  template_name: string
  template_lang: string
  variables: VariableDef[]
  plan_ids: string[]
  statuses: string[]
  daily_limit: number
  status: string
  header_image_url: string | null
}

interface WaSettings {
  phoneNumberId?: string
  accessToken?: string
}

// ───────────────────────── helpers ─────────────────────────

/** Primeiro nome pra saudação. */
function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || 'cliente'
}

/**
 * Normalização ESTRITA (mais rígida que a do send-whatsapp, de propósito:
 * campanha em massa não pode mandar pra número "chutado").
 *  - Com "+": código do país já embutido, 8-15 dígitos.
 *  - Sem "+": só aceita BR — 10/11 dígitos (DDD+fone, coloca 55) ou
 *    12/13 dígitos começando com 55. DDD precisa ser >= 11.
 *  - Qualquer outra coisa: null (vira 'skipped / telefone inválido').
 */
function normalizePhoneStrict(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null
  }

  let national: string | null = null
  if (digits.length === 10 || digits.length === 11) national = digits
  else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    national = digits.slice(2)
  }
  if (!national) return null

  const ddd = Number(national.slice(0, 2))
  if (!(ddd >= 11 && ddd <= 99)) return null
  return `55${national}`
}

/** A Meta rejeita \n, \t e muitos espaços seguidos em parâmetros de template. */
function sanitizeParam(v: string): string {
  const s = v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 1000)
  return s || '-'
}

function buildParams(vars: VariableDef[], ctx: { firstName: string; link: string }) {
  return vars.map((v) => {
    if (v.kind === 'first_name') return { type: 'text', text: sanitizeParam(ctx.firstName) }
    if (v.kind === 'portal_link') return { type: 'text', text: sanitizeParam(ctx.link) }
    return { type: 'text', text: sanitizeParam(v.value ?? '') }
  })
}

function validateCampaign(c: Campaign): string | null {
  if (!c.template_name?.trim()) return 'Campanha sem nome de template.'
  if (!Array.isArray(c.variables)) return 'Variáveis da campanha inválidas.'
  for (const [i, v] of c.variables.entries()) {
    if (!['first_name', 'portal_link', 'text'].includes(v?.kind)) {
      return `Variável {{${i + 1}}} com tipo inválido.`
    }
    if (v.kind === 'text' && !v.value?.trim()) {
      return `Variável {{${i + 1}}} (texto) está vazia.`
    }
  }
  if (c.header_image_url && !/^https:\/\//i.test(c.header_image_url)) {
    return 'A imagem do cabeçalho precisa ser um link https público.'
  }
  if (!Array.isArray(c.plan_ids) || c.plan_ids.length === 0) {
    return 'Escolha ao menos um plano para a campanha.'
  }
  return null
}

function needsPortalLink(c: Campaign): boolean {
  return c.variables.some((v) => v.kind === 'portal_link')
}

async function authenticate(req: Request, db: Db) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data, error } = await db.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

/** Chamada à Cloud API. Nunca lança: devolve ok/erro estruturado. */
async function sendTemplate(
  cfg: WaSettings,
  campaign: Campaign,
  to: string,
  params: { type: string; text: string }[],
): Promise<
  | { ok: true; messageId: string | null }
  | { ok: false; code: number | null; message: string }
> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.phoneNumberId}/messages`
  const template: Record<string, unknown> = {
    name: campaign.template_name,
    language: { code: campaign.template_lang || 'pt_BR' },
  }
  const components: Record<string, unknown>[] = []
  if (campaign.header_image_url) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: campaign.header_image_url } }],
    })
  }
  if (params.length > 0) components.push({ type: 'body', parameters: params })
  if (components.length > 0) template.components = components

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), GRAPH_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template }),
      signal: ctrl.signal,
    })
    const result = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      const err = result?.error ?? {}
      return {
        ok: false,
        code: typeof err.code === 'number' ? err.code : null,
        message: String(err.error_data?.details ?? err.message ?? `HTTP ${resp.status}`),
      }
    }
    return { ok: true, messageId: result?.messages?.[0]?.id ?? null }
  } catch (e) {
    return { ok: false, code: null, message: `Falha de rede: ${String((e as Error)?.message ?? e)}` }
  } finally {
    clearTimeout(timer)
  }
}

async function getCounts(db: Db, campaignId: string) {
  const statuses = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const
  const results = await Promise.all(
    statuses.map((s) =>
      db
        .from('whatsapp_campaign_messages')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', s),
    ),
  )
  const out: Record<string, number> = {}
  statuses.forEach((s, i) => { out[s] = results[i].count ?? 0 })
  return out as Record<(typeof statuses)[number], number>
}

// ───────────────────────── handler ─────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    // service role: lê/escreve por baixo do RLS. NUNCA exponha no front.
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // 1) Quem está chamando? (a chave anon do site NÃO passa aqui)
    const user = await authenticate(req, db)
    if (!user) return json({ error: 'Não autorizado' }, 401)

    const { data: au } = await db.from('admin_users').select('role').eq('id', user.id).maybeSingle()
    if (au?.role !== 'super_admin') return json({ error: 'Apenas super_admin' }, 403)

    const payload = await req.json().catch(() => ({}))
    const { action, campaignId } = payload as { action?: string; campaignId?: string }
    if (!action || !campaignId) return json({ error: 'action e campaignId são obrigatórios' }, 400)

    // 2) Campanha (só as da própria admin)
    const { data: campaignRow } = await db
      .from('whatsapp_campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('admin_id', user.id)
      .maybeSingle()
    if (!campaignRow) return json({ error: 'Campanha não encontrada' }, 404)
    const campaign = campaignRow as Campaign

    // ─────────────── PREPARE ───────────────
    if (action === 'prepare') {
      if (!['draft', 'prepared'].includes(campaign.status)) {
        return json({ error: `Campanha "${campaign.status}" não pode ser preparada de novo.` }, 409)
      }
      const invalid = validateCampaign(campaign)
      if (invalid) return json({ error: invalid }, 400)

      // Recomeça a lista (nada foi enviado ainda neste estado).
      await db
        .from('whatsapp_campaign_messages')
        .delete()
        .eq('campaign_id', campaign.id)
        .in('status', ['pending', 'skipped'])

      // Público: opt-in de MARKETING, sem opt-out, não arquivada, no plano/status.
      const audience: { id: string; phone: string | null }[] = []
      for (let from = 0; ; from += PAGE_SIZE) {
        let q = db
          .from('clients')
          .select('id, phone')
          .eq('admin_id', user.id)
          .eq('is_archived', false)
          .eq('whatsapp_marketing_opt_in', true)
          .is('whatsapp_marketing_opt_out_at', null)
          .in('plan_id', campaign.plan_ids)
          .not('phone', 'is', null)
        if (campaign.statuses?.length) q = q.in('status', campaign.statuses)
        const { data, error } = await q
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(error.message)
        audience.push(...(data ?? []))
        if (!data || data.length < PAGE_SIZE) break
      }

      // Mesma pessoa pode ter 2 cadastros (repetiu a análise) — manda só 1 vez.
      const seen = new Set<string>()
      const rows = audience.map((c) => {
        const phone = normalizePhoneStrict(c.phone)
        let status = 'pending'
        let skip_reason: string | null = null
        if (!phone) {
          status = 'skipped'
          skip_reason = 'telefone inválido'
        } else if (seen.has(phone)) {
          status = 'skipped'
          skip_reason = 'telefone repetido nesta campanha'
        } else {
          seen.add(phone)
        }
        return {
          campaign_id: campaign.id,
          client_id: c.id,
          admin_id: user.id,
          phone: phone ?? c.phone,
          status,
          skip_reason,
        }
      })

      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const { error } = await db
          .from('whatsapp_campaign_messages')
          .upsert(rows.slice(i, i + INSERT_CHUNK), {
            onConflict: 'campaign_id,client_id',
            ignoreDuplicates: true,
          })
        if (error) throw new Error(error.message)
      }

      await db
        .from('whatsapp_campaigns')
        .update({ status: 'prepared', prepared_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', campaign.id)

      const counts = await getCounts(db, campaign.id)
      return json({ ok: true, audience: audience.length, ...counts })
    }

    // Configuração de envio (credenciais da Meta) — comum a send e test.
    const { data: cfgRow } = await db
      .from('admin_content')
      .select('content')
      .eq('admin_id', user.id)
      .eq('type', 'whatsapp_settings')
      .maybeSingle()
    const cfg = (cfgRow?.content ?? {}) as WaSettings
    if (!cfg.phoneNumberId || !cfg.accessToken) {
      return json({ error: 'Credenciais do WhatsApp não configuradas (Phone Number ID / Access Token).' }, 400)
    }
    if (needsPortalLink(campaign) && !SITE_URL) {
      return json({ error: 'SITE_URL não configurada na edge function (necessária pra variável de link do portal).' }, 500)
    }

    // ─────────────── TEST ───────────────
    if (action === 'test') {
      const invalid = validateCampaign({ ...campaign, plan_ids: campaign.plan_ids?.length ? campaign.plan_ids : ['-'] })
      if (invalid) return json({ error: invalid }, 400)
      const to = normalizePhoneStrict(String(payload.to ?? ''))
      if (!to) return json({ error: 'Número de teste inválido' }, 400)

      const params = buildParams(campaign.variables, {
        firstName: firstName(String(payload.name ?? 'Teste')),
        link: `${SITE_URL}/c/TOKEN_DE_TESTE`,
      })
      const r = await sendTemplate(cfg, campaign, to, params)
      if (!r.ok) return json({ error: 'Falha na Cloud API', detail: r.message, code: r.code }, 502)
      return json({ ok: true, to, messageId: r.messageId })
    }

    // ─────────────── SEND (um lote) ───────────────
    if (action === 'send') {
      const resumable = campaign.status === 'paused' && payload.resume === true
      if (!['prepared', 'sending'].includes(campaign.status) && !resumable) {
        return json({ error: `Campanha "${campaign.status}" não pode ser enviada.` }, 409)
      }
      const invalid = validateCampaign(campaign)
      if (invalid) return json({ error: invalid }, 400)

      if (campaign.status !== 'sending') {
        await db
          .from('whatsapp_campaigns')
          .update({ status: 'sending', updated_at: new Date().toISOString() })
          .eq('id', campaign.id)
      }

      // Reservas esquecidas (função caiu no meio) voltam pra fila.
      const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString()
      await db
        .from('whatsapp_campaign_messages')
        .update({ status: 'pending', claimed_at: null })
        .eq('campaign_id', campaign.id)
        .eq('status', 'sending')
        .lt('claimed_at', staleBefore)

      // Janela de 24h: tudo que a admin já mandou (qualquer campanha) + em andamento.
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const [sentRes, inflightRes, oldestRes] = await Promise.all([
        db.from('whatsapp_campaign_messages').select('id', { count: 'exact', head: true })
          .eq('admin_id', user.id).eq('status', 'sent').gte('sent_at', since),
        db.from('whatsapp_campaign_messages').select('id', { count: 'exact', head: true })
          .eq('admin_id', user.id).eq('status', 'sending').gte('claimed_at', since),
        db.from('whatsapp_campaign_messages').select('sent_at')
          .eq('admin_id', user.id).eq('status', 'sent').gte('sent_at', since)
          .order('sent_at', { ascending: true }).limit(1),
      ])
      const usedToday = (sentRes.count ?? 0) + (inflightRes.count ?? 0)
      const remainingToday = Math.max(0, campaign.daily_limit - usedToday)

      const finish = async (
        extra: {
          limitReached?: boolean
          rateLimited?: boolean
          authError?: boolean
          templateError?: string | null
          resumeAfter?: string | null
        },
      ) => {
        const counts = await getCounts(db, campaign.id)
        const done = counts.pending + counts.sending === 0
        const stopped = extra.limitReached || extra.rateLimited || extra.authError || !!extra.templateError
        const nextStatus = done ? 'completed' : stopped ? 'paused' : 'sending'
        await db
          .from('whatsapp_campaigns')
          .update({ status: nextStatus, updated_at: new Date().toISOString() })
          .eq('id', campaign.id)
        return json({
          ok: true,
          done,
          campaignStatus: nextStatus,
          remainingToday: Math.max(0, remainingToday),
          limitReached: !!extra.limitReached,
          rateLimited: !!extra.rateLimited,
          authError: !!extra.authError,
          templateError: extra.templateError ?? null,
          resumeAfter: extra.resumeAfter ?? null,
          ...counts,
        })
      }

      if (remainingToday <= 0) {
        const oldest = oldestRes.data?.[0]?.sent_at
        const resumeAfter = oldest ? new Date(new Date(oldest).getTime() + 24 * 3600_000).toISOString() : null
        return await finish({ limitReached: true, resumeAfter })
      }

      // Reserva o lote (pending -> sending). Duas chamadas simultâneas pegam
      // linhas diferentes porque o UPDATE só vale onde status ainda é 'pending'.
      const take = Math.min(remainingToday, BATCH_MAX)
      const { data: candidates } = await db
        .from('whatsapp_campaign_messages')
        .select('id')
        .eq('campaign_id', campaign.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .order('id')
        .limit(take)
      const ids = (candidates ?? []).map((r: { id: string }) => r.id)
      if (ids.length === 0) return await finish({})

      const { data: claimedRows } = await db
        .from('whatsapp_campaign_messages')
        .update({ status: 'sending', claimed_at: new Date().toISOString() })
        .in('id', ids)
        .eq('status', 'pending')
        .select('id, client_id, phone')
      const claimed = (claimedRows ?? []) as { id: string; client_id: string; phone: string | null }[]
      if (claimed.length === 0) return await finish({})

      const { data: clientRows } = await db
        .from('clients')
        .select('id, full_name, token, admin_id, is_archived, whatsapp_marketing_opt_in, whatsapp_marketing_opt_out_at')
        .in('id', claimed.map((m) => m.client_id))
      const clientById = new Map((clientRows ?? []).map((c: any) => [c.id, c]))

      const stop: { reason: null | 'rate' | 'auth' | 'template'; detail?: string } = { reason: null }

      const setMsg = (id: string, patch: Record<string, unknown>) =>
        db.from('whatsapp_campaign_messages').update(patch).eq('id', id)

      const processOne = async (m: { id: string; client_id: string; phone: string | null }) => {
        // Outro erro grave já mandou parar: devolve pra fila sem tentar.
        if (stop.reason) {
          await setMsg(m.id, { status: 'pending', claimed_at: null })
          return
        }

        const client: any = clientById.get(m.client_id)
        // Revalida o consentimento NA HORA do envio.
        if (
          !client ||
          client.admin_id !== user.id ||
          client.is_archived ||
          client.whatsapp_marketing_opt_in !== true ||
          client.whatsapp_marketing_opt_out_at
        ) {
          await setMsg(m.id, {
            status: 'skipped',
            skip_reason: 'consentimento removido ou cliente arquivada',
            claimed_at: null,
          })
          return
        }
        if (!m.phone) {
          await setMsg(m.id, { status: 'skipped', skip_reason: 'telefone inválido', claimed_at: null })
          return
        }

        const params = buildParams(campaign.variables, {
          firstName: firstName(client.full_name),
          link: client.token ? `${SITE_URL}/c/${client.token}` : '',
        })
        const r = await sendTemplate(cfg, campaign, m.phone, params)

        if (r.ok) {
          await setMsg(m.id, {
            status: 'sent',
            message_id: r.messageId,
            sent_at: new Date().toISOString(),
            claimed_at: null,
            error: null,
          })
          return
        }

        // A cliente desativou marketing no próprio WhatsApp → registra a saída
        // pra ela nunca mais entrar em campanha e segue o lote.
        if (r.code !== null && OPT_OUT_CODES.has(r.code)) {
          await db
            .from('clients')
            .update({ whatsapp_marketing_opt_out_at: new Date().toISOString() })
            .eq('id', m.client_id)
            .eq('admin_id', user.id)
          await setMsg(m.id, {
            status: 'skipped',
            skip_reason: 'cliente desativou mensagens de marketing no WhatsApp',
            claimed_at: null,
          })
          return
        }
        if (r.code !== null && TEMPLATE_ERROR_CODES.has(r.code)) {
          stop.reason = stop.reason ?? 'template'
          stop.detail = stop.detail ?? `${r.code}: ${r.message}`
          await setMsg(m.id, { status: 'pending', claimed_at: null })
          return
        }
        if (r.code !== null && RATE_LIMIT_CODES.has(r.code)) {
          stop.reason = stop.reason ?? 'rate'
          await setMsg(m.id, { status: 'pending', claimed_at: null })
          return
        }
        if (r.code !== null && AUTH_ERROR_CODES.has(r.code)) {
          stop.reason = 'auth'
          await setMsg(m.id, { status: 'pending', claimed_at: null })
          return
        }

        console.error('[send-whatsapp-campaign] falha', m.id, r.code, r.message)
        await setMsg(m.id, {
          status: 'failed',
          error: `${r.code ?? 'erro'}: ${r.message}`.slice(0, 500),
          claimed_at: null,
        })
      }

      let next = 0
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, claimed.length) }, async () => {
          while (true) {
            const i = next++
            if (i >= claimed.length) break
            await processOne(claimed[i])
          }
        }),
      )

      return await finish({
        rateLimited: stop.reason === 'rate',
        authError: stop.reason === 'auth',
        templateError: stop.reason === 'template' ? (stop.detail ?? 'Erro no template') : null,
      })
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400)
  } catch (e) {
    console.error('[send-whatsapp-campaign] exceção:', e)
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})