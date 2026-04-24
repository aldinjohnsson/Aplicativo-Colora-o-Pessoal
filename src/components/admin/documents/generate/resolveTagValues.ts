// src/components/admin/documents/generate/resolveTagValues.ts
//
// Dado (template, cliente), produz o mapa tag_id -> valor resolvido pronto
// pra engine de geração consumir. Inclui download dos bytes das imagens.
//
// Também faz a VALIDAÇÃO: quais tags usadas no template ainda não têm
// valor preenchido pra este cliente.

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

/**
 * Baixa um arquivo como ArrayBuffer, com MIME inferido do response.
 */
async function fetchBytes(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar imagem (HTTP ${res.status}) em ${url}`)
  const mime = res.headers.get('content-type') || 'application/octet-stream'
  const bytes = await res.arrayBuffer()
  return { bytes, mime }
}

/**
 * Resolve todos os valores necessários para gerar o PDF.
 * - elements: os elementos posicionados no template (descobrimos quais tags importam)
 * - tags:     o catálogo completo de tags ativas
 * - values:   os valores preenchidos para este cliente
 *
 * Retorna `missing` com as tags faltando (lista não vazia = geração deve ser bloqueada).
 */
export async function resolveTagValues(input: {
  elements: DocumentTemplateElement[]
  tags: DocumentTag[]
  values: ClientTagValue[]
}): Promise<ResolveOutcome> {
  const { elements, tags, values } = input

  // Reúne ids de tags que realmente aparecem no template (dedup)
  const usedTagIds = Array.from(new Set(elements.map(el => el.tag_id)))

  const tagsById: Record<string, DocumentTag> = {}
  for (const t of tags) tagsById[t.id] = t

  const valuesByTagId: Record<string, ClientTagValue> = {}
  for (const v of values) valuesByTagId[v.tag_id] = v

  const resolved: Record<string, TagValueResolved> = {}
  const missing: DocumentTag[] = []

  for (const tagId of usedTagIds) {
    const tag = tagsById[tagId]
    if (!tag) continue   // tag foi deletada; elemento ficou órfão, ignora

    const value = valuesByTagId[tagId]

    if (tag.type === 'text') {
      const hasText = value && value.text_value !== null && value.text_value !== undefined && value.text_value.trim() !== ''
      if (!hasText) { missing.push(tag); continue }
      resolved[tagId] = {
        tag, kind: 'text', text: value!.text_value as string,
      }
    } else {
      // imagem
      const hasPhoto = !!value?.photo_id
      const hasUpload = !!value?.image_storage_path
      if (!hasPhoto && !hasUpload) { missing.push(tag); continue }

      try {
        let url: string
        let mimeFromStorage: string | undefined

        if (hasUpload) {
          url = await documentsService.getSignedTagImageUrl(value!.image_storage_path as string)
          mimeFromStorage = value!.image_mime || undefined
        } else {
          // photo_id → precisamos do storage_path do client_photos
          // Reaproveita listClientPhotos (tem cache curto, barato)
          const photos = await documentsService.listClientPhotos(value!.client_id)
          const found = photos.find(p => p.id === value!.photo_id)
          if (!found) {
            // A foto foi deletada da galeria depois de ser linkada
            missing.push(tag); continue
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
        // Trata falha de download como "faltando" — evita gerar PDF com slot em branco por erro de rede
        console.error(`Falha ao baixar imagem da tag "${tag.name}":`, err)
        missing.push(tag)
      }
    }
  }

  return { resolved, missing }
}
