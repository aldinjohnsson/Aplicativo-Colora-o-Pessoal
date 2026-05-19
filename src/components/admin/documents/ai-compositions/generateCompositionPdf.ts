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
 * Baixa todas as imagens (urls assinadas) em paralelo controlado.
 * Devolve no MESMO ORDEM da entrada.
 */
export async function fetchAllAsBytes(urls: string[]): Promise<CompositionImage[]> {
  const out: CompositionImage[] = []
  for (const url of urls) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Falha ao baixar imagem (HTTP ${res.status})`)
    const mime  = res.headers.get('content-type') || 'image/png'
    const bytes = await res.arrayBuffer()
    out.push({ bytes, mime })
  }
  return out
}
