// src/components/admin/documents/lib/documentsService.ts
//
// Service layer da feature "Gerador de Documento".
// Centraliza todas as chamadas Supabase.

import { supabase } from '../../../../lib/supabase'
import { driveStorage } from '../../../../lib/driveStorage'
import type {
  DocumentTag,
  DocumentTagInput,
  DocumentTemplate,
  DocumentTemplateElement,
  ClientGeneratedDocument,
  DocumentMapping,
  ClientTagValue,
  TextImportSourceOption,
  ElementStyle,
} from '../types'
import { extractPdfMetadata } from './pdfUtils'
import { formatContrastValue } from './contrastLayout'

// ══════════════════════════════════════════════════════════════════════
// Tipos de composition
// ══════════════════════════════════════════════════════════════════════

export interface CompositionImageResult {
  /** ID do arquivo no Google Drive. Use com driveStorage.viewUrl / fetchPhotoBlob. */
  driveFileId:   string
  driveFolderId: string
  /** URL pública de thumbnail (estática, sem TTL). Pode usar direto em <img src>. */
  url:           string
  /** URL de download (estática, sem TTL). */
  downloadUrl:   string
  photoName:     string
  size?:         number
  promptName?:   string
}

export interface ClientLite {
  id:        string
  full_name: string
  email:     string | null
}

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

  // ────────────────────────────────────────────────────────────────
  //  "Importar de" — monta lista de fontes de texto para UM cliente
  //  Agora inclui os campos de "Informações da análise" (ai_info_templates
  //  + clients.ai_info_tags).
  // ────────────────────────────────────────────────────────────────

  async getTextImportSources(clientId: string): Promise<TextImportSourceOption[]> {
    const options: TextImportSourceOption[] = []

    // 1. Dados básicos do cliente
    const { data: client } = await supabase
      .from('clients')
      .select('full_name, email, phone, plan_id, ai_info_tags, contrast_layout')
      .eq('id', clientId).single()

    if (client) {
      options.push(
        { key: 'full_name', label: 'Nome',     group: 'client', groupLabel: 'Dados do cliente', value: client.full_name || null },
        { key: 'email',     label: 'E-mail',   group: 'client', groupLabel: 'Dados do cliente', value: client.email || null },
        { key: 'phone',     label: 'Telefone', group: 'client', groupLabel: 'Dados do cliente', value: client.phone || null },
      )
    }

    // 2. Resultado
    const { data: result } = await supabase
      .from('client_results').select('observations, folder_url').eq('client_id', clientId).maybeSingle()

    options.push(
      { key: 'observations',  label: 'Observações do resultado',   group: 'result', groupLabel: 'Resultado', value: result?.observations || null },
      { key: 'result_folder', label: 'Link da pasta do resultado', group: 'result', groupLabel: 'Resultado', value: result?.folder_url || null },
    )

    // 3. Informações da análise (ai_info_templates × ai_info_tags do cliente)
    //    Cada template é uma "coluna" tipo Coloração Pessoal / Subtom / etc.
    {
      const [{ data: templates }] = await Promise.all([
        supabase.from('ai_info_templates').select('id, name, sort_order').order('sort_order'),
      ])

      const saved: Array<{ templateId: string; value: string }> = Array.isArray(client?.ai_info_tags)
        ? (client!.ai_info_tags as any[])
        : []

      const savedMap: Record<string, string> = {}
      for (const row of saved) {
        if (row && typeof row.templateId === 'string') {
          savedMap[row.templateId] = (row.value ?? '').toString()
        }
      }

      for (const t of (templates || []) as Array<{ id: string; name: string }>) {
        const val = savedMap[t.id]
        options.push({
          key: `ai_info:${t.id}`,
          label: t.name,
          group: 'form',                       // reutiliza o tipo existente
          groupLabel: 'Informações da análise',
          value: val && val.trim() ? val : null,
        })
      }
    }

    // 3.5 Built-in: Contraste (Ferramenta de Contraste — clients.contrast_layout)
    //     Sempre presente como variável {{Contraste}}, mesmo sem cadastrar tag.
    //     Valor null quando a ferramenta ainda não foi configurada pra cliente.
    {
      const cl: any = (client as any)?.contrast_layout
      let value: string | null = null
      if (cl && typeof cl === 'object' && cl.photoId && typeof cl.label === 'string') {
        value = formatContrastValue(cl.label, Number(cl.cMin), Number(cl.cMax))
      }
      options.push({
        key:        'ai_info:_contrast',     // prefixo ai_info: pro filtro do AddPageDialog
        label:      'Contraste',
        group:      'form',
        groupLabel: 'Informações da análise',
        value,
      })
    }

    // 4. Campos do formulário do plano
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

  // ────────────────────────────────────────────────────────────────
  //  AI Info Tags do tipo IMAGEM — alimenta a aba "Tags de análise"
  //  no picker de imagem (TagValueImageDialog).
  //
  //  Retorna, pra este cliente, apenas as tags ai_info_templates onde:
  //   • type === 'image'
  //   • o cliente selecionou alguma opção (clients.ai_info_tags)
  //   • a opção selecionada tem imagePath cadastrado no catálogo
  //
  //  Tags sem imagem na opção ou ainda não preenchidas são filtradas.
  // ────────────────────────────────────────────────────────────────

  async getAiInfoImageSources(clientId: string): Promise<Array<{
    templateId: string
    templateName: string
    selectedLabel: string
    imagePath: string         // path no bucket ai-tag-option-images
    imageUrl: string          // URL pública pronta pra <img src>
  }>> {
    // 1. Lê o que o cliente selecionou em cada tag
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('ai_info_tags')
      .eq('id', clientId)
      .single()
    if (clientErr) throw clientErr

    const saved: Array<{ templateId: string; value: string }> =
      Array.isArray(client?.ai_info_tags) ? (client!.ai_info_tags as any[]) : []
    if (saved.length === 0) return []

    const savedMap: Record<string, string> = {}
    for (const row of saved) {
      if (row && typeof row.templateId === 'string') {
        savedMap[row.templateId] = (row.value ?? '').toString().trim()
      }
    }

    // 2. Lê o catálogo de tags do tipo imagem
    const { data: templates, error: tplErr } = await supabase
      .from('ai_info_templates')
      .select('id, name, options, sort_order')
      .eq('type', 'image')
      .order('sort_order')
    if (tplErr) throw tplErr

    // 3. Cruza: pra cada template-imagem, acha a opção cujo label
    //    bate com o valor salvo pelo cliente; só inclui se a opção tem imagePath.
    const out: Array<{
      templateId: string
      templateName: string
      selectedLabel: string
      imagePath: string
      imageUrl: string
    }> = []

    for (const tpl of (templates || []) as Array<{ id: string; name: string; options: any }>) {
      const label = savedMap[tpl.id]
      if (!label) continue

      const options: any[] = Array.isArray(tpl.options) ? tpl.options : []
      const opt = options.find(o => {
        if (typeof o === 'string') return o === label
        return o && typeof o === 'object' && o.label === label
      })
      if (!opt || typeof opt === 'string') continue
      const imagePath: string | undefined = opt.imagePath
      if (!imagePath) continue

      const { data: urlData } = supabase.storage
        .from('ai-tag-option-images')
        .getPublicUrl(imagePath)

      out.push({
        templateId: tpl.id,
        templateName: tpl.name,
        selectedLabel: label,
        imagePath,
        imageUrl: urlData.publicUrl,
      })
    }

    return out
  },

  // ────────────────────────────────────────────────────────────────
  //  Lista enxuta das AI Info Tags ativas (Settings → tagsmanager).
  //  Usada no TagFormDialog para popular o dropdown de vínculo.
  // ────────────────────────────────────────────────────────────────

  async listAiInfoTemplates(): Promise<Array<{
    id: string
    name: string
    type: 'text' | 'image'
    options: any[]
  }>> {
    const { data, error } = await supabase
      .from('ai_info_templates')
      .select('id, name, type, options, sort_order')
      .order('sort_order')
    if (error) throw error
    return (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      type: t.type === 'image' ? 'image' : 'text',
      options: Array.isArray(t.options) ? t.options : [],
    }))
  },

  // ────────────────────────────────────────────────────────────────
  //  Resolve, para um cliente, o valor "ao vivo" de uma lista de
  //  AI Info Templates linkadas. Usado por:
  //   • resolveTagValues  (engine de geração de PDF)
  //   • ClientTagValuesPanel  (preview das tags vinculadas)
  //
  //  Retorna map templateId → resolução. Templates ausentes do mapa
  //  significam: ou o template não existe mais, ou o cliente não
  //  selecionou nenhuma opção.
  // ────────────────────────────────────────────────────────────────

  async resolveAiInfoLinks(
    clientId: string,
    templateIds: string[],
  ): Promise<Record<string, {
    templateId: string
    templateName: string
    templateType: 'text' | 'image'
    selectedLabel: string
    imagePath: string | null    // só pra type='image' COM imagem no catálogo
    imageUrl: string | null
  }>> {
    if (templateIds.length === 0) return {}

    // 1. Valores selecionados pelo cliente
    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('ai_info_tags')
      .eq('id', clientId)
      .single()
    if (cErr) throw cErr

    const saved: Array<{ templateId: string; value: string }> =
      Array.isArray(client?.ai_info_tags) ? (client!.ai_info_tags as any[]) : []
    const savedMap: Record<string, string> = {}
    for (const row of saved) {
      if (row && typeof row.templateId === 'string') {
        savedMap[row.templateId] = (row.value ?? '').toString().trim()
      }
    }

    // 2. Carrega os templates pedidos
    const { data: tpls, error: tErr } = await supabase
      .from('ai_info_templates')
      .select('id, name, type, options')
      .in('id', templateIds)
    if (tErr) throw tErr

    const out: Record<string, {
      templateId: string
      templateName: string
      templateType: 'text' | 'image'
      selectedLabel: string
      imagePath: string | null
      imageUrl: string | null
    }> = {}

    for (const tpl of (tpls || []) as Array<{ id: string; name: string; type: string; options: any }>) {
      const label = savedMap[tpl.id]
      if (!label) continue   // cliente ainda não selecionou nada pra essa tag

      const templateType: 'text' | 'image' = tpl.type === 'image' ? 'image' : 'text'

      let imagePath: string | null = null
      let imageUrl:  string | null = null

      if (templateType === 'image') {
        const options: any[] = Array.isArray(tpl.options) ? tpl.options : []
        const opt = options.find(o => {
          if (typeof o === 'string') return o === label
          return o && typeof o === 'object' && o.label === label
        })
        if (opt && typeof opt === 'object' && opt.imagePath) {
          imagePath = opt.imagePath as string
          const { data: urlData } = supabase.storage
            .from('ai-tag-option-images')
            .getPublicUrl(imagePath)
          imageUrl = urlData.publicUrl
        }
      }

      out[tpl.id] = {
        templateId: tpl.id,
        templateName: tpl.name,
        templateType,
        selectedLabel: label,
        imagePath,
        imageUrl,
      }
    }

    return out
  },

  // ────────────────────────────────────────────────────────────────
  //  Catálogo de fontes disponíveis pra vínculo (NO catalog level — sem
  //  contexto de cliente). Usado em TagFormDialog pra popular o dropdown
  //  "Vincular a...". A resolução do VALOR por cliente é feita em
  //  getTextImportSources (texto) ou resolveAiInfoLinks (imagem).
  //
  //  Chaves alinhadas com as do getTextImportSources:
  //   • 'full_name', 'email', 'phone'   → Dados do cliente
  //   • 'observations', 'result_folder' → Resultado
  //   • 'ai_info:<uuid>'                → AI Info Templates
  // ────────────────────────────────────────────────────────────────

  async listImportSourceCatalog(): Promise<Array<{
    key: string
    label: string
    groupLabel: string
    /**
     * Tipos de doc tag que podem vincular a esta fonte.
     * - Fontes de texto puro (cliente, resultado, AI Info texto): ['text']
     * - AI Info imagem: ['text', 'image']  (texto → label; imagem → arquivo)
     */
    acceptedTagTypes: Array<'text' | 'image'>
  }>> {
    const out: Array<{
      key: string; label: string; groupLabel: string
      acceptedTagTypes: Array<'text' | 'image'>
    }> = [
      { key: 'full_name',     label: 'Nome',                       groupLabel: 'Dados do cliente', acceptedTagTypes: ['text'] },
      { key: 'email',         label: 'E-mail',                     groupLabel: 'Dados do cliente', acceptedTagTypes: ['text'] },
      { key: 'phone',         label: 'Telefone',                   groupLabel: 'Dados do cliente', acceptedTagTypes: ['text'] },
      { key: 'observations',  label: 'Observações do resultado',   groupLabel: 'Resultado',        acceptedTagTypes: ['text'] },
      { key: 'result_folder', label: 'Link da pasta do resultado', groupLabel: 'Resultado',        acceptedTagTypes: ['text'] },
    ]

    // AI Info Templates (ambos tipos viram fonte de tag — text/imagem)
    const { data: tpls, error } = await supabase
      .from('ai_info_templates')
      .select('id, name, type, sort_order')
      .order('sort_order')
    if (error) throw error

    for (const t of (tpls || []) as Array<{ id: string; name: string; type: string }>) {
      const isImg = t.type === 'image'
      out.push({
        key: `ai_info:${t.id}`,
        label: t.name,
        groupLabel: 'Informações da análise',
        // Doc-tag texto sempre vale (pega a label). Doc-tag imagem só se a AI Info é imagem.
        acceptedTagTypes: isImg ? ['text', 'image'] : ['text'],
      })
    }

    return out
  },

  async listClientPhotos(clientId: string): Promise<Array<{
    id: string; photo_name: string; storage_path: string; url: string;
    drive_file_id: string | null;
    category_id: string | null; category_title: string | null;
  }>> {
    const { data, error } = await supabase
      .from('client_photos')
      .select('id, photo_name, storage_path, drive_file_id, category_id, uploaded_at')
      .eq('client_id', clientId)
      .order('uploaded_at', { ascending: true })
    if (error) throw error

    const rows = (data || []) as Array<{
      id: string; photo_name: string; storage_path: string;
      drive_file_id: string | null;
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
      drive_file_id: r.drive_file_id ?? null,
      // Fotos do Drive usam a URL de thumbnail do Drive; as do Supabase usam getPublicUrl
      url: r.drive_file_id
        ? driveStorage.viewUrl(r.drive_file_id)
        : this.getClientPhotoUrl(r.storage_path),
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
    // 1. Apaga elementos posicionados
    await supabase.from('document_template_elements').delete().eq('template_id', id)
      .then(({ error }) => { if (error) console.warn('Erro ao apagar elementos:', error.message) })

    // 2. Apaga documentos gerados vinculados (FK client_generated_documents_template_id_fkey)
    await supabase.from('client_generated_documents').delete().eq('template_id', id)
      .then(({ error }) => { if (error) console.warn('Erro ao apagar docs gerados:', error.message) })

    // 3. Apaga arquivos do Storage (silencioso — PDF pode já ter sumido)
    try {
      const { data: files } = await supabase.storage.from('document-templates').list(id)
      if (files && files.length > 0) {
        await supabase.storage.from('document-templates')
          .remove(files.map(f => `${id}/${f.name}`)).catch(() => {})
      }
    } catch { /* pasta inexistente — ignora */ }

    // 4. Apaga o registro do template
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

  // ═══════════════ ELEMENTOS DE TEMPLATE ═══════════════════════════

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
    template_id: string; tag_id: string; page_number: number
    x_pt: number; y_pt: number
    width_pt?: number | null; height_pt?: number | null
    style?: ElementStyle; z_index?: number
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
      .update(updates as any).eq('id', id).select().single()
    if (error) throw error
    return data as DocumentTemplateElement
  },

  async deleteTemplateElement(id: string): Promise<void> {
    const { error } = await supabase.from('document_template_elements').delete().eq('id', id)
    if (error) throw error
  },

  // ═══════════════ GENERATED DOCS ══════════════════════════════════

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

  async saveGeneratedDocument(input: {
    clientId:   string
    templateId: string | null
    fileName:   string
    blob:       Blob
    mappings?:  DocumentMapping[]
    source?:    'template' | 'ai_composition'
  }): Promise<ClientGeneratedDocument> {
    const { clientId, templateId, fileName, blob, mappings = [], source = 'template' } = input
    const storagePath = `${clientId}/${Date.now()}_${safeFileName(fileName)}`

    const up = await supabase.storage.from('document-generated').upload(
      storagePath, blob,
      { contentType: 'application/pdf', upsert: false },
    )
    if (up.error) throw up.error

    let generatedBy: string | null = null
    try {
      const { data } = await supabase.auth.getUser()
      generatedBy = data?.user?.id ?? null
    } catch { /* ignore */ }

    const { data: row, error } = await supabase
      .from('client_generated_documents')
      .insert({
        client_id:    clientId,
        template_id:  templateId,          // agora pode ser null
        storage_path: storagePath,
        file_name:    fileName,
        file_size:    blob.size,
        mappings:     mappings as any,
        generated_by: generatedBy,
        source:       source,              // campo novo
        generated_at: new Date().toISOString(),
      })
      .select().single()

    if (error) {
      await supabase.storage.from('document-generated').remove([storagePath]).catch(() => {})
      throw error
    }
    return row as ClientGeneratedDocument
  },

  async deleteGeneratedDocument(doc: ClientGeneratedDocument): Promise<void> {
    await supabase.storage.from('document-generated').remove([doc.storage_path]).catch(() => {})
    const { error } = await supabase.from('client_generated_documents').delete().eq('id', doc.id)
    if (error) throw error
  },

  // ════════════════════════════════════════════════════════════════════
  //  AI Image Prompts — catálogo de prompts pra geração via gpt-image-1
  //
  //  Nova estrutura:
  //   • parts: AiPromptPart[]  — cada parte vira 1 imagem na fila
  //   • reference_image_path   — imagem complementar global do prompt
  //   • O campo `prompt` é mantido por retrocompatibilidade (pode ser '')
  // ════════════════════════════════════════════════════════════════════

  async listAiImagePrompts(opts?: { includeInactive?: boolean }): Promise<Array<{
    id: string
    name: string
    prompt: string
    parts: Array<{ id: string; label: string; prompt: string }>
    reference_image_path: string | null
    reference_image_url:  string | null
    model: string
    size: string
    quality: string
    is_active: boolean
    created_at: string
    updated_at: string
  }>> {
    let q = supabase.from('ai_image_prompts').select('*').order('name')
    if (!opts?.includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw error

    // Enriquece com URL pública da imagem de referência
    return ((data || []) as any[]).map((row: any) => {
      let reference_image_url: string | null = null
      if (row.reference_image_path) {
        const { data: urlData } = supabase.storage
          .from('ai-prompt-references')
          .getPublicUrl(row.reference_image_path)
        reference_image_url = urlData?.publicUrl ?? null
      }
      return {
        ...row,
        parts: Array.isArray(row.parts) ? row.parts : [],
        reference_image_path: row.reference_image_path ?? null,
        reference_image_url,
      }
    })
  },

  async createAiImagePrompt(input: {
    name: string
    prompt?: string
    parts?: Array<{ id: string; label: string; prompt: string }>
    reference_image_path?: string | null
    model?: string
    size?: string
    quality?: string
  }): Promise<{ id: string; name: string; parts: any[]; model: string; size: string; quality: string; is_active: boolean }> {
    const { data, error } = await supabase
      .from('ai_image_prompts')
      .insert({
        name:                 input.name.trim(),
        prompt:               input.prompt ?? '',
        parts:                input.parts ?? [],
        reference_image_path: input.reference_image_path ?? null,
        model:                input.model   || 'gpt-image-1',
        size:                 input.size    || '1024x1024',
        quality:              input.quality || 'medium',
        is_active: true,
      })
      .select('id, name, prompt, parts, reference_image_path, model, size, quality, is_active')
      .single()
    if (error) throw error
    return data as any
  },

  async updateAiImagePrompt(id: string, updates: Partial<{
    name: string
    prompt: string
    parts: Array<{ id: string; label: string; prompt: string }>
    reference_image_path: string | null
    model: string
    size: string
    quality: string
    is_active: boolean
  }>): Promise<void> {
    const payload: any = { ...updates }
    if (typeof payload.name === 'string') payload.name = payload.name.trim()
    const { error } = await supabase.from('ai_image_prompts').update(payload).eq('id', id)
    if (error) throw error
  },

  async deleteAiImagePrompt(id: string): Promise<void> {
    // Remove imagem de referência do storage antes de deletar o registro
    const { data: row } = await supabase
      .from('ai_image_prompts')
      .select('reference_image_path')
      .eq('id', id)
      .single()
    if (row?.reference_image_path) {
      await supabase.storage
        .from('ai-prompt-references')
        .remove([row.reference_image_path])
        .catch(() => {})
    }
    const { error } = await supabase.from('ai_image_prompts').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Faz upload da imagem de referência complementar de um prompt.
   * Salva no bucket `ai-prompt-references`.
   * Retorna { path, url } — `path` é o que você grava em `reference_image_path`.
   *
   * @param file      — arquivo a fazer upload
   * @param oldPath   — path anterior (será deletado antes do novo upload)
   */
  async uploadPromptReferenceImage(
    file: File,
    oldPath?: string | null,
  ): Promise<{ path: string; url: string }> {
    // Remove imagem anterior se existir
    if (oldPath) {
      await supabase.storage
        .from('ai-prompt-references')
        .remove([oldPath])
        .catch(() => {})
    }

    const ext = file.name.includes('.')
      ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase().replace(/[^a-z0-9.]/g, '')
      : '.png'
    // Usa prefixo aleatório — promptId não está disponível no momento do upload (modo create)
    const prefix = Math.random().toString(36).slice(2, 10)
    const path = `refs/${prefix}_${Date.now()}${ext}`

    const { error: upErr } = await supabase.storage
      .from('ai-prompt-references')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (upErr) throw upErr

    const { data: urlData } = supabase.storage
      .from('ai-prompt-references')
      .getPublicUrl(path)

    return { path, url: urlData?.publicUrl ?? '' }
  },

  // ════════════════════════════════════════════════════════════════════
  //  Composition — geração de imagens sem amarrar tag
  // ════════════════════════════════════════════════════════════════════

  /**
   * Gera UMA imagem no modo composition (sem amarrar a tag).
   * Chama a Edge Function generate-tag-image no modo composition.
   * Retorna o `storagePath` (relativo ao bucket `client-tag-images`).
   */
  async generateCompositionImage(input: {
    promptId:             string
    clientId:             string
    photoId:              string
    compositionId:        string    // qualquer string única — agrupa as imagens da mesma sessão
    index:                number    // posição da imagem na composição (pra nome de arquivo)
    /** Imagem extra de referência em base64 puro (sem prefixo data:…) */
    uploadedImageBase64?: string
    /** MIME da imagem extra, ex: 'image/png' */
    uploadedImageMime?:   string
    /** Se fornecido, sobrescreve o model salvo no prompt */
    modelOverride?:       string
    /** Texto do prompt já resolvido (parte específica). Evita a edge function ler o campo prompt vazio. */
    promptOverride?:      string
    /** Drive file ID da foto base — obrigatório quando a foto veio do Google Drive */
    driveFileId?:         string
  }): Promise<CompositionImageResult> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Usuário não autenticado')

    const supabaseUrl = (supabase as any).supabaseUrl || import.meta.env.VITE_SUPABASE_URL
    if (!supabaseUrl) throw new Error('SUPABASE_URL não disponível')

    const body: Record<string, any> = {
      promptId: input.promptId,
      clientId: input.clientId,
      photoId:  input.photoId,
      composition: {
        compositionId: input.compositionId,
        index:         input.index,
      },
    }
    if (input.uploadedImageBase64) {
      body.uploadedImage = {
        base64: input.uploadedImageBase64,
        mime:   input.uploadedImageMime || 'image/png',
      }
    }
    if (input.modelOverride) {
      body.modelOverride = input.modelOverride
    }
    if (input.promptOverride) {
      body.promptOverride = input.promptOverride
    }
    if (input.driveFileId) {
      body.driveFileId = input.driveFileId
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/generate-tag-image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error || `Falha ao gerar imagem (HTTP ${res.status})`)
    }
    const data = await res.json()
    // A edge function no modo composition agora retorna o arquivo no Drive.
    if (!data?.driveFileId) {
      throw new Error('Edge function não retornou driveFileId (composition deve subir pro Drive)')
    }
    return {
      driveFileId:   data.driveFileId,
      driveFolderId: data.driveFolderId,
      url:           data.url,
      downloadUrl:   data.downloadUrl,
      photoName:     data.photoName,
      size:          data.size,
      promptName:    data.promptName,
    }
  },

  // Os métodos `getSignedCompositionImageUrl` e `deleteCompositionImages`
  // foram removidos: composições não vivem mais no Supabase Storage. A URL
  // do Drive já vem estática (sem TTL) no resultado de generateCompositionImage,
  // e o cleanup é gerenciado pelo cron de purge do Drive (drive/cleanup).

  /**
   * Lista de clientes pro seletor (ordenado por nome).
   */
  async listClientsLight(): Promise<ClientLite[]> {
    const { data, error } = await supabase
      .from('clients')
      .select('id, full_name, email')
      .order('full_name', { ascending: true })
    if (error) throw error
    return (data as ClientLite[]) || []
  },

  // ────────────────────────────────────────────────────────────────────
  //  Invocação da Edge Function — gera imagem pra um tag/cliente.
  //  A Function valida admin, baixa a foto, chama OpenAI, sobe o
  //  resultado em client-tag-images e upserta client_tag_values.
  // ────────────────────────────────────────────────────────────────────

  async generateTagImageFromAI(input: {
    promptId: string
    clientId: string
    tagId:    string
    photoId:  string
  }): Promise<{ storagePath: string; size: number; promptName: string }> {
    const { data, error } = await supabase.functions.invoke('generate-tag-image', { body: input })
    if (error) {
      // Tenta extrair detalhe do response body se houver
      const ctx = (error as any)?.context
      let detail = ''
      try {
        if (ctx?.text) detail = await ctx.text()
        else if (typeof ctx === 'string') detail = ctx
      } catch { /* ignora */ }
      throw new Error(`${error.message}${detail ? ` — ${detail.slice(0, 300)}` : ''}`)
    }
    if (!data || (data as any).error) {
      throw new Error((data as any)?.error || 'Resposta vazia da Edge Function')
    }
    return data as any
  },
}