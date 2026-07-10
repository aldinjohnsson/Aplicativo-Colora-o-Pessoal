// src/lib/services.ts
import { supabase } from './supabase'
import { driveStorage } from './driveStorage'
import { calculateDeadline, formatDateForDB } from './deadlineCalculator'

// ============================================================
// THROTTLE DE E-MAILS DE NOTIFICACAO (anti-burst)
// ============================================================
//
// Evita disparar varios e-mails identicos em sequencia quando o
// cliente envia varias fotos seguidas (ou troca a foto varias vezes).
// O check+set e sincrono (sem await no meio), entao mesmo com N
// uploads em paralelo apenas o primeiro passa — JS e single-threaded.
//
// Obs: o mapa vive em memoria da aba. Se a cliente recarregar a pagina
// o throttle zera — por isso existe tambem o dedupe no servidor
// (Edge Function send-contract-email + tabela email_dedup).
const _emailThrottle = new Map<string, number>()

function shouldSendThrottledEmail(key: string, windowMs: number): boolean {
  const now = Date.now()
  const last = _emailThrottle.get(key) || 0
  if (now - last < windowMs) return false
  _emailThrottle.set(key, now)
  return true
}

// ============================================================
// TYPES
// ============================================================

export type ClientStatus =
  | 'awaiting_contract'
  | 'awaiting_form'
  | 'awaiting_photos'
  | 'photos_submitted'
  | 'in_analysis'
  | 'preparing_materials'
  | 'validating_materials'           // interno — cliente vê "Preparando Materiais"
  | 'sending_dossier'                // interno — cliente vê "Preparando Materiais"
  | 'awaiting_ai_photo'              // condicional (só se plano tem categoria IA). Cliente vê parcial + upload de foto
  | 'simulating'                     // interno — cliente vê "Simulações em andamento"
  | 'making_capillary_dossier'       // interno — cliente vê "Simulações em andamento"
  | 'validating_capillary_dossier'   // interno — cliente vê "Simulações em andamento"
  | 'sending_capillary_dossier'      // interno — cliente vê "Simulações em andamento"
  | 'completed'

export interface Plan {
  id: string
  name: string
  description: string | null
  deadline_days: number
  is_active: boolean
  created_at: string
}

export interface PlanContract {
  title: string
  sections: Array<{ id: string; title: string; content: string; order: number }>
}

export interface FormField {
  id: string
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox'
  label: string
  placeholder?: string
  options?: string[]
  required: boolean
  order: number
}

export interface PlanForm {
  title: string
  description: string | null
  fields: FormField[]
}

export interface PhotoCategory {
  id: string
  plan_id: string
  title: string
  description: string | null
  instructions: string[]
  video_url: string | null
  max_photos: number
  order_index: number
  /** Marca esta categoria como a etapa condicional "Foto IA" do fluxo. */
  is_ai_simulation?: boolean
}

export interface Client {
  id: string
  token: string
  plan_id: string | null
  full_name: string
  email: string
  phone: string | null
  notes: string | null
  status: ClientStatus
  created_at: string
  updated_at: string
  plan?: Plan
  // ── Campos de rejeição (adicionados junto com a feature de reenvio) ──
  form_rejection_reason?: string | null
  form_rejected_at?: string | null
  photos_rejection_reason?: string | null
  photos_rejected_at?: string | null
  // ── Arquivamento ──
  is_archived: boolean
}


export interface AdminUser {
  id: string
  email: string
  nome: string | null
  telefone: string | null
  // ★ Tipos de conta:
  //   • super_admin → Marília. Gerencia tudo.
  //   • admin       → Salão pagante. Full panel.
  //   • chat_admin  → MS Color IA standalone (chat + config resumida).
  //   • full_admin  → Salão + IA. Chat IA + geração de dossiê por IA, sem gestão de clientes.
  role: 'super_admin' | 'admin' | 'chat_admin' | 'full_admin'
  license_active: boolean
  license_expires_at: string | null
  observacoes: string | null
  created_at?: string
}

export interface ClientPortalData {
  client: {
    id: string
    full_name: string
    email: string
    phone: string | null
    status: ClientStatus
    created_at: string
    // Rejeição também precisa vir até aqui (o banner do portal lê desses campos)
    form_rejection_reason?: string | null
    form_rejected_at?: string | null
    photos_rejection_reason?: string | null
    photos_rejected_at?: string | null
    // Idioma escolhido pela cliente no portal (i18n). NULL = ainda não escolheu,
    // o front cai no `admin_default_language` abaixo.
    language?: string | null
  }
  // Idioma padrão configurado pelo admin em Settings — usado como fallback
  // quando client.language ainda é NULL.
  admin_default_language?: string | null
  plan: { id: string; name: string; deadline_days: number } | null
  contract: PlanContract | null
  form: PlanForm | null
  photo_categories: PhotoCategory[]
  contract_signed: boolean
  contract_signed_at: string | null
  form_submitted: boolean
  form_submitted_at: string | null
  photos: Array<{
    id: string
    photo_name: string
    photo_size: number
    category_id: string | null
    uploaded_at: string
    url?: string                    // ← URL reconstruída no client
  }>
  // ── Submissão completa do formulário (para pré-preencher em caso de reenvio) ──
  form_submission?: {
    form_data: Record<string, any>
    submitted_at: string
  } | null
  deadline: { photos_sent_at: string; deadline_date: string } | null
  result: {
    folder_url: string | null
    observations: string | null
    custom_link_url: string | null
    released_at: string
    chat_enabled: boolean
    files: Array<{ id: string; file_name: string; storage_path: string; file_size: number }>
  } | null
}

// ============================================================
// ADMIN SERVICE
// ============================================================

export const adminService = {
  // ---- Auth ----
  async login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, role, license_active, license_expires_at')
      .eq('id', data.user.id)
      .single()

    if (!adminData) {
      await supabase.auth.signOut({ scope: 'local' })
      throw new Error('Acesso não autorizado. Usuário não é administrador.')
    }

    // Checagem de licença — super_admin sempre passa
    if (adminData.role !== 'super_admin') {
      if (!adminData.license_active) {
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('Sua licença está inativa. Entre em contato com o suporte.')
      }
      if (adminData.license_expires_at && new Date(adminData.license_expires_at) < new Date()) {
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('Sua licença está vencida. Entre em contato com o suporte para renovar.')
      }
    }

    return data.user
  },

  async logout() {
    await supabase.auth.signOut({ scope: 'local' })
  },

  async getSession() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return null

    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, role, license_active, license_expires_at')
      .eq('id', data.session.user.id)
      .single()

    if (!adminData) {
      await supabase.auth.signOut({ scope: 'local' })
      return null
    }

    // Se a licença expirou/foi desativada durante a sessão, desloga silenciosamente
    if (adminData.role !== 'super_admin') {
      const inactive = !adminData.license_active
      const expired = adminData.license_expires_at && new Date(adminData.license_expires_at) < new Date()
      if (inactive || expired) {
        await supabase.auth.signOut({ scope: 'local' })
        return null
      }
    }

    return data.session.user
  },

  // ---- Admin atual (com role e licença) ----
  async getCurrentAdmin(): Promise<AdminUser | null> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
      .from('admin_users')
      .select('id, email, nome, telefone, role, license_active, license_expires_at, observacoes, created_at')
      .eq('id', user.id)
      .single()

    return (data as AdminUser | null) ?? null
  },

  /**
   * Atualiza nome e telefone do admin logado na tabela admin_users.
   */
  async updateAdminProfile({ nome, telefone }: { nome: string; telefone: string }): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Sessão expirada. Faça login novamente.')
    const { error } = await supabase
      .from('admin_users')
      .update({
        nome:     nome     || null,
        telefone: telefone || null,
      })
      .eq('id', user.id)
    if (error) throw error
  },

  /**
   * Troca a senha do usuário autenticado (sessão ativa).
   * Também funciona quando o usuário chega via link de recuperação:
   * o Supabase já estabelece a sessão de recovery antes de redirecionar.
   */
  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  },

  /**
   * Envia e-mail de recuperação de senha via Supabase Auth.
   * O link redireciona para redirectTo (padrão: /admin — Supabase
   * anexa os parâmetros de recovery automaticamente).
   *
   * Configure em Supabase > Authentication > URL Configuration:
   *   Site URL: https://seu-dominio.com
   *   Redirect URLs: https://seu-dominio.com/admin/**
   */
  async requestPasswordReset(email: string): Promise<void> {
    const redirectTo = `${window.location.origin}/admin/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw error
    // Supabase não revela se o e-mail existe (segurança); sempre resolve.
  },

  // ---- Plans ----
  async getPlans(): Promise<Plan[]> {
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  async createPlan(plan: Omit<Plan, 'id' | 'created_at'>): Promise<Plan> {
    const { data, error } = await supabase
      .from('plans')
      .insert(plan)
      .select()
      .single()
    if (error) throw error

    await supabase.from('plan_contracts').insert({
      plan_id: data.id,
      title: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
      sections: []
    })
    await supabase.from('plan_forms').insert({
      plan_id: data.id,
      title: 'Formulário de Análise',
      description: null,
      fields: []
    })

    return data
  },

  async updatePlan(id: string, updates: Partial<Plan>): Promise<void> {
    const { error } = await supabase.from('plans').update(updates).eq('id', id)
    if (error) throw error
  },

  async deletePlan(id: string): Promise<void> {
    const { error } = await supabase.from('plans').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Clona um plano completo: cria um novo `plans` com nome "{original} (Cópia)"
   * e duplica `plan_contracts`, `plan_forms` e `plan_photo_categories`
   * (incluindo `instruction_items` com texto/vídeos/imagens).
   *
   * Observações:
   *  • `share_token` NÃO é copiado — cada plano gera o próprio quando
   *    compartilhado pela primeira vez.
   *  • Arquivos referenciados em `instruction_items` (bucket
   *    `category-instructions`) ficam compartilhados entre origem e clone
   *    (mesmo storagePath/URL). Se o original for deletado e a limpeza de
   *    storage executar, o clone perde as mídias. Isso é aceitável para o
   *    caso de uso típico ("quero um plano parecido para ajustar").
   *  • Em caso de erro no meio da cópia (contrato/formulário/categorias),
   *    o plano parcialmente clonado é deletado para não deixar lixo —
   *    `ON DELETE CASCADE` nas FKs limpa eventuais linhas filhas órfãs.
   */
  async clonePlan(sourceId: string, opts?: { newName?: string }): Promise<Plan> {
    // 1) Busca o plano de origem
    const { data: source, error: srcErr } = await supabase
      .from('plans')
      .select('*')
      .eq('id', sourceId)
      .single()
    if (srcErr) throw srcErr
    if (!source) throw new Error('Plano de origem não encontrado')

    // 2) Cria o novo plano (createPlan já gera contract+form vazios automaticamente).
    //    NÃO copiamos share_token — o clone gera o próprio quando for compartilhado.
    const newPlan = await this.createPlan({
      name: opts?.newName ?? `${source.name} (Cópia)`,
      description: source.description,
      deadline_days: source.deadline_days,
      is_active: source.is_active,
    })

    // A partir daqui, se algo falhar, removemos o plano parcial para não deixar lixo.
    try {
      // 3) Copia o contrato (upsert sobrescreve a linha vazia criada por createPlan)
      const contract = await this.getPlanContract(sourceId)
      if (contract) {
        await this.savePlanContract(newPlan.id, contract)
      }

      // 4) Copia o formulário
      const form = await this.getPlanForm(sourceId)
      if (form) {
        await this.savePlanForm(newPlan.id, form)
      }

      // 5) Copia as categorias de foto (com instruction_items, vídeos, imagens etc.)
      const { data: cats, error: catsErr } = await supabase
        .from('plan_photo_categories')
        .select('*')
        .eq('plan_id', sourceId)
        .order('order_index')
      if (catsErr) throw catsErr

      if (cats && cats.length > 0) {
        const cloned = cats.map((c: any) => ({
          plan_id: newPlan.id,
          title: c.title,
          description: c.description,
          instructions: c.instructions ?? null,         // legado
          video_url: c.video_url ?? null,                // legado
          instruction_items: c.instruction_items ?? [],  // atual
          max_photos: c.max_photos,
          order_index: c.order_index,
          is_ai_simulation: !!c.is_ai_simulation,
        }))
        const { error: insErr } = await supabase
          .from('plan_photo_categories')
          .insert(cloned)
        if (insErr) throw insErr
      }

      return newPlan
    } catch (err) {
      // Rollback: remove o plano clonado pela metade
      await supabase.from('plans').delete().eq('id', newPlan.id)
      throw err
    }
  },

  // ---- Plan contract ----
  async getPlanContract(planId: string): Promise<PlanContract | null> {
    const { data } = await supabase
      .from('plan_contracts')
      .select('title, sections')
      .eq('plan_id', planId)
      .single()
    return data || null
  },

  async savePlanContract(planId: string, contract: PlanContract): Promise<void> {
    // Não enviamos `updated_at` no payload — se a coluna existir, fica a cargo
    // do trigger `set_updated_at` do Postgres; se não existir (como em
    // `plan_contracts`), o upsert quebraria. Mesma lógica em `savePlanForm`.
    const { error } = await supabase
      .from('plan_contracts')
      .upsert(
        { plan_id: planId, ...contract },
        { onConflict: 'plan_id' }
      )
    if (error) throw error
  },

  // ---- Plan form ----
  async getPlanForm(planId: string): Promise<PlanForm | null> {
    const { data } = await supabase
      .from('plan_forms')
      .select('title, description, fields')
      .eq('plan_id', planId)
      .single()
    return data || null
  },

  async savePlanForm(planId: string, form: PlanForm): Promise<void> {
    // Mesmo motivo de `savePlanContract`: se a coluna `updated_at` não existir
    // em `plan_forms`, o upsert quebra. Deixa o trigger cuidar (se houver).
    const { error } = await supabase
      .from('plan_forms')
      .upsert(
        { plan_id: planId, ...form },
        { onConflict: 'plan_id' }
      )
    if (error) throw error
  },

  // ---- Photo categories ----
  async getPhotoCategories(planId: string): Promise<PhotoCategory[]> {
    const { data, error } = await supabase
      .from('plan_photo_categories')
      .select('*')
      .eq('plan_id', planId)
      .order('order_index')
    if (error) throw error
    return data || []
  },

  async savePhotoCategory(category: Omit<PhotoCategory, 'id'>): Promise<PhotoCategory> {
    const { data, error } = await supabase
      .from('plan_photo_categories')
      .insert(category)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async updatePhotoCategory(id: string, updates: Partial<PhotoCategory>): Promise<void> {
    const { error } = await supabase
      .from('plan_photo_categories')
      .update(updates)
      .eq('id', id)
    if (error) throw error
  },

  async deletePhotoCategory(id: string): Promise<void> {
    const { error } = await supabase.from('plan_photo_categories').delete().eq('id', id)
    if (error) throw error
  },

  // ---- Clients ----
  // ⚡ PERFORMANCE: lista explícita de colunas SEM iris_analysis.
  // A iris_analysis (JSONB com imagem em base64) chegou a 28 MB somados —
  // praticamente 100% do peso da tabela — e era baixada inteira a cada
  // abertura do painel, sem a lista usar. Ela continua sendo carregada na
  // visão individual da cliente (getClientDetail usa select('*')).
  // ⚠️ Se criar coluna nova em clients que a LISTA precise, adicione aqui.
  async getClients(): Promise<Client[]> {
    const { data, error } = await supabase
      .from('clients')
      .select(
        'id, token, plan_id, full_name, email, phone, notes, status, created_at, updated_at, ' +
        'birth_date, ai_prompt, ai_reference_photo_path, ai_profile, ai_folder_id, ' +
        'ai_credits_image, ai_credits_text, ai_credits_used_image, ai_credits_used_text, ' +
        'ai_info_tags, step_contract, step_form, step_photos, ai_reference_photos, ' +
        'form_rejection_reason, form_rejected_at, photos_rejection_reason, photos_rejected_at, ' +
        'admin_id, stage_timestamps, drive_folder_id, drive_purged_at, contrast_layout, ' +
        'is_archived, whatsapp_opt_in, whatsapp_opt_in_at, ' +
        'plan:plans(id, name, deadline_days, is_active, description, created_at)'
      )
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []) as Client[]
  },

  async getClientDetail(clientId: string) {
    const { data: client, error } = await supabase
      .from('clients')
      .select('*, plan:plans(*)')
      .eq('id', clientId)
      .single()
    if (error) throw error

    const [contract, formSub, photos, deadline, result, resultFiles, photoCategories, planForm] =
      await Promise.all([
        supabase.from('client_contracts').select('signed_at').eq('client_id', clientId).maybeSingle(),
        supabase.from('client_form_submissions').select('form_data, submitted_at').eq('client_id', clientId).maybeSingle(),
        supabase.from('client_photos').select('*').eq('client_id', clientId).order('uploaded_at'),
        supabase.from('client_deadlines').select('*').eq('client_id', clientId).maybeSingle(),
        supabase.from('client_results').select('*').eq('client_id', clientId).maybeSingle(),
        supabase.from('client_result_files').select('*').eq('client_id', clientId).order('uploaded_at'),
        client.plan_id
          ? supabase.from('plan_photo_categories').select('*').eq('plan_id', client.plan_id).order('order_index')
          : Promise.resolve({ data: [] }),
        client.plan_id
          ? supabase.from('plan_forms').select('title, description, fields').eq('plan_id', client.plan_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

    return {
      client,
      contract: contract.data,
      formSubmission: formSub.data,
      photos: photos.data || [],
      deadline: deadline.data,
      result: result.data,
      resultFiles: resultFiles.data || [],
      photoCategories: photoCategories.data || [],
      planForm: planForm.data || null,
    }
  },

  async createClient(data: {
    full_name: string
    email: string
    phone?: string
    birth_date: string
    plan_id: string
    notes?: string
  }): Promise<Client> {
    // FIX: passa admin_id explicitamente em vez de confiar no DEFAULT auth.uid()
    // da coluna. Mesmo padrão de adminContent.ts — protege contra mudanças
    // futuras na coluna e deixa a intenção explícita no código.
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Sessão expirada. Faça login novamente.')

    const { data: client, error } = await supabase
      .from('clients')
      .insert({ ...data, admin_id: user.id, status: 'awaiting_contract' })
      .select()
      .single()
    if (error) throw error
    return client
  },

  async updateClient(id: string, updates: Partial<Client>): Promise<void> {
    const { error } = await supabase.from('clients').update(updates).eq('id', id)
    if (error) throw error
  },

  async archiveClient(id: string): Promise<void> {
    const { error } = await supabase
      .from('clients')
      .update({ is_archived: true })
      .eq('id', id)
    if (error) throw error
  },

  async restoreClient(id: string): Promise<void> {
    const { error } = await supabase
      .from('clients')
      .update({ is_archived: false })
      .eq('id', id)
    if (error) throw error
  },

  async deleteClient(id: string): Promise<void> {
    const { data: photos } = await supabase
      .from('client_photos')
      .select('storage_path')
      .eq('client_id', id)

    const { data: resultFiles } = await supabase
      .from('client_result_files')
      .select('storage_path')
      .eq('client_id', id)

    // Legado: limpa arquivos antigos do Supabase Storage (fotos sem drive_file_id)
    const legacyPhotos  = (photos      || []).filter(p => p.storage_path).map(p => p.storage_path)
    const legacyResults = (resultFiles || []).filter(f => f.storage_path).map(f => f.storage_path)

    if (legacyPhotos.length) {
      await supabase.storage.from('client-photos').remove(legacyPhotos)
    }
    if (legacyResults.length) {
      await supabase.storage.from('client-results').remove(legacyResults)
    }

    // Fotos do Drive: o cleanup automático (cron 21 dias após análise entregue)
    // apaga a pasta inteira do cliente. Aqui só removemos do banco.

    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) throw error
  },

  // ---- Approve photos (admin) ----
  /**
   * Aprovação das fotos pela admin.
   * - Calcula o prazo a partir de AGORA
   * - Cria/atualiza registro em client_deadlines
   * - Muda status para 'in_analysis'
   * - Limpa QUALQUER motivo de rejeição pendente (fotos ou formulário)
   * - Envia e-mail de notificação
   */
  async approvePhotos(clientId: string, deadlineDays: number): Promise<void> {
    const approvedAt = new Date()
    const deadline = calculateDeadline(approvedAt, deadlineDays)
    const deadlineDateStr = formatDateForDB(deadline)

    const { error: dlError } = await supabase
      .from('client_deadlines')
      .upsert(
        {
          client_id: clientId,
          photos_sent_at: approvedAt.toISOString(),
          deadline_date: deadlineDateStr,
          updated_at: approvedAt.toISOString(),
        },
        { onConflict: 'client_id' }
      )
    if (dlError) throw dlError

    const { error: stError } = await supabase
      .from('clients')
      .update({
        status: 'in_analysis',
        updated_at: approvedAt.toISOString(),
        // Limpa qualquer resquício de rejeição — ciclo concluído com aprovação
        form_rejection_reason: null,
        form_rejected_at: null,
        photos_rejection_reason: null,
        photos_rejected_at: null,
      })
      .eq('id', clientId)
    if (stError) throw stError

    // Envia e-mail de notificação
    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, admin_id, plan:plans(name)')  // FIX: admin_id para multi-tenant
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'photos_approved',
            adminId: (client as any).admin_id,
            clientToken: client.token,           // ← rede de segurança
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
            deadlineDate: deadlineDateStr,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar e-mail de aprovação de fotos:', e)
    }
  },

  // ─── Rejeição (cliente ajusta no portal, nada é apagado) ─────────────────

  /**
   * Admin solicita ajuste no formulário.
   * - Volta status para 'awaiting_form'
   * - Grava motivo + timestamp
   * - NÃO apaga a submissão anterior (cliente verá o formulário pré-preenchido)
   * - Envia e-mail com o motivo
   */
  async rejectForm(clientId: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error('Motivo obrigatório')

    const { error } = await supabase
      .from('clients')
      .update({
        status: 'awaiting_form',
        form_rejection_reason: reason,
        form_rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', clientId)
    if (error) throw error

    // Notifica a cliente
    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, admin_id, plan:plans(name)')  // FIX: admin_id para multi-tenant
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'form_rejected',
            adminId: (client as any).admin_id,
            clientToken: client.token,
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
            reason,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar e-mail de rejeição de formulário:', e)
    }
  },

  /**
   * Admin solicita ajuste nas fotos.
   * - Volta status para 'awaiting_photos'
   * - Grava motivo + timestamp
   * - NÃO apaga as fotos (cliente verá as atuais, poderá remover/substituir)
   * - Envia e-mail com o motivo
   */
  async rejectPhotos(clientId: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error('Motivo obrigatório')

    const { error } = await supabase
      .from('clients')
      .update({
        status: 'awaiting_photos',
        photos_rejection_reason: reason,
        photos_rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', clientId)
    if (error) throw error

    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, admin_id, plan:plans(name)')  // FIX: admin_id para multi-tenant
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'photos_rejected',
            adminId: (client as any).admin_id,
            clientToken: client.token,
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
            reason,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar e-mail de rejeição de fotos:', e)
    }
  },

  /**
   * Admin solicita ajuste nos dois — formulário E fotos.
   * Status final: 'awaiting_form' (cliente faz formulário primeiro, depois fotos).
   * Motivos e timestamps das duas rejeições ficam gravados simultaneamente.
   */
  async rejectBoth(clientId: string, formReason: string, photosReason: string): Promise<void> {
    if (!formReason.trim()) throw new Error('Motivo do formulário obrigatório')
    if (!photosReason.trim()) throw new Error('Motivo das fotos obrigatório')

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('clients')
      .update({
        status: 'awaiting_form',                    // formulário primeiro
        form_rejection_reason: formReason,
        form_rejected_at: now,
        photos_rejection_reason: photosReason,
        photos_rejected_at: now,
        updated_at: now,
      })
      .eq('id', clientId)
    if (error) throw error

    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, admin_id, plan:plans(name)')  // FIX: admin_id para multi-tenant
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'both_rejected',
            adminId: (client as any).admin_id,
            clientToken: client.token,
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
            formReason,
            photosReason,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar e-mail de rejeição de ambos:', e)
    }
  },

  // ─── Controle de Etapas (admin) ──────────────────────────────────────────

  /**
   * Reabrir uma etapa específica — volta a cliente para um status anterior.
   *
   * Funciona a partir de QUALQUER status atual (inclusive `completed`).
   * Não apaga dados: form_submission, fotos e assinatura continuam intactos —
   * a cliente vê tudo pré-preenchido e só ajusta o que precisar.
   *
   * Steps:
   *   - 'contract': volta p/ awaiting_contract (remove assinatura)
   *   - 'form':     volta p/ awaiting_form    (+ form_rejection_reason)
   *   - 'photos':   volta p/ awaiting_photos  (+ photos_rejection_reason)
   *   - 'review':   volta p/ photos_submitted (remove deadline)
   *
   * `reason` é opcional — se não passar, usa mensagem genérica.
   *
   * ATENÇÃO: se a cliente estava em `completed` e você reabre, o portal
   * deixa de mostrar o resultado automaticamente (porque é renderizado por
   * status). Quando você avançar de volta a `completed`, o resultado
   * reaparece intacto (não mexemos em `is_released`).
   */
  async reopenStep(
    clientId: string,
    step: 'contract' | 'form' | 'photos' | 'review' | 'analysis' | 'materials' | 'validate_materials' | 'send_dossier' | 'ai_photo' | 'simulations' | 'make_capillary' | 'validate_capillary' | 'send_capillary' | 'result',
    reason?: string
  ): Promise<void> {
    const now = new Date().toISOString()
    const defaultReason = reason?.trim() || 'A consultora solicitou um ajuste nesta etapa.'

    if (step === 'contract') {
      // ─── HARD RESET ─────────────────────────────────────────────────────
      // Voltar pro contrato é o ponto mais inicial do funil — qualquer dado
      // gerado nas etapas seguintes vira inconsistente. Apagamos TUDO:
      //   - assinatura
      //   - submissão do formulário (form vai vir em branco)
      //   - fotos (DB + storage)
      //   - prazo
      //   - resultado e arquivos de resultado (DB + storage)
      //
      // OBS: para reabertura do form/photos/etc, o comportamento continua
      // sendo SOFT (preserva dados pra cliente só ajustar). Só `contract`
      // faz limpeza total porque conceitualmente é "começar de novo".

      // 1. Coleta storage_paths antes de deletar do banco
      const [{ data: photoRows }, { data: resultFileRows }] = await Promise.all([
        supabase.from('client_photos').select('storage_path').eq('client_id', clientId),
        supabase.from('client_result_files').select('storage_path').eq('client_id', clientId),
      ])

      // 2. Limpa storage (não-crítico — registros DB são removidos a seguir
      //    independentemente disso)
      if (photoRows?.length) {
        try {
          await supabase.storage
            .from('client-photos')
            .remove(photoRows.map(p => p.storage_path).filter(Boolean))
        } catch (e) {
          console.warn('Erro ao limpar fotos do storage durante reset do contrato:', e)
        }
      }
      if (resultFileRows?.length) {
        try {
          await supabase.storage
            .from('client-results')
            .remove(resultFileRows.map(f => f.storage_path).filter(Boolean))
        } catch (e) {
          console.warn('Erro ao limpar arquivos de resultado do storage durante reset do contrato:', e)
        }
      }

      // 3. Apaga tudo no banco em paralelo
      await Promise.all([
        supabase.from('client_contracts').delete().eq('client_id', clientId),
        supabase.from('client_form_submissions').delete().eq('client_id', clientId),
        supabase.from('client_photos').delete().eq('client_id', clientId),
        supabase.from('client_deadlines').delete().eq('client_id', clientId),
        supabase.from('client_result_files').delete().eq('client_id', clientId),
        supabase.from('client_results').delete().eq('client_id', clientId),
      ])

      // 4. Status volta para o início + limpa rejeições antigas
      const { error } = await supabase
        .from('clients')
        .update({
          status: 'awaiting_contract',
          form_rejection_reason: null,
          form_rejected_at: null,
          photos_rejection_reason: null,
          photos_rejected_at: null,
          updated_at: now,
        })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'form') {
      const { error } = await supabase
        .from('clients')
        .update({
          status: 'awaiting_form',
          form_rejection_reason: defaultReason,
          form_rejected_at: now,
          updated_at: now,
        })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'photos') {
      const { error } = await supabase
        .from('clients')
        .update({
          status: 'awaiting_photos',
          photos_rejection_reason: defaultReason,
          photos_rejected_at: now,
          updated_at: now,
        })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'review') {
      // Volta pra revisão: remove o prazo (será recalculado quando aprovar
      // de novo) e limpa qualquer rejeição pendente
      await supabase.from('client_deadlines').delete().eq('client_id', clientId)
      const { error } = await supabase
        .from('clients')
        .update({
          status: 'photos_submitted',
          form_rejection_reason: null,
          form_rejected_at: null,
          photos_rejection_reason: null,
          photos_rejected_at: null,
          updated_at: now,
        })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'analysis') {
      // Volta pra análise: PRESERVA o prazo já atribuído — ele foi calculado
      // quando as fotos foram aprovadas e não deve ser removido só porque
      // a etapa está sendo reaberta internamente. O prazo só é limpo quando
      // voltamos para 'review' (photos_submitted), pois nesse caso as fotos
      // serão reavaliadas e o prazo recalculado na próxima aprovação.
      // Somente a admin pode editar o prazo manualmente após a reabertura.
      const { error } = await supabase
        .from('clients')
        .update({
          status: 'in_analysis',
          form_rejection_reason: null,
          form_rejected_at: null,
          photos_rejection_reason: null,
          photos_rejected_at: null,
          updated_at: now,
        })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'materials') {
      // Volta pra preparação de materiais
      const { error } = await supabase
        .from('clients')
        .update({
          status: 'preparing_materials',
          updated_at: now,
        })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'validate_materials') {
      // Volta para validação interna de materiais
      const { error } = await supabase
        .from('clients')
        .update({
          status: 'validating_materials',
          updated_at: now,
        })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'send_dossier') {
      // Volta para envio de dossiê — etapa interna, cliente não vê mudança
      const { error } = await supabase
        .from('clients')
        .update({ status: 'sending_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'ai_photo') {
      // Volta para "Aguardando Foto IA" — cliente vê o resultado parcial
      // (se já liberado) + instruções + upload da foto.
      // NÃO reseta is_released — o parcial fica visível pra cliente.
      const { error } = await supabase
        .from('clients')
        .update({ status: 'awaiting_ai_photo', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'simulations') {
      // Volta para 'simulating' (etapa interna; cliente vê "simulações em andamento").
      // NÃO reseta is_released — o parcial JÁ foi liberado em ai_photo (ou no
      // próprio simulations quando o plano não tem IA) e deve continuar visível.
      const { error } = await supabase
        .from('clients')
        .update({ status: 'simulating', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'make_capillary') {
      const { error } = await supabase
        .from('clients')
        .update({ status: 'making_capillary_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'validate_capillary') {
      const { error } = await supabase
        .from('clients')
        .update({ status: 'validating_capillary_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'send_capillary') {
      const { error } = await supabase
        .from('clients')
        .update({ status: 'sending_capillary_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'result') {
      // "Reabrir resultado" volta para 'sending_capillary_dossier' (etapa
      // imediatamente anterior a 'completed') e oculta o resultado FINAL.
      // Reseta is_released — admin reabre pra refazer/corrigir.
      await supabase
        .from('client_results')
        .update({ is_released: false, updated_at: now })
        .eq('client_id', clientId)
      const { error } = await supabase
        .from('clients')
        .update({ status: 'sending_capillary_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
  },

  /**
   * @deprecated — não é mais chamado.
   * Reabertura de etapas pelo StageController não envia e-mail.
   * E-mails de rejeição são disparados apenas pelos métodos rejectForm/rejectPhotos/rejectBoth.
   */
  async _notifyReopen(clientId: string, type: string, reason: string): Promise<void> {
    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, admin_id, plan:plans(name)')  // FIX: admin_id para multi-tenant
        .eq('id', clientId)
        .single()
      if (!client) return
      const portalUrl = `${window.location.origin}/c/${client.token}`
      await supabase.functions.invoke('send-contract-email', {
        body: {
          type,
          adminId: (client as any).admin_id,
          clientToken: client.token,
          clientName: client.full_name,
          clientEmail: client.email,
          planName: (client as any).plan?.name || '',
          portalUrl,
          reason,
        },
      })
    } catch (e) {
      console.warn('Erro ao notificar reabertura de etapa:', e)
    }
  },

  /**
   * Avançar uma etapa manualmente — pula a ação da cliente.
   *
   * Útil quando a etapa foi resolvida fora do sistema (ex: contrato assinado
   * por e-mail, formulário preenchido por ligação, etc).
   *
   * Transições:
   *   awaiting_contract → awaiting_form       (cria registro de assinatura)
   *   awaiting_form     → awaiting_photos     (limpa rejeição se houver)
   *   awaiting_photos   → photos_submitted    (envia para revisão)
   *   photos_submitted  → in_analysis         (delega para approvePhotos)
   *   in_analysis       → completed           (delega para releaseResult)
   *
   * Em `completed` não há pra onde avançar — lança erro.
   */
  async advanceStep(clientId: string): Promise<void> {
    const { data: client, error } = await supabase
      .from('clients')
      .select('status, plan:plans(deadline_days)')
      .eq('id', clientId)
      .single()
    if (error) throw error
    if (!client) throw new Error('Cliente não encontrada')

    const now = new Date().toISOString()
    const currentStatus = client.status as string

    // Casos que delegam para ações já existentes (que calculam prazo / enviam e-mail)
    if (currentStatus === 'photos_submitted') {
      const days = (client as any).plan?.deadline_days ?? 5
      return this.approvePhotos(clientId, days)
    }
    if (currentStatus === 'in_analysis') {
      // Avança para "Preparando Materiais" — resultado ainda não liberado
      const { error } = await supabase
        .from('clients')
        .update({ status: 'preparing_materials', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'preparing_materials') {
      // Avança para "Validar Materiais" — etapa interna, cliente ainda vê "Preparando Materiais"
      const { error } = await supabase
        .from('clients')
        .update({ status: 'validating_materials', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'validating_materials') {
      // Avança para "Enviar Dossiê" — etapa interna, cliente ainda vê "Preparando Materiais"
      const { error } = await supabase
        .from('clients')
        .update({ status: 'sending_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'sending_dossier') {
      // Decide o próximo status baseado no plano:
      //   - Plano tem categoria com is_ai_simulation=true → 'awaiting_ai_photo'
      //   - Caso contrário                                → 'simulating' (pula a etapa)
      const planId = (client as any).plan_id
      let goesToAi = false
      if (planId) {
        const { data: aiCats, error: catErr } = await supabase
          .from('plan_photo_categories')
          .select('id')
          .eq('plan_id', planId)
          .eq('is_ai_simulation', true)
          .limit(1)
        if (catErr) {
          // Se a coluna is_ai_simulation não existe (migration não aplicada),
          // o erro vem aqui. Seguimos como se o plano não tivesse IA, mas
          // logamos pra investigação.
          console.warn('[advanceStep] erro consultando is_ai_simulation:', catErr.message)
        }
        goesToAi = !!aiCats && aiCats.length > 0
      }
      const nextStatus = goesToAi ? 'awaiting_ai_photo' : 'simulating'
      const { error } = await supabase
        .from('clients')
        .update({ status: nextStatus, updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'awaiting_ai_photo') {
      // Admin validou a foto IA — avança pra 'simulating'.
      const { error } = await supabase
        .from('clients')
        .update({ status: 'simulating', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'simulating') {
      // Avança pra "Fazer Dossiê Capilar" — etapa interna; cliente continua
      // vendo "simulações em andamento". Resultado FINAL ainda não liberado.
      const { error } = await supabase
        .from('clients')
        .update({ status: 'making_capillary_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'making_capillary_dossier') {
      const { error } = await supabase
        .from('clients')
        .update({ status: 'validating_capillary_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'validating_capillary_dossier') {
      const { error } = await supabase
        .from('clients')
        .update({ status: 'sending_capillary_dossier', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'sending_capillary_dossier') {
      // Avança pra "Resultado" — libera resultado FINAL e dispara e-mail.
      return this.releaseResult(clientId)
    }
    if (currentStatus === 'completed') {
      throw new Error('Esta cliente já está concluída — não há próxima etapa.')
    }

    // Demais transições: mudança direta de status
    const nextByCurrent: Record<string, string> = {
      awaiting_contract: 'awaiting_form',
      awaiting_form: 'awaiting_photos',
      awaiting_photos: 'photos_submitted',
    }
    const next = nextByCurrent[currentStatus]
    if (!next) throw new Error(`Status desconhecido: ${currentStatus}`)

    // Se pulou o contrato, registra "assinatura manual" para o progresso ficar consistente
    if (currentStatus === 'awaiting_contract') {
      await supabase.from('client_contracts').upsert(
        { client_id: clientId, signed_at: now },
        { onConflict: 'client_id' }
      )
    }

    const { error: updateErr } = await supabase
      .from('clients')
      .update({
        status: next,
        // ao avançar, limpa rejeições pendentes da etapa que pulamos
        ...(currentStatus === 'awaiting_form'
          ? { form_rejection_reason: null, form_rejected_at: null }
          : {}),
        ...(currentStatus === 'awaiting_photos'
          ? { photos_rejection_reason: null, photos_rejected_at: null }
          : {}),
        updated_at: now,
      })
      .eq('id', clientId)
    if (updateErr) throw updateErr
  },

  /**
   * Pular DIRETAMENTE para uma etapa qualquer (pra frente OU pra trás), sem
   * disparar efeitos colaterais das transições intermediárias.
   *
   * Diferente de `advanceStep` (que respeita o fluxo natural — chama
   * approvePhotos, releaseResult, calcula prazo, manda e-mails) e diferente
   * de `reopenStep` (que volta SOFT preservando dados ou HARD apagando tudo
   * no caso do contrato), este método apenas atualiza `status` e ajusta
   * `stage_timestamps` (apaga timestamps de etapas posteriores ao destino,
   * pra UI ficar consistente quando a admin "regrediu").
   *
   * Dados de tabelas relacionadas (client_contracts, client_form_submissions,
   * client_photos, client_deadlines, client_results, client_result_files)
   * NUNCA são tocados aqui — preservação total.
   *
   * Exceções:
   *   - destino = 'awaiting_contract' → delega pra `reopenStep('contract')`
   *     que faz hard reset (apaga assinatura, formulário, fotos, prazo,
   *     resultado e arquivos). É o único caso em que o pulo destrói dados,
   *     porque "voltar pro contrato" significa recomeçar do zero.
   *   - destino = 'completed' → delega pra `releaseResult` que libera o
   *     resultado (`is_released = true`) e dispara e-mail "result_released".
   *     Sem isso, o portal não exibe o resultado final.
   *
   * Observação: o `client_results.is_released` (parcial) NÃO é alterado
   * automaticamente em destinos como `awaiting_ai_photo` ou `simulating` —
   * a admin libera/cancela parcial manualmente pelos botões existentes.
   */
  async jumpToStep(clientId: string, targetStatus: string): Promise<void> {
    // Lista canônica de status na ordem do fluxo (espelha COL_ORDER do
    // ClientsManager e STEPS do StageController). Se um status novo for
    // adicionado ao sistema, lembre de adicionar aqui também.
    const STATUS_ORDER = [
      'awaiting_contract', 'awaiting_form', 'awaiting_photos', 'photos_submitted',
      'in_analysis', 'preparing_materials', 'validating_materials', 'sending_dossier',
      'awaiting_ai_photo', 'simulating', 'making_capillary_dossier',
      'validating_capillary_dossier', 'sending_capillary_dossier', 'completed',
    ]
    // Mapa status → key usada em stage_timestamps (mesmo nome usado no
    // StageController, mantido por compatibilidade visual).
    const STATUS_TO_KEY: Record<string, string> = {
      awaiting_contract:            'contract',
      awaiting_form:                'form',
      awaiting_photos:              'photos',
      photos_submitted:             'review',
      in_analysis:                  'analysis',
      preparing_materials:          'materials',
      validating_materials:         'validate_materials',
      sending_dossier:              'send_dossier',
      awaiting_ai_photo:            'ai_photo',
      simulating:                   'simulations',
      making_capillary_dossier:     'make_capillary',
      validating_capillary_dossier: 'validate_capillary',
      sending_capillary_dossier:    'send_capillary',
      completed:                    'result',
    }

    if (!STATUS_ORDER.includes(targetStatus)) {
      throw new Error(`Status de destino inválido: ${targetStatus}`)
    }

    // Caso especial 1 — destino é o contrato: hard reset via reopenStep.
    if (targetStatus === 'awaiting_contract') {
      return this.reopenStep(clientId, 'contract', 'Movido manualmente pela consultora')
    }

    // Caso especial 2 — destino é completed: precisa liberar o resultado e
    // mandar o e-mail final, senão o portal não exibe nada pra cliente.
    if (targetStatus === 'completed') {
      return this.releaseResult(clientId)
    }

    const now = new Date().toISOString()

    // Busca status atual + timestamps pra ajustar a UI corretamente.
    const { data: current, error: fetchErr } = await supabase
      .from('clients')
      .select('status, stage_timestamps')
      .eq('id', clientId)
      .single()
    if (fetchErr) throw fetchErr
    if (!current) throw new Error('Cliente não encontrada')

    const currentStatus = current.status as string
    if (currentStatus === targetStatus) return // no-op

    const targetIdx = STATUS_ORDER.indexOf(targetStatus)
    const stageTimestamps: Record<string, string> = (current as any).stage_timestamps || {}

    // Apaga timestamps das etapas que ficam DEPOIS do destino (incluindo o
    // destino, porque ele agora é a etapa atual — não está concluído).
    // Ex: se destino é 'in_analysis' (idx 4), apaga keys de 'analysis',
    // 'materials', 'validate_materials', etc. em diante. Etapas anteriores
    // (contract, form, photos, review) mantêm seus timestamps reais.
    const updatedTimestamps = { ...stageTimestamps }
    for (let i = targetIdx; i < STATUS_ORDER.length; i++) {
      const status = STATUS_ORDER[i]
      const key = STATUS_TO_KEY[status]
      if (key) delete updatedTimestamps[key]
    }

    // Limpa rejeições pendentes — quando admin pula, ela está reposicionando
    // a cliente, qualquer rejeição anterior fica obsoleta.
    const { error } = await supabase
      .from('clients')
      .update({
        status: targetStatus,
        stage_timestamps: updatedTimestamps,
        form_rejection_reason: null,
        form_rejected_at: null,
        photos_rejection_reason: null,
        photos_rejected_at: null,
        updated_at: now,
      })
      .eq('id', clientId)
    if (error) throw error
  },

  // ---- Results ----
  async getClientPhotosWithUrls(clientId: string) {
    const { data: photos } = await supabase
      .from('client_photos')
      .select('*')
      .eq('client_id', clientId)
      .order('uploaded_at')

    return (photos || []).map(photo => {
      let url: string
      if (photo.drive_file_id) {
        // Foto nova: pública no Drive da admin
        url = driveStorage.viewUrl(photo.drive_file_id)
      } else if (photo.storage_path) {
        // Foto legada: ainda no bucket do Supabase
        const { data } = supabase.storage.from('client-photos').getPublicUrl(photo.storage_path)
        url = data.publicUrl
      } else {
        url = ''
      }
      return { ...photo, url }
    })
  },

  async saveResult(
    clientId: string,
    result: { folder_url?: string | null; observations?: string; custom_link_url?: string }
  ): Promise<void> {
    const { error } = await supabase
      .from('client_results')
      .upsert(
        { client_id: clientId, ...result, updated_at: new Date().toISOString() },
        { onConflict: 'client_id' }
      )
    if (error) throw error
  },

  /**
   * Busca os arquivos de resultado do cliente (client_result_files) já no
   * formato que a Edge Function `send-contract-email` espera para anexar
   * no e-mail (id do Drive + nome). Só entram arquivos que já têm
   * drive_file_id — arquivos legados (storage_path do Supabase) não são
   * anexados automaticamente.
   *
   * Usado tanto em releaseResult (primeiro e-mail) quanto em
   * resendResultEmail (reenvio manual).
   */
  async getResultFilesForEmail(
    clientId: string
  ): Promise<Array<{ driveFileId: string; fileName: string }>> {
    const { data: files } = await supabase
      .from('client_result_files')
      .select('drive_file_id, file_name')
      .eq('client_id', clientId)
      .not('drive_file_id', 'is', null)
      .order('uploaded_at')

    return (files || [])
      .filter((f: any) => f.drive_file_id)
      .map((f: any) => ({ driveFileId: f.drive_file_id as string, fileName: f.file_name as string }))
  },

  async releaseResult(clientId: string, options?: { chatEnabled?: boolean }): Promise<void> {
    const { error } = await supabase
      .from('client_results')
      .upsert(
        {
          client_id: clientId,
          is_released: true,
          released_at: new Date().toISOString(),
          chat_enabled: options?.chatEnabled ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id' }
      )
    if (error) throw error

    await supabase
      .from('clients')
      .update({ status: 'completed' })
      .eq('id', clientId)

    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, admin_id, plan:plans(name)')  // FIX: admin_id para multi-tenant
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''
        const resultFiles = await this.getResultFilesForEmail(clientId)

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'result_released',
            adminId: (client as any).admin_id,
            clientToken: client.token,
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
            resultFiles,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar e-mail de resultado liberado:', e)
    }
  },

  /**
   * Reenvia o e-mail de resultado concluído — mesmo conteúdo/anexos do
   * releaseResult, mas SEM mexer em client_results/clients (não altera
   * released_at nem status). Feito pra quando a consultora adiciona um
   * arquivo depois de já ter marcado como concluído e quer que a cliente
   * receba o material novo por e-mail.
   *
   * Só funciona com o cliente já em status 'completed' — chame a partir do
   * botão "Reenviar e-mail" que só aparece nesse estado (ver StageController).
   */
  async resendResultEmail(clientId: string): Promise<void> {
    const { data: client, error: cliErr } = await supabase
      .from('clients')
      .select('full_name, email, token, admin_id, status, plan:plans(name)')
      .eq('id', clientId)
      .single()
    if (cliErr || !client) throw new Error('Cliente não encontrado')
    if ((client as any).status !== 'completed') {
      throw new Error('Só é possível reenviar o e-mail de um resultado já concluído.')
    }

    const portalUrl = `${window.location.origin}/c/${client.token}`
    const planName = (client as any).plan?.name || ''
    const resultFiles = await this.getResultFilesForEmail(clientId)

    const { error } = await supabase.functions.invoke('send-contract-email', {
      body: {
        type: 'result_released',
        isResend: true,
        adminId: (client as any).admin_id,
        clientToken: client.token,
        clientName: client.full_name,
        clientEmail: client.email,
        planName,
        portalUrl,
        resultFiles,
      }
    })
    if (error) throw new Error(error.message || 'Erro ao reenviar e-mail')
  },

  /**
   * Libera o resultado parcialmente — mesma lógica do releaseResult,
   * mas SEM avançar o status para 'completed'.
   * Usado durante a etapa de Simulações. O e-mail disparado é o
   * 'partial_result_released', diferente do 'result_released' final.
   */
  async releasePartialResult(clientId: string, options?: { chatEnabled?: boolean }): Promise<void> {
    const { error } = await supabase
      .from('client_results')
      .upsert(
        {
          client_id: clientId,
          is_released: true,
          released_at: new Date().toISOString(),
          chat_enabled: options?.chatEnabled ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id' }
      )
    if (error) throw error

    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, admin_id, plan:plans(name)')  // FIX: admin_id para multi-tenant
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'partial_result_released',
            adminId: (client as any).admin_id,
            clientToken: client.token,
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar e-mail de resultado parcial:', e)
    }
  },

  /**
   * Cancela a liberação parcial do resultado.
   * Oculta o resultado do portal sem alterar o status da cliente.
   */
  async cancelPartialResult(clientId: string): Promise<void> {
    const { error } = await supabase
      .from('client_results')
      .update({ is_released: false, updated_at: new Date().toISOString() })
      .eq('client_id', clientId)
    if (error) throw error
  },

  /**
   * Revoga o resultado já liberado (completed).
   *
   * Diferente de cancelPartialResult (que só oculta sem mexer no status),
   * aqui também volta o status para 'simulating' — porque o resultado estava
   * totalmente liberado e a admin quer reabrir o ciclo para corrigir/refazer
   * antes de liberar novamente.
   *
   * O que NÃO muda:
   *   - folder_url, observações e arquivos de resultado ficam intactos
   *   - ao liberar de novo (advanceStep de simulating), tudo reaparece
   */
  async revokeResult(clientId: string): Promise<void> {
    const now = new Date().toISOString()

    const { error: resultErr } = await supabase
      .from('client_results')
      .update({ is_released: false, updated_at: now })
      .eq('client_id', clientId)
    if (resultErr) throw resultErr

    const { error: clientErr } = await supabase
      .from('clients')
      .update({ status: 'sending_capillary_dossier', updated_at: now })
      .eq('id', clientId)
    if (clientErr) throw clientErr
  },

  async uploadResultFile(clientId: string, file: File): Promise<void> {
    // Resgata o token do cliente — a Edge Function drive/upload precisa
    // dele pra resolver o admin dono
    const { data: client, error: cliErr } = await supabase
      .from('clients')
      .select('token')
      .eq('id', clientId)
      .single()
    if (cliErr || !client) throw new Error('Cliente não encontrado')

    await driveStorage.uploadPhoto({
      portalToken: client.token,
      file,
      categoryId: null,
      kind: 'result_file',
    })
  },

  async deleteResultFile(fileId: string, storagePath: string | null): Promise<void> {
    if (storagePath) {
      // Legado: arquivo no bucket
      try { await supabase.storage.from('client-results').remove([storagePath]) } catch {}
    }
    // Drive: cleanup automático apaga junto com a pasta do cliente em 21d
    await supabase.from('client_result_files').delete().eq('id', fileId)
  },

  /**
   * Gera a URL pra abrir/baixar arquivo de resultado.
   * Aceita o registro inteiro (com storage_path OU drive_file_id).
   * Mantém compatibilidade com chamadas antigas que passavam só o storage_path string.
   */
  getResultFileUrl(fileOrPath: string | { storage_path?: string | null; drive_file_id?: string | null }): string {
    // Compat: chamada antiga com string
    if (typeof fileOrPath === 'string') {
      const { data } = supabase.storage.from('client-results').getPublicUrl(fileOrPath)
      return data.publicUrl
    }
    if (fileOrPath.drive_file_id) {
      return driveStorage.downloadUrl(fileOrPath.drive_file_id)
    }
    if (fileOrPath.storage_path) {
      const { data } = supabase.storage.from('client-results').getPublicUrl(fileOrPath.storage_path)
      return data.publicUrl
    }
    return ''
  },

  // ─── Kanban Column Labels ───────────────────────────────────────────────────

  /** Retorna mapa { status_key → display_name } */
  async getColumnLabels(): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('kanban_column_labels')
      .select('status_key, display_name')
    if (error) throw error
    const map: Record<string, string> = {}
    for (const row of data ?? []) map[row.status_key] = row.display_name
    return map
  },

  /** Salva ou atualiza o nome de exibição de uma coluna (per-admin) */
  async upsertColumnLabel(statusKey: string, displayName: string): Promise<void> {
    // admin_id auto-preenche via DEFAULT auth.uid() na tabela.
    // onConflict alvo é a unique constraint composta (admin_id, status_key).
    const { error } = await supabase
      .from('kanban_column_labels')
      .upsert(
        { status_key: statusKey, display_name: displayName },
        { onConflict: 'admin_id,status_key' }
      )
    if (error) throw error
  },

  /** Remove customização (volta ao nome padrão) */
  async deleteColumnLabel(statusKey: string): Promise<void> {
    const { error } = await supabase
      .from('kanban_column_labels')
      .delete()
      .eq('status_key', statusKey)
    if (error) throw error
  },

  // ---- Super Admin: gestão de admins ----
  // Todos esses métodos são só pra super_admin. As policies de RLS
  // (Phase 3, opcional) garantem isso a nível de banco. Por enquanto
  // proteja na UI.

  async listAdmins(): Promise<AdminUser[]> {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, email, nome, role, license_active, license_expires_at, observacoes, created_at')
      .order('role', { ascending: true })  // super_admin vem primeiro
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []) as AdminUser[]
  },

  async toggleAdminLicense(adminId: string, active: boolean): Promise<void> {
    const { error } = await supabase
      .from('admin_users')
      .update({ license_active: active })
      .eq('id', adminId)
    if (error) throw error
  },

  async renewAdminLicense(adminId: string, daysToAdd: number): Promise<void> {
    const { data: current } = await supabase
      .from('admin_users')
      .select('license_expires_at')
      .eq('id', adminId)
      .single()

    const baseDate = current?.license_expires_at && new Date(current.license_expires_at) > new Date()
      ? new Date(current.license_expires_at)
      : new Date()
    baseDate.setDate(baseDate.getDate() + daysToAdd)

    const { error } = await supabase
      .from('admin_users')
      .update({
        license_expires_at: baseDate.toISOString(),
        license_active: true,
      })
      .eq('id', adminId)
    if (error) throw error
  },

  async setAdminLicenseExpiry(adminId: string, expiresAt: string | null): Promise<void> {
    const { error } = await supabase
      .from('admin_users')
      .update({ license_expires_at: expiresAt })
      .eq('id', adminId)
    if (error) throw error
  },

  async updateAdminInfo(
    adminId: string,
    updates: { nome?: string; observacoes?: string }
  ): Promise<void> {
    const { error } = await supabase
      .from('admin_users')
      .update(updates)
      .eq('id', adminId)
    if (error) throw error
  },

  async createAdmin(input: {
    email: string
    password: string
    nome: string
    // ★ NOVO: tipo de conta. Default 'admin' pra preservar compatibilidade
    //   com todas as chamadas antigas que não passam este campo.
    //   Só super_admin tem permissão pra criar contas (via SuperAdminPanel),
    //   e o painel oferece a escolha entre 'admin' (salão), 'chat_admin' (MS Color IA)
    //   e 'full_admin' (Salão + IA).
    role?: 'admin' | 'chat_admin' | 'full_admin'
    license_active?: boolean
    license_expires_at?: string | null
    observacoes?: string
  }): Promise<AdminUser> {
    // Validação defensiva — bloqueia tentativas de criar super_admin por aqui.
    if (input.role && !['admin', 'chat_admin', 'full_admin'].includes(input.role)) {
      throw new Error('Tipo de conta inválido.')
    }

    // Cliente Supabase TEMPORÁRIO sem persistência, pra não substituir
    // a sessão do super admin atual ao criar o usuário.
    const { createClient } = await import('@supabase/supabase-js')
    const tempClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    )

    // 1) Cria no Supabase Auth (cliente temporário)
    const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
      email: input.email,
      password: input.password,
    })
    if (signUpError) throw signUpError
    if (!signUpData.user) throw new Error('Falha ao criar usuário no Auth.')

    // 2) Insere registro em admin_users (no cliente principal, com sua sessão de super_admin)
    const { data: adminData, error: adminError } = await supabase
      .from('admin_users')
      .insert({
        id: signUpData.user.id,
        email: input.email,
        nome: input.nome,
        // ★ aceita o role escolhido (admin, chat_admin ou full_admin), default 'admin'
        role: input.role ?? 'admin',
        license_active: input.license_active ?? true,
        license_expires_at: input.license_expires_at ?? null,
        observacoes: input.observacoes ?? null,
      })
      .select()
      .single()

    if (adminError) {
      // Rollback parcial: o user em auth.users ficou órfão. Idealmente, expor
      // isso pra você limpar manualmente no Dashboard > Authentication > Users.
      throw new Error(
        `Erro ao salvar admin (${adminError.message}). ` +
        `O usuário foi criado em Auth mas não foi vinculado. ` +
        `Verifique em Authentication > Users no Supabase.`
      )
    }

    return adminData as AdminUser
  },

  async deleteAdmin(adminId: string): Promise<void> {
    // ATENÇÃO: isso só remove de admin_users. O auth.users continua existindo
    // (precisa ser removido manualmente no Dashboard ou via Edge Function).
    const { error } = await supabase
      .from('admin_users')
      .delete()
      .eq('id', adminId)
    if (error) throw error
  },

  // ── MS Color IA: config compartilhada ───────────────────────────────
  //
  // chat_admin compartilha as ai_folders globais. A tabela ai_folders
  // não tem coluna admin_id — folders são compartilhadas entre todos
  // os admins por design. Esta função pega a folder mais antiga como
  // "default" pro chat_admin. Se houver múltiplas folders, considere
  // adicionar um flag is_default ou um setting global pra escolher.
  //
  // Requer policy ai_folders_chat_admin_read criada pela
  // migration_chat_admin.sql (chat_admin não passa pelo filtro da
  // policy admin_read antiga).
  async getChatAdminDefaultFolder(): Promise<{ id: string; name: string; config: any } | null> {
    const { data, error } = await supabase
      .from('ai_folders')
      .select('id, name, config')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('[adminService.getChatAdminDefaultFolder] falhou:', error)
      return null
    }
    if (!data) return null

    const config = typeof data.config === 'string'
      ? JSON.parse(data.config)
      : data.config

    return { id: data.id, name: data.name, config }
  },

  // ---- Iris text templates ----

  async listIrisTextTemplates() {
    const { data, error } = await supabase
      .from('iris_text_templates')
      .select('*')
      .order('name')
    if (error) throw error
    return data || []
  },

  async createIrisTextTemplate(payload: {
    name: string; title: string; body: string
    font_family: string; text_color: string; bg_color: string
    title_size: number; body_size: number
  }) {
    const { data, error } = await supabase
      .from('iris_text_templates')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async updateIrisTextTemplate(id: string, payload: {
    name: string; title: string; body: string
    font_family: string; text_color: string; bg_color: string
    title_size: number; body_size: number
  }) {
    const { error } = await supabase
      .from('iris_text_templates')
      .update(payload)
      .eq('id', id)
    if (error) throw error
  },

  async deleteIrisTextTemplate(id: string) {
    const { error } = await supabase
      .from('iris_text_templates')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}

// ============================================================
// CLIENT PORTAL SERVICE (token-based, sem autenticação)
// ============================================================

export const clientService = {
  /**
   * Carrega dados do portal.
   *
   * Além do RPC principal, chama `get_client_portal_extras` para trazer:
   *  - Campos de rejeição no cliente (form/photos_rejection_reason + timestamps)
   *  - form_submission completo (para pré-preencher em caso de reenvio)
   *  - storage_paths das fotos (para gerar URLs públicas)
   *
   * Compatibilidade: se o RPC extras ainda não foi criado no Supabase,
   * a função retorna sem enriquecer (portal funciona como antes).
   */
  async getPortalData(token: string): Promise<ClientPortalData | null> {
    const { data, error } = await supabase.rpc('get_client_portal', { p_token: token })
    if (error) return null
    if (data?.error) return null

    const portalData = data as ClientPortalData
    if (!portalData?.client?.id) return portalData

    // Enriquecer com dados necessários pro fluxo de rejeição
    try {
      const { data: extras, error: extrasErr } = await supabase.rpc(
        'get_client_portal_extras',
        { p_token: token }
      )

      if (!extrasErr && extras) {
        // 1. Rejeição no cliente
        portalData.client = {
          ...portalData.client,
          form_rejection_reason: extras.form_rejection_reason ?? null,
          form_rejected_at: extras.form_rejected_at ?? null,
          photos_rejection_reason: extras.photos_rejection_reason ?? null,
          photos_rejected_at: extras.photos_rejected_at ?? null,
        }

        // 2. Form submission completo
        portalData.form_submission = extras.form_submission ?? null

        // 3. URLs das fotos — reconstruindo a partir de extras.photo_paths
        // IMPORTANTE: não depende de portalData.photos estar pré-populado,
        // pois o RPC get_client_portal pode omitir fotos em status awaiting_form
        // (e.g. após rejeição de formulário quando o cliente já tinha fotos)
        if (Array.isArray(extras.photo_paths) && extras.photo_paths.length > 0) {
          const photosFromPaths = extras.photo_paths
            .filter((p: any) => p?.id && p?.storage_path)
            .map((p: any) => {
              const { data: urlData } = supabase.storage
                .from('client-photos')
                .getPublicUrl(p.storage_path)
              return {
                id: p.id,
                photo_name: p.photo_name ?? '',
                category_id: p.category_id ?? null,
                url: urlData.publicUrl,
              }
            })

          if (photosFromPaths.length > 0) {
            // Mescla com portalData.photos existente (preserva campos extras se houver)
            const existingMap = new Map((portalData.photos || []).map((ph: any) => [ph.id, ph]))
            portalData.photos = photosFromPaths.map((ph: any) => ({
              ...(existingMap.get(ph.id) || {}),
              ...ph,
            }))
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar extras do portal (não crítico):', e)
    }

    // ── Fallback: busca direta das fotos quando o RPC não as retornou ──────
    // Cobre o caso de rejeição de formulário (status=awaiting_form) onde o
    // RPC principal não inclui as fotos na resposta
    if (
      portalData.client.form_rejection_reason &&
      (!portalData.photos || portalData.photos.length === 0)
    ) {
      try {
        const { data: photoRows } = await supabase
          .from('client_photos')
          .select('id, photo_name, category_id, storage_path')
          .eq('client_id', portalData.client.id)

        if (photoRows && photoRows.length > 0) {
          portalData.photos = photoRows.map((p: any) => ({
            id: p.id,
            photo_name: p.photo_name ?? '',
            category_id: p.category_id ?? null,
            url: supabase.storage
              .from('client-photos')
              .getPublicUrl(p.storage_path).data.publicUrl,
          }))
        }
      } catch (e) {
        console.warn('Erro ao buscar fotos (fallback):', e)
      }
    }

    // ── Buscar chat_enabled, custom_link_url e arquivos de resultado ────────
    // Usa RPC com SECURITY DEFINER — evita queries diretas sem auth que causavam
    // "Invalid Refresh Token" + 406 no portal do cliente.
    if (portalData.result) {
      try {
        const { data: resultExtras, error: reErr } = await supabase.rpc(
          'get_client_portal_result_extras',
          { p_token: token }
        )
        if (!reErr && resultExtras) {
          portalData.result.chat_enabled    = resultExtras.chat_enabled    ?? true
          portalData.result.custom_link_url = resultExtras.custom_link_url ?? null
          portalData.result.files           = resultExtras.result_files    ?? []
        } else {
          portalData.result.chat_enabled    = true
          portalData.result.custom_link_url = null
          portalData.result.files           = portalData.result.files ?? []
        }
      } catch (e) {
        console.warn('Erro ao carregar extras de resultado (não crítico):', e)
        portalData.result.chat_enabled    = true
        portalData.result.custom_link_url = null
        portalData.result.files           = portalData.result.files ?? []
      }
    }

    return portalData
  },

  /**
   * Salva o idioma escolhido pela cliente no portal (i18n). Chamado pelo
   * LanguageProvider sempre que ela troca de idioma no seletor — assim a
   * preferência persiste entre dispositivos/sessões, não só no localStorage
   * do navegador atual.
   *
   * Usa a RPC `update_client_language` (SECURITY DEFINER, autenticada por
   * portal_token) — mesmo padrão de sign_client_contract. Falha aqui não deve
   * quebrar o fluxo do portal, por isso é silenciosa (apenas console.warn).
   */
  async updateClientLanguage(token: string, language: string): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('update_client_language', {
        p_token: token,
        p_language: language,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
    } catch (e) {
      console.warn('Erro ao salvar idioma do cliente (não crítico):', e)
    }
  },

  async signContract(
    token: string,
    meta?: {
      country?: string
      ip?: string
      signedAt?: string
      // ↓ Campos adicionados: ClientSignup.tsx envia, mas estavam sendo
      // descartados pelo TypeScript silenciosamente. Sem eles, a Edge Function
      // gerava o PDF SEM a assinatura manuscrita e SEM o IP do signatário.
      contractTitle?: string
      sections?: Array<{ id?: string; title: string; content: string; order: number }>
      signatureDataUrl?: string
    }
  ): Promise<void> {
    const { data, error } = await supabase.rpc('sign_client_contract', { p_token: token })
    if (error) throw error
    if (data?.error) throw new Error(data.error)

    const signedAt = meta?.signedAt ?? new Date().toISOString()

    // Salva país, IP e timestamp de assinatura no registro do cliente.
    // Wrapped em try/catch para não quebrar o fluxo caso as colunas ainda não
    // existam no banco (adicione `country`, `signed_ip` e `signed_at` à tabela
    // `clients` se quiser persistir esses dados).
    if (meta && (meta.country || meta.ip)) {
      try {
        await supabase
          .from('clients')
          .update({
            ...(meta.country  ? { country: meta.country }      : {}),
            ...(meta.ip       ? { signed_ip: meta.ip }         : {}),
            ...(meta.signedAt ? { signed_at: meta.signedAt }   : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('token', token)
      } catch (_) {
        // Silently ignore — columns may not exist yet
      }
    }

    // ── Notificação por e-mail (cliente + admin) ────────────────────────────
    // Dispara a Edge Function `send-contract-email` com type='contract_signed'
    // que gera o PDF do contrato e manda para os dois.
    // Roda em try/catch — falha de e-mail não deve quebrar a assinatura.
    // É chamado em TODA assinatura (inclusive re-assinatura após reabertura),
    // já que cada assinatura é um evento de negócio que merece registro.
    try {
      // Tenta carregar dados do cliente (pode retornar null em contexto anon por RLS).
      // O invoke é feito independentemente — clientToken garante que a Edge Function
      // resolve adminId e dados do cliente via service role quando necessário.
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, plan_id, admin_id, plan:plans(name)')
        .eq('token', token)
        .maybeSingle()

      // Prioridade: o que vem do frontend > o que está no DB.
      // O frontend já carregou o contrato pra exibir e pra gerar o PDF de
      // download local, então geralmente já manda tudo pronto.
      let contractTitle: string | undefined = meta?.contractTitle
      let sections: any[] = Array.isArray(meta?.sections) ? meta!.sections : []

      // Fallback: se não veio do frontend, tenta buscar do DB
      if ((!sections || sections.length === 0) && (client as any)?.plan_id) {
        const { data: planContract } = await supabase
          .from('plan_contracts')
          .select('title, sections')
          .eq('plan_id', (client as any).plan_id)
          .maybeSingle()
        if (planContract) {
          if (!contractTitle) contractTitle = planContract.title
          sections = Array.isArray(planContract.sections) ? planContract.sections : []
        }
      }

      const portalUrl = `${window.location.origin}/c/${token}`

      // Sempre invoca — clientToken é o fallback obrigatório.
      // Se admin_id veio null (RLS bloqueou a query anon), a Edge Function
      // resolve o adminId sozinha via service role usando o token.
      await supabase.functions.invoke('send-contract-email', {
        body: {
          type: 'contract_signed',
          adminId: (client as any)?.admin_id || null,
          clientToken: token,
          clientName: client?.full_name || '',
          clientEmail: client?.email || '',
          planName: (client as any)?.plan?.name || '',
          signedAt,
          contractTitle,
          sections,
          portalUrl,
          // ↓ Campos que estavam faltando — sem eles o PDF do e-mail saía
          // sem a assinatura manuscrita e sem o IP no bloco de assinatura.
          ip: meta?.ip,
          signatureDataUrl: meta?.signatureDataUrl,
        },
      })
    } catch (e) {
      console.warn('Erro ao enviar e-mail de contrato assinado:', e)
    }
  },

  /**
   * Cliente envia/reenvia o formulário.
   *
   * Fluxo normal: status muda para 'awaiting_photos' (pelo RPC).
   *
   * Caso especial pós-rejeição só do formulário: se a cliente já tem fotos
   * enviadas, pula direto para 'photos_submitted' (revisão da admin) em vez
   * de forçar novo envio de fotos que estavam OK.
   *
   * Em qualquer caso, limpa os campos de rejeição do formulário.
   */
  async submitForm(token: string, formData: Record<string, any>): Promise<void> {
    const { data, error } = await supabase.rpc('submit_client_form', {
      p_token: token,
      p_form_data: formData,
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)

    // Pós-processamento: limpar rejeição e ajustar status se necessário
    try {
      const { data: client } = await supabase
        .from('clients')
        .select('id, photos_rejection_reason')
        .eq('token', token)
        .single()

      if (client) {
        const hasPendingPhotosRejection = !!client.photos_rejection_reason

        const { data: photoRows } = await supabase
          .from('client_photos')
          .select('id')
          .eq('client_id', client.id)
          .limit(1)
        const hasPhotos = (photoRows?.length ?? 0) > 0

        // Regra de status pós-submit do formulário:
        // 1. Há rejeição de fotos pendente → cliente precisa ajustar as fotos (awaiting_photos)
        // 2. Já tem fotos e nenhuma rejeição pendente → vai pra revisão da admin (photos_submitted)
        // 3. Sem fotos → fluxo normal, o RPC já colocou awaiting_photos
        const newStatus = hasPendingPhotosRejection
          ? 'awaiting_photos'
          : hasPhotos
            ? 'photos_submitted'
            : undefined   // mantém o que o RPC definiu

        await supabase
          .from('clients')
          .update({
            ...(newStatus ? { status: newStatus } : {}),
            form_rejection_reason: null,
            form_rejected_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('token', token)
      }
    } catch (e) {
      console.warn('Erro ao limpar rejeição/ajustar status pós-submitForm:', e)
    }
  },

  async uploadPhoto(
    token: string,
    _clientId: string,
    file: File,
    categoryId: string | null
  ): Promise<void> {
    // Delega tudo pra Edge Function `drive/upload`: ela faz upload no Drive
    // da admin dona desse token e grava em client_photos via RPC.
    await driveStorage.uploadPhoto({
      portalToken: token,
      file,
      categoryId,
      kind: 'photo',
    })
  },

  /**
   * Cliente remove uma foto específica (usado durante reenvio pós-rejeição).
   *
   * Para fotos novas (Drive): o RPC `delete_client_photo_drive` valida que a
   * foto pertence ao cliente do token e apaga o registro. O arquivo no Drive
   * continua até o cleanup automático (21d após análise entregue) — escolha
   * consciente pra simplificar o frontend.
   *
   * Para fotos legadas (Storage): também limpa o bucket.
   */
  async deletePhoto(token: string, photoId: string): Promise<void> {
    const { data, error } = await supabase.rpc('delete_client_photo_drive', {
      p_token: token,
      p_photo_id: photoId,
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)

    // Legado: foto antiga que ainda estava no Supabase Storage
    if (data?.storage_path) {
      try { await supabase.storage.from('client-photos').remove([data.storage_path]) } catch {}
    }
  },

  /**
   * Cliente finaliza o envio das fotos.
   *
   * FLUXO:
   *   Cliente envia fotos → status: 'photos_submitted' (em revisão)
   *   Admin aprova fotos → status: 'in_analysis' + prazo calculado
   *
   * O prazo NÃO é calculado aqui — só quando a admin aprovar.
   * Limpa também os campos de rejeição de fotos (se houver).
   */
  async finalizePhotos(token: string): Promise<void> {
    const sentAt = new Date()

    const { data, error } = await supabase.rpc('finalize_client_photos', {
      p_token: token,
      p_deadline_date: null,
      p_photos_sent_at: sentAt.toISOString(),
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)

    // Safety net + limpeza de rejeição de fotos
    await supabase
      .from('clients')
      .update({
        status: 'photos_submitted',
        photos_rejection_reason: null,
        photos_rejected_at: null,
        updated_at: sentAt.toISOString(),
      })
      .eq('token', token)
      .in('status', ['awaiting_photos', 'photos_submitted', 'in_analysis'])

    // Notificação para a admin
    // Throttle: ignora cliques repetidos no botao de finalizar (2 min)
    if (!shouldSendThrottledEmail(`photos_submitted:${token}`, 2 * 60 * 1000)) {
      console.log('Notificacao photos_submitted suprimida (throttle 2min)')
      return
    }
    try {
      // .maybeSingle() em vez de .single() — RLS no portal anon pode bloquear
      // a leitura. Se voltar null, ainda invocamos a Edge Function passando
      // clientToken; ela hidrata os campos via service role.
      const { data: client } = await supabase
        .from('clients')
        .select('id, full_name, email, token, admin_id, plan:plans(name)')
        .eq('token', token)
        .maybeSingle()

      const portalUrl = `${window.location.origin}/c/${token}`
      const planName = (client as any)?.plan?.name || ''
      const clientId = (client as any)?.id ?? null
      const adminPanelUrl = clientId
        ? `${window.location.origin}/admin/clients/${clientId}`
        : ''

      await supabase.functions.invoke('send-contract-email', {
        body: {
          type: 'photos_submitted',
          adminId: (client as any)?.admin_id ?? null,
          clientToken: token,                       // ← fallback obrigatório
          clientName: client?.full_name ?? '',
          clientEmail: client?.email ?? '',
          planName,
          portalUrl,
          adminPanelUrl,
        }
      })
    } catch (e) {
      console.warn('Erro ao enviar notificação de fotos enviadas:', e)
    }
  },

  /**
   * Cliente envia a foto para a etapa "Aguardando Foto IA".
   *
   * FLUXO:
   *   - A Edge Function drive/upload apaga foto IA antiga da mesma categoria
   *   - Faz upload no Drive da admin (pasta do cliente)
   *   - Chama RPC `save_client_photo_drive` (valida status + categoria IA)
   *   - NÃO muda o status — admin valida e avança via StageController
   *   - NÃO envia e-mail. A notificação é disparada UMA vez, depois que
   *     TODAS as fotos do lote subiram, via `notifyAiPhotosSubmitted()`.
   *     (Antes o e-mail era enviado aqui, por foto: cliente que subia
   *     5 fotos num envio só gerava 5 e-mails idênticos pra consultora.)
   */
  async submitAiPhoto(
    token: string,
    _clientId: string,
    categoryId: string,
    file: File,
    clearPrevious = true
  ): Promise<void> {
    // clearPrevious=true (1ª foto do lote ou reenvio pós-rejeição): o RPC
    // save_client_photo_drive apaga as fotos anteriores da categoria antes
    // de gravar. clearPrevious=false (fotos 2..N do mesmo lote): acumula.
    await driveStorage.uploadPhoto({
      portalToken: token,
      file,
      categoryId,
      kind: 'ai_photo',
      clearPrevious,
    })
  },

  /**
   * Notifica a consultora que a(s) foto(s) da simulação foram enviadas.
   *
   * Chamado UMA vez pelo portal (AiPhotoStep.handleSubmit), DEPOIS que
   * todas as fotos do lote subiram com sucesso — assim a consultora
   * recebe um único e-mail por envio, independente da quantidade de fotos,
   * e nunca é avisada de um envio que falhou no meio.
   *
   * Camadas extras de proteção contra duplicados:
   *   - throttle local de 10 min (clique duplo / re-render)
   *   - dedupe atômico no servidor (tabela email_dedup, janela de 10 min)
   */
  async notifyAiPhotosSubmitted(token: string): Promise<void> {
    if (!shouldSendThrottledEmail(`ai_photo_submitted:${token}`, 10 * 60 * 1000)) {
      console.log('Notificacao ai_photo_submitted suprimida (throttle 10min)')
      return
    }
    try {
      const { data: client } = await supabase
        .from('clients')
        .select('id, full_name, email, token, admin_id, plan:plans(name)')
        .eq('token', token)
        .maybeSingle()

      const portalUrl = `${window.location.origin}/c/${token}`
      const planName = (client as any)?.plan?.name || ''
      const clientId = (client as any)?.id ?? null
      const adminPanelUrl = clientId
        ? `${window.location.origin}/admin/clients/${clientId}`
        : ''

      await supabase.functions.invoke('send-contract-email', {
        body: {
          type: 'ai_photo_submitted',
          adminId: (client as any)?.admin_id ?? null,
          clientToken: token,
          clientName: client?.full_name ?? '',
          clientEmail: client?.email ?? '',
          planName,
          portalUrl,
          adminPanelUrl,
        }
      })
    } catch (e) {
      console.warn('Erro ao enviar notificação de foto IA enviada:', e)
    }
  },

  // ---- Storage ----
  /**
   * Gera a URL pública de um arquivo de resultado.
   * Aceita storage_path (legado) ou drive_file_id.
   * Mantém compat com chamadas antigas que passavam só string.
   */
  getResultFileUrl(fileOrPath: string | { storage_path?: string | null; drive_file_id?: string | null }): string {
    if (typeof fileOrPath === 'string') {
      const { data } = supabase.storage.from('client-results').getPublicUrl(fileOrPath)
      return data.publicUrl
    }
    if (fileOrPath.drive_file_id) {
      return driveStorage.downloadUrl(fileOrPath.drive_file_id)
    }
    if (fileOrPath.storage_path) {
      const { data } = supabase.storage.from('client-results').getPublicUrl(fileOrPath.storage_path)
      return data.publicUrl
    }
    return ''
  },
}