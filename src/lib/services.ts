// src/lib/services.ts
import { supabase } from './supabase'
import { calculateDeadline, formatDateForDB } from './deadlineCalculator'

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
  | 'validating_materials'   // interno — cliente vê "Preparando Materiais"
  | 'sending_dossier'        // interno — cliente vê "Preparando Materiais"
  | 'simulating'             // interno — cliente vê "Preparando Materiais"
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
  }
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
      .select('id')
      .eq('id', data.user.id)
      .single()

    if (!adminData) {
      await supabase.auth.signOut()
      throw new Error('Acesso não autorizado. Usuário não é administrador.')
    }

    return data.user
  },

  async logout() {
    await supabase.auth.signOut()
  },

  async getSession() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return null

    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', data.session.user.id)
      .single()

    return adminData ? data.session.user : null
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
  async getClients(): Promise<Client[]> {
    const { data, error } = await supabase
      .from('clients')
      .select('*, plan:plans(id, name, deadline_days, is_active, description, created_at)')
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
    const { data: client, error } = await supabase
      .from('clients')
      .insert({ ...data, status: 'awaiting_contract' })
      .select()
      .single()
    if (error) throw error
    return client
  },

  async updateClient(id: string, updates: Partial<Client>): Promise<void> {
    const { error } = await supabase.from('clients').update(updates).eq('id', id)
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

    if (photos?.length) {
      await supabase.storage.from('client-photos').remove(photos.map(p => p.storage_path))
    }
    if (resultFiles?.length) {
      await supabase.storage.from('client-results').remove(resultFiles.map(f => f.storage_path))
    }

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
        .select('full_name, email, token, plan:plans(name)')
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'photos_approved',
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
        .select('full_name, email, token, plan:plans(name)')
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'form_rejected',
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
        .select('full_name, email, token, plan:plans(name)')
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'photos_rejected',
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
        .select('full_name, email, token, plan:plans(name)')
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'both_rejected',
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
    step: 'contract' | 'form' | 'photos' | 'review' | 'analysis' | 'materials' | 'validate_materials' | 'send_dossier' | 'simulations' | 'result',
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

    if (step === 'simulations') {
      // Volta para simulações — etapa interna, cliente não vê mudança
      // IMPORTANTE: reseta is_released para evitar que resultado parcial
      // anterior reapareça automaticamente no portal
      await supabase
        .from('client_results')
        .update({ is_released: false, updated_at: now })
        .eq('client_id', clientId)
      const { error } = await supabase
        .from('clients')
        .update({ status: 'simulating', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }

    if (step === 'result') {
      // "Reabrir resultado" volta para 'simulating' (etapa imediatamente anterior
      // a 'completed') e oculta o resultado no portal.
      // Reseta is_released para garantir que não apareça enquanto ainda está em revisão.
      await supabase
        .from('client_results')
        .update({ is_released: false, updated_at: now })
        .eq('client_id', clientId)
      const { error } = await supabase
        .from('clients')
        .update({ status: 'simulating', updated_at: now })
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
        .select('full_name, email, token, plan:plans(name)')
        .eq('id', clientId)
        .single()
      if (!client) return
      const portalUrl = `${window.location.origin}/c/${client.token}`
      await supabase.functions.invoke('send-contract-email', {
        body: {
          type,
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
      // Avança para "Simulações" — etapa interna, cliente ainda vê "Preparando Materiais"
      const { error } = await supabase
        .from('clients')
        .update({ status: 'simulating', updated_at: now })
        .eq('id', clientId)
      if (error) throw error
      return
    }
    if (currentStatus === 'simulating') {
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

  // ---- Results ----
  async getClientPhotosWithUrls(clientId: string) {
    const { data: photos } = await supabase
      .from('client_photos')
      .select('*')
      .eq('client_id', clientId)
      .order('uploaded_at')

    return (photos || []).map(photo => {
      const { data } = supabase.storage
        .from('client-photos')
        .getPublicUrl(photo.storage_path)
      return { ...photo, url: data.publicUrl }
    })
  },

  async saveResult(
    clientId: string,
    result: { folder_url?: string; observations?: string }
  ): Promise<void> {
    const { error } = await supabase
      .from('client_results')
      .upsert(
        { client_id: clientId, ...result, updated_at: new Date().toISOString() },
        { onConflict: 'client_id' }
      )
    if (error) throw error
  },

  async releaseResult(clientId: string, options?: { chatEnabled?: boolean }): Promise<void> {
    const { error } = await supabase
      .from('client_results')
      .upsert(
        {
          client_id: clientId,
          is_released: true,
          released_at: new Date().toISOString(),
          chat_enabled: options?.chatEnabled ?? true,
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
        .select('full_name, email, token, plan:plans(name)')
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'result_released',
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar e-mail de resultado liberado:', e)
    }
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
          chat_enabled: options?.chatEnabled ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id' }
      )
    if (error) throw error

    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, plan:plans(name)')
        .eq('id', clientId)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'partial_result_released',
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
      .update({ status: 'simulating', updated_at: now })
      .eq('id', clientId)
    if (clientErr) throw clientErr
  },

  async uploadResultFile(clientId: string, file: File): Promise<void> {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${clientId}/${Date.now()}_${safeName}`

    const { error: uploadError } = await supabase.storage
      .from('client-results')
      .upload(storagePath, file, { contentType: file.type, upsert: false })
    if (uploadError) throw uploadError

    const { error: dbError } = await supabase
      .from('client_result_files')
      .insert({
        client_id: clientId,
        file_name: file.name,
        storage_path: storagePath,
        file_size: file.size,
      })
    if (dbError) {
      await supabase.storage.from('client-results').remove([storagePath])
      throw dbError
    }
  },

  async deleteResultFile(fileId: string, storagePath: string): Promise<void> {
    await supabase.storage.from('client-results').remove([storagePath])
    await supabase.from('client_result_files').delete().eq('id', fileId)
  },

  getResultFileUrl(storagePath: string): string {
    const { data } = supabase.storage
      .from('client-results')
      .getPublicUrl(storagePath)
    return data.publicUrl
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

  /** Salva ou atualiza o nome de exibição de uma coluna */
  async upsertColumnLabel(statusKey: string, displayName: string): Promise<void> {
    const { error } = await supabase
      .from('kanban_column_labels')
      .upsert({ status_key: statusKey, display_name: displayName }, { onConflict: 'status_key' })
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

    // ── Buscar chat_enabled da tabela client_results ──────────────────────
    // O RPC get_client_portal não retorna este campo, então buscamos direto.
    if (portalData.result) {
      try {
        const { data: resultRow } = await supabase
          .from('client_results')
          .select('chat_enabled')
          .eq('client_id', portalData.client.id)
          .single()
        portalData.result.chat_enabled = resultRow?.chat_enabled ?? true
      } catch (e) {
        portalData.result.chat_enabled = true
      }
    }

    // ── Buscar arquivos de resultado (PDFs) da tabela client_result_files ──
    // O RPC get_client_portal não inclui os arquivos — buscamos direto.
    if (portalData.result) {
      try {
        const { data: filesRows } = await supabase
          .from('client_result_files')
          .select('id, file_name, storage_path, file_size')
          .eq('client_id', portalData.client.id)
          .order('uploaded_at')
        portalData.result.files = filesRows || []
      } catch (e) {
        portalData.result.files = portalData.result.files ?? []
      }
    }

    return portalData
  },

  async signContract(
    token: string,
    meta?: { country?: string; ip?: string; signedAt?: string }
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
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, plan_id, plan:plans(name)')
        .eq('token', token)
        .single()

      if (client) {
        // Busca o conteúdo do contrato pra gerar o PDF na Edge Function
        let contractTitle: string | undefined
        let sections: any[] = []
        if ((client as any).plan_id) {
          const { data: planContract } = await supabase
            .from('plan_contracts')
            .select('title, sections')
            .eq('plan_id', (client as any).plan_id)
            .maybeSingle()
          if (planContract) {
            contractTitle = planContract.title
            sections = Array.isArray(planContract.sections) ? planContract.sections : []
          }
        }

        const portalUrl = `${window.location.origin}/c/${token}`
        const planName  = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'contract_signed',
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            signedAt,
            contractTitle,
            sections,
            portalUrl,
          },
        })
      }
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
    clientId: string,
    file: File,
    categoryId: string | null
  ): Promise<void> {
    const uniqueName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const path = `${clientId}/${uniqueName}`

    const { error: uploadError } = await supabase.storage
      .from('client-photos')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (uploadError) throw uploadError

    const { data, error } = await supabase.rpc('save_client_photo', {
      p_token: token,
      p_photo_name: uniqueName,
      p_photo_type: file.type,
      p_photo_size: file.size,
      p_storage_path: path,
      p_category_id: categoryId,
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
  },

  /**
   * Cliente remove uma foto específica (usado durante reenvio pós-rejeição).
   *
   * O RPC `delete_client_photo` valida que a foto pertence ao cliente do
   * token e apaga o registro. O storage é limpo aqui em seguida.
   */
  async deletePhoto(token: string, photoId: string): Promise<void> {
    const { data, error } = await supabase.rpc('delete_client_photo', {
      p_token: token,
      p_photo_id: photoId,
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)

    // Limpeza do storage (feita no client porque o RPC só devolve o path)
    if (data?.storage_path) {
      await supabase.storage.from('client-photos').remove([data.storage_path])
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
    try {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, email, token, plan:plans(name)')
        .eq('token', token)
        .single()

      if (client) {
        const portalUrl = `${window.location.origin}/c/${client.token}`
        const planName = (client as any).plan?.name || ''

        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'photos_submitted',
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar notificação de fotos enviadas:', e)
    }
  },

  // ---- Storage ----
  /**
   * Gera a URL pública de um arquivo de resultado no Supabase Storage.
   * Usado pelo portal da cliente para exibir links de download dos PDFs/arquivos
   * liberados pela admin.
   */
  getResultFileUrl(storagePath: string): string {
    const { data } = supabase.storage
      .from('client-results')
      .getPublicUrl(storagePath)
    return data.publicUrl
  },
}