// src/components/admin/documents/lib/pdfUtils.ts
//
// O worker é importado localmente via Vite (sufixo ?url) — sem CDN,
// sem risco de versão desatualizada ou bloqueio de rede.

import * as pdfjs from 'pdfjs-dist'
// O Vite resolve este import como URL estática do arquivo já bundlado.
// Se der erro de tipo, adicione /// <reference types="vite/client" /> no topo
// ou crie um vite-env.d.ts com essa diretiva na raiz do projeto.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let workerConfigured = false
function ensureWorker() {
  if (workerConfigured) return
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  workerConfigured = true
}

export interface PdfBaseMetadata {
  pageCount: number
  pageWidthPt: number
  pageHeightPt: number
}

export async function extractPdfMetadata(file: ArrayBuffer | Uint8Array | File): Promise<PdfBaseMetadata> {
  ensureWorker()

  let data: Uint8Array
  if (file instanceof File) {
    data = new Uint8Array(await file.arrayBuffer())
  } else if (file instanceof ArrayBuffer) {
    // .slice(0) copia o buffer — pdfjs v4+ transfere o buffer original
    // pro worker thread (detach), zerando-o para outros usos.
    data = new Uint8Array(file.slice(0))
  } else {
    data = new Uint8Array(file.buffer.slice(0))
  }

  const pdf = await pdfjs.getDocument({ data }).promise
  try {
    const firstPage = await pdf.getPage(1)
    const viewport = firstPage.getViewport({ scale: 1 })
    return {
      pageCount: pdf.numPages,
      pageWidthPt: viewport.width,
      pageHeightPt: viewport.height,
    }
  } finally {
    pdf.destroy()
  }
}

export async function renderPdfPageToDataURL(
  file: ArrayBuffer | Uint8Array | File,
  pageNumber = 1,
  targetWidthPx = 320,
): Promise<string> {
  ensureWorker()

  let data: Uint8Array
  if (file instanceof File) data = new Uint8Array(await file.arrayBuffer())
  else if (file instanceof ArrayBuffer) data = new Uint8Array(file)
  else data = file

  const pdf = await pdfjs.getDocument({ data }).promise
  try {
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.max(0.25, Math.min(4, targetWidthPx / base.width))
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context indisponível')

    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas.toDataURL('image/png')
  } finally {
    pdf.destroy()
  }
}