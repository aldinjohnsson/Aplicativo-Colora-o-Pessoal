// src/components/admin/documents/ai-compositions/generateCompositionPdf.ts
//
// Builder de PDF pra feature "Composições IA".
//
// Regra: 1 imagem por página. Página é dimensionada pra que o LADO MAIOR
// equivalha ao lado maior de uma A4 (842 pt ≈ 297 mm). Isso dá:
//   - imagem 1024×1024 (quadrada)    → página 842×842 pt
//   - imagem 1024×1536 (retrato)     → página 561×842 pt  (≈ A4 portrait)
//   - imagem 1536×1024 (paisagem)    → página 842×561 pt  (≈ A4 landscape)
// A imagem preenche a página inteira (cover sem necessidade de crop —
// já que a página tem o exato aspect ratio da imagem). Sem margens.

import { PDFDocument } from 'pdf-lib'

// Lado maior da página em pt. 842 = altura da A4 em portrait.
const TARGET_LONG_SIDE_PT = 842

export interface CompositionImage {
  bytes: ArrayBuffer
  mime:  string         // 'image/png' | 'image/jpeg' (a edge function devolve sempre png)
}

export async function generateCompositionPdf(images: CompositionImage[]): Promise<Blob> {
  if (images.length === 0) {
    throw new Error('Nenhuma imagem pra montar o PDF')
  }

  const pdf = await PDFDocument.create()

  for (const img of images) {
    const m = (img.mime || '').toLowerCase()
    const embedded = m.includes('png')
      ? await pdf.embedPng(img.bytes)
      : await pdf.embedJpg(img.bytes)

    const longSide = Math.max(embedded.width, embedded.height) || 1
    const scale = TARGET_LONG_SIDE_PT / longSide
    const pageW = embedded.width * scale
    const pageH = embedded.height * scale

    const page = pdf.addPage([pageW, pageH])
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width:  pageW,
      height: pageH,
    })
  }

  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

/**
 * Detecta o tipo real da imagem pelos magic bytes do arquivo.
 * Ignora o Content-Type do response, que pode vir errado do Supabase
 * storage (ex: application/octet-stream ao invés de image/png), o que
 * faria pdf-lib chamar embedJpg() com dados PNG e gerar um PDF inválido.
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
  return 'image/png' // fallback seguro — edge function sempre devolve PNG
}

/**
 * Baixa todas as imagens (urls assinadas) em sequência.
 * Devolve na MESMA ORDEM da entrada.
 * O tipo MIME é determinado pelos magic bytes do arquivo, não pelo
 * Content-Type do servidor (que pode estar errado).
 */
export async function fetchAllAsBytes(urls: string[]): Promise<CompositionImage[]> {
  const out: CompositionImage[] = []
  for (const url of urls) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Falha ao baixar imagem (HTTP ${res.status})`)
    const bytes = await res.arrayBuffer()
    const mime  = detectImageMime(bytes)
    out.push({ bytes, mime })
  }
  return out
}