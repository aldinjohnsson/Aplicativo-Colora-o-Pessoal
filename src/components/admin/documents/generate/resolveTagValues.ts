// src/components/admin/documents/generate/resolveTagValues.ts
//
// Dado (template, cliente), produz o mapa tag_id -> valor resolvido pronto
// pra engine de geração consumir. Inclui download dos bytes das imagens.
//
// Também faz a VALIDAÇÃO: quais tags usadas no template ainda não têm
// valor preenchido pra este cliente.
//
// FONTES DE VALOR (ordem de prioridade por tag):
//   1. Vínculo a AI Info Template (default_hint.source === 'ai_info_template')
//      → resolve a partir de clients.ai_info_tags + ai_info_templates.
//      Se a tag estiver vinculada e o cliente ainda não selecionou nada,
//      vai pra `missing` SEM consultar client_tag_values.
//   2. client_tag_values (preenchimento manual no ClientTagValuesPanel).

import { documentsService } from '../lib/documentsService'
import type {
  DocumentTag,
  DocumentTemplateElement,
  ClientTagValue,
} from '../types'
import type { TagValueResolved } from './generatePdf'

export interface ResolveOutcome {
  resolved: Record<string, TagValueResolved>   // chave: tag_id
  missing: DocumentTag[]                        // tags usadas sem valor preenchido
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function fetchBytes(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar imagem (HTTP ${res.status}) em ${url}`)
  const mime = res.headers.get('content-type') || 'application/octet-stream'
  const bytes = await res.arrayBuffer()
  return { bytes, mime }
}

/**
 * Lê o vínculo configurado em `default_hint` da DocumentTag.
 *
 * Suporta dois formatos:
 *  • Antigo: { source: 'ai_info_template', templateId: 'uuid' }
 *    → equivalente a { source: 'import_source', key: 'ai_info:<uuid>' }
 *
 *  • Novo (canônico): { source: 'import_source', key: '<chave>' }
 *    Chaves:
 *      - 'full_name' / 'email' / 'phone'             (cliente)
 *      - 'observations' / 'result_folder'            (resultado)
 *      - 'ai_info:<uuid>'                            (AI Info template)
 *      - 'form:<fieldId>'                            (formulário)
 */
type ParsedLink =
  | { kind: 'ai_info_template'; templateId: string }    // pra image-type doc tag (puxa arquivo)
  | { kind: 'import_source';    key: string }           // pra text-type doc tag (puxa string)
  | null

function parseTagLink(tag: DocumentTag): ParsedLink {
  const hint = (tag as any).default_hint
  if (!hint || typeof hint !== 'object') return null

  // Formato antigo
  if (hint.source === 'ai_info_template' && typeof hint.templateId === 'string' && hint.templateId) {
    if (tag.type === 'image') return { kind: 'ai_info_template', templateId: hint.templateId }
    // Pra text-type, convertemos pro caminho genérico (puxa a label)
    return { kind: 'import_source', key: `ai_info:${hint.templateId}` }
  }

  // Formato novo
  if (hint.source === 'import_source' && typeof hint.key === 'string' && hint.key) {
    if (tag.type === 'image') {
      // Doc-tag imagem só sabe lidar com ai_info:<uuid> (puxa arquivo)
      const m = /^ai_info:(.+)$/.exec(hint.key)
      if (m) return { kind: 'ai_info_template', templateId: m[1] }
      return null
    }
    return { kind: 'import_source', key: hint.key }
  }

  return null
}

// ─── Main ─────────────────────────────────────────────────────────────

/**
 * Resolve todos os valores necessários para gerar o PDF.
 * - clientId: necessário pra resolver tags vinculadas (AI Info)
 * - elements: os elementos posicionados no template (descobre quais tags importam)
 * - tags:     o catálogo completo de tags ativas
 * - values:   os valores de client_tag_values pra este cliente
 *
 * Retorna `missing` com as tags faltando (lista não vazia = bloqueia geração).
 */
export async function resolveTagValues(input: {
  clientId: string
  elements: DocumentTemplateElement[]
  tags: DocumentTag[]
  values: ClientTagValue[]
}): Promise<ResolveOutcome> {
  const { clientId, elements, tags, values } = input

  // Tags que efetivamente aparecem no template (dedup)
  const usedTagIds = Array.from(new Set(elements.map(el => el.tag_id)))

  const tagsById: Record<string, DocumentTag> = {}
  for (const t of tags) tagsById[t.id] = t

  const valuesByTagId: Record<string, ClientTagValue> = {}
  for (const v of values) valuesByTagId[v.tag_id] = v

  // ── 1. Pre-fetch dos dois "lados": AI Info imagem (bytes) e fontes texto ─
  //
  //   • aiLinks    : pra doc-tags imagem vinculadas a AI Info imagem
  //   • textSource : pra doc-tags texto vinculadas a qualquer fonte
  //
  //  Cada um é puxado UMA vez só, mesmo que várias doc-tags consumam.
  const aiImageTemplateIds: string[] = []
  let needsTextSources = false

  const parsedByTag: Record<string, ParsedLink> = {}
  for (const tagId of usedTagIds) {
    const tag = tagsById[tagId]
    if (!tag) continue
    const link = parseTagLink(tag)
    parsedByTag[tagId] = link
    if (link?.kind === 'ai_info_template') aiImageTemplateIds.push(link.templateId)
    if (link?.kind === 'import_source')    needsTextSources = true
  }

  const aiLinks = aiImageTemplateIds.length > 0
    ? await documentsService.resolveAiInfoLinks(clientId, Array.from(new Set(aiImageTemplateIds)))
    : {}

  const textSources = needsTextSources
    ? await documentsService.getTextImportSources(clientId)
    : []
  const textSourceByKey: Record<string, typeof textSources[number]> = {}
  for (const s of textSources) textSourceByKey[s.key] = s

  // ── 2. Resolve tag-a-tag ──────────────────────────────────────────
  const resolved: Record<string, TagValueResolved> = {}
  const missing: DocumentTag[] = []

  for (const tagId of usedTagIds) {
    const tag = tagsById[tagId]
    if (!tag) continue   // tag deletada; elemento órfão, ignora

    const link = parsedByTag[tagId]

    // ─── Caminho A: VINCULADA — AI Info imagem (puxa bytes) ─────
    if (link?.kind === 'ai_info_template') {
      const ai = aiLinks[link.templateId]
      if (!ai) { missing.push(tag); continue }
      if (!ai.imagePath || !ai.imageUrl) {
        // selecionou label mas a opção não tem imagem cadastrada no catálogo
        missing.push(tag); continue
      }
      try {
        const { bytes, mime } = await fetchBytes(ai.imageUrl)
        resolved[tagId] = {
          tag, kind: 'image',
          imageBytes: bytes,
          imageMime: mime,
        }
      } catch (err) {
        console.error(`Falha ao baixar imagem da AI Info pra tag "${tag.name}":`, err)
        missing.push(tag)
      }
      continue
    }

    // ─── Caminho B: VINCULADA — fonte de texto (cliente/resultado/AI Info/etc) ─
    if (link?.kind === 'import_source') {
      const src = textSourceByKey[link.key]
      const txt = src?.value
      if (!txt || !txt.trim()) {
        // Fonte existe mas valor vazio (ou fonte sumiu — ex: ai_info_template removido)
        missing.push(tag)
        continue
      }
      resolved[tagId] = {
        tag, kind: 'text', text: txt,
      }
      continue
    }

    // ─── Caminho C: tag MANUAL — lê client_tag_values ────────────
    const value = valuesByTagId[tagId]

    if (tag.type === 'text') {
      const hasText = !!(value && value.text_value && value.text_value.trim() !== '')
      if (!hasText) { missing.push(tag); continue }
      resolved[tagId] = {
        tag, kind: 'text', text: value!.text_value as string,
      }
      continue
    }

    // tag.type === 'image' manual
    const hasPhoto  = !!value?.photo_id
    const hasUpload = !!value?.image_storage_path
    if (!hasPhoto && !hasUpload) { missing.push(tag); continue }

    try {
      let url: string
      let mimeFromStorage: string | undefined

      if (hasUpload) {
        url = await documentsService.getSignedTagImageUrl(value!.image_storage_path as string)
        mimeFromStorage = value!.image_mime || undefined
      } else {
        const photos = await documentsService.listClientPhotos(value!.client_id)
        const found = photos.find(p => p.id === value!.photo_id)
        if (!found) {
          missing.push(tag)
          continue
        }
        url = found.url
      }

      const { bytes, mime } = await fetchBytes(url)
      resolved[tagId] = {
        tag, kind: 'image',
        imageBytes: bytes,
        imageMime: mimeFromStorage || mime,
      }
    } catch (err) {
      console.error(`Falha ao baixar imagem da tag "${tag.name}":`, err)
      missing.push(tag)
    }
  }

  return { resolved, missing }
}