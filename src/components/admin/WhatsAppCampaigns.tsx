// src/components/admin/WhatsAppCampaigns.tsx
//
// Campanhas de MARKETING por WhatsApp, por plano. SOMENTE super_admin.
// Aparece na aba "Campanhas WhatsApp" do SuperAdminPanel.
//
// Fluxo da tela:
//   1) Nova campanha → nome, template aprovado na Meta, variáveis, planos e
//      status das clientes, limite por dia.
//   2) "Preparar público" → a edge function congela a lista (só quem aceitou
//      marketing e não saiu) e mostra quantas entram / quantas são puladas.
//   3) "Enviar teste" → manda o template pro seu número antes de disparar.
//   4) "Disparar" → envia em lotes, respeitando o limite de contatos por 24h.
//
// O envio é conduzido por ESTA tela (ela chama a edge function lote a lote):
// mantenha a aba aberta enquanto envia. Se fechar, é só voltar e clicar em
// "Continuar envio" — nada é enviado duas vezes.
//
// Depende de: migrations 001/002/003, edge function send-whatsapp-campaign e
// as funções de campanha do whatsappService.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Megaphone, Plus, ArrowLeft, Send, Play, Pause, Loader2, AlertCircle,
  CheckCircle2, Copy, Ban, RefreshCw, Users, X, Trash2, Info, Upload, ExternalLink, Reply,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { adminService } from '../../lib/services'
import { useTheme } from '../../lib/theme'
import {
  prepareCampaign,
  runCampaign,
  sendCampaignTest,
  type CampaignVariable,
  type CampaignStatus,
  type CampaignCounts,
} from '../../lib/whatsappService'

// ───────────────────────── constantes ─────────────────────────

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  prepared: 'Pronta para enviar',
  sending: 'Enviando',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
}

const STATUS_COLOR: Record<CampaignStatus, string> = {
  draft: '#6b7280',
  prepared: '#3b82f6',
  sending: '#f59e0b',
  paused: '#f59e0b',
  completed: '#10b981',
  cancelled: '#ef4444',
}

// Status da CLIENTE (clients.status) — o que filtra "em que etapa ela está".
const CLIENT_STATUS_LABEL: Record<string, string> = {
  completed: 'Análise concluída',
  awaiting_contract: 'Aguardando contrato',
  awaiting_form: 'Aguardando formulário',
  awaiting_photos: 'Aguardando fotos',
  photos_submitted: 'Fotos enviadas',
  in_analysis: 'Em análise',
  simulating: 'Simulando',
  preparing_materials: 'Preparando materiais',
  awaiting_ai_photo: 'Aguardando foto IA',
  sending_dossier: 'Enviando dossiê',
  sending_capillary_dossier: 'Enviando dossiê capilar',
}

const VARIABLE_KIND_LABEL: Record<CampaignVariable['kind'], string> = {
  first_name: 'Primeiro nome da cliente',
  portal_link: 'Link do portal da cliente',
  text: 'Texto fixo (igual pra todas)',
}

const MAX_VARIABLES = 6

const EMPTY_COUNTS: CampaignCounts = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 }

interface CampaignRow {
  id: string
  name: string
  template_name: string
  template_lang: string
  variables: CampaignVariable[]
  plan_ids: string[]
  statuses: string[]
  daily_limit: number
  header_image_url: string | null
  preview_body: string | null
  preview_footer: string | null
  preview_button_link: string | null
  preview_button_reply: string | null
  status: CampaignStatus
  prepared_at: string | null
  created_at: string
  updated_at: string
}

interface FormState {
  name: string
  templateName: string
  templateLang: string
  variables: CampaignVariable[]
  planIds: string[]
  statuses: string[]
  dailyLimit: number
  headerImageUrl: string
  previewBody: string
  previewFooter: string
  previewButtonLink: string
  previewButtonReply: string
}

interface PlanLite { id: string; name: string; is_active?: boolean }

interface EligibleClient { plan_id: string | null; status: string }

const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

// ───────────────────────── estilos (tema do painel) ─────────────────────────

function useUi() {
  const { theme: t } = useTheme()
  const textDim = t.text2
  const card: React.CSSProperties = {
    background: t.cardBg,
    border: `1px solid ${t.border}`,
    borderRadius: 14,
  }
  const input: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    background: t.bg,
    color: t.text,
    border: `1px solid ${t.border}`,
    borderRadius: 10,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  }
  const btnPrimary: React.CSSProperties = {
    padding: '9px 18px',
    background: `linear-gradient(135deg, ${t.accent}, ${t.accent}dd)`,
    color: t.accentFg,
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    whiteSpace: 'nowrap',
  }
  const btnGhost: React.CSSProperties = {
    padding: '9px 16px',
    background: 'transparent',
    color: t.text,
    border: `1px solid ${t.border}`,
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    whiteSpace: 'nowrap',
  }
  return { t, textDim, card, input, btnPrimary, btnGhost }
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const color = STATUS_COLOR[status]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: `${color}1f`,
        border: `1px solid ${color}44`,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function Notice({ type, children }: { type: 'success' | 'error' | 'info'; children: React.ReactNode }) {
  const color = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'
  const Icon = type === 'success' ? CheckCircle2 : type === 'error' ? AlertCircle : Info
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderRadius: 10,
        fontSize: 13,
        color,
        background: `${color}14`,
        border: `1px solid ${color}40`,
      }}
    >
      <Icon size={16} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ wordBreak: 'break-word' }}>{children}</div>
    </div>
  )
}

// ───────────────────────── prévia estilo WhatsApp ─────────────────────────

/** Troca {{1}}, {{2}}... pelo exemplo de cada variável configurada. */
function renderPreviewBody(text: string, vars: CampaignVariable[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
    const v = vars[Number(n) - 1]
    if (!v) return `{{${n}}}`
    if (v.kind === 'first_name') return 'Maria'
    if (v.kind === 'portal_link') return `${window.location.origin}/c/a1b2c3…`
    return v.value?.trim() || `{{${n}}}`
  })
}

/** Maior número de variável usado no texto ({{3}} → 3). */
function maxPlaceholder(text: string): number {
  let max = 0
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]))
  return max
}

function WhatsAppPreview({
  imageUrl, body, footer, linkText, replyText,
}: { imageUrl: string; body: string; footer: string; linkText: string; replyText: string }) {
  const hasImg = /^https:\/\//i.test(imageUrl)
  const btn: React.CSSProperties = {
    borderTop: '1px solid #e9edef', textAlign: 'center', color: '#00a884', fontSize: 14,
    padding: '10px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }
  return (
    <div style={{ background: '#efeae2', borderRadius: 14, padding: 16 }}>
      <div
        style={{
          maxWidth: 320, background: '#fff', borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 1px 1px rgba(0,0,0,.13)', color: '#111',
        }}
      >
        {hasImg && <img src={imageUrl} alt="" style={{ width: '100%', display: 'block' }} />}
        <div style={{ padding: '8px 10px' }}>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.35, wordBreak: 'break-word' }}>
            {body.trim() ? body : <span style={{ color: '#8696a0' }}>A prévia aparece aqui quando você colar o texto do template.</span>}
          </div>
          {footer.trim() && <div style={{ fontSize: 12, color: '#667781', marginTop: 6 }}>{footer}</div>}
          <div style={{ fontSize: 11, color: '#667781', textAlign: 'right', marginTop: 2 }}>20:03</div>
        </div>
        {linkText.trim() && <div style={btn}><ExternalLink size={14} />{linkText}</div>}
        {replyText.trim() && <div style={btn}><Reply size={14} />{replyText}</div>}
      </div>
    </div>
  )
}

// ───────────────────────── componente raiz ─────────────────────────

type View = { mode: 'list' } | { mode: 'detail'; id: string | null; copyFrom?: CampaignRow }

export function WhatsAppCampaigns() {
  const [view, setView] = useState<View>({ mode: 'list' })

  if (view.mode === 'list') {
    return (
      <CampaignList
        onNew={() => setView({ mode: 'detail', id: null })}
        onOpen={(id) => setView({ mode: 'detail', id })}
        onDuplicate={(c) => setView({ mode: 'detail', id: null, copyFrom: c })}
      />
    )
  }
  return (
    <CampaignDetail
      key={view.id ?? `new-${view.copyFrom?.id ?? ''}`}
      id={view.id}
      copyFrom={view.copyFrom}
      onBack={() => setView({ mode: 'list' })}
    />
  )
}

// ───────────────────────── lista ─────────────────────────

function CampaignList({
  onNew, onOpen, onDuplicate,
}: {
  onNew: () => void
  onOpen: (id: string) => void
  onDuplicate: (c: CampaignRow) => void
}) {
  const { t, textDim, card, btnPrimary, btnGhost } = useUi()
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('whatsapp_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
      if (err) setError(err.message)
      else setRows((data ?? []) as CampaignRow[])
      setLoading(false)
    })()
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-5" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 42, height: 42, borderRadius: 12,
              background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Megaphone size={20} color={t.accentFg} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>Campanhas de WhatsApp</h1>
            <p style={{ margin: 0, fontSize: 13, color: textDim }}>
              Ofertas e novidades por plano, só para quem aceitou receber
            </p>
          </div>
        </div>
        <button onClick={onNew} style={btnPrimary}>
          <Plus size={16} /> Nova campanha
        </button>
      </div>

      {error && <Notice type="error">{error}</Notice>}

      <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 size={24} className="animate-spin" color={t.accent} />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center" style={{ color: textDim }}>
            <Megaphone size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: 14 }}>Nenhuma campanha ainda. Clique em "Nova campanha".</p>
          </div>
        ) : (
          rows.map((c, i) => (
            <div
              key={c.id}
              style={{
                padding: '14px 16px',
                borderTop: i === 0 ? 'none' : `1px solid ${t.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: textDim, marginTop: 2 }}>
                  Template <span style={{ fontFamily: 'monospace' }}>{c.template_name}</span>
                  {' · '}{c.plan_ids.length} plano{c.plan_ids.length === 1 ? '' : 's'}
                  {' · '}criada em {fmtDateTime(c.created_at)}
                </div>
              </div>
              <StatusBadge status={c.status} />
              <button onClick={() => onDuplicate(c)} style={btnGhost} title="Duplicar">
                <Copy size={14} /> Duplicar
              </button>
              <button onClick={() => onOpen(c.id)} style={btnPrimary}>Abrir</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ───────────────────────── detalhe / edição ─────────────────────────

function CampaignDetail({
  id, copyFrom, onBack,
}: {
  id: string | null
  copyFrom?: CampaignRow
  onBack: () => void
}) {
  const { t, textDim, card, input, btnPrimary, btnGhost } = useUi()

  const [loading, setLoading] = useState(true)
  const [campaign, setCampaign] = useState<CampaignRow | null>(null)
  const [form, setForm] = useState<FormState>(() => ({
    name: copyFrom ? `${copyFrom.name} (cópia)` : '',
    templateName: copyFrom?.template_name ?? '',
    templateLang: copyFrom?.template_lang ?? 'pt_BR',
    variables: copyFrom?.variables?.length ? copyFrom.variables : [{ kind: 'first_name' }],
    planIds: copyFrom?.plan_ids ?? [],
    statuses: copyFrom?.statuses?.length ? copyFrom.statuses : ['completed'],
    dailyLimit: copyFrom?.daily_limit ?? 250,
    headerImageUrl: copyFrom?.header_image_url ?? '',
    previewBody: copyFrom?.preview_body ?? '',
    previewFooter: copyFrom?.preview_footer ?? '',
    previewButtonLink: copyFrom?.preview_button_link ?? '',
    previewButtonReply: copyFrom?.preview_button_reply ?? '',
  }))

  const [plans, setPlans] = useState<PlanLite[]>([])
  const [eligible, setEligible] = useState<EligibleClient[]>([])
  const [counts, setCounts] = useState<CampaignCounts>(EMPTY_COUNTS)

  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [running, setRunning] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const stopRef = useRef(false)

  const [testPhone, setTestPhone] = useState('')
  const [testing, setTesting] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [rowsFilter, setRowsFilter] = useState<'problems' | 'sent' | 'pending'>('problems')
  const [msgRows, setMsgRows] = useState<any[]>([])
  const [loadingRows, setLoadingRows] = useState(false)

  const editable = !campaign || campaign.status === 'draft' || campaign.status === 'prepared'
  const busy = saving || preparing || running || testing

  // ── carga inicial ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [planList, elig] = await Promise.all([
          adminService.getPlans().catch(() => [] as PlanLite[]),
          loadEligible(),
        ])
        setPlans(planList as PlanLite[])
        setEligible(elig)
        if (id) {
          const row = await loadCampaign(id)
          if (row) {
            setCampaign(row)
            setForm(rowToForm(row))
            await refreshCounts(row.id)
            await loadRows(row.id, 'problems')
          }
        }
      } catch (e: any) {
        setMsg({ type: 'error', text: e?.message || 'Erro ao carregar' })
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Avisa antes de fechar a aba no meio do envio.
  useEffect(() => {
    if (!running) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [running])

  // ── queries ───────────────────────────────────────────────
  async function loadCampaign(cid: string): Promise<CampaignRow | null> {
    const { data, error } = await supabase.from('whatsapp_campaigns').select('*').eq('id', cid).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as CampaignRow) ?? null
  }

  /** Clientes que aceitaram marketing (RLS já limita às da própria admin). */
  async function loadEligible(): Promise<EligibleClient[]> {
    const out: EligibleClient[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('clients')
        .select('plan_id, status')
        .eq('is_archived', false)
        .eq('whatsapp_marketing_opt_in', true)
        .is('whatsapp_marketing_opt_out_at', null)
        .not('phone', 'is', null)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      out.push(...((data ?? []) as EligibleClient[]))
      if (!data || data.length < 1000) break
    }
    return out
  }

  async function refreshCounts(cid: string) {
    const keys = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const
    const res = await Promise.all(
      keys.map(k =>
        supabase.from('whatsapp_campaign_messages')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', cid).eq('status', k),
      ),
    )
    const next = { ...EMPTY_COUNTS }
    keys.forEach((k, i) => { next[k] = res[i].count ?? 0 })
    setCounts(next)
  }

  async function loadRows(cid: string, filter: 'problems' | 'sent' | 'pending') {
    setLoadingRows(true)
    const statuses = filter === 'problems' ? ['skipped', 'failed'] : filter === 'sent' ? ['sent'] : ['pending', 'sending']
    const { data } = await supabase
      .from('whatsapp_campaign_messages')
      .select('id, status, skip_reason, error, phone, sent_at, clients(full_name)')
      .eq('campaign_id', cid)
      .in('status', statuses)
      .order('created_at', { ascending: true })
      .limit(200)
    setMsgRows(data ?? [])
    setLoadingRows(false)
  }

  function rowToForm(c: CampaignRow): FormState {
    return {
      name: c.name,
      templateName: c.template_name,
      templateLang: c.template_lang,
      variables: c.variables?.length ? c.variables : [],
      planIds: c.plan_ids ?? [],
      statuses: c.statuses ?? [],
      dailyLimit: c.daily_limit,
      headerImageUrl: c.header_image_url ?? '',
      previewBody: c.preview_body ?? '',
      previewFooter: c.preview_footer ?? '',
      previewButtonLink: c.preview_button_link ?? '',
      previewButtonReply: c.preview_button_reply ?? '',
    }
  }

  // ── derivados ─────────────────────────────────────────────
  const planCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of eligible) {
      if (!c.plan_id) continue
      if (form.statuses.length && !form.statuses.includes(c.status)) continue
      m[c.plan_id] = (m[c.plan_id] ?? 0) + 1
    }
    return m
  }, [eligible, form.statuses])

  const visiblePlans = useMemo(
    () =>
      plans
        .filter(p => (planCounts[p.id] ?? 0) > 0 || form.planIds.includes(p.id))
        .sort((a, b) => (planCounts[b.id] ?? 0) - (planCounts[a.id] ?? 0)),
    [plans, planCounts, form.planIds],
  )

  const audienceEstimate = useMemo(
    () => form.planIds.reduce((sum, pid) => sum + (planCounts[pid] ?? 0), 0),
    [form.planIds, planCounts],
  )

  const selectedPlanNames = plans.filter(p => form.planIds.includes(p.id)).map(p => p.name)
  const total = counts.pending + counts.sending + counts.sent + counts.failed
  const pct = total > 0 ? Math.round((counts.sent / total) * 100) : 0

  // ── edição do formulário ──────────────────────────────────
  const patch = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }))

  const togglePlan = (pid: string) =>
    patch({ planIds: form.planIds.includes(pid) ? form.planIds.filter(x => x !== pid) : [...form.planIds, pid] })

  const toggleStatus = (s: string) =>
    patch({ statuses: form.statuses.includes(s) ? form.statuses.filter(x => x !== s) : [...form.statuses, s] })

  const setVariable = (i: number, v: CampaignVariable) =>
    patch({ variables: form.variables.map((x, idx) => (idx === i ? v : x)) })

  const changeVariableKind = (i: number, kind: CampaignVariable['kind']) =>
    setVariable(i, kind === 'text' ? { kind: 'text', value: '' } : ({ kind } as CampaignVariable))

  function validate(): string | null {
    if (!form.name.trim()) return 'Dê um nome para a campanha.'
    if (!form.templateName.trim()) return 'Informe o nome do template aprovado na Meta.'
    if (form.planIds.length === 0) return 'Escolha ao menos um plano.'
    if (form.statuses.length === 0) return 'Escolha ao menos uma etapa de cliente.'
    for (const [i, v] of form.variables.entries()) {
      if (v.kind === 'text' && !v.value.trim()) return `A variável {{${i + 1}}} (texto fixo) está vazia.`
    }
    if (form.headerImageUrl.trim() && !/^https:\/\//i.test(form.headerImageUrl.trim())) {
      return 'A imagem do cabeçalho precisa ser um link https público.'
    }
    if (!(form.dailyLimit > 0)) return 'O limite por dia precisa ser maior que zero.'
    return null
  }

  /** Salva (cria ou atualiza) e devolve a campanha gravada. */
  async function persist(): Promise<CampaignRow> {
    const invalid = validate()
    if (invalid) throw new Error(invalid)

    const payload = {
      name: form.name.trim(),
      template_name: form.templateName.trim(),
      template_lang: form.templateLang.trim() || 'pt_BR',
      variables: form.variables,
      plan_ids: form.planIds,
      statuses: form.statuses,
      daily_limit: Math.floor(form.dailyLimit),
      header_image_url: form.headerImageUrl.trim() || null,
      preview_body: form.previewBody.trim() || null,
      preview_footer: form.previewFooter.trim() || null,
      preview_button_link: form.previewButtonLink.trim() || null,
      preview_button_reply: form.previewButtonReply.trim() || null,
      updated_at: new Date().toISOString(),
    }

    if (!campaign) {
      const { data, error } = await supabase
        .from('whatsapp_campaigns').insert({ ...payload, status: 'draft' }).select('*').single()
      if (error) throw new Error(error.message)
      setCampaign(data as CampaignRow)
      return data as CampaignRow
    }

    // Editou uma campanha já preparada → o público congelado ficou desatualizado.
    const nextStatus: CampaignStatus = campaign.status === 'prepared' ? 'draft' : campaign.status
    const { data, error } = await supabase
      .from('whatsapp_campaigns').update({ ...payload, status: nextStatus }).eq('id', campaign.id).select('*').single()
    if (error) throw new Error(error.message)
    setCampaign(data as CampaignRow)
    return data as CampaignRow
  }

  // ── upload da imagem do cabeçalho (bucket público 'whatsapp-campaigns') ──
  // A Meta baixa a imagem pelo link na hora do envio, então ela precisa estar
  // num endereço público. O botão sobe o arquivo pro Storage e já preenche o link.
  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite escolher o mesmo arquivo de novo
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setMsg({ type: 'error', text: 'A imagem precisa ser JPG ou PNG.' })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMsg({ type: 'error', text: 'A imagem passa de 5 MB. Reduza o tamanho e tente de novo.' })
      return
    }
    setUploadingImage(true); setMsg(null)
    try {
      const ext = file.type === 'image/png' ? 'png' : 'jpg'
      const path = `campaigns/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage
        .from('whatsapp-campaigns')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw new Error(error.message)
      const { data } = supabase.storage.from('whatsapp-campaigns').getPublicUrl(path)
      patch({ headerImageUrl: data.publicUrl })
      setMsg({ type: 'success', text: 'Imagem enviada. Clique em "Salvar" para guardar na campanha.' })
    } catch (err: any) {
      setMsg({
        type: 'error',
        text: 'Não consegui enviar a imagem: ' + (err?.message || 'erro desconhecido') +
          ' (a migration 005 do bucket já foi rodada?)',
      })
    } finally {
      setUploadingImage(false)
    }
  }

  // ── ações ─────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true); setMsg(null)
    try {
      const saved = await persist()
      setMsg({
        type: 'success',
        text: saved.status === 'draft' && campaign?.status === 'prepared'
          ? 'Campanha salva. Como o público mudou, prepare a lista de novo antes de disparar.'
          : 'Campanha salva.',
      })
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'Erro ao salvar' })
    } finally { setSaving(false) }
  }

  async function handlePrepare() {
    setPreparing(true); setMsg(null)
    try {
      const saved = await persist()
      const r = await prepareCampaign(saved.id)
      setCounts({ pending: r.pending, sending: r.sending, sent: r.sent, failed: r.failed, skipped: r.skipped })
      const fresh = await loadCampaign(saved.id)
      if (fresh) setCampaign(fresh)
      await loadRows(saved.id, 'problems')
      setRowsFilter('problems')
      setMsg({
        type: 'success',
        text: `Público preparado: ${r.pending} na fila de envio e ${r.skipped} puladas (telefone inválido ou repetido).`,
      })
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'Erro ao preparar o público' })
    } finally { setPreparing(false) }
  }

  async function handleTest() {
    if (!testPhone.trim()) { setMsg({ type: 'error', text: 'Informe um número para o teste.' }); return }
    setTesting(true); setMsg(null)
    try {
      const saved = await persist()
      await sendCampaignTest(saved.id, testPhone.trim())
      setMsg({ type: 'success', text: 'Teste enviado! Confira o WhatsApp do número informado.' })
    } catch (e: any) {
      setMsg({ type: 'error', text: 'Falha no teste: ' + (e?.message || 'erro desconhecido') })
    } finally { setTesting(false) }
  }

  async function startSending() {
    if (!campaign) return
    setConfirmOpen(false)
    setRunning(true); setPausing(false); stopRef.current = false; setMsg(null)
    const resume = campaign.status === 'paused'
    try {
      const last = await runCampaign(campaign.id, {
        resume,
        shouldStop: () => stopRef.current,
        onProgress: (r) =>
          setCounts({ pending: r.pending, sending: r.sending, sent: r.sent, failed: r.failed, skipped: r.skipped }),
      })

      const stoppedByUser =
        stopRef.current && !last.done && !last.limitReached && !last.rateLimited && !last.authError && !last.templateError
      if (stoppedByUser) {
        await supabase.from('whatsapp_campaigns')
          .update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', campaign.id)
      }

      if (last.templateError) {
        setMsg({
          type: 'error',
          text: `A Meta recusou o template, então a campanha foi pausada sem marcar ninguém como falha: ${last.templateError}. ` +
            'Confira o nome, o idioma, se está aprovado e se as variáveis/imagem batem com o template.',
        })
      } else if (last.done) {
        setMsg({ type: 'success', text: `Campanha concluída: ${last.sent} enviadas, ${last.failed} com falha, ${last.skipped} puladas.` })
      } else if (last.limitReached) {
        setMsg({
          type: 'info',
          text: `Limite de contatos por dia atingido (${last.sent} enviadas até agora). ` +
            (last.resumeAfter ? `Volte depois de ${fmtDateTime(last.resumeAfter)} e clique em "Continuar envio".` : 'Volte mais tarde e clique em "Continuar envio".'),
        })
      } else if (last.rateLimited) {
        setMsg({ type: 'info', text: 'A Meta pediu para segurar os envios (limite de taxa). A campanha foi pausada — tente continuar daqui a alguns minutos.' })
      } else if (last.authError) {
        setMsg({ type: 'error', text: 'A Meta recusou as credenciais (Access Token inválido ou expirado). Confira em Configurações → Notificação por WhatsApp. A campanha foi pausada.' })
      } else if (stoppedByUser) {
        setMsg({ type: 'info', text: 'Envio pausado. Clique em "Continuar envio" quando quiser retomar.' })
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'Erro durante o envio' })
    } finally {
      setRunning(false); setPausing(false)
      const fresh = await loadCampaign(campaign.id).catch(() => null)
      if (fresh) setCampaign(fresh)
      await refreshCounts(campaign.id)
      await loadRows(campaign.id, rowsFilter)
    }
  }

  async function handleCancelCampaign() {
    if (!campaign) return
    if (!window.confirm('Cancelar esta campanha? As mensagens ainda pendentes não serão enviadas.')) return
    const { error } = await supabase.from('whatsapp_campaigns')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', campaign.id)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    const fresh = await loadCampaign(campaign.id)
    if (fresh) setCampaign(fresh)
    setMsg({ type: 'info', text: 'Campanha cancelada.' })
  }

  // ── render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 size={26} className="animate-spin" color={t.accent} />
      </div>
    )
  }

  const label = (text: string) => (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 6 }}>{text}</label>
  )

  const canSend = !!campaign && ['prepared', 'sending', 'paused'].includes(campaign.status) && !running
  const sendLabel = campaign && ['sending', 'paused'].includes(campaign.status) ? 'Continuar envio' : 'Disparar campanha'

  return (
    <div>
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-5" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} style={btnGhost} disabled={running}>
            <ArrowLeft size={15} /> Voltar
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>
              {campaign ? campaign.name : 'Nova campanha'}
            </h1>
            {campaign && (
              <div style={{ marginTop: 4 }}><StatusBadge status={campaign.status} /></div>
            )}
          </div>
        </div>
        {campaign && !['completed', 'cancelled'].includes(campaign.status) && (
          <button onClick={handleCancelCampaign} style={{ ...btnGhost, color: '#ef4444' }} disabled={running}>
            <Ban size={14} /> Cancelar campanha
          </button>
        )}
      </div>

      <div className="space-y-4">
        {msg && <Notice type={msg.type}>{msg.text}</Notice>}

        {/* Como funciona */}
        {editable && (
          <Notice type="info">
            Mensagem de oferta exige um <strong>template de categoria Marketing aprovado na Meta</strong> (o
            "analise_concluida" é de avisos e não serve). Informe abaixo o nome dele e como preencher cada
            variável <span style={{ fontFamily: 'monospace' }}>{'{{1}}'} {'{{2}}'} …</span> na mesma ordem do template.
            Só recebem clientes que <strong>aceitaram marketing</strong> e não pediram para sair.
          </Notice>
        )}

        {/* Dados da campanha */}
        <div style={{ ...card, padding: 16 }} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              {label('Nome da campanha')}
              <input
                style={input} value={form.name} disabled={!editable}
                onChange={e => patch({ name: e.target.value })}
                placeholder="Ex: Desconto coloração pessoal — outubro"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                {label('Template (nome na Meta)')}
                <input
                  style={{ ...input, fontFamily: 'monospace' }} value={form.templateName} disabled={!editable}
                  onChange={e => patch({ templateName: e.target.value.trim() })}
                  placeholder="oferta_coloracao_v1"
                />
              </div>
              <div>
                {label('Idioma')}
                <input
                  style={{ ...input, fontFamily: 'monospace' }} value={form.templateLang} disabled={!editable}
                  onChange={e => patch({ templateLang: e.target.value.trim() })}
                  placeholder="pt_BR"
                />
              </div>
            </div>
          </div>

          {/* Imagem do cabeçalho */}
          <div>
            {label('Imagem do cabeçalho (só se o template tiver imagem)')}
            <div className="flex flex-wrap gap-2">
              <input
                style={{ ...input, flex: 1, minWidth: 220 }} value={form.headerImageUrl} disabled={!editable}
                onChange={e => patch({ headerImageUrl: e.target.value.trim() })}
                placeholder="Envie uma imagem ou cole um link https://..."
              />
              {editable && (
                <>
                  <input
                    ref={fileInputRef} type="file" accept="image/jpeg,image/png"
                    onChange={handleImageFile} style={{ display: 'none' }}
                  />
                  <button
                    type="button" onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage} style={{ ...btnGhost, opacity: uploadingImage ? 0.6 : 1 }}
                  >
                    {uploadingImage ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    Enviar imagem
                  </button>
                </>
              )}
            </div>
            {/^https:\/\//i.test(form.headerImageUrl) && (
              <img
                src={form.headerImageUrl} alt="Prévia da imagem"
                style={{ marginTop: 8, maxHeight: 140, maxWidth: '100%', borderRadius: 10, border: `1px solid ${t.border}` }}
              />
            )}
            <p style={{ fontSize: 12, color: textDim, marginTop: 6 }}>
              JPG ou PNG, até 5 MB (melhor em formato 1,91:1, tipo 1200×628, ou quadrada). O botão sobe a imagem e
              preenche o link sozinho. Pode trocar a imagem a cada campanha sem criar template novo.
            </p>
          </div>

          {/* Variáveis */}
          <div>
            {label('Variáveis do template (na ordem)')}
            {form.variables.length === 0 && (
              <p style={{ fontSize: 12, color: textDim, margin: '0 0 8px' }}>
                Template sem variáveis — a mensagem vai igual para todas.
              </p>
            )}
            <div className="space-y-2">
              {form.variables.map((v, i) => (
                <div key={i} className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: textDim, width: 44 }}>{`{{${i + 1}}}`}</span>
                  <select
                    style={{ ...input, width: 'auto', minWidth: 220 }} value={v.kind} disabled={!editable}
                    onChange={e => changeVariableKind(i, e.target.value as CampaignVariable['kind'])}
                  >
                    {(Object.keys(VARIABLE_KIND_LABEL) as CampaignVariable['kind'][]).map(k => (
                      <option key={k} value={k}>{VARIABLE_KIND_LABEL[k]}</option>
                    ))}
                  </select>
                  {v.kind === 'text' && (
                    <input
                      style={{ ...input, flex: 1, minWidth: 200 }} value={v.value} disabled={!editable}
                      onChange={e => setVariable(i, { kind: 'text', value: e.target.value })}
                      placeholder="Ex: 20% de desconto até domingo"
                    />
                  )}
                  {editable && (
                    <button
                      onClick={() => patch({ variables: form.variables.filter((_, idx) => idx !== i) })}
                      style={{ ...btnGhost, padding: '7px 9px' }} title="Remover variável"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {editable && form.variables.length < MAX_VARIABLES && (
              <button
                onClick={() => patch({ variables: [...form.variables, { kind: 'text', value: '' }] })}
                style={{ ...btnGhost, marginTop: 8 }}
              >
                <Plus size={14} /> Adicionar variável
              </button>
            )}
            <p style={{ fontSize: 12, color: textDim, marginTop: 8 }}>
              Dica: a Meta não aceita quebra de linha dentro de uma variável — texto fixo vai em uma linha só.
            </p>
          </div>

          {/* Prévia do template */}
          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 14 }}>
            {label('Prévia da mensagem')}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <div style={{ fontSize: 12, color: textDim, marginBottom: 4 }}>
                    Texto do template — copie do que foi aprovado na Meta (serve só para esta prévia)
                  </div>
                  <textarea
                    style={{ ...input, minHeight: 140, resize: 'vertical', fontFamily: 'inherit' }}
                    value={form.previewBody} disabled={!editable}
                    onChange={e => patch({ previewBody: e.target.value })}
                    placeholder={'Olá, {{1}}! 🎨\n\nSua oferta aqui...'}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: textDim, marginBottom: 4 }}>Rodapé (opcional)</div>
                  <input
                    style={input} value={form.previewFooter} disabled={!editable}
                    onChange={e => patch({ previewFooter: e.target.value })}
                    placeholder="Para sair da lista, responda SAIR"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div style={{ fontSize: 12, color: textDim, marginBottom: 4 }}>Botão de link</div>
                    <input
                      style={input} value={form.previewButtonLink} disabled={!editable}
                      onChange={e => patch({ previewButtonLink: e.target.value })}
                      placeholder="Quero meu desconto"
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: textDim, marginBottom: 4 }}>Botão de resposta</div>
                    <input
                      style={input} value={form.previewButtonReply} disabled={!editable}
                      onChange={e => patch({ previewButtonReply: e.target.value })}
                      placeholder="Parar de receber"
                    />
                  </div>
                </div>
                {form.previewBody.trim() && maxPlaceholder(form.previewBody) !== form.variables.length && (
                  <Notice type="error">
                    O texto usa {maxPlaceholder(form.previewBody)} variável(is), mas a campanha tem{' '}
                    {form.variables.length}. O template e a campanha precisam ter o mesmo número, senão a Meta recusa o envio.
                  </Notice>
                )}
              </div>
              <WhatsAppPreview
                imageUrl={form.headerImageUrl}
                body={renderPreviewBody(form.previewBody, form.variables)}
                footer={form.previewFooter}
                linkText={form.previewButtonLink}
                replyText={form.previewButtonReply}
              />
            </div>
            <p style={{ fontSize: 12, color: textDim, marginTop: 8 }}>
              Prévia aproximada, com "Maria" no lugar do nome. O que vale é o template aprovado na Meta: o texto dele
              não muda por aqui, então confira se o que você colou é idêntico.
            </p>
          </div>
        </div>

        {/* Público */}
        <div style={{ ...card, padding: 16 }} className="space-y-4">
          <div>
            {label('Etapa em que a cliente está')}
            <div className="flex flex-wrap gap-2">
              {Object.entries(CLIENT_STATUS_LABEL).map(([s, text]) => {
                const on = form.statuses.includes(s)
                return (
                  <button
                    key={s} type="button" disabled={!editable} onClick={() => toggleStatus(s)}
                    style={{
                      padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      cursor: editable ? 'pointer' : 'default',
                      color: on ? t.accentFg : t.text,
                      background: on ? t.accent : 'transparent',
                      border: `1px solid ${on ? t.accent : t.border}`,
                    }}
                  >
                    {text}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: 12, color: textDim, marginTop: 6 }}>
              Para oferta de coloração, normalmente só "Análise concluída".
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              {label('Planos que vão receber')}
              <span style={{ fontSize: 12, color: textDim }}>
                <Users size={12} style={{ display: 'inline', marginRight: 4 }} />
                ~{audienceEstimate} clientes (antes de descartar telefones inválidos/repetidos)
              </span>
            </div>
            {visiblePlans.length === 0 ? (
              <p style={{ fontSize: 13, color: textDim }}>
                Nenhum plano com clientes que aceitaram marketing nas etapas escolhidas.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {visiblePlans.map(p => {
                  const on = form.planIds.includes(p.id)
                  return (
                    <label
                      key={p.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
                        cursor: editable ? 'pointer' : 'default',
                        border: `1px solid ${on ? t.accent : t.border}`,
                        background: on ? `${t.accent}14` : 'transparent',
                      }}
                    >
                      <input type="checkbox" checked={on} disabled={!editable} onChange={() => togglePlan(p.id)} />
                      <span style={{ flex: 1, fontSize: 13, color: t.text }}>{p.name}</span>
                      <span style={{ fontSize: 12, color: textDim }}>{planCounts[p.id] ?? 0}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div style={{ maxWidth: 260 }}>
            {label('Máximo de contatos por 24h')}
            <input
              type="number" min={1} style={input} value={form.dailyLimit} disabled={!editable}
              onChange={e => patch({ dailyLimit: Number(e.target.value) })}
            />
            <p style={{ fontSize: 12, color: textDim, marginTop: 6 }}>
              Deixe abaixo do limite do seu número na Meta (250 ou 1.000). Esse limite também conta os avisos de
              "análise concluída", então deixe uma folga. Passou do limite, a campanha pausa e continua depois.
            </p>
          </div>
        </div>

        {/* Botões do formulário */}
        {editable && (
          <div className="flex flex-wrap gap-2">
            <button onClick={handleSave} disabled={busy} style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} Salvar
            </button>
            <button onClick={handlePrepare} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
              {preparing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {campaign?.status === 'prepared' ? 'Preparar público de novo' : 'Preparar público'}
            </button>
          </div>
        )}

        {/* Teste */}
        {campaign && campaign.status !== 'cancelled' && campaign.status !== 'completed' && (
          <div style={{ ...card, padding: 16 }}>
            {label('Enviar teste (um número só, não entra na campanha)')}
            <div className="flex flex-wrap gap-2">
              <input
                style={{ ...input, flex: 1, minWidth: 220 }} value={testPhone}
                onChange={e => setTestPhone(e.target.value)} placeholder="DDD + número (ex: 41999998888)"
              />
              <button onClick={handleTest} disabled={busy || running} style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }}>
                {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Testar
              </button>
            </div>
            <p style={{ fontSize: 12, color: textDim, marginTop: 6 }}>
              Salva a campanha e manda o template com "Teste" no lugar do nome. Faça isso antes de disparar.
            </p>
          </div>
        )}

        {/* Andamento / disparo */}
        {campaign && campaign.status !== 'draft' && (
          <div style={{ ...card, padding: 16 }} className="space-y-3">
            <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 600, color: t.text }}>Andamento</div>
              <div style={{ fontSize: 12, color: textDim }}>
                {campaign.prepared_at ? `Público preparado em ${fmtDateTime(campaign.prepared_at)}` : ''}
              </div>
            </div>

            <div style={{ height: 8, borderRadius: 999, background: t.border, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: t.accent, transition: 'width .3s' }} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {([
                ['Na fila', counts.pending + counts.sending, '#6b7280'],
                ['Enviadas', counts.sent, '#10b981'],
                ['Falhas', counts.failed, '#ef4444'],
                ['Puladas', counts.skipped, '#f59e0b'],
                ['Progresso', `${pct}%`, t.accent],
              ] as [string, number | string, string][]).map(([name, value, color]) => (
                <div key={name} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${t.border}` }}>
                  <div style={{ fontSize: 11, color: textDim }}>{name}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {canSend && (
                <button
                  onClick={() => setConfirmOpen(true)} disabled={busy || counts.pending + counts.sending === 0}
                  style={{ ...btnPrimary, opacity: busy || counts.pending + counts.sending === 0 ? 0.5 : 1 }}
                >
                  <Play size={15} /> {sendLabel}
                </button>
              )}
              {running && (
                <>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: textDim, fontSize: 13 }}>
                    <Loader2 size={16} className="animate-spin" color={t.accent} />
                    {pausing ? 'Pausando após o lote atual…' : 'Enviando — mantenha esta aba aberta.'}
                  </div>
                  <button onClick={() => { stopRef.current = true; setPausing(true) }} disabled={pausing} style={btnGhost}>
                    <Pause size={15} /> Pausar
                  </button>
                </>
              )}
            </div>

            {/* Lista de mensagens */}
            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 12 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Detalhes</span>
                <select
                  style={{ ...input, width: 'auto' }} value={rowsFilter}
                  onChange={e => {
                    const f = e.target.value as 'problems' | 'sent' | 'pending'
                    setRowsFilter(f)
                    if (campaign) loadRows(campaign.id, f)
                  }}
                >
                  <option value="problems">Puladas e falhas</option>
                  <option value="sent">Enviadas</option>
                  <option value="pending">Na fila</option>
                </select>
                <button
                  onClick={() => campaign && (refreshCounts(campaign.id), loadRows(campaign.id, rowsFilter))}
                  style={{ ...btnGhost, padding: '7px 10px' }} title="Atualizar"
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              {loadingRows ? (
                <Loader2 size={18} className="animate-spin" color={t.accent} />
              ) : msgRows.length === 0 ? (
                <p style={{ fontSize: 13, color: textDim, margin: 0 }}>Nada para mostrar neste filtro.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: textDim }}>
                        <th style={{ padding: '6px 8px' }}>Cliente</th>
                        <th style={{ padding: '6px 8px' }}>Telefone</th>
                        <th style={{ padding: '6px 8px' }}>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {msgRows.map((r: any) => (
                        <tr key={r.id} style={{ borderTop: `1px solid ${t.border}`, color: t.text }}>
                          <td style={{ padding: '6px 8px' }}>{r.clients?.full_name ?? '—'}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                            {r.phone ? `…${String(r.phone).slice(-4)}` : '—'}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            {r.status === 'sent' && `Enviada ${fmtDateTime(r.sent_at)}`}
                            {r.status === 'skipped' && `Pulada: ${r.skip_reason ?? '—'}`}
                            {r.status === 'failed' && `Falha: ${r.error ?? '—'}`}
                            {(r.status === 'pending' || r.status === 'sending') && 'Na fila'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {msgRows.length >= 200 && (
                    <p style={{ fontSize: 12, color: textDim }}>Mostrando as 200 primeiras.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirmação de disparo */}
      {confirmOpen && campaign && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div style={{ ...card, padding: 20, maxWidth: 460, width: '100%' }} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.text }}>Confirmar disparo</h2>
              <button onClick={() => setConfirmOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: textDim }}>
                <X size={18} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: t.text }}>
              Enviar <strong>{counts.pending + counts.sending}</strong> mensagens com o template{' '}
              <span style={{ fontFamily: 'monospace' }}>{campaign.template_name}</span>
              {selectedPlanNames.length > 0 && <> para clientes de: {selectedPlanNames.join(', ')}</>}.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: textDim }}>
              <li>Mensagens de marketing são cobradas pela Meta por entrega.</li>
              <li>Até {campaign.daily_limit} contatos por 24h; passando disso a campanha pausa e você continua depois.</li>
              <li>Você já enviou um teste e conferiu o resultado?</li>
              <li>O envio não pode ser desfeito, só pausado.</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} style={btnGhost}>Voltar</button>
              <button onClick={startSending} style={btnPrimary}>
                <Send size={15} /> Disparar agora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}