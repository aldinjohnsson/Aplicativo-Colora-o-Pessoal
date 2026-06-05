// src/lib/imageOrientation.ts
//
// Corrige a orientação EXIF de fotos. Celular salva os pixels "deitados" + uma
// marca dizendo "gire 90°". O <img> respeita essa marca, mas canvas/processamento
// (compressão, thumbnail, envio pra IA) a PERDEM — sobram os pixels deitados e a
// foto fica torta em todo lugar que reprocessa.
//
// Estas funções decodificam JÁ aplicando a orientação e re-codificam em pixels
// "em pé", de forma definitiva (não é CSS — é o arquivo de verdade).

async function decodeUpright(input: Blob): Promise<ImageBitmap | HTMLImageElement> {
  // Caminho moderno: createImageBitmap aplica a orientação EXIF na decodificação.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(input, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    } catch {
      try { return await createImageBitmap(input) } catch { /* cai pro <img> */ }
    }
  }
  // Fallback: <img> (respeita EXIF na maioria dos browsers atuais).
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(input)
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao carregar imagem')) }
    img.src = url
  })
}

function dims(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return { w: (src as any).width, h: (src as any).height }
}

function release(src: ImageBitmap | HTMLImageElement): void {
  if ('close' in src && typeof (src as any).close === 'function') (src as ImageBitmap).close()
}

/**
 * Re-codifica a imagem com a orientação EXIF JÁ aplicada (pixels em pé),
 * opcionalmente redimensionando. Retorna um JPEG. Use no UPLOAD — assim a foto
 * fica correta em todo lugar (galeria, IA, PDF), sem depender de marca EXIF.
 */
export async function fixImageOrientation(
  input: Blob,
  opts: { maxSize?: number; quality?: number } = {},
): Promise<Blob> {
  const { maxSize = 1600, quality = 0.88 } = opts
  const src = await decodeUpright(input)
  let { w, h } = dims(src)

  if (maxSize && (w > maxSize || h > maxSize)) {
    if (w > h) { h = Math.round((h * maxSize) / w); w = maxSize }
    else       { w = Math.round((w * maxSize) / h); h = maxSize }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) { release(src); return input }
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h)
  release(src)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Falha ao processar imagem')),
      'image/jpeg', quality,
    )
  })
}

/**
 * Gira a imagem em múltiplos de 90° (sentido horário) e re-codifica em JPEG.
 * Aplica a orientação EXIF antes de girar, então o resultado é definitivo —
 * pra usar num botão "girar" que conserta a foto em todo lugar que a usa.
 */
export async function rotateImageBlob(input: Blob, degrees: number, quality = 0.92): Promise<Blob> {
  const deg = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360
  const src = await decodeUpright(input)
  const { w, h } = dims(src)
  const swap = deg === 90 || deg === 270

  const canvas = document.createElement('canvas')
  canvas.width  = swap ? h : w
  canvas.height = swap ? w : h
  const ctx = canvas.getContext('2d')
  if (!ctx) { release(src); return input }

  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(src as CanvasImageSource, -w / 2, -h / 2, w, h)
  release(src)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Falha ao girar imagem')),
      'image/jpeg', quality,
    )
  })
}
