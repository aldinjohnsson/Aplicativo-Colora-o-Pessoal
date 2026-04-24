// src/components/admin/documents/lib/documentsService.ts
//
// Service layer da feature "Gerador de Documento".
// Centraliza todas as chamadas Supabase relacionadas a tags, valores por
// cliente, templates, elementos de template e documentos gerados.

import { supabase } from '../../../../lib/supabase'
import type {
  DocumentTag,
  DocumentTagInput,
  DocumentTemplate,
  DocumentTemplateElement,
  ClientGeneratedDocument,
  ClientTagValue,
  TextImportSourceOption,
  ElementStyle,
} from '../types'
import { extractPdfMetadata } from './pdfUtils'

// ══════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════

export function toSlug(input: string): string {
  return input
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(slug) && slug.length <= 80
}

function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const cleanBase = base
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 60)
  const cleanExt = ext.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase()
  return `${cleanBase || 'file'}${cleanExt}`
}

// ══════════════════════════════════════════════════════════════════════
// Service
// ══════════════════════════════════════════════════════════════════════

export const documentsService = {
  // ═══════════════ TAGS ════════════════════════════════════════════

  async listTags(opts?: { includeInactive?: boolean }): Promise<DocumentTag[]> {
    let query = supabase.from('document_tags').select('*').order('name', { ascending: true })
    if (!opts?.includeInactive) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) throw error
    return (data || []) as DocumentTag[]
  },

  async getTag(id: string): Promise<DocumentTag | null> {
    const { data, error } = await supabase.from('document_tags').select('*').eq('id', id).single()
    if (error && (error as any).code !== 'PGRST116') throw error
    return (data || null) as DocumentTag | null
  },

  async isSlugTaken(slug: string, ignoreId?: string): Promise<boolean> {
    let q = supabase.from('document_tags').select('id', { count: 'exact', head: true }).eq('slug', slug)
    if (ignoreId) q = q.neq('id', ignoreId)
    const { count, error } = await q
    if (error) throw error
    return (count || 0) > 0
  },

  async createTag(input: DocumentTagInput): Promise<DocumentTag> {
    const payload = {
      name: input.name.trim(),
      slug: input.slug.trim(),
      type: input.type,
      description: input.description?.trim() || null,
      default_hint: input.default_hint ?? {},
      is_active: input.is_active ?? true,
    }
    const { data, error } = await supabase.from('document_tags').insert(payload).select().single()
    if (error) {
      if ((error as any).code === '23505') throw new Error('Já existe uma tag com este identificador (slug). Escolha outro.')
      throw error
    }
    return data as DocumentTag
  },

  async updateTag(id: string, updates: Partial<DocumentTagInput>): Promise<DocumentTag> {
    const payload: Record<string, any> = {}
    if (updates.name !== undefined) payload.name = updates.name.trim()
    if (updates.slug !== undefined) payload.slug = updates.slug.trim()
    if (updates.type !== undefined) payload.type = updates.type
    if (updates.description !== undefined) payload.description = updates.description?.trim() || null
    if (updates.default_hint !== undefined) payload.default_hint = updates.default_hint
    if (updates.is_active !== undefined) payload.is_active = updates.is_active

    const { data, error } = await supabase.from('document_tags').update(payload).eq('id', id).select().single()
    if (error) {
      if ((error as any).code === '23505') throw new Error('Já existe uma tag com este identificador (slug). Escolha outro.')
      throw error
    }
    return data as DocumentTag
  },

  async deleteTag(id: string): Promise<void> {
    const { error } = await supabase.from('document_tags').delete().eq('id', id)
    if (error) {
      if ((error as any).code === '23503') {
        throw new Error('Esta tag está sendo usada em um ou mais templates. Remova-a dos templates primeiro, ou desative-a em vez de excluir.')
      }
      throw error
    }
  },

  async setTagActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('document_tags').update({ is_active: isActive }).eq('id', id)
    if (error) throw error
  },

  async countTagUsage(tagId: string): Promise<number> {
    const { count, error } = await supabase
      .from('document_template_elements')
      .select('id', { count: 'exact', head: true })
      .eq('tag_id', tagId)
    if (error) throw error
    return count || 0
  },

  // ═══════════════ VALORES DE TAG POR CLIENTE ═════════════════════

  async listClientTagValues(clientId: string): Promise<ClientTagValue[]> {
    const { data, error } = await supabase
      .from('client_tag_values').select('*').eq('client_id', clientId)
    if (error) throw error
    return (data || []) as ClientTagValue[]
  },

  async setClientTagText(clientId: string, tagId: string, text: string | null): Promise<ClientTagValue> {
    const existing = await this._getValueRow(clientId, tagId)
    if (existing?.image_storage_path) {
      await supabase.storage.from('client-tag-images').remove([existing.image_storage_path]).catch(() => {})
    }
    const payload = {
      client_id: clientId, tag_id: tagId,
      text_value: text ?? null, photo_id: null,
      image_storage_path: null, image_size: null, image_mime: null,
    }
    const { data, error } = await supabase
      .from('client_tag_values')
      .upsert(payload, { onConflict: 'client_id,tag_id' })
      .select().single()
    if (error) throw error
    return data as ClientTagValue
  },

  async setClientTagPhoto(clientId: string, tagId: string, photoId: string): Promise<ClientTagValue> {
    const existing = await this._getValueRow(clientId, tagId)
    if (existing?.image_storage_path) {
      await supabase.storage.from('client-tag-images').remove([existing.image_storage_path]).catch(() => {})
    }
    const payload = {
      client_id: clientId, tag_id: tagId,
      text_value: null, photo_id: photoId,
      image_storage_path: null, image_size: null, image_mime: null,
    }
    const { data, error } = await supabase
      .from('client_tag_values')
      .upsert(payload, { onConflict: 'client_id,tag_id' })
      .select().single()
    if (error) throw error
    return data as ClientTagValue
  },

  async setClientTagImageUpload(clientId: string, tagId: string, file: File): Promise<ClientTagValue> {
    const existing = await this._getValueRow(clientId, tagId)
    if (existing?.image_storage_path) {
      await supabase.storage.from('client-tag-images').remove([existing.image_storage_path]).catch(() => {})
    }
    const path = `${clientId}/${tagId}/${Date.now()}_${safeFileName(file.name)}`
    const up = await supabase.storage
      .from('client-tag-images')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (up.error) throw up.error

    const payload = {
      client_id: clientId, tag_id: tagId,
      text_value: null, photo_id: null,
      image_storage_path: path, image_size: file.size, image_mime: file.type,
    }
    const { data, error } = await supabase
      .from('client_tag_values')
      .upsert(payload, { onConflict: 'client_id,tag_id' })
      .select().single()
    if (error) throw error
    return data as ClientTagValue
  },

  async clearClientTagValue(clientId: string, tagId: string): Promise<void> {
    const existing = await this._getValueRow(clientId, tagId)
    if (existing?.image_storage_path) {
      await supabase.storage.from('client-tag-images').remove([existing.image_storage_path]).catch(() => {})
    }
    const { error } = await supabase
      .from('client_tag_values').delete()
      .eq('client_id', clientId).eq('tag_id', tagId)
    if (error) throw error
  },

  async _getValueRow(clientId: string, tagId: string): Promise<ClientTagValue | null> {
    const { data, error } = await supabase
      .from('client_tag_values').select('*')
      .eq('client_id', clientId).eq('tag_id', tagId)
      .maybeSingle()
    if (error) throw error
    return (data || null) as ClientTagValue | null
  },

  async getSignedTagImageUrl(storagePath: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await supabase.storage
      .from('client-tag-images').createSignedUrl(storagePath, expiresIn)
    if (error) throw error
    return data.signedUrl
  },

  getClientPhotoUrl(storagePath: string): string {
    const { data } = supabase.storage.from('client-photos').getPublicUrl(storagePath)
    return data.publicUrl
  },

  async getTextImportSources(clientId: string): Promise<TextImportSourceOption[]> {
    const options: TextImportSourceOption[] = []

    const { data: client } = await supabase
      .from('clients').select('full_name, email, phone, plan_id').eq('id', clientId).single()

    if (client) {
      options.push(
        { key: 'full_name', label: 'Nome',     group: 'client', groupLabel: 'Dados do cliente', value: client.full_name || null },
        { key: 'email',     label: 'E-mail',   group: 'client', groupLabel: 'Dados do cliente', value: client.email || null },
        { key: 'phone',     label: 'Telefone', group: 'client', groupLabel: 'Dados do cliente', value: client.phone || null },
      )
    }

    const { data: result } = await supabase
      .from('client_results').select('observations, folder_url').eq('client_id', clientId).maybeSingle()

    options.push(
      { key: 'observations',  label: 'Observações do resultado',   group: 'result', groupLabel: 'Resultado', value: result?.observations || null },
      { key: 'result_folder', label: 'Link da pasta do resultado', group: 'result', groupLabel: 'Resultado', value: result?.folder_url || null },
    )

    if (client?.plan_id) {
      const [{ data: planForm }, { data: submission }] = await Promise.all([
        supabase.from('plan_forms').select('fields').eq('plan_id', client.plan_id).maybeSingle(),
        supabase.from('client_form_submissions').select('form_data').eq('client_id', clientId).maybeSingle(),
      ])

      const formData: Record<string, any> = (submission?.form_data as any) || {}
      const fields: Array<{ id: string; label: string; type: string; order?: number }> =
        Array.isArray(planForm?.fields) ? (planForm!.fields as any[]) : []

      const ordered = [...fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

      for (const f of ordered) {
        const raw = formData[f.id]
        let text: string | null = null
        if (raw !== undefined && raw !== null) {
          if (Array.isArray(raw)) text = raw.join(', ')
          else if (typeof raw === 'object') text = JSON.stringify(raw)
          else text = String(raw)
        }
        options.push({
          key: `form:${f.id}`, label: f.label || f.id,
          group: 'form', groupLabel: 'Formulário', value: text,
        })
      }
    }

    return options
  },

  async listClientPhotos(clientId: string): Promise<Array<{
    id: string; photo_name: string; storage_path: string; url: string;
    category_id: string | null; category_title: string | null;
  }>> {
    const { data, error } = await supabase
      .from('client_photos')
      .select('id, photo_name, storage_path, category_id, uploaded_at')
      .eq('client_id', clientId)
      .order('uploaded_at', { ascending: true })
    if (error) throw error

    const rows = (data || []) as Array<{
      id: string; photo_name: string; storage_path: string;
      category_id: string | null; uploaded_at: string
    }>

    const catIds = Array.from(new Set(rows.map(r => r.category_id).filter(Boolean))) as string[]
    const catsMap: Record<string, string> = {}
    if (catIds.length > 0) {
      const { data: cats } = await supabase
        .from('plan_photo_categories').select('id, title').in('id', catIds)
      for (const c of (cats || [])) catsMap[(c as any).id] = (c as any).title
    }

    return rows.map(r => ({
      id: r.id, photo_name: r.photo_name, storage_path: r.storage_path,
      url: this.getClientPhotoUrl(r.storage_path),
      category_id: r.category_id,
      category_title: r.category_id ? (catsMap[r.category_id] || null) : null,
    }))
  },

  // ═══════════════ TEMPLATES ═══════════════════════════════════════

  async listTemplates(opts?: { includeInactive?: boolean }): Promise<DocumentTemplate[]> {
    let q = supabase.from('document_templates').select('*').order('updated_at', { ascending: false })
    if (!opts?.includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw error
    return (data || []) as DocumentTemplate[]
  },

  async getTemplate(id: string): Promise<DocumentTemplate | null> {
    const { data, error } = await supabase.from('document_templates').select('*').eq('id', id).single()
    if (error && (error as any).code !== 'PGRST116') throw error
    return (data || null) as DocumentTemplate | null
  },

  async createTemplate(input: {
    name: string; description?: string | null; planId?: string | null; file: File
  }): Promise<DocumentTemplate> {
    if (!input.file.type.includes('pdf') && !input.file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error('Arquivo inválido: envie um PDF.')
    }
    const buf = await input.file.arrayBuffer()
    const meta = await extractPdfMetadata(buf)

    const { data: created, error: insErr } = await supabase
      .from('document_templates')
      .insert({
        name: input.name.trim(),
        description: input.description?.trim() || null,
        plan_id: input.planId || null,
        base_pdf_path: '',
        page_count: meta.pageCount,
        page_width_pt: meta.pageWidthPt,
        page_height_pt: meta.pageHeightPt,
        is_active: true,
      })
      .select().single()
    if (insErr) throw insErr

    const id = created.id as string
    const storagePath = `${id}/base.pdf`

    try {
      const up = await supabase.storage.from('document-templates').upload(
        storagePath, new Blob([buf], { type: 'application/pdf' }),
        { contentType: 'application/pdf', upsert: true },
      )
      if (up.error) throw up.error

      const { data: updated, error: updErr } = await supabase
        .from('document_templates').update({ base_pdf_path: storagePath })
        .eq('id', id).select().single()
      if (updErr) throw updErr
      return updated as DocumentTemplate
    } catch (e) {
      await supabase.storage.from('document-templates').remove([storagePath]).catch(() => {})
      await supabase.from('document_templates').delete().eq('id', id).catch(() => {})
      throw e
    }
  },

  async updateTemplate(id: string, updates: Partial<Pick<DocumentTemplate,
    'name' | 'description' | 'is_active' | 'plan_id'
  >>): Promise<DocumentTemplate> {
    const payload: Record<string, any> = {}
    if (updates.name !== undefined)        payload.name = updates.name.trim()
    if (updates.description !== undefined) payload.description = updates.description?.trim() || null
    if (updates.is_active !== undefined)   payload.is_active = updates.is_active
    if (updates.plan_id !== undefined)     payload.plan_id = updates.plan_id

    const { data, error } = await supabase
      .from('document_templates').update(payload).eq('id', id).select().single()
    if (error) throw error
    return data as DocumentTemplate
  },

  async deleteTemplate(id: string): Promise<void> {
    const { data: files } = await supabase.storage.from('document-templates').list(id)
    if (files && files.length > 0) {
      await supabase.storage.from('document-templates')
        .remove(files.map(f => `${id}/${f.name}`)).catch(() => {})
    }
    const { error } = await supabase.from('document_templates').delete().eq('id', id)
    if (error) throw error
  },

  async getBaseTemplateSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await supabase.storage
      .from('document-templates').createSignedUrl(storagePath, expiresIn)
    if (error) throw error
    return data.signedUrl
  },

  async downloadBaseTemplate(storagePath: string): Promise<Blob> {
    const { data, error } = await supabase.storage.from('document-templates').download(storagePath)
    if (error) throw error
    return data
  },

  // ═══════════════ ELEMENTOS DE TEMPLATE (Fase 3) ══════════════════

  async listTemplateElements(templateId: string): Promise<DocumentTemplateElement[]> {
    const { data, error } = await supabase
      .from('document_template_elements')
      .select('*')
      .eq('template_id', templateId)
      .order('page_number', { ascending: true })
      .order('z_index', { ascending: true })
    if (error) throw error
    return (data || []) as DocumentTemplateElement[]
  },

  async createTemplateElement(input: {
    template_id: string
    tag_id: string
    page_number: number
    x_pt: number
    y_pt: number
    width_pt?: number | null
    height_pt?: number | null
    style?: ElementStyle
    z_index?: number
  }): Promise<DocumentTemplateElement> {
    const { data, error } = await supabase
      .from('document_template_elements')
      .insert({
        template_id: input.template_id,
        tag_id: input.tag_id,
        page_number: input.page_number,
        x_pt: input.x_pt,
        y_pt: input.y_pt,
        width_pt: input.width_pt ?? null,
        height_pt: input.height_pt ?? null,
        style: input.style ?? {},
        z_index: input.z_index ?? 0,
        rotation: 0,
      })
      .select().single()
    if (error) throw error
    return data as DocumentTemplateElement
  },

  async updateTemplateElement(
    id: string,
    updates: Partial<Pick<DocumentTemplateElement,
      'x_pt' | 'y_pt' | 'width_pt' | 'height_pt' | 'rotation' | 'z_index' | 'style' | 'page_number'
    >>,
  ): Promise<DocumentTemplateElement> {
    const { data, error } = await supabase
      .from('document_template_elements')
      .update(updates as any)
      .eq('id', id)
      .select().single()
    if (error) throw error
    return data as DocumentTemplateElement
  },

  async deleteTemplateElement(id: string): Promise<void> {
    const { error } = await supabase.from('document_template_elements').delete().eq('id', id)
    if (error) throw error
  },

  // ═══════════════ GENERATED DOCS (Fase 5) ════════════════════════

  async listGeneratedForClient(clientId: string): Promise<ClientGeneratedDocument[]> {
    const { data, error } = await supabase
      .from('client_generated_documents').select('*')
      .eq('client_id', clientId)
      .order('generated_at', { ascending: false })
    if (error) throw error
    return (data || []) as ClientGeneratedDocument[]
  },

  getGeneratedDocUrl(storagePath: string): string {
    const { data } = supabase.storage.from('document-generated').getPublicUrl(storagePath)
    return data.publicUrl
  },

  async downloadGeneratedDoc(storagePath: string): Promise<Blob> {
    const { data, error } = await supabase.storage.from('document-generated').download(storagePath)
    if (error) throw error
    return data
  },
}