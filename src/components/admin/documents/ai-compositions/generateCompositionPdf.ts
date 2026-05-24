// src/components/admin/documents/ai-compositions/generateCompositionPdf.ts
//
// Builder de PDF pra feature "Composições IA".
//
// Estrutura do PDF final:
//   [Capa.pdf]                     ← do admin (branding), vem do banco em base64
//   [N páginas geradas pela IA]    ← sem logo, imagem centrada em página A4
//   [Contracapa.pdf]               ← do admin (branding), vem do banco em base64
//
// ─── Regra de tamanho de página (UNIFORME) ──────────────────────────────
//
// TODAS as páginas do PDF final têm o MESMO tamanho. Sem isso, abrir o
// dossiê mostraria a capa A4 + páginas IA quadradas + contracapa A4 —
// inconsistente. Estratégia:
//
//   1. Se a capa foi enviada → usa o tamanho da 1ª página da capa como padrão
//   2. Senão, se a contracapa foi enviada → usa o tamanho da 1ª página dela
//   3. Senão (nenhum branding) → A4 portrait padrão (595×842 pt)
//
// As imagens geradas pela IA são posicionadas nessa página com
// **aspect-preserving fit + center** (letterbox):
//   - 1024×1024 (quadrada) em A4 portrait → 595×595 centrada verticalmente,
//     ~123pt de margem branca acima e abaixo
//   - 1024×1536 (retrato) em A4 portrait → preenche quase tudo, leves
//     margens laterais (proporções 0.667 vs 0.707 — diferença pequena)
//   - 1536×1024 (paisagem) em A4 portrait → margens grandes acima/abaixo;
//     se isso for indesejável, faça capa landscape
//
// Recomendação: faça capa/contracapa do MESMO tamanho que a imagem IA
// (ou vice-versa) pra evitar áreas em branco grandes nas páginas IA.
// Padrão sugerido: A4 portrait pra tudo, imagens IA quadradas com
// letterbox (visual ok e consistente).

import { PDFDocument, PDFPage } from 'pdf-lib'
import { driveStorage } from '../../../../lib/driveStorage'

// A4 portrait em pt (1 pt = 1/72 polegada). Usado como fallback quando
// nenhum branding (capa nem contracapa) está configurado.
const A4_PORTRAIT_W = 595
const A4_PORTRAIT_H = 842

export interface CompositionImage {
  bytes: ArrayBuffer
  mime:  string         // 'image/png' | 'image/jpeg'
}

export interface BrandingPdfs {
  cover?: ArrayBuffer | null
  final?: ArrayBuffer | null
}

/**
 * Monta o PDF da composição com tamanho de página uniforme.
 *
 * Ordem das páginas no PDF final:
 *   1. Todas as páginas do `branding.cover` (se informado) — copiadas vetorialmente
 *   2. N imagens geradas pela IA (1 por página, centradas com aspect-preserving fit)
 *   3. Todas as páginas do `branding.final` (se informado) — copiadas vetorialmente
 *
 * Se a capa ou o final falharem em carregar (PDF corrompido, formato
 * inválido), o builder ignora silenciosamente e segue — melhor entregar
 * o PDF sem branding do que quebrar o fluxo do admin.
 */
export async function generateCompositionPdf(
  images: CompositionImage[],
  branding: BrandingPdfs = {},
): Promise<Blob> {
  if (images.length === 0) {
    throw new Error('Nenhuma imagem pra montar o PDF')
  }

  const pdf = await PDFDocument.create()

  // ── 1. Carrega capa e contracapa primeiro pra inferir tamanho-padrão ──
  //
  // Carrega aqui mesmo (não dentro do try de adicionar) pra poder
  // medir a 1ª página antes de criar as páginas das imagens IA.
  let coverDoc: PDFDocument | null = null
  let finalDoc: PDFDocument | null = null

  if (branding.cover) {
    try {
      coverDoc = await PDFDocument.load(branding.cover)
    } catch (e) {
      console.warn('[generateCompositionPdf] Capa inválida, ignorando:', e)
      coverDoc = null
    }
  }
  if (branding.final) {
    try {
      finalDoc = await PDFDocument.load(branding.final)
    } catch (e) {
      console.warn('[generateCompositionPdf] Contracapa inválida, ignorando:', e)
      finalDoc = null
    }
  }

  // Tamanho-padrão pra todas as páginas: capa → contracapa → A4 portrait.
  // (Cobre os 3 cenários: com capa, só com contracapa, sem nada.)
  let pageW = A4_PORTRAIT_W
  let pageH = A4_PORTRAIT_H

  if (coverDoc) {
    const firstPage = coverDoc.getPage(0)
    pageW = firstPage.getWidth()
    pageH = firstPage.getHeight()
  } else if (finalDoc) {
    const firstPage = finalDoc.getPage(0)
    pageW = firstPage.getWidth()
    pageH = firstPage.getHeight()
  }

  // ── 2. Capa: copia vetorialmente todas as páginas ──
  if (coverDoc) {
    const indices = coverDoc.getPageIndices()
    const copied  = await pdf.copyPages(coverDoc, indices)
    copied.forEach((p: PDFPage) => pdf.addPage(p))
  }

  // ── 3. Páginas geradas pela IA: tamanho uniforme + imagem centrada ──
  for (const img of images) {
    const m = (img.mime || '').toLowerCase()
    const embedded = m.includes('png')
      ? await pdf.embedPng(img.bytes)
      : await pdf.embedJpg(img.bytes)

    const page = pdf.addPage([pageW, pageH])

    // Aspect-preserving fit: escala pela dimensão mais restrita.
    // Resulta em letterbox (margens brancas) quando o aspect ratio da
    // imagem não bate com o da página.
    const scale = Math.min(
      pageW / embedded.width,
      pageH / embedded.height,
    )
    const imgW = embedded.width  * scale
    const imgH = embedded.height * scale

    // Centro horizontal e vertical na página
    const x = (pageW - imgW) / 2
    const y = (pageH - imgH) / 2

    page.drawImage(embedded, { x, y, width: imgW, height: imgH })
  }

  // ── 4. Contracapa: copia vetorialmente todas as páginas ──
  if (finalDoc) {
    const indices = finalDoc.getPageIndices()
    const copied  = await pdf.copyPages(finalDoc, indices)
    copied.forEach((p: PDFPage) => pdf.addPage(p))
  }

  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

/**
 * Detecta o tipo real da imagem pelos magic bytes do arquivo.
 * Ignora o Content-Type do response, que pode vir errado dependendo da
 * fonte (ex: application/octet-stream do Drive proxy), o que faria
 * pdf-lib chamar embedJpg() com dados PNG e gerar um PDF inválido.
 *
 *   PNG  → 89 50 4E 47  (‰PNG)
 *   JPEG → FF D8 FF
 *   Fallback → 'image/png'  (a edge function sempre gera PNG)
 */
function detectImageMime(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf, 0, 4)
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
    return 'image/png'
  }
  if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
    return 'image/jpeg'
  }
  return 'image/png' // fallback seguro
}

/**
 * Baixa todas as imagens da composição a partir dos IDs do Drive.
 * Devolve na MESMA ORDEM da entrada.
 */
export async function fetchAllByDriveId(driveFileIds: string[]): Promise<CompositionImage[]> {
  const out: CompositionImage[] = []
  for (const id of driveFileIds) {
    const blob  = await driveStorage.fetchPhotoBlob(id)
    const bytes = await blob.arrayBuffer()
    const mime  = detectImageMime(bytes)
    out.push({ bytes, mime })
  }
  return out
}

/**
 * Converte um PDF salvo em base64 (data URL ou base64 puro) pra ArrayBuffer.
 *
 * O Settings salva os PDFs de branding usando FileReader.readAsDataURL,
 * que produz "data:application/pdf;base64,JVBERi0xLjQK…". Essa função
 * aceita as duas formas: com prefixo data: ou só o base64.
 *
 * Usado pra decodificar a capa e a contracapa armazenadas em
 * admin_content.content.pdfBase64 antes de passar pro builder.
 */
export function base64PdfToArrayBuffer(base64: string): ArrayBuffer {
  if (!base64) throw new Error('base64 vazio')
  const cleaned = base64.includes(',') ? base64.split(',')[1] : base64
  const binStr  = atob(cleaned)
  const bytes   = new Uint8Array(binStr.length)
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
  return bytes.buffer
}