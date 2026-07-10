// supabase/functions/send-whatsapp/index.ts
//
// Dispara uma mensagem de WhatsApp via Cloud API OFICIAL da Meta quando uma
// cliente é concluída. A config (credenciais + mensagens por plano) vive em
// admin_content (type='whatsapp_settings') sob o super_admin — mesmo padrão
// do global_email_settings usado pelo send-contract-email.
//
// Chamada pelo front:
//   supabase.functions.invoke('send-whatsapp', { body: { clientId } })
// Ou em modo teste:
//   supabase.functions.invoke('send-whatsapp', { body: { to, name, planId, test: true } })
//
// IMPORTANTE: mensagem iniciada pela empresa exige TEMPLATE APROVADO na Meta.
// Veja o modelo de template no README/checklist que acompanha este arquivo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GRAPH_VERSION = Deno.env.get('WA_GRAPH_VERSION') ?? 'v22.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

interface WhatsAppSettings {
  enabled?: boolean
  phoneNumberId?: string
  accessToken?: string
  templateName?: string
  templateLang?: string
  defaultMessage?: string
  planMessages?: Record<string, string>
}

/** Normaliza o telefone pro formato E.164 esperado pela Cloud API (Brasil). */
function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) return ''
  // Já tem código do país (55...) → usa direto. Senão, prefixa 55.
  return digits.startsWith('55') ? digits : `55${digits}`
}

/** Pega só o primeiro nome pra personalizar a saudação. */
function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || 'cliente'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      // service role: a function lê config do super_admin e dados da cliente
      // por baixo do RLS. NUNCA exponha esta chave no front.
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const payload = await req.json().catch(() => ({}))
    const { clientId, to: explicitTo, name: explicitName, planId: explicitPlanId, test } = payload

    // 1) Config global do WhatsApp (linha do super_admin)
    const { data: superAdmin } = await supabase
      .from('admin_users')
      .select('id')
      .eq('role', 'super_admin')
      .limit(1)
      .maybeSingle()

    if (!superAdmin?.id) return json({ skipped: 'sem super_admin configurado' })

    const { data: cfgRow } = await supabase
      .from('admin_content')
      .select('content')
      .eq('admin_id', superAdmin.id)
      .eq('type', 'whatsapp_settings')
      .maybeSingle()

    const cfg = (cfgRow?.content ?? {}) as WhatsAppSettings

    if (!cfg.enabled) return json({ skipped: 'notificação de WhatsApp desativada' })
    if (!cfg.phoneNumberId || !cfg.accessToken || !cfg.templateName) {
      return json({ skipped: 'credenciais/template do WhatsApp incompletos' })
    }

    // 2) Resolve destinatário, nome e plano
    let toPhone = ''
    let clientName = ''
    let planId: string | null = null

    if (clientId) {
      const { data: client, error: cErr } = await supabase
        .from('clients')
        .select('full_name, phone, plan_id, whatsapp_opt_in')
        .eq('id', clientId)
        .maybeSingle()

      if (cErr) {
        // Provável coluna ausente — não dispara sem ter como checar consentimento.
        console.warn('[send-whatsapp] erro ao ler cliente (rode a migration whatsapp_opt_in?):', cErr.message)
        return json({ skipped: 'não foi possível verificar o consentimento (coluna whatsapp_opt_in ausente?)' })
      }
      if (!client) return json({ skipped: 'cliente não encontrada' })
      if (client.whatsapp_opt_in !== true) {
        return json({ skipped: 'cliente não autorizou contato por WhatsApp' })
      }
      if (!client.phone) return json({ skipped: 'cliente sem telefone cadastrado' })

      toPhone = normalizePhone(client.phone)
      clientName = firstName(client.full_name)
      planId = client.plan_id ?? null
    } else if (explicitTo) {
      // modo teste
      toPhone = normalizePhone(explicitTo)
      clientName = firstName(explicitName || 'Teste')
      planId = explicitPlanId ?? null
    } else {
      return json({ error: 'clientId ou to é obrigatório' }, 400)
    }

    if (!toPhone) return json({ skipped: 'telefone inválido' })

    // 3) Mensagem parametrizada por plano (com fallback pro padrão)
    const planMessage =
      (planId && cfg.planMessages?.[planId]) ? cfg.planMessages[planId] : (cfg.defaultMessage || '')

    if (!planMessage.trim()) return json({ skipped: 'sem mensagem definida para este plano' })

    // 4) Dispara via Cloud API.
    //    Template esperado (2 variáveis no corpo): "Olá {{1}}! {{2}}"
    //      {{1}} = primeiro nome da cliente
    //      {{2}} = mensagem do plano (a parte que você parametriza)
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.phoneNumberId}/messages`
    const body = {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'template',
      template: {
        name: cfg.templateName,
        language: { code: cfg.templateLang || 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: clientName },
              { type: 'text', text: planMessage },
            ],
          },
        ],
      },
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const result = await resp.json().catch(() => ({}))

    if (!resp.ok) {
      console.error('[send-whatsapp] erro Meta:', JSON.stringify(result))
      return json(
        { error: 'Falha na Cloud API', detail: result?.error?.message ?? result },
        502,
      )
    }

    return json({
      ok: true,
      test: !!test,
      to: toPhone,
      messageId: result?.messages?.[0]?.id ?? null,
    })
  } catch (e) {
    console.error('[send-whatsapp] exceção:', e)
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})