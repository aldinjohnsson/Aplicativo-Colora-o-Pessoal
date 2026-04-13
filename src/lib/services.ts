// src/lib/services.ts
import { supabase } from './supabase'
import { calculateDeadline } from './deadlineCalculator'

// ============================================================
// TYPES
// ============================================================

export type ClientStatus =
  | 'awaiting_contract'
  | 'awaiting_form'
  | 'awaiting_photos'
  | 'in_analysis'
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
}

export interface ClientPortalData {
  client: {
    id: string
    full_name: string
    email: string
    phone: string | null
    status: ClientStatus
    created_at: string
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
  }>
  deadline: { photos_sent_at: string; deadline_date: string } | null
  result: {
    folder_url: string | null
    observations: string | null
    released_at: string
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
    const { error } = await supabase
      .from('plan_contracts')
      .upsert(
        { plan_id: planId, ...contract, updated_at: new Date().toISOString() },
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
    const { error } = await supabase
      .from('plan_forms')
      .upsert(
        { plan_id: planId, ...form, updated_at: new Date().toISOString() },
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

  async releaseResult(clientId: string): Promise<void> {
    const { error } = await supabase
      .from('client_results')
      .upsert(
        {
          client_id: clientId,
          is_released: true,
          released_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id' }
      )
    if (error) throw error
 
    await supabase
      .from('clients')
      .update({ status: 'completed' })
      .eq('id', clientId)
 
    // ── Enviar e-mail de resultado liberado ──
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
}

// ============================================================
// CLIENT PORTAL SERVICE (token-based, sem autenticação)
// ============================================================

export const clientService = {
  async getPortalData(token: string): Promise<ClientPortalData | null> {
    const { data, error } = await supabase.rpc('get_client_portal', { p_token: token })
    if (error) return null
    if (data?.error) return null
    return data as ClientPortalData
  },

  async signContract(token: string): Promise<void> {
    const { data, error } = await supabase.rpc('sign_client_contract', { p_token: token })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
  },

  async submitForm(token: string, formData: Record<string, any>): Promise<void> {
    const { data, error } = await supabase.rpc('submit_client_form', {
      p_token: token,
      p_form_data: formData,
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
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

  async finalizePhotos(token: string, deadlineDays: number): Promise<void> {
    const sentAt = new Date()
    const deadline = calculateDeadline(sentAt, deadlineDays)
    const deadlineDateStr = deadline.toISOString().split('T')[0]
 
    const { data, error } = await supabase.rpc('finalize_client_photos', {
      p_token: token,
      p_deadline_date: deadlineDateStr,
      p_photos_sent_at: sentAt.toISOString(),
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
 
    // ── Enviar e-mail de fotos finalizadas ──
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
            type: 'photos_finalized',
            clientName: client.full_name,
            clientEmail: client.email,
            planName,
            portalUrl,
            deadlineDate: deadlineDateStr,
          }
        })
      }
    } catch (e) {
      console.warn('Erro ao enviar e-mail de fotos finalizadas:', e)
    }
  },
}