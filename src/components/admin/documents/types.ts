// src/components/admin/documents/types.ts
//
// Tipos compartilhados pela feature "Gerador de Documento".
// Mantenha este arquivo em sincronia com a migration do banco.

export type DocumentTagType = 'text' | 'image'

// ─── Tags ──────────────────────────────────────────────────────────────

export interface DocumentTag {
  id: string
  name: string
  slug: string
  type: DocumentTagType
  description: string | null
  /**
   * Sugestão (não vinculante) de origem dos dados. Reservado; ainda não
   * alimentado pela UI. Usado no futuro como pré-seleção do botão "Importar de".
   */
  default_hint: Record<string, any>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DocumentTagInput {
  name: string
  slug: string
  type: DocumentTagType
  description?: string | null
  default_hint?: Record<string, any>
  is_active?: boolean
}

// ─── Valores por cliente ───────────────────────────────────────────────

export interface ClientTagValue {
  id: string
  client_id: string
  tag_id: string

  // tags de texto
  text_value: string | null

  // tags de imagem — mutuamente exclusivos
  photo_id: string | null             // foto existente na aba "Fotos"
  image_storage_path: string | null   // upload avulso
  image_size: number | null
  image_mime: string | null

  updated_at: string
}

/**
 * Opção exibida no menu "Importar de" dos campos de texto.
 * `value` pode ser null quando a fonte existe no sistema mas ainda
 * não foi preenchida para este cliente (ex: formulário não enviado).
 */
export interface TextImportSourceOption {
  key: string                       // id estável (ex: 'full_name', 'form:<field_id>')
  label: string                     // label exibido no menu
  group: 'client' | 'result' | 'form'
  groupLabel: string                // "Dados do cliente", "Resultado", "Formulário"
  value: string | null              // valor resolvido; null = indisponível
}

// ─── Templates ─────────────────────────────────────────────────────────

export interface DocumentTemplate {
  id: string
  name: string
  description: string | null
  plan_id: string | null
  base_pdf_path: string
  page_count: number
  page_width_pt: number
  page_height_pt: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Estilos aplicados a um elemento ───────────────────────────────────
//
// Este objeto é guardado em document_template_elements.style (JSONB).
// Adicionar campos NOVOS é seguro — campos antigos seguem com defaults
// na engine de geração e no editor.

export interface ElementStyle {
  // ── texto ──────────────────────────────────────
  fontFamily?: string
  fontSize?: number                 // em pt
  color?: string                    // hex (#rrggbb ou #rgb)
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  /** Posicionamento vertical do bloco de texto dentro do retângulo */
  verticalAlign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number               // multiplicador (ex: 1.3)
  letterSpacing?: number            // em pt
  textTransform?: 'none' | 'uppercase' | 'lowercase'
  /**
   * Quando true, a engine reduz o fontSize automaticamente até o texto
   * caber dentro do retângulo (largura E altura). Útil quando o tamanho
   * do conteúdo varia bastante entre clientes. Default: false.
   */
  autoFit?: boolean

  // ── imagem ────────────────────────────────────
  /**
   * 'cover'   — preenche todo o retângulo, cortando o excedente
   *             (recorte é feito via canvas antes do embed).
   * 'contain' — encaixa inteira dentro do retângulo, mantém proporção,
   *             pode sobrar borda nos lados curtos.
   */
  objectFit?: 'cover' | 'contain'
}

export interface DocumentTemplateElement {
  id: string
  template_id: string
  tag_id: string
  page_number: number
  x_pt: number
  y_pt: number
  width_pt: number | null
  height_pt: number | null
  rotation: number
  z_index: number
  style: ElementStyle
  condition: Record<string, any> | null
  created_at: string
  updated_at: string
}

// ─── Documentos gerados ────────────────────────────────────────────────

export type MappingSource =
  | 'client_field'
  | 'form_field'
  | 'result_observations'
  | 'result_folder_url'
  | 'photo_id'
  | 'upload'
  | 'manual'

export interface DocumentMapping {
  tag_id: string
  source: MappingSource
  value: string
  source_ref?: Record<string, any>
}

export interface ClientGeneratedDocument {
  id: string
  client_id: string
  template_id: string
  storage_path: string
  file_name: string
  file_size: number | null
  mappings: DocumentMapping[]
  generated_at: string
  generated_by: string | null
}

// ─── Fontes suportadas pelo editor ─────────────────────────────────────

export const SUPPORTED_FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Poppins',
  'Raleway',
] as const

export type SupportedFont = typeof SUPPORTED_FONTS[number]