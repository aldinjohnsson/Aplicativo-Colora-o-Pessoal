// src/lib/photoUpload.ts
// Compressão no navegador + fila de upload resiliente (paralela, com
// tentativas automáticas, pausa offline e progresso por arquivo).
import { driveStorage } from './driveStorage'

// ── Rede ────────────────────────────────────────────────────────────────

function netInfo(): { slow: boolean; verySlow: boolean } {
  const c: any = typeof navigator !== 'undefined' ? (navigator as any).connection : null
  const t: string = c?.effectiveType || ''
  const verySlow = t === 'slow-2g' || t === '2g'
  const slow = verySlow || t === '3g' || !!c?.saveData
  return { slow, verySlow }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    const t = setTimeout(done, ms)
    function done() { clearTimeout(t); signal?.removeEventListener('abort', done); resolve() }
    signal?.addEventListener('abort', done, { once: true })
  })

/** Resolve na hora se há internet; senão espera o evento `online`. */
function waitOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve()
  return new Promise<void>(resolve => {
    const done = () => {
      window.removeEventListener('online', done)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    window.addEventListener('online', done)
    signal?.addEventListener('abort', done, { once: true })
  })
}

const backoff = (attempt: number) =>
  Math.min(30_000, 2_000 * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5)

/** Roda `fn` com tentativas e espera crescente; pausa enquanto estiver offline. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: any
  for (let i = 1; i <= attempts; i++) {
    await waitOnline()
    try { return await fn() } catch (e) {
      last = e
      if (i < attempts) await sleep(backoff(i))
    }
  }
  throw last
}

// ── Compressão ──────────────────────────────────────────────────────────

/**
 * Reduz a foto antes do envio. Fotos de celular têm 3–10MB; em 2400px/JPEG 85%
 * ficam ~0,5–1MB. Em rede lenta reduz mais (1800px/80%). Se algo falhar
 * (ex.: HEIC no Chrome) ou o resultado não ficar menor, devolve o original.
 */
export async function compressForUpload(
  file: File,
  opts: { maxDim?: number; quality?: number; skipBelowBytes?: number } = {},
): Promise<File> {
  const slow = netInfo().slow
  const { maxDim = slow ? 1800 : 2400, quality = slow ? 0.8 : 0.85, skipBelowBytes = 800 * 1024 } = opts
  if (!file.type.startsWith('image/') || file.size < skipBelowBytes) return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any)
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bmp.close?.(); return file }
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
    canvas.width = canvas.height = 0 // libera memória (importante no celular)
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}

// ── Fila de upload ──────────────────────────────────────────────────────

export type UploadStatus =
  | 'queued' | 'compressing' | 'uploading'
  | 'retrying'   // falhou, vai tentar de novo
  | 'waiting'    // sem internet — retoma sozinho quando voltar
  | 'done' | 'error'

export interface UploadItem {
  id: string
  file: File
  categoryId: string
  /** Só usado pra kind='ai_photo'. */
  clearPrevious?: boolean
}

export interface UploadItemState {
  status: UploadStatus
  /** 0–100 */
  percent: number
  error?: string
  attempt?: number
  maxAttempts?: number
}

// Id estável por objeto File (não muda quando o cliente remove outra foto).
const ids = new WeakMap<File, string>()
let seq = 0
export function fileId(f: File): string {
  let v = ids.get(f)
  if (!v) { v = `f${++seq}`; ids.set(f, v) }
  return v
}

export const MAX_ATTEMPTS = 10

/**
 * Envia os itens. Regras:
 *  - 1º item (e os com clearPrevious) sobem sozinhos antes — evita criar
 *    pastas duplicadas do cliente no Drive e preserva a ordem do "limpar anteriores".
 *  - Depois, até `concurrency` em paralelo (menos em rede lenta).
 *  - Cada foto tenta até MAX_ATTEMPTS vezes com espera crescente. Se a
 *    internet cair, PAUSA (sem gastar tentativas) e retoma quando voltar.
 *  - Só erros de rede/servidor temporário são repetidos; erro 4xx definitivo falha direto.
 *
 * Retorna os ids que falharam de vez (vazio = tudo salvo).
 */
export async function uploadBatch(opts: {
  token: string
  items: UploadItem[]
  kind?: 'photo' | 'ai_photo'
  concurrency?: number
  onItem: (id: string, state: UploadItemState) => void
  signal?: AbortSignal
}): Promise<string[]> {
  const { token, items, kind = 'photo', onItem, signal } = opts
  const net = netInfo()
  const baseConc = opts.concurrency ?? (net.verySlow ? 1 : net.slow ? 2 : 3)
  const failed: string[] = []

  const runOne = async (it: UploadItem): Promise<boolean> => {
    if (signal?.aborted) return false
    onItem(it.id, { status: 'compressing', percent: 0 })
    const file = await compressForUpload(it.file) // 1x só; as tentativas reusam

    let lastErr = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) return false

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        onItem(it.id, { status: 'waiting', percent: 0, attempt, maxAttempts: MAX_ATTEMPTS })
        await waitOnline(signal)
        // pequena folga pro Wi-Fi/dados estabilizarem
        await sleep(1500, signal)
      }

      onItem(it.id, { status: 'uploading', percent: 0, attempt, maxAttempts: MAX_ATTEMPTS })
      try {
        await driveStorage.uploadPhoto({
          portalToken: token,
          file,
          categoryId: it.categoryId,
          kind,
          clearPrevious: it.clearPrevious,
          signal,
          onProgress: (l, t) => {
            // 99% até o servidor confirmar (Drive ainda processa).
            const pct = t > 0 ? Math.min(99, Math.round((l / t) * 100)) : 0
            onItem(it.id, { status: 'uploading', percent: pct, attempt, maxAttempts: MAX_ATTEMPTS })
          },
        })
        onItem(it.id, { status: 'done', percent: 100 })
        return true
      } catch (e: any) {
        lastErr = e?.message || 'Erro'
        const retryable = e?.retryable !== false && e?.name !== 'AbortError'
        if (!retryable || attempt === MAX_ATTEMPTS) break
        onItem(it.id, { status: 'retrying', percent: 0, attempt, maxAttempts: MAX_ATTEMPTS, error: lastErr })
        await sleep(backoff(attempt), signal)
      }
    }
    failed.push(it.id)
    onItem(it.id, { status: 'error', percent: 0, error: lastErr })
    return false
  }

  // 1) sequenciais
  const serial = items.filter((it, i) => i === 0 || it.clearPrevious)
  const rest = items.filter(it => !serial.includes(it))
  let firstOk = true
  for (const it of serial) { if (!(await runOne(it))) firstOk = false }

  // 2) resto em paralelo (1 por vez se a 1ª falhou, pra não duplicar pasta)
  const conc = firstOk ? baseConc : 1
  let next = 0
  const worker = async () => {
    while (next < rest.length) await runOne(rest[next++])
  }
  await Promise.all(Array.from({ length: Math.min(conc, rest.length) }, worker))
  return failed
}