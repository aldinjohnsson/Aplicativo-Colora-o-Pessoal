// src/components/admin/ClientsManager.tsx
// KanbanBoard integrado com dados reais do Supabase

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import {
  Plus, Search, Eye, Trash2, ArrowLeft, Copy, CheckCircle,
  Clock, FileText, Camera, Upload, X, ExternalLink,
  Check, Download, User, Phone, Mail,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  FolderOpen, Image, ClipboardList,
  LayoutGrid, List, Calendar,
  AlertTriangle, Save, MessageSquare, Link2, Tag,
  Lock, Unlock,
  MoreHorizontal, Archive, ArchiveRestore, Star, Layers,
  SlidersHorizontal, ChevronDown, Palette, Pencil,
  Loader2, AlertCircle, Bell, Wand2, Mic, Square, Music, RotateCcw, Hourglass,
} from 'lucide-react'
import { adminService, Client, Plan } from '../../lib/services'
import { notifyClientCompleted } from '../../lib/whatsappService'
import { supabase } from '../../lib/supabase'
import { driveStorage } from '../../lib/driveStorage'
import { formatDeadlineDate, calendarDaysUntil, parseLocalDate } from '../../lib/deadlineCalculator'
import { AIPromptConfig } from './AIPromptConfig'
import { GeminiChat } from '../client/GeminiChat'
import { RejectionModal } from './RejectionModal'
import { StageController } from './StageController'
import { THEMES, ThemeName, Theme, useTheme } from '../../lib/theme'
import { ClientDocumentsTab } from './documents/client/ClientDocumentsTab'
import { AiCompositionsManager } from './documents/ai-compositions/AiCompositionsManager'
import { ContrastLayoutDialog, type ContrastLayoutData, formatContrastValue } from './documents/client/ContrastLayoutDialog'
import { IrisAnalysisSection } from './documents/client/IrisAnalysisSection'
import { IrisAnalysisDialog } from './documents/client/IrisAnalysisDialog'
import type { IrisAnalysisRecord } from './documents/client/irisAnalysisTypes'
import { cleanClientFiles } from '../../services/cleanupService'
import { AddManualClientModal } from './AddManualClientModal'

// ─── HEIC → JPEG (conversão no navegador) ─────────────────────────────────
// Cache compartilhado entre todas as instâncias para não reconverter a mesma foto
const __heicCache = new Map<string, string>()
const __heicInflight = new Map<string, Promise<string>>()

// Fila com limite de concorrência. libheif (WASM) é single-thread; muitas
// conversões em paralelo saturam o navegador e dão sensação de travamento.
type HeicPriority = 'high' | 'normal'
type HeicQueueItem = { url: string; run: () => void; priority: HeicPriority }
const __heicQueue: HeicQueueItem[] = []
let __heicActive = 0
const HEIC_MAX_CONCURRENT = 2
const HEIC_TIMEOUT_MS = 45000

function __heicProcessQueue() {
  while (__heicActive < HEIC_MAX_CONCURRENT) {
    // Pega primeiro item de prioridade alta; se não tiver, pega normal
    let idx = __heicQueue.findIndex(it => it.priority === 'high')
    if (idx < 0) idx = __heicQueue.length > 0 ? 0 : -1
    if (idx < 0) return
    const item = __heicQueue.splice(idx, 1)[0]
    __heicActive++
    item.run()
  }
}

function isLikelyHeic(url?: string, name?: string): boolean {
  const target = (name || url || '').toLowerCase()
  return /\.heic(\?|#|$)/.test(target) || /\.heif(\?|#|$)/.test(target)
}

async function convertHeicFromUrl(url: string, priority: HeicPriority = 'normal'): Promise<string> {
  const cached = __heicCache.get(url)
  if (cached) return cached

  const inflight = __heicInflight.get(url)
  if (inflight) {
    // Se já está na fila com prioridade normal e agora pediram alta, sobe na fila
    if (priority === 'high') {
      const queued = __heicQueue.find(it => it.url === url)
      if (queued) queued.priority = 'high'
    }
    return inflight
  }

  const promise = new Promise<string>((resolve, reject) => {
    const run = async () => {
      const t0 = performance.now()
      try {
        console.log('[HEIC] Iniciando:', url.split('/').pop())

        const work = (async () => {
          // Import dinâmico: heic2any (~700KB) só é baixado quando há HEIC
          const heic2any = (await import('heic2any')).default
          const res = await fetch(url)
          if (!res.ok) throw new Error(`Fetch falhou (${res.status})`)
          const blob = await res.blob()
          const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 })
          const converted = Array.isArray(result) ? result[0] : result
          return URL.createObjectURL(converted as Blob)
        })()

        const timeout = new Promise<string>((_, rej) =>
          setTimeout(() => rej(new Error(`Timeout após ${HEIC_TIMEOUT_MS / 1000}s`)), HEIC_TIMEOUT_MS)
        )

        const blobUrl = await Promise.race([work, timeout])
        __heicCache.set(url, blobUrl)
        console.log(`[HEIC] OK em ${Math.round(performance.now() - t0)}ms:`, url.split('/').pop())
        resolve(blobUrl)
      } catch (err) {
        console.error(`[HEIC] FALHOU em ${Math.round(performance.now() - t0)}ms:`, url.split('/').pop(), err)
        reject(err)
      } finally {
        __heicInflight.delete(url)
        __heicActive--
        __heicProcessQueue()
      }
    }

    __heicQueue.push({ url, run, priority })
    __heicProcessQueue()
  })

  __heicInflight.set(url, promise)
  return promise
}

/** Hook que devolve uma URL segura para exibir (converte HEIC quando necessário). */
function useHeicSafeSrc(originalUrl?: string, fileName?: string, priority: HeicPriority = 'normal') {
  const [state, setState] = useState<{ src?: string; loading: boolean; error: boolean }>(() => {
    if (!originalUrl) return { src: undefined, loading: false, error: false }
    if (!isLikelyHeic(originalUrl, fileName)) return { src: originalUrl, loading: false, error: false }
    const cached = __heicCache.get(originalUrl)
    if (cached) return { src: cached, loading: false, error: false }
    return { src: undefined, loading: true, error: false }
  })

  useEffect(() => {
    if (!originalUrl) {
      setState({ src: undefined, loading: false, error: false })
      return
    }
    if (!isLikelyHeic(originalUrl, fileName)) {
      setState({ src: originalUrl, loading: false, error: false })
      return
    }
    const cached = __heicCache.get(originalUrl)
    if (cached) {
      setState({ src: cached, loading: false, error: false })
      return
    }

    setState({ src: undefined, loading: true, error: false })
    let cancelled = false

    convertHeicFromUrl(originalUrl, priority)
      .then(blobUrl => {
        if (!cancelled) setState({ src: blobUrl, loading: false, error: false })
      })
      .catch(err => {
        console.error('Erro ao converter HEIC:', originalUrl, err)
        if (!cancelled) setState({ src: undefined, loading: false, error: true })
      })

    return () => { cancelled = true }
  }, [originalUrl, fileName, priority])

  return state
}

/** Drop-in replacement para <img> que lida com HEIC automaticamente. */
function SafeImage({
  src: originalSrc,
  fileName,
  className,
  style,
  alt,
  onLoad,
  onError,
  onClick,
  draggable,
  loading: imgLoading,
  decoding,
}: {
  src?: string
  fileName?: string
  className?: string
  style?: React.CSSProperties
  alt?: string
  onLoad?: React.ReactEventHandler<HTMLImageElement>
  onError?: React.ReactEventHandler<HTMLImageElement>
  onClick?: React.MouseEventHandler<HTMLElement>
  draggable?: boolean
  loading?: 'lazy' | 'eager'
  decoding?: 'sync' | 'async' | 'auto'
}) {
  const { src, loading, error } = useHeicSafeSrc(originalSrc, fileName)

  if (loading) {
    return (
      <div
        className={className}
        style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', opacity: 1 }}
        onClick={onClick}
      >
        <Loader2 className="h-5 w-5 text-rose-500 animate-spin" />
      </div>
    )
  }

  if (error || !src) {
    return (
      <div
        className={className}
        style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e5e7eb', opacity: 1 }}
        onClick={onClick}
      >
        <AlertCircle className="h-5 w-5 text-gray-400" />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onLoad={onLoad}
      onError={onError}
      onClick={onClick}
      draggable={draggable}
      loading={imgLoading}
      decoding={decoding}
    />
  )
}

// ─── Exibição de fotos do Drive via proxy autenticado ─────────
// As URLs públicas do Drive (drive.google.com/thumbnail) são instáveis no
// WebKit/iOS: muitas vezes não carregam no <img> (rate-limit/redirect/cookie)
// e ficam pretas silenciosamente. Aqui baixamos os bytes pelo /photo-proxy
// (mesmo caminho confiável já usado por download/áudio/rotação), detectamos
// HEIC pelos bytes e convertemos quando necessário, servindo um blob: local.
const __driveSrcCache = new Map<string, string>()
const __driveSrcInflight = new Map<string, Promise<string>>()

async function __detectHeicFromBytes(blob: Blob): Promise<boolean> {
  try {
    const buf = await blob.slice(0, 12).arrayBuffer()
    const b = new Uint8Array(buf)
    // 'ftyp' em offset 4 + marca heic/heif/mif1/heix/hevc...
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase()
      return /hei|mif1|msf1|heic|heix|hevc|heim|heis|hevm|hevs/.test(brand)
    }
  } catch { /* ignora */ }
  return false
}

async function loadDriveImageSrc(driveFileId: string): Promise<string> {
  const cached = __driveSrcCache.get(driveFileId)
  if (cached) return cached
  const inflight = __driveSrcInflight.get(driveFileId)
  if (inflight) return inflight

  const promise = (async () => {
    let blob = await driveStorage.fetchPhotoBlob(driveFileId)
    if (await __detectHeicFromBytes(blob)) {
      const heic2any = (await import('heic2any')).default
      const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 })
      blob = (Array.isArray(result) ? result[0] : result) as Blob
    }
    const url = URL.createObjectURL(blob)
    __driveSrcCache.set(driveFileId, url)
    return url
  })()

  __driveSrcInflight.set(driveFileId, promise)
  try {
    return await promise
  } finally {
    __driveSrcInflight.delete(driveFileId)
  }
}

/**
 * Comprime uma foto no navegador ANTES do upload: redimensiona pro maior
 * lado não passar de `maxDim` e reencoda como JPEG na qualidade informada.
 * 100% client-side via Canvas API — sem dependência nova, sem round-trip
 * ao servidor. Ideia: foto de celular moderno (12MP+, 4-15MB) normalmente
 * não precisa de mais que ~2000px de lado pra IA ou visualização — isso
 * já reduz o arquivo em 70-90% na prática, sem perda visível de qualidade.
 *
 * Se o arquivo já for pequeno (abaixo de `skipBelowBytes`) devolve como
 * está — não vale a pena gastar CPU comprimindo o que já é leve. Se não
 * for uma imagem rasterizável pelo navegador (ex: HEIC, que Chrome/Firefox
 * não decodificam nativamente) ou a compressão falhar por qualquer motivo,
 * devolve o arquivo ORIGINAL sem quebrar o fluxo de upload — o backend
 * ainda tem suas próprias travas de tamanho como rede de segurança.
 */
async function compressImageFile(
  file: File,
  opts: { maxDim?: number; quality?: number; skipBelowBytes?: number } = {}
): Promise<File> {
  const { maxDim = 2000, quality = 0.85, skipBelowBytes = 1.5 * 1024 * 1024 } = opts
  if (file.size <= skipBelowBytes) return file
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file // não ajudou — mantém original

    const newName = (file.name.replace(/\.[a-zA-Z0-9]+$/, '') || 'foto') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } catch (e) {
    console.warn('[compressImageFile] falhou, usando arquivo original:', e)
    return file
  }
}

/**
 * Resolve a URL de exibição de uma foto:
 *  - blob:/data: → usa direto (ex.: já convertido/rotacionado localmente)
 *  - drive_file_id → baixa pelo proxy (confiável no mobile) + HEIC se preciso
 *  - senão (legado storage_path) → cai no comportamento antigo (URL pública)
 */
function useDrivePhotoSrc(photo?: { url?: string; photo_name?: string; drive_file_id?: string; _blobUrl?: string }) {
  const directLocal =
    photo?._blobUrl ||
    (photo?.url && (photo.url.startsWith('blob:') || photo.url.startsWith('data:')) ? photo.url : undefined)

  const driveId = !directLocal ? photo?.drive_file_id : undefined

  // Legado: sem drive_file_id e sem blob local → usa o hook antigo (URL pública)
  const legacy = useHeicSafeSrc(
    !directLocal && !driveId ? photo?.url : undefined,
    photo?.photo_name
  )

  const [state, setState] = useState<{ src?: string; loading: boolean; error: boolean }>(() => {
    if (directLocal) return { src: directLocal, loading: false, error: false }
    if (driveId && __driveSrcCache.has(driveId)) return { src: __driveSrcCache.get(driveId), loading: false, error: false }
    if (driveId) return { src: undefined, loading: true, error: false }
    return { src: legacy.src, loading: legacy.loading, error: legacy.error }
  })

  useEffect(() => {
    if (directLocal) { setState({ src: directLocal, loading: false, error: false }); return }
    if (!driveId) { setState({ src: legacy.src, loading: legacy.loading, error: legacy.error }); return }

    const cached = __driveSrcCache.get(driveId)
    if (cached) { setState({ src: cached, loading: false, error: false }); return }

    setState({ src: undefined, loading: true, error: false })
    let cancelled = false
    loadDriveImageSrc(driveId)
      .then(url => { if (!cancelled) setState({ src: url, loading: false, error: false }) })
      .catch(err => {
        console.error('[useDrivePhotoSrc] falha ao carregar foto do Drive:', driveId, err)
        if (!cancelled) setState({ src: undefined, loading: false, error: true })
      })
    return () => { cancelled = true }
  }, [directLocal, driveId, legacy.src, legacy.loading, legacy.error])

  return state
}

/**
 * <img> resiliente para fotos do Drive. Substitui SafeImage/URL pública nas
 * miniaturas que têm drive_file_id, garantindo carregamento no mobile.
 */
function DrivePhotoImg({
  photo, className, style, alt, onLoad, onError, decoding,
}: {
  photo: { url?: string; photo_name?: string; drive_file_id?: string; _blobUrl?: string }
  className?: string
  style?: React.CSSProperties
  alt?: string
  onLoad?: React.ReactEventHandler<HTMLImageElement>
  onError?: React.ReactEventHandler<HTMLImageElement>
  decoding?: 'sync' | 'async' | 'auto'
}) {
  const { src, loading, error } = useDrivePhotoSrc(photo)

  if (loading) {
    return (
      <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
        <Loader2 className="h-5 w-5 text-rose-500 animate-spin" />
      </div>
    )
  }
  if (error || !src) {
    return (
      <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e5e7eb' }}>
        <AlertCircle className="h-5 w-5 text-gray-400" />
      </div>
    )
  }
  return (
    <img src={src} alt={alt} className={className} style={style} onLoad={onLoad} onError={onError} decoding={decoding} draggable={false} />
  )
}

// ─── Re-encode de áudio gravado → WAV ──────────────────────────────────────
// O WebM do MediaRecorder não escreve o elemento Duration no header. Um blob:
// WebM sem duração não toca no Chrome do Android (no desktop e no Safari toca).
// Aqui decodificamos via Web Audio e remontamos um WAV (PCM 16-bit), que tem
// duração correta e toca em qualquer navegador. Reamostramos pra `targetRate`
// mono (16 kHz é ótimo pra voz) pra não inflar o tamanho do arquivo.
async function reencodeToWav(blob: Blob, targetRate = 16000): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer()
  const AC: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext
  const decodeCtx = new AC()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0))
  } finally {
    decodeCtx.close()
  }

  // Reamostra + faz downmix pra mono usando OfflineAudioContext
  const OAC: typeof OfflineAudioContext =
    window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate))
  const offline = new OAC(1, frames, targetRate)
  const node = offline.createBufferSource()
  node.buffer = decoded
  node.connect(offline.destination)
  node.start()
  const rendered = await offline.startRendering()
  const samples = rendered.getChannelData(0)

  // Float32 [-1,1] → PCM Int16 + cabeçalho WAV
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const out = new ArrayBuffer(44 + dataSize)
  const dv = new DataView(out)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF');  dv.setUint32(4, 36 + dataSize, true);  writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); dv.setUint32(16, 16, true);            dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true);             dv.setUint32(24, targetRate, true)
  dv.setUint32(28, targetRate * bytesPerSample, true)
  dv.setUint16(32, bytesPerSample, true); dv.setUint16(34, 16, true)
  writeStr(36, 'data'); dv.setUint32(40, dataSize, true)
  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([out], { type: 'audio/wav' })
}

// ─── DriveAudioPlayer ─────────────────────────────────────────────────────────
// Para arquivos do Drive no painel admin: busca via photo-proxy (autenticado)
// e cria um blob: URL local — evita CORS e o problema de range requests do Drive.
function DriveAudioPlayer({ driveFileId, className }: { driveFileId: string; className?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState(false)

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) throw new Error('sem sessão')
        const base = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined
          ?? supabase.supabaseUrl as string
        const res = await fetch(
          `${base}/functions/v1/drive/photo-proxy?id=${encodeURIComponent(driveFileId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) throw new Error(`proxy ${res.status}`)
        const blob = await res.blob()
        if (cancelled) return
        created = URL.createObjectURL(blob)
        setBlobUrl(created)
      } catch {
        if (!cancelled) setLoadErr(true)
      }
    })()
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [driveFileId])

  if (loadErr) return (
    <p className="text-xs text-red-400 py-2 flex items-center gap-1">
      <AlertCircle className="h-3.5 w-3.5" /> Erro ao carregar áudio
    </p>
  )
  if (!blobUrl) return (
    <div className="flex items-center gap-2 py-2">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
      <span className="text-xs text-gray-400">Carregando áudio…</span>
    </div>
  )
  return <audio src={blobUrl} controls preload="auto" className={className ?? 'w-full'} />
}

// ─── Status Config ────────────────────────────────────────────────────────
const STATUSES: Record<string, {
  label: string; short: string; color: string; bg: string; textColor: string
  tailwindColor: string; tailwindBg: string
}> = {
  awaiting_contract: {
    label: 'Aguardando Contrato', short: 'Contrato',
    color: '#f59e0b', bg: '#fef3c7', textColor: '#92400e',
    tailwindColor: 'bg-amber-100 text-amber-700', tailwindBg: 'bg-amber-50',
  },
  awaiting_form: {
    label: 'Aguardando Formulário', short: 'Formulário',
    color: '#3b82f6', bg: '#dbeafe', textColor: '#1e40af',
    tailwindColor: 'bg-blue-100 text-blue-700', tailwindBg: 'bg-blue-50',
  },
  awaiting_photos: {
    label: 'Aguardando Fotos', short: 'Fotos',
    color: '#a855f7', bg: '#f3e8ff', textColor: '#6b21a8',
    tailwindColor: 'bg-purple-100 text-purple-700', tailwindBg: 'bg-purple-50',
  },
  // fotos recebidas, aguardando aprovação da admin (fotos + formulário)
  photos_submitted: {
    label: 'Fotos Enviadas', short: 'Fotos Enviadas',
    color: '#ec4899', bg: '#fce7f3', textColor: '#9d174d',
    tailwindColor: 'bg-pink-100 text-pink-700', tailwindBg: 'bg-pink-50',
  },
  in_analysis: {
    label: 'Análise em Andamento', short: 'Análise',
    color: '#f97316', bg: '#ffedd5', textColor: '#9a3412',
    tailwindColor: 'bg-orange-100 text-orange-700', tailwindBg: 'bg-orange-50',
  },
  preparing_materials: {
    label: 'Fazer Dossiê', short: 'Dossiê',
    color: '#0d9488', bg: '#ccfbf1', textColor: '#134e4a',
    tailwindColor: 'bg-teal-100 text-teal-700', tailwindBg: 'bg-teal-50',
  },
  validating_materials: {
    label: 'Validar Dossiê', short: 'Validar Dossiê',
    color: '#6366f1', bg: '#e0e7ff', textColor: '#3730a3',
    tailwindColor: 'bg-indigo-100 text-indigo-700', tailwindBg: 'bg-indigo-50',
  },
  sending_dossier: {
    label: 'Enviar Dossiê', short: 'Enviar Dossiê',
    color: '#0ea5e9', bg: '#e0f2fe', textColor: '#075985',
    tailwindColor: 'bg-sky-100 text-sky-700', tailwindBg: 'bg-sky-50',
  },
  awaiting_ai_photo: {
    label: 'Aguardando Foto IA', short: 'Foto IA',
    color: '#a855f7', bg: '#f3e8ff', textColor: '#6b21a8',
    tailwindColor: 'bg-purple-100 text-purple-700', tailwindBg: 'bg-purple-50',
  },
  simulating: {
    label: 'Simulações', short: 'Simulações',
    color: '#8b5cf6', bg: '#ede9fe', textColor: '#5b21b6',
    tailwindColor: 'bg-violet-100 text-violet-700', tailwindBg: 'bg-violet-50',
  },
  making_capillary_dossier: {
    label: 'Fazer Dossiê Capilar', short: 'Dossiê Capilar',
    color: '#10b981', bg: '#d1fae5', textColor: '#065f46',
    tailwindColor: 'bg-emerald-100 text-emerald-700', tailwindBg: 'bg-emerald-50',
  },
  validating_capillary_dossier: {
    label: 'Validar Dossiê Capilar', short: 'Validar Capilar',
    color: '#d946ef', bg: '#fae8ff', textColor: '#86198f',
    tailwindColor: 'bg-fuchsia-100 text-fuchsia-700', tailwindBg: 'bg-fuchsia-50',
  },
  sending_capillary_dossier: {
    label: 'Enviar Dossiê Capilar', short: 'Enviar Capilar',
    color: '#06b6d4', bg: '#cffafe', textColor: '#155e75',
    tailwindColor: 'bg-cyan-100 text-cyan-700', tailwindBg: 'bg-cyan-50',
  },
  completed: {
    label: 'Concluído', short: 'Concluído',
    color: '#22c55e', bg: '#dcfce7', textColor: '#166534',
    tailwindColor: 'bg-green-100 text-green-700', tailwindBg: 'bg-green-50',
  },
}
// photos_submitted is between awaiting_photos and in_analysis
const COL_ORDER = ['awaiting_contract', 'awaiting_form', 'awaiting_photos', 'photos_submitted', 'in_analysis', 'preparing_materials', 'validating_materials', 'sending_dossier', 'awaiting_ai_photo', 'simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier', 'completed']

/** Classifica um arquivo de resultado pelo nome — usado pra separar PDFs,
 *  áudios e fotos na aba Resultado e no ClientPortal. */
function getResultFileKind(fileName: string): 'pdf' | 'audio' | 'image' | 'other' {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['mp3','wav','ogg','webm','m4a','aac','opus','oga','flac','mpga','mpeg'].includes(ext)) return 'audio'
  if (['jpg','jpeg','png','webp','heic','heif','gif','bmp'].includes(ext)) return 'image'
  return 'other'
}

/** mm:ss a partir de duração em milissegundos */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/** Retorna o nome de exibição: customizado > short padrão */
function getColLabel(
  statusKey: string,
  customLabels: Record<string, string>,
  field: 'short' | 'label' = 'short'
): string {
  return customLabels[statusKey] ?? STATUSES[statusKey]?.[field] ?? statusKey
}

// ─── Avatar Helpers ───────────────────────────────────────────────────────
const AVATAR_COLORS: [string, string][] = [
  ['#fce7f3', '#be185d'], ['#ede9fe', '#6d28d9'], ['#dbeafe', '#1d4ed8'],
  ['#dcfce7', '#15803d'], ['#fef3c7', '#b45309'], ['#ffedd5', '#c2410c'],
]
function getAvatarColor(name: string): [string, string] {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}
function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// ─── Deadline Info ────────────────────────────────────────────────────────
interface DeadlineData {
  deadline_date: string
  photos_sent_at: string
  no_deadline?: boolean
}
interface DeadlineInfo {
  label: string
  dateFormatted: string
  urgency: 'danger' | 'warning' | 'ok'
  color: string
  bgColor: string
  textColor: string
}
function getDeadlineInfo(client: Client, deadline?: DeadlineData | null): DeadlineInfo | null {
  if (deadline?.no_deadline || !deadline?.deadline_date || client.status === 'completed' || client.status === 'photos_submitted' || client.status === 'awaiting_ai_photo') return null
 
  const today = new Date(); today.setHours(0, 0, 0, 0)
  // CORRIGIDO: parseLocalDate evita bug de timezone (new Date("YYYY-MM-DD") = UTC = dia errado no Brasil)
  const dl = parseLocalDate(deadline.deadline_date)
  const days = Math.round((dl.getTime() - today.getTime()) / 86400000)
  const dateFormatted = dl.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
 
  if (days < 0) return { label: `${Math.abs(days)}d atrasado`, dateFormatted, urgency: 'danger', color: '#ef4444', bgColor: '#fee2e2', textColor: '#991b1b' }
  if (days === 0) return { label: 'Vence hoje', dateFormatted, urgency: 'danger', color: '#ef4444', bgColor: '#fee2e2', textColor: '#991b1b' }
  if (days <= 2) return { label: `${days}d restantes`, dateFormatted, urgency: 'warning', color: '#f59e0b', bgColor: '#fef3c7', textColor: '#92400e' }
  return { label: `${days}d restantes`, dateFormatted, urgency: 'ok', color: '#6b7280', bgColor: '#f3f4f6', textColor: '#4b5563' }
}

/**
 * Prazo de expiração do LINK da análise (feature de plano com
 * `analysis_expiration_days`) — diferente de getDeadlineInfo, que é sobre o
 * prazo de ENVIO DE FOTOS.
 *
 * `client.analysis_expires_at` só fica preenchido em 2 momentos: assinatura
 * de contrato NOVA (dali pra frente), ou quando a PRÓPRIA cliente abre o
 * portal (cálculo retroativo lazy, ver check_client_expiration no banco).
 * O painel admin nunca dispara nenhum dos dois — então pra clientes
 * vigentes que assinaram antes do plano ganhar prazo, essa coluna fica NULL
 * até elas acessarem o link. Pra não deixar o card "cego" até lá, calculamos
 * aqui também: contrato assinado (`client_contracts.signed_at`, embutido no
 * getClients()) + `plan.analysis_expiration_days`. É só uma prévia pra
 * exibição — quem decide de verdade (e arquiva) continua sendo a RPC.
 */
/**
 * Prazo de expiração do LINK da análise (feature de plano com
 * `analysis_expiration_days`) — diferente de getDeadlineInfo, que é sobre o
 * prazo de ENVIO DE FOTOS.
 *
 * Só faz sentido mostrar enquanto a AÇÃO pendente é da cliente: depois que
 * ela envia as fotos (`photos_submitted` em diante), a bola passa pro
 * estúdio — a contagem não tem mais relação com o que falta fazer, então
 * o badge some a partir daí (mesmo que `analysis_expires_at` continue no
 * futuro; simplesmente deixa de ser relevante mostrar).
 *
 * `client.analysis_expires_at` só fica preenchido em 2 momentos: assinatura
 * de contrato NOVA (dali pra frente), ou quando a PRÓPRIA cliente abre o
 * portal (cálculo retroativo lazy, ver check_client_expiration no banco).
 * O painel admin nunca dispara nenhum dos dois — então pra clientes
 * vigentes que assinaram antes do plano ganhar prazo, essa coluna fica NULL
 * até elas acessarem o link. Pra não deixar o card "cego" até lá, calculamos
 * aqui também: contrato assinado (`signedAt`, vindo de
 * getContractSignedDates()) + `plan.analysis_expiration_days`. É só uma
 * prévia pra exibição — quem decide de verdade (e arquiva) continua sendo
 * a RPC.
 */
function getExpirationInfo(client: Client, signedAt?: string | null): { label: string; bgColor: string; textColor: string; urgent: boolean } | null {
  if (client.status !== 'awaiting_form' && client.status !== 'awaiting_photos') return null

  let expiresAtRaw: string | null = client.analysis_expires_at ?? null

  if (!expiresAtRaw) {
    const plan = (client as any).plan as Plan | undefined
    const days = plan?.analysis_expiration_days
    if (!days || !signedAt) return null // plano sem prazo, ou contrato ainda não assinado
    expiresAtRaw = new Date(new Date(signedAt).getTime() + days * 86400000).toISOString()
  }

  const diffMs = new Date(expiresAtRaw).getTime() - Date.now()
  const days = Math.ceil(diffMs / 86400000)
  if (days < 0) return { label: 'Prazo expirado', bgColor: '#fee2e2', textColor: '#991b1b', urgent: true }
  if (days === 0) return { label: 'Expira hoje', bgColor: '#fee2e2', textColor: '#991b1b', urgent: true }
  if (days <= 3) return { label: `Expira em ${days}d`, bgColor: '#fef3c7', textColor: '#92400e', urgent: true }
  return { label: `Expira em ${days}d`, bgColor: '#f3f4f6', textColor: '#4b5563', urgent: false }
}

// ─── Tiny UI ──────────────────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = 'primary', size = 'md', loading = false, disabled = false, className = '' }: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
    green: 'bg-green-500 text-white hover:bg-green-600',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100',
    pink: 'bg-pink-500 text-white hover:bg-pink-600',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${v[variant]} ${s[size]} ${className}`}>
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ─── Kanban Card ──────────────────────────────────────────────────────────
/**
 * Monta o link do wa.me a partir do telefone salvo — cobrindo os 2 formatos
 * que existem no banco:
 *  - NOVO (a partir da melhoria de telefone internacional): sempre E.164,
 *    já com "+" e código do país (ex: "+5511999998888"). Só remove os
 *    caracteres não-numéricos, o código do país já vem embutido.
 *  - ANTIGO (cadastros feitos antes dessa melhoria): sem "+", só DDD+número
 *    (ex: "11999998888"). Mantém a suposição de Brasil que o link já fazia
 *    — sem isso, essas clientes antigas ficariam com o link quebrado.
 */
function whatsappHref(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const isE164 = phone.trim().startsWith('+')
  return `https://wa.me/${isE164 ? digits : `55${digits}`}`
}

// ─── Coloração Pessoal tag style ─────────────────────────────────────────────
function getSeasonTagStyle(value: string): { bg: string; color: string; border: string } {
  const v = value.toLowerCase()
  if (v.includes('outono'))    return { bg: 'rgba(180,83,9,0.12)',   color: '#92400e', border: 'rgba(180,83,9,0.3)'   }
  if (v.includes('primavera')) return { bg: 'rgba(234,88,12,0.12)',  color: '#9a3412', border: 'rgba(234,88,12,0.3)'  }
  if (v.includes('verão'))     return { bg: 'rgba(190,18,60,0.10)',  color: '#9f1239', border: 'rgba(190,18,60,0.28)' }
  if (v.includes('inverno'))   return { bg: 'rgba(67,56,202,0.10)', color: '#3730a3', border: 'rgba(67,56,202,0.28)' }
  return { bg: 'rgba(107,114,128,0.10)', color: '#374151', border: 'rgba(107,114,128,0.25)' }
}

// ─── QuickMoveButton ─────────────────────────────────────────────────────────
function QuickMoveButton({ currentStatus, theme: t, onMove, columnLabels = {} }: {
  currentStatus: string; theme: Theme; onMove: (targetStatus: string) => void
  columnLabels?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const currentIdx = COL_ORDER.indexOf(currentStatus)
  const nextStatus = currentIdx < COL_ORDER.length - 1 ? COL_ORDER[currentIdx + 1] : null
  const nextCfg = nextStatus ? STATUSES[nextStatus] : null

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        (!popRef.current || !popRef.current.contains(e.target as Node))
      ) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      // Estimativa de altura do popover (header + próxima etapa + lista + paddings)
      const estHeight =
        30 +                                   // header "MOVER ETAPA"
        (nextStatus ? 60 : 0) +                // bloco "Próxima etapa"
        24 +                                   // label "Todas as etapas"
        Math.min(COL_ORDER.length * 32, 220) + // lista (limitada por maxHeight: 220)
        14                                     // paddings + espaço inferior
      const margin = 8
      const spaceBelow = window.innerHeight - rect.bottom - margin
      const spaceAbove = rect.top - margin
      // Abre para cima se não couber abaixo E houver mais espaço acima
      const openUp = spaceBelow < estHeight && spaceAbove > spaceBelow
      const top = openUp
        ? Math.max(margin, rect.top - estHeight - 4)
        : rect.bottom + 4
      const left = Math.max(margin, Math.min(rect.right - 218, window.innerWidth - 226))
      setPopPos({ top, left })
    }
    setOpen(true)
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title="Avançar etapa"
        style={{
          background: 'transparent',
          border: `1px solid ${open ? 'rgba(99,102,241,0.45)' : 'rgba(99,102,241,0.22)'}`,
          cursor: 'pointer',
          padding: '3px 10px',
          color: open ? '#4338ca' : 'rgba(79,70,229,0.65)',
          borderRadius: 20,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          fontSize: 11, fontWeight: 500, letterSpacing: 0.1,
          transition: 'all 0.15s',
          lineHeight: 1,
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'rgba(99,102,241,0.08)'
          el.style.borderColor = 'rgba(99,102,241,0.45)'
          el.style.color = '#4338ca'
        }}
        onMouseLeave={e => {
          if (!open) {
            const el = e.currentTarget as HTMLButtonElement
            el.style.background = 'transparent'
            el.style.borderColor = 'rgba(99,102,241,0.22)'
            el.style.color = 'rgba(79,70,229,0.65)'
          }
        }}
      >
        Avançar <ChevronRight size={10} strokeWidth={2} />
      </button>

      {open && popPos && (
        <div
          ref={popRef}
          style={{
            position: 'fixed', top: popPos.top, left: popPos.left,
            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,0.20)', zIndex: 9999, width: 218,
          }}
        >
          {/* Header */}
          <div style={{ padding: '8px 12px 6px', borderBottom: `1px solid ${t.border}` }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Mover etapa
            </p>
          </div>

          {/* Próxima etapa — destaque */}
          {nextStatus && nextCfg && (
            <div style={{ padding: '8px 10px 4px' }}>
              <p style={{ margin: '0 0 4px 2px', fontSize: 10, fontWeight: 600, color: t.text3 }}>⚡ Próxima etapa</p>
              <button
                onClick={() => { onMove(nextStatus); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: `${nextCfg.color}18`, color: nextCfg.textColor,
                  fontSize: 12, fontWeight: 700, textAlign: 'left', transition: 'filter 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(0.93)'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = 'none'}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: nextCfg.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{getColLabel(nextStatus!, columnLabels, 'label')}</span>
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          {/* Lista completa */}
          <div style={{ padding: '4px 10px', borderTop: nextStatus ? `1px solid ${t.border}` : 'none', marginTop: nextStatus ? 4 : 0 }}>
            <p style={{ margin: '6px 0 4px 2px', fontSize: 10, fontWeight: 600, color: t.text3 }}>Todas as etapas</p>
            <div style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 2 }}>
              {COL_ORDER.map(statusKey => {
                const cfg = STATUSES[statusKey]
                const isCurrent = statusKey === currentStatus
                const isNext = statusKey === nextStatus
                return (
                  <button
                    key={statusKey}
                    disabled={isCurrent}
                    onClick={() => { onMove(statusKey); setOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '7px 8px', borderRadius: 6, border: 'none',
                      cursor: isCurrent ? 'default' : 'pointer',
                      background: isCurrent ? t.surface2 : 'none',
                      color: isCurrent ? t.text3 : t.text2,
                      fontSize: 12, fontWeight: isCurrent ? 700 : 400, textAlign: 'left',
                      opacity: isCurrent ? 0.6 : 1, transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                    onMouseLeave={e => { if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                  >
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{getColLabel(statusKey, columnLabels, 'label')}</span>
                    {isCurrent && <span style={{ fontSize: 10, color: t.text3 }}>atual</span>}
                    {isNext && !isCurrent && <span style={{ fontSize: 10, color: cfg.color, fontWeight: 600 }}>próxima</span>}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ height: 6 }} />
        </div>
      )}
    </div>
  )
}

function KanbanCard({
  client, deadline, theme: t, onView, onArchive, onDelete, onStar, compact, starred,
  onDragStart, isDragging, onQuickMove, columnLabels = {}, hasConditionalObs,
  hasAiPhotoPending, contractSignedAt,
}: {
  client: Client; deadline?: DeadlineData | null; theme: Theme
  onView: () => void; onArchive: () => void; onDelete: () => void; onStar: () => void
  compact: boolean; starred: boolean
  onDragStart?: () => void
  isDragging?: boolean
  onQuickMove?: (targetStatus: string) => void
  columnLabels?: Record<string, string>
  hasConditionalObs?: boolean
  hasAiPhotoPending?: boolean
  /** signed_at do contrato desta cliente — usado só pro fallback do badge de expiração. */
  contractSignedAt?: string | null
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuPopRef = useRef<HTMLDivElement>(null)
  // Tema serve a paleta via `t` (prop), mas precisamos saber se é claro/escuro
  // para escolher o tom certo do destaque "foto IA pendente" — violeta clara
  // some no dark, então no escuro usamos violeta forte com leve fundo.
  const { isDark } = useTheme()
  const dl = getDeadlineInfo(client, deadline)
  const expInfo = getExpirationInfo(client, contractSignedAt)
  const [bgColor, fgColor] = getAvatarColor(client.full_name)
  const needsReview = client.status === 'photos_submitted'
  const aiTags: { templateId: string; name: string; value: string }[] = (client as any).ai_info_tags || []
  const personalColorTag = aiTags.find(tag => tag.name.toLowerCase().includes('coloração pessoal') || tag.name.toLowerCase().includes('coloracao pessoal'))
  const personalColor = personalColorTag?.value?.trim() || null
  const planName: string | null = (client as any).plan?.name ?? null

  // Cor do destaque do card "Foto IA pendente" — laranja vibrante para chamar
  // atenção (distinto do rosa de "aguardando aprovação", vermelho de "prazo"
  // e amarelo de "warning"). Combina com o ✨ que enfatiza algo a fazer.
  const aiBorderColor  = isDark ? '#f97316' : '#fb923c'
  const aiCardBg       = isDark
    ? 'color-mix(in srgb, #f97316 14%, ' + t.cardBg + ')'
    : 'color-mix(in srgb, #f97316 7%, '  + t.cardBg + ')'
  const aiBadgeBg      = isDark ? 'rgba(249,115,22,0.25)' : '#ffedd5'
  const aiBadgeColor   = isDark ? '#fdba74' : '#c2410c'

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        (!menuPopRef.current || !menuPopRef.current.contains(e.target as Node))
      ) setMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Border color based on urgency / review state
  const borderColor = dl?.urgency === 'danger'
    ? '#fca5a5'
    : dl?.urgency === 'warning'
      ? '#fcd34d'
      : needsReview
        ? '#fbcfe8'
        : hasAiPhotoPending
          ? aiBorderColor
          : t.cardBorder

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      style={{
        background: hasAiPhotoPending ? aiCardBg : t.cardBg,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        padding: compact ? '9px 12px' : '11px 13px',
        marginBottom: 8,
        cursor: isDragging ? 'grabbing' : 'grab',
        position: 'relative',
        opacity: isDragging ? 0.45 : 1,
        transition: 'box-shadow 0.15s, opacity 0.15s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)' }}
      onClick={onView}
    >
      {/* ── Row 1: Name + Star + Menu ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <p style={{
              margin: 0, fontSize: compact ? 12 : 13, fontWeight: 700, color: t.text,
              lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {client.full_name}
            </p>
            {starred && <span style={{ fontSize: 11, color: '#f59e0b', flexShrink: 0, lineHeight: 1 }}>★</span>}
            {hasConditionalObs && (
              <span title="Possui observação condicional no formulário" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                <Bell size={10} strokeWidth={2} style={{ color: '#f97316', opacity: 0.75 }} />
              </span>
            )}
          </div>

          {/* Plan — always visible, more prominent */}
          {planName && (
            <p style={{
              margin: '3px 0 0', fontSize: 11, fontWeight: 500,
              color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {planName}
            </p>
          )}
        </div>

        {/* Context menu */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={e => {
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
              setMenuPos({ top: rect.bottom + 4, left: Math.min(rect.right - 160, window.innerWidth - 168) })
              setMenuOpen(v => !v)
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: t.text3, borderRadius: 4, display: 'flex', alignItems: 'center', opacity: 0.5 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'; (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && menuPos && (
            <div ref={menuPopRef} style={{
              position: 'fixed', top: menuPos.top, left: menuPos.left,
              background: t.surface,
              border: `1px solid ${t.border}`, borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 9999, minWidth: 160, overflow: 'hidden',
            }}>
              {[
                { icon: Eye,     label: 'Abrir cliente',                  action: onView,    color: t.text    },
                { icon: Star,    label: starred ? 'Remover estrela' : 'Destacar', action: onStar, color: '#f59e0b' },
                { icon: Archive, label: 'Arquivar',                       action: onArchive, color: '#6b7280' },
                { icon: Trash2,  label: 'Excluir',                        action: onDelete,  color: '#ef4444' },
              ].map(({ icon: Icon, label, action, color }) => (
                <button key={label} onClick={() => { action(); setMenuOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color, textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Deadline (days remaining + date) ── */}
      {dl && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Urgency badge: "7d restantes" */}
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
            background: dl.bgColor, color: dl.textColor,
            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
          }}>
            <Clock size={10} strokeWidth={2.5} /> {dl.label}
          </span>
          {/* Actual date: "01/01/2026" */}
          <span style={{ fontSize: 11, color: t.text3, fontWeight: 500, whiteSpace: 'nowrap' }}>
            {dl.dateFormatted}
          </span>
        </div>
      )}

      {/* ── Row 3: Tags (always shown regardless of stage) ── */}
      {(personalColor || needsReview || hasAiPhotoPending) && (
        <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {needsReview && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: '#fce7f3', color: '#9d174d', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              📸 Aguardando aprovação
            </span>
          )}
          {hasAiPhotoPending && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: aiBadgeBg, color: aiBadgeColor, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              ✨ Foto IA p/ revisar
            </span>
          )}
          {personalColor && (() => {
            const s = getSeasonTagStyle(personalColor)
            return (
              <span style={{
                fontSize: 10, padding: '2px 9px', borderRadius: 20, fontWeight: 700,
                background: s.bg, color: s.color, border: `1px solid ${s.border}`,
                letterSpacing: 0.3, display: 'inline-flex', alignItems: 'center', gap: 3,
              }}>
                🎨 {personalColor}
              </span>
            )
          })()}
        </div>
      )}

      {/* ── Row 4: Expiration (sutil, início da linha) + Quick-move button (fim da linha) ── */}
      {(expInfo || onQuickMove) && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }} onClick={e => e.stopPropagation()}>
          {expInfo ? (
            <span title="Prazo pra concluir a análise, conforme o contrato" style={{
              fontSize: 10, color: expInfo.urgent ? '#b45309' : t.text3, fontWeight: expInfo.urgent ? 600 : 500,
              display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
            }}>
              <Hourglass size={9} strokeWidth={2} /> {expInfo.label}
            </span>
          ) : <span />}
          {onQuickMove && (
            <QuickMoveButton
              currentStatus={client.status}
              theme={t}
              onMove={onQuickMove}
              columnLabels={columnLabels}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Kanban Column ────────────────────────────────────────────────────────
function KanbanColumn({
  statusKey, clients, deadlines, starredIds, theme: t,
  onView, onArchive, onDelete, onStar, collapsed, onToggleCollapse,
  onDragStart, onDrop, draggingClientId,
  displayLabel,
  onRenameLabel,
  onQuickMove,
  columnLabels = {},
  formObsIds,
  aiPhotoPendingIds,
  sortOrder = 'recent',
  onSortChange,
  forceCompact,
  contractSignedAt,
}: {
  statusKey: string; clients: Client[]; deadlines: Record<string, DeadlineData>
  starredIds: Set<string>; theme: Theme
  onView: (id: string) => void; onArchive: (id: string) => void
  onDelete: (id: string) => void; onStar: (id: string) => void
  collapsed: boolean; onToggleCollapse: () => void
  onDragStart?: (clientId: string) => void
  onDrop?: (targetStatus: string) => void
  draggingClientId?: string | null
  displayLabel: string
  onRenameLabel: (newName: string) => Promise<void>
  onQuickMove?: (clientId: string, targetStatus: string) => void
  columnLabels?: Record<string, string>
  formObsIds?: Set<string>
  aiPhotoPendingIds?: Set<string>
  sortOrder?: string
  onSortChange?: (sort: string) => void
  forceCompact?: boolean
  contractSignedAt?: Record<string, string>
}) {
  const obsIds: Set<string> = formObsIds ?? new Set<string>()
  const cfg = STATUSES[statusKey]
  const dangerCount = clients.filter(c => getDeadlineInfo(c, deadlines[c.id])?.urgency === 'danger').length
  const reviewCount = statusKey === 'photos_submitted' ? clients.length : 0
  // Quando esta coluna é a `awaiting_ai_photo`, conta quantos clientes já
  // enviaram a foto IA — eles aparecem com badge no card e a contagem é
  // mostrada no header da coluna recolhida.
  const aiReviewCount = statusKey === 'awaiting_ai_photo' && aiPhotoPendingIds
    ? clients.filter(c => aiPhotoPendingIds.has(c.id)).length
    : 0
  const [compactLocal, setCompactLocal] = useState(false)
  // forceCompact (from global toolbar) overrides the per-column toggle
  const compact = forceCompact !== undefined ? forceCompact : compactLocal
  const [isDragOver, setIsDragOver] = useState(false)
  const [sortDropOpen, setSortDropOpen] = useState(false)
  const sortBtnRef = useRef<HTMLButtonElement>(null)
  const sortDropRef = useRef<HTMLDivElement>(null)
  const [sortDropPos, setSortDropPos] = useState<{ top: number; left: number } | null>(null)

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortDropOpen) return
    const h = (e: MouseEvent) => {
      if (
        sortBtnRef.current && !sortBtnRef.current.contains(e.target as Node) &&
        sortDropRef.current && !sortDropRef.current.contains(e.target as Node)
      ) setSortDropOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [sortDropOpen])

  const SORT_OPTIONS = [
    { key: 'recent',    label: 'Recentes primeiro' },
    { key: 'oldest',    label: 'Antigas primeiro' },
    { key: 'name_asc',  label: 'Nome A→Z' },
    { key: 'name_desc', label: 'Nome Z→A' },
  ]

  // ── Inline label editing ──────────────────────────────────────────────
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const labelInputRef = useRef<HTMLInputElement>(null)

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setLabelDraft(displayLabel)
    setEditingLabel(true)
    setTimeout(() => labelInputRef.current?.select(), 30)
  }

  const commitEdit = async () => {
    const trimmed = labelDraft.trim()
    setEditingLabel(false)
    if (!trimmed || trimmed === displayLabel) return
    try {
      await onRenameLabel(trimmed)
    } catch {
      alert('Erro ao salvar nome da coluna')
    }
  }

  if (collapsed) {
    return (
      <div onClick={onToggleCollapse} title={`Expandir: ${cfg.label}`}
        style={{
          flexShrink: 0, width: 36, background: t.colBg, borderRadius: 12,
          border: `1px solid ${t.border}`, cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '12px 0 14px', gap: 8, transition: 'background 0.15s, border 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = t.surface2 }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = t.colBg }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: t.text2,
          writingMode: 'vertical-rl', textOrientation: 'mixed',
          letterSpacing: 1, transform: 'rotate(180deg)', userSelect: 'none',
          flex: 1,
        }}>
          {displayLabel}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: t.accent, background: t.accentLight, borderRadius: 20, padding: '2px 5px', minWidth: 20, textAlign: 'center' }}>
          {clients.length}
        </span>
        {dangerCount > 0 && <span style={{ fontSize: 9, color: '#ef4444' }}>⚠{dangerCount}</span>}
        {reviewCount > 0 && <span style={{ fontSize: 9, color: '#ec4899' }}>📸{reviewCount}</span>}
        {aiReviewCount > 0 && <span style={{ fontSize: 9, color: '#f97316' }}>✨{aiReviewCount}</span>}
        <ChevronRight size={12} color={t.text3} style={{ opacity: 0.6 }} />
      </div>
    )
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDragOver(true) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false) }}
      onDrop={e => { e.preventDefault(); setIsDragOver(false); onDrop?.(statusKey) }}
      style={{
        flexShrink: 0,
        width: compact ? 'clamp(190px, calc(100vw - 24px), 240px)' : 'clamp(240px, calc(100vw - 24px), 310px)',
        background: isDragOver ? cfg.bg : t.colBg,
        borderRadius: 12,
        border: isDragOver ? `2px dashed ${cfg.color}` : `1px solid ${t.border}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'background 0.15s, border 0.15s, width 0.2s',
      }}
    >
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${t.border}`, background: isDragOver ? cfg.bg : t.colBg, position: 'sticky', top: 0, zIndex: 2, transition: 'background 0.15s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
          {/* Nome da coluna — clique duplo ou ícone para editar */}
          {editingLabel ? (
            <>
              <input
                ref={labelInputRef}
                value={labelDraft}
                onChange={e => setLabelDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditingLabel(false)
                }}
                style={{
                  flex: 1, fontSize: 13, fontWeight: 700, color: t.text,
                  background: t.surface2, border: `1px solid ${t.accent}`,
                  borderRadius: 6, padding: '1px 6px', outline: 'none', minWidth: 0,
                }}
                autoFocus
                maxLength={40}
                onClick={e => e.stopPropagation()}
              />
              <button
                onClick={e => { e.stopPropagation(); commitEdit() }}
                title="Confirmar"
                style={{
                  background: t.accent, border: 'none', cursor: 'pointer',
                  padding: '2px 5px', color: '#fff', borderRadius: 5, display: 'flex',
                  alignItems: 'center', flexShrink: 0,
                }}
              >
                <Check size={11} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); setEditingLabel(false) }}
                title="Cancelar"
                style={{
                  background: 'none', border: `1px solid ${t.border}`, cursor: 'pointer',
                  padding: '2px 5px', color: t.text3, borderRadius: 5, display: 'flex',
                  alignItems: 'center', flexShrink: 0,
                }}
              >
                <X size={11} />
              </button>
            </>
          ) : (
            <span
              title="Duplo clique para renomear"
              onDoubleClick={startEdit}
              style={{ flex: 1, fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: 0.2, cursor: 'text' }}
            >
              {displayLabel}
            </span>
          )}
          {!editingLabel && (
            <button
              onClick={startEdit}
              title="Renomear coluna"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 2, color: t.text3, borderRadius: 4, display: 'flex', opacity: 0.5,
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
            >
              <Pencil size={11} />
            </button>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, color: t.accent, background: t.accentLight, borderRadius: 20, padding: '1px 7px', minWidth: 22, textAlign: 'center' }}>
            {clients.length}
          </span>
          {dangerCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', background: '#fee2e2', borderRadius: 20, padding: '1px 6px' }}>⚠{dangerCount}</span>
          )}
          {reviewCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#9d174d', background: '#fce7f3', borderRadius: 20, padding: '1px 6px' }}>📸 revisar</span>
          )}
          <button onClick={() => setCompactLocal(v => !v)} title={compact ? 'Modo normal' : 'Modo compacto'}
            style={{ background: compact ? t.accentLight : 'none', border: 'none', cursor: 'pointer', padding: 2, color: compact ? t.accent : t.text3, opacity: compact ? 1 : 0.7, borderRadius: 4, display: forceCompact ? 'none' : 'flex' }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
            onMouseLeave={e => { if (!compact) (e.currentTarget as HTMLButtonElement).style.opacity = '0.7' }}
          ><Layers size={13} /></button>

          {/* Sort button — only shown when onSortChange is provided (completed column) */}
          {onSortChange && (
            <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
              <button
                ref={sortBtnRef}
                onClick={e => {
                  e.stopPropagation()
                  if (sortDropOpen) { setSortDropOpen(false); return }
                  const rect = sortBtnRef.current?.getBoundingClientRect()
                  if (rect) {
                    const dropWidth = 196
                    const left = Math.max(8, Math.min(rect.right - dropWidth, window.innerWidth - dropWidth - 8))
                    setSortDropPos({ top: rect.bottom + 4, left })
                  }
                  setSortDropOpen(true)
                }}
                title="Ordenar por"
                style={{
                  background: sortDropOpen ? t.accentLight : 'none',
                  border: 'none', cursor: 'pointer', padding: 2,
                  color: sortDropOpen ? t.accent : t.text3,
                  opacity: sortDropOpen ? 1 : 0.7, borderRadius: 4, display: 'flex',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
                onMouseLeave={e => { if (!sortDropOpen) (e.currentTarget as HTMLButtonElement).style.opacity = '0.7' }}
              >
                {/* Sort icon: two lines with arrows */}
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1.5 3.5h10M1.5 6.5h7M1.5 9.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
              {sortDropOpen && sortDropPos && createPortal(
                <div
                  ref={sortDropRef}
                  style={{
                    position: 'fixed', top: sortDropPos.top, left: sortDropPos.left,
                    background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
                    boxShadow: '0 8px 28px rgba(0,0,0,0.18)', zIndex: 9999, width: 196,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ padding: '8px 12px 6px', borderBottom: `1px solid ${t.border}` }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.9 }}>
                      Ordenar por
                    </p>
                  </div>
                  <div style={{ padding: '4px 6px 6px' }}>
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => { onSortChange(opt.key); setSortDropOpen(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                          padding: '8px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                          background: sortOrder === opt.key ? t.accentLight : 'none',
                          color: sortOrder === opt.key ? t.accent : t.text2,
                          fontSize: 12, fontWeight: sortOrder === opt.key ? 700 : 400,
                          textAlign: 'left', transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { if (sortOrder !== opt.key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                        onMouseLeave={e => { if (sortOrder !== opt.key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                      >
                        {sortOrder === opt.key && (
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.accent, flexShrink: 0 }} />
                        )}
                        {sortOrder !== opt.key && (
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.border, flexShrink: 0 }} />
                        )}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>,
                document.body
              )}
            </div>
          )}

          <button onClick={onToggleCollapse} title="Recolher coluna"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: t.text3, opacity: 0.7, borderRadius: 4, display: 'flex' }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'}
          ><ChevronLeft size={14} /></button>
        </div>
      </div>

      <div data-col-scroller={statusKey} style={{ flex: 1, overflowY: 'auto', padding: '10px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)', minHeight: 0, WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        {clients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 12px', color: t.text3 }}>
            <p style={{ fontSize: 12, margin: 0 }}>
              {isDragOver ? 'Soltar aqui' : 'Nenhuma cliente'}
            </p>
          </div>
        ) : (
          clients.map(client => (
            <KanbanCard
              key={client.id} client={client} deadline={deadlines[client.id] || null}
              theme={t} compact={compact} starred={starredIds.has(client.id)}
              onDragStart={() => onDragStart?.(client.id)}
              isDragging={draggingClientId === client.id}
              onView={() => onView(client.id)} onArchive={() => onArchive(client.id)}
              onDelete={() => onDelete(client.id)} onStar={() => onStar(client.id)}
              onQuickMove={onQuickMove ? (targetStatus) => onQuickMove(client.id, targetStatus) : undefined}
              columnLabels={columnLabels}
              hasConditionalObs={formObsIds.has(client.id)}
              hasAiPhotoPending={!!aiPhotoPendingIds?.has(client.id) && client.status === 'awaiting_ai_photo'}
              contractSignedAt={contractSignedAt?.[client.id] || null}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Kanban Sidebar ───────────────────────────────────────────────────────
function KanbanSidebar({
  theme: t, clients, search, onSearch, filter, onFilter,
  sidebarOpen, onToggle, total, archivedCount, deadlines, columnLabels,
  aiPhotoPendingIds,
}: {
  theme: Theme; clients: Client[]; search: string; onSearch: (v: string) => void
  filter: string; onFilter: (v: string) => void; sidebarOpen: boolean; onToggle: () => void
  total: number; archivedCount: number; deadlines: Record<string, DeadlineData>
  columnLabels: Record<string, string>
  aiPhotoPendingIds?: Set<string>
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    COL_ORDER.forEach(k => { c[k] = clients.filter(cl => cl.status === k).length })
    return c
  }, [clients])

  const dangerCount = useMemo(() =>
    clients.filter(c => getDeadlineInfo(c, deadlines[c.id])?.urgency === 'danger').length,
    [clients, deadlines]
  )

  const inAnalysisCount = useMemo(() =>
    clients.filter(c => c.status === 'in_analysis').length,
    [clients]
  )

  // Fotos IA aguardando revisão: clientes em awaiting_ai_photo que JÁ enviaram a foto.
  const aiPhotoPendingCount = useMemo(() => {
    if (!aiPhotoPendingIds || aiPhotoPendingIds.size === 0) return 0
    return clients.filter(c => c.status === 'awaiting_ai_photo' && aiPhotoPendingIds.has(c.id)).length
  }, [clients, aiPhotoPendingIds])

  const navBtn = (key: string, label: string, count: number, color?: string, icon?: React.ReactNode) => (
    <button key={key} onClick={() => onFilter(key)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px',
        borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left',
        background: filter === key ? t.accentLight : 'none',
        color: filter === key ? t.accent : (color || t.text2),
        fontWeight: filter === key ? 600 : 400,
      }}
      onMouseEnter={e => { if (filter !== key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
      onMouseLeave={e => { if (filter !== key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      {icon && <span style={{ flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: filter === key ? t.accent : t.text3 }}>{count}</span>
    </button>
  )

  return (
    <>
      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 29, background: 'rgba(0,0,0,0.4)' }}
        className="sm:hidden" onClick={onToggle} />
      )}
      {/* Outer wrapper: controls the animated width.
          Never goes fully to 0 — stays at 13px so the toggle button
          (right: -13px, width: 26px) remains centered on the edge. */}
      <div style={{
        width: sidebarOpen ? 220 : 13, flexShrink: 0,
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
        position: 'relative', zIndex: 30,
      }}>
        {/* Inner panel: fills the outer width and clips content */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: 220,
          background: t.sidebar,
          borderRight: sidebarOpen ? `1px solid ${t.border}` : 'none',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          transition: 'opacity 0.2s',
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? 'auto' : 'none',
        }}>
        <div style={{ width: 220, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '4px 8px', flex: 1, overflowY: 'auto', paddingTop: 10 }}>
            {navBtn('all', 'Todas as clientes', total)}
            {navBtn('danger', 'Prazo crítico', dangerCount, '#ef4444', <AlertTriangle size={14} />)}
            {inAnalysisCount > 0 && navBtn('in_analysis', 'Em análise', inAnalysisCount, '#f97316', <SlidersHorizontal size={14} />)}
            {navBtn('photos_submitted', 'Aguardando revisão', counts['photos_submitted'] || 0, '#9d174d', <Camera size={14} />)}
            {aiPhotoPendingCount > 0 && navBtn('awaiting_ai_photo', 'Foto IA p/ revisar', aiPhotoPendingCount, '#c2410c', <Wand2 size={14} />)}
            {navBtn('preparing_materials', 'Preparando materiais', counts['preparing_materials'] || 0, '#0d9488', <Layers size={14} />)}

            <div style={{ borderTop: `1px solid ${t.border}`, margin: '8px 0', padding: '8px 0 4px' }}>
              <p style={{ margin: '0 0 4px 10px', fontSize: 10, fontWeight: 700, color: t.text3, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Por status</p>
              {COL_ORDER.map(key => {
                const cfg = STATUSES[key]
                return (
                  <button key={key} onClick={() => onFilter(key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px',
                      borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, textAlign: 'left',
                      background: filter === key ? t.accentLight : 'none',
                      color: filter === key ? t.accent : t.text2,
                      fontWeight: filter === key ? 600 : 400,
                    }}
                    onMouseEnter={e => { if (filter !== key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                    onMouseLeave={e => { if (filter !== key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{getColLabel(key, columnLabels)}</span>
                    <span style={{ fontSize: 11, color: t.text3 }}>{counts[key]}</span>
                  </button>
                )
              })}
            </div>

            <div style={{ borderTop: `1px solid ${t.border}`, margin: '4px 0', paddingTop: 8 }}>
              <button onClick={() => onFilter('archived')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px',
                  borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left',
                  background: filter === 'archived' ? t.accentLight : 'none',
                  color: filter === 'archived' ? t.accent : t.text2,
                  fontWeight: filter === 'archived' ? 600 : 400,
                }}
                onMouseEnter={e => { if (filter !== 'archived') (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                onMouseLeave={e => { if (filter !== 'archived') (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
              >
                <Archive size={15} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>Arquivadas</span>
                <span style={{ fontSize: 11, color: t.text3 }}>{archivedCount}</span>
              </button>
            </div>
          </div>
        </div>
        </div>{/* end inner panel */}

        {/* ── Floating edge toggle button ────────────────────────────────
            Always visible, sits on the right border of the sidebar.
            On mobile it inherits the same behaviour (sidebar slides in as
            a drawer, button still floats at the edge). */}
        <button
          onClick={onToggle}
          title={sidebarOpen ? 'Recolher menu' : 'Expandir menu'}
          style={{
            position: 'absolute',
            right: -13,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: t.sidebar,
            border: `1.5px solid ${t.border}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.13)',
            zIndex: 32,
            color: t.text2,
            transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLButtonElement
            el.style.background = t.surface2
            el.style.color = t.accent
            el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLButtonElement
            el.style.background = t.sidebar
            el.style.color = t.text2
            el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.13)'
          }}
        >
          {sidebarOpen
            ? <ChevronLeft size={14} strokeWidth={2.5} />
            : <ChevronRight size={14} strokeWidth={2.5} />}
        </button>
      </div>{/* end outer wrapper */}
    </>
  )
}

// ─── Archive View ─────────────────────────────────────────────────────────
function ArchiveView({ clients, theme: t, onRestore, onReactivate, onDelete }: {
  clients: Client[]; theme: Theme; onRestore: (id: string) => void
  onReactivate: (client: Client) => void; onDelete: (id: string) => void
}) {
  if (clients.length === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: t.text3 }}>
      <Archive size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
      <p style={{ fontSize: 14, margin: 0 }}>Nenhuma cliente arquivada</p>
    </div>
  )

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Archive size={18} color={t.text2} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.text }}>Clientes Arquivadas</h2>
        <span style={{ fontSize: 12, color: t.text3, background: t.surface2, padding: '2px 8px', borderRadius: 20 }}>{clients.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 12 }}>
        {clients.map(client => {
          const [bg, fg] = getAvatarColor(client.full_name)
          const cfg = STATUSES[client.status]
          const isExpired = client.archived_reason === 'expired'
          return (
            <div key={client.id} style={{ background: t.cardBg, border: `1px solid ${isExpired ? '#fcd34d' : t.border}`, borderRadius: 12, padding: '14px 16px', opacity: 0.9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                  {getInitials(client.full_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: t.text }}>{client.full_name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: t.text2 }}>{(client as any).plan?.name}</p>
                </div>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: cfg?.bg, color: cfg?.textColor, fontWeight: 600 }}>{cfg?.short}</span>
              </div>
              {isExpired && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10, fontSize: 11, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '4px 8px' }}>
                  <Clock size={11} /> Prazo expirado — link bloqueado pro cliente
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {isExpired ? (
                  <button onClick={() => onReactivate(client)}
                    style={{ flex: 1, padding: 6, borderRadius: 8, border: '1px solid #fcd34d', background: '#fffbeb', cursor: 'pointer', fontSize: 12, color: '#b45309', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  ><ArchiveRestore size={13} /> Reativar</button>
                ) : (
                  <button onClick={() => onRestore(client.id)}
                    style={{ flex: 1, padding: 6, borderRadius: 8, border: `1px solid ${t.border}`, background: 'none', cursor: 'pointer', fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                  ><ArchiveRestore size={13} /> Restaurar</button>
                )}
                <button onClick={() => onDelete(client.id)}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #fca5a5', background: 'none', cursor: 'pointer', fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#fee2e2'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                ><Trash2 size={13} /></button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Drag Confirm Modal ───────────────────────────────────────────────────
interface ConfirmState {
  title: string
  body: string
  confirmLabel: string
  confirmColor?: string
  infoOnly?: boolean
  onConfirm: () => Promise<void> | void
}

function DragConfirmModal({
  state, onClose, theme: t,
}: {
  state: ConfirmState; onClose: () => void; theme: Theme
}) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    if (state.infoOnly) { onClose(); return }
    setLoading(true)
    try { await state.onConfirm() } finally { setLoading(false); onClose() }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose() }}
    >
      <div style={{
        background: t.surface, borderRadius: 18,
        border: `1px solid ${t.border}`,
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        width: '100%', maxWidth: 420, padding: '28px 28px 24px',
        display: 'flex', flexDirection: 'column', gap: 20,
        animation: 'modalIn 0.18s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.92) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: state.infoOnly ? '#fef3c7' : `${t.accent}1a`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {state.infoOnly
              ? <AlertTriangle size={22} color="#b45309" />
              : <ChevronRight size={24} color={t.accent} />
            }
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.text, lineHeight: 1.3 }}>
              {state.title}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: t.text2, lineHeight: 1.6 }}>
              {state.body}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {!state.infoOnly && (
            <button
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '10px 20px', borderRadius: 10,
                border: `1px solid ${t.border}`, background: 'none',
                cursor: 'pointer', fontSize: 13, fontWeight: 500, color: t.text2,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = t.surface2)}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              Cancelar
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              padding: '10px 22px', borderRadius: 10, border: 'none',
              background: state.infoOnly ? '#f59e0b' : (state.confirmColor || t.accent),
              color: 'white', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 8,
              opacity: loading ? 0.75 : 1,
              transition: 'opacity 0.15s, filter 0.15s',
            }}
            onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'none' }}
          >
            {loading && (
              <div className="animate-spin" style={{
                width: 14, height: 14,
                border: '2px solid rgba(255,255,255,0.35)',
                borderTopColor: 'white', borderRadius: '50%',
              }} />
            )}
            {state.infoOnly ? 'Entendido' : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Reactivate Modal (prazo expirado → concede mais dias) ────────────────
//
// Só aparece pra clientes com archived_reason='expired'. Diferente do botão
// "Restaurar" simples (que só desarquiva), este pede quantos dias a mais
// conceder — necessário porque o `analysis_expires_at` antigo continua no
// passado, e sem empurrá-lo pra frente a cliente seria re-arquivada no
// próximo acesso ao portal.
function ReactivateModal({
  client, onClose, onConfirm, theme: t,
}: {
  client: Client; onClose: () => void; onConfirm: (id: string, extraDays: number) => Promise<void>; theme: Theme
}) {
  const [extraDays, setExtraDays] = useState(30)
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    if (extraDays < 1) return
    setLoading(true)
    try { await onConfirm(client.id, extraDays) } finally { setLoading(false); onClose() }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose() }}
    >
      <div style={{
        background: t.surface, borderRadius: 18,
        border: `1px solid ${t.border}`,
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        width: '100%', maxWidth: 420, padding: '28px 28px 24px',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ArchiveRestore size={22} color="#b45309" />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.text, lineHeight: 1.3 }}>
              Reativar {client.full_name}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: t.text2, lineHeight: 1.6 }}>
              O prazo do plano venceu e o link foi arquivado automaticamente.
              Quantos dias a mais você quer conceder, a partir de hoje, pra ela concluir a análise?
            </p>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: t.text3, marginBottom: 6 }}>
            Dias adicionais
          </label>
          <input
            type="number" min={1} max={730} value={extraDays} autoFocus
            onChange={e => setExtraDays(parseInt(e.target.value) || 1)}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              border: `1px solid ${t.border}`, background: t.surface2, color: t.text,
              fontSize: 14,
            }}
          />
          <p style={{ margin: '6px 0 0', fontSize: 11, color: t.text3 }}>
            Novo prazo final: {new Date(Date.now() + extraDays * 86400000).toLocaleDateString('pt-BR')}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose} disabled={loading}
            style={{
              padding: '10px 20px', borderRadius: 10,
              border: `1px solid ${t.border}`, background: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 500, color: t.text2,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm} disabled={loading || extraDays < 1}
            style={{
              padding: '10px 22px', borderRadius: 10, border: 'none',
              background: '#b45309', color: 'white', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
              opacity: loading ? 0.75 : 1,
            }}
          >
            {loading && (
              <div className="animate-spin" style={{
                width: 14, height: 14,
                border: '2px solid rgba(255,255,255,0.35)',
                borderTopColor: 'white', borderRadius: '50%',
              }} />
            )}
            Reativar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Clients List ─────────────────────────────────────────────────────────
function ClientsList({ onOpenNav }: { onOpenNav?: () => void }) {
  const [clients, setClients] = useState<Client[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [deadlines, setDeadlines] = useState<Record<string, DeadlineData>>({})
  // client_id → signed_at do contrato. Usado só pra calcular o badge de
  // "Expira em Xd" de clientes cujo analysis_expires_at ainda não foi
  // calculado (ver getExpirationInfo). Consulta separada e simples, no
  // mesmo padrão de `deadlines` acima.
  const [contractSignedAt, setContractSignedAt] = useState<Record<string, string>>({})
  const [formObsIds, setFormObsIds] = useState<Set<string>>(new Set())
  // IDs de clientes em `awaiting_ai_photo` que JÁ enviaram a foto IA — pendentes
  // de revisão pela consultora. Usado para mostrar badge no card e contador
  // no painel lateral.
  const [aiPhotoPendingIds, setAiPhotoPendingIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(window.innerWidth >= 768)
  const { theme: t, themeName, setThemeName, isDark } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'board' | 'board-compact' | 'list'>(() => {
    const saved = localStorage.getItem('kanban-view-mode')
    if (saved === 'board' || saved === 'board-compact' || saved === 'list') return saved
    return 'board'
  })
  const [creating, setCreating] = useState(false)
  const [showManualModal, setShowManualModal] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', birth_date: '', plan_id: '', notes: '' })
  const [themeOpen, setThemeOpen] = useState(false)
  const themeRef = useRef<HTMLDivElement>(null)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  // ── Sort preference for "completed" column (persisted in localStorage) ──
  const [completedSort, setCompletedSort] = useState<string>(
    () => localStorage.getItem('kanban-sort-completed') || 'recent'
  )
  const handleCompletedSortChange = useCallback((sort: string) => {
    setCompletedSort(sort)
    localStorage.setItem('kanban-sort-completed', sort)
  }, [])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchDropOpen, setSearchDropOpen] = useState(false)
  const navigate = useNavigate()

  // ── Drag & Drop state ──────────────────────────────────────────────────
  const [draggingClientId, setDraggingClientId] = useState<string | null>(null)
  // Ref síncrona — atualizada junto com o state, mas lida sem closure stale
  const draggingClientIdRef = useRef<string | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  // ── Board pan (desktop click-to-scroll) + auto-scroll on drag ─────────
  const boardRef = useRef<HTMLDivElement>(null)
  const isPanningRef = useRef(false)
  const [isPanning, setIsPanning] = useState(false)
  const panStartX = useRef(0)
  const scrollStartX = useRef(0)
  const autoScrollAnimRef = useRef<number | null>(null)
  const autoScrollDirRef = useRef<'left' | 'right' | null>(null)
  const autoScrollSpeedRef = useRef(0)
  // inertia
  const velocityRef = useRef(0)
  const lastMouseX = useRef(0)
  const lastMouseTime = useRef(0)
  const inertiaRef = useRef<number | null>(null)

  // ── Labels customizadas das colunas ──────────────────────────────────
  const [columnLabels, setColumnLabels] = useState<Record<string, string>>({})

  useEffect(() => { load() }, [])
  // Persiste a preferência de visualização sempre que o usuário mudar
  useEffect(() => {
    localStorage.setItem('kanban-view-mode', viewMode)
  }, [viewMode])
  useEffect(() => {
    adminService.getColumnLabels().then(setColumnLabels).catch(console.error)
  }, [])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Detecta mudança de viewport (mobile/desktop) para reorganizar o toolbar
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Fecha dropdown de busca ao clicar fora
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchDropOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Limpa o estado de drag se o usuário soltar fora de qualquer coluna
  useEffect(() => {
    const h = () => {
      setDraggingClientId(null)
      draggingClientIdRef.current = null
      if (autoScrollAnimRef.current !== null) {
        cancelAnimationFrame(autoScrollAnimRef.current)
        autoScrollAnimRef.current = null
      }
      autoScrollDirRef.current = null
    }
    document.addEventListener('dragend', h)
    return () => document.removeEventListener('dragend', h)
  }, [])

  // ── Restaura scroll do kanban ao voltar de um card ───────────────────
  const scrollRestoreRef = useRef<Record<string, number> | null>(null)
  useEffect(() => {
    const saved = sessionStorage.getItem('kanban-scroll')
    if (saved) {
      try { scrollRestoreRef.current = JSON.parse(saved) } catch {}
      sessionStorage.removeItem('kanban-scroll')
    }
  }, [])

  useEffect(() => {
    if (loading) return  // aguarda dados + board renderizado
    const positions = scrollRestoreRef.current
    if (!positions) return
    scrollRestoreRef.current = null

    const restore = () => {
      if (boardRef.current && positions.__board__ != null) {
        boardRef.current.scrollLeft = positions.__board__
      }
      const colScrollers = boardRef.current?.querySelectorAll('[data-col-scroller]')
      colScrollers?.forEach(el => {
        const key = (el as HTMLElement).dataset.colScroller
        if (key && positions[key] != null) {
          (el as HTMLElement).scrollTop = positions[key]
        }
      })
    }

    // Duplo timeout: primeiro frame já aplica o horizontal;
    // segundo garante que as colunas já têm altura calculada (vertical)
    const t1 = setTimeout(restore, 0)
    const t2 = setTimeout(restore, 120)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [loading])

  // Salva posições de scroll antes de navegar para um card
  const saveScrollPositions = useCallback(() => {
    const positions: Record<string, number> = {
      __board__: boardRef.current?.scrollLeft ?? 0,
    }
    const colScrollers = boardRef.current?.querySelectorAll('[data-col-scroller]')
    colScrollers?.forEach(el => {
      const key = (el as HTMLElement).dataset.colScroller
      if (key) positions[key] = (el as HTMLElement).scrollTop
    })
    sessionStorage.setItem('kanban-scroll', JSON.stringify(positions))
  }, [])

  // ── Board pan handlers (desktop click-to-scroll via document listeners) ──
  const stopInertia = useCallback(() => {
    if (inertiaRef.current !== null) {
      cancelAnimationFrame(inertiaRef.current)
      inertiaRef.current = null
    }
  }, [])

  const applyInertia = useCallback(() => {
    if (!boardRef.current || Math.abs(velocityRef.current) < 0.3) {
      inertiaRef.current = null
      return
    }
    boardRef.current.scrollLeft += velocityRef.current
    velocityRef.current *= 0.92
    inertiaRef.current = requestAnimationFrame(applyInertia)
  }, [])

  const handleBoardMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (
      target.closest('[draggable="true"]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea')
    ) return
    if (!boardRef.current) return
    stopInertia()
    isPanningRef.current = true
    setIsPanning(true)
    panStartX.current = e.clientX
    scrollStartX.current = boardRef.current.scrollLeft
    velocityRef.current = 0
    lastMouseX.current = e.clientX
    lastMouseTime.current = performance.now()
    e.preventDefault()

    // Usa rAF para coalescer updates — sem jitter por excesso de mousemove
    let rafPending = false
    let pendingX = e.clientX

    const handleGlobalMove = (ev: MouseEvent) => {
      if (!isPanningRef.current) return
      pendingX = ev.clientX
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        if (!isPanningRef.current || !boardRef.current) return
        const dx = pendingX - panStartX.current
        boardRef.current.scrollLeft = scrollStartX.current - dx
        const now = performance.now()
        const dt = now - lastMouseTime.current
        if (dt > 0) velocityRef.current = (lastMouseX.current - pendingX) / dt * 16
        lastMouseX.current = pendingX
        lastMouseTime.current = now
      })
    }

    const handleGlobalUp = () => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      setIsPanning(false)
      inertiaRef.current = requestAnimationFrame(applyInertia)
      document.removeEventListener('mousemove', handleGlobalMove)
      document.removeEventListener('mouseup', handleGlobalUp)
    }

    document.addEventListener('mousemove', handleGlobalMove)
    document.addEventListener('mouseup', handleGlobalUp)
  }, [stopInertia, applyInertia])

  // ── Auto-scroll durante drag ───────────────────────────────────────────
  const stopAutoScroll = useCallback(() => {
    if (autoScrollAnimRef.current !== null) {
      cancelAnimationFrame(autoScrollAnimRef.current)
      autoScrollAnimRef.current = null
    }
    autoScrollDirRef.current = null
    autoScrollSpeedRef.current = 0
  }, [])

  const startAutoScroll = useCallback((dir: 'left' | 'right', speed: number) => {
    // Se a direção mudou ou a velocidade aumentou significativamente, reinicia
    if (autoScrollDirRef.current === dir && Math.abs(autoScrollSpeedRef.current - speed) < 3) return
    if (autoScrollAnimRef.current !== null) cancelAnimationFrame(autoScrollAnimRef.current)
    autoScrollDirRef.current = dir
    autoScrollSpeedRef.current = speed
    const step = () => {
      if (!boardRef.current) return
      boardRef.current.scrollLeft += dir === 'right' ? autoScrollSpeedRef.current : -autoScrollSpeedRef.current
      autoScrollAnimRef.current = requestAnimationFrame(step)
    }
    autoScrollAnimRef.current = requestAnimationFrame(step)
  }, [])

  // Listener permanente no document — sem delay assíncrono do React.
  // Usa draggingClientIdRef (síncrona) para checar se drag está ativo.
  // Usa window.innerWidth para as zonas de borda — independe do tamanho do board.
  useEffect(() => {
    const EDGE = 120  // px da borda para ativar o scroll
    const onDocDragOver = (e: DragEvent) => {
      if (!draggingClientIdRef.current || !boardRef.current) {
        stopAutoScroll()
        return
      }
      const x = e.clientX
      const W = window.innerWidth
      if (x < EDGE) {
        // Quanto mais perto da borda esquerda, mais rápido
        const speed = Math.round(10 + (1 - x / EDGE) * 20)
        startAutoScroll('left', speed)
      } else if (x > W - EDGE) {
        // Quanto mais perto da borda direita, mais rápido
        const speed = Math.round(10 + ((x - (W - EDGE)) / EDGE) * 20)
        startAutoScroll('right', speed)
      } else {
        stopAutoScroll()
      }
    }
    document.addEventListener('dragover', onDocDragOver)
    return () => document.removeEventListener('dragover', onDocDragOver)
  }, [startAutoScroll, stopAutoScroll])

  // handleBoardDragOver só precisa de preventDefault para o cursor de "drop" funcionar
  const handleBoardDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  // Busca clientes que JÁ enviaram a foto IA (categoria com `is_ai_simulation`).
  // Combinada no front com `client.status === 'awaiting_ai_photo'` para identificar
  // os que estão aguardando revisão. Quando a admin avança a etapa, o cliente
  // sai de `awaiting_ai_photo`, então a flag deixa de aparecer naturalmente.
  const fetchAiPhotoSenders = async (): Promise<Set<string>> => {
    const aiCats = await supabase.from('plan_photo_categories').select('id').eq('is_ai_simulation', true)
    const aiCatIds = (aiCats.data || []).map((c: any) => c.id)
    if (aiCatIds.length === 0) return new Set()
    const photos = await supabase.from('client_photos').select('client_id').in('category_id', aiCatIds)
    return new Set<string>((photos.data || []).map((p: any) => p.client_id))
  }

  // ── Blindagem mobile ──────────────────────────────────────────────────
  // 1) Sessão: ao voltar de aba suspensa no celular, o token pode estar em
  //    renovação; query sem token + RLS devolve LISTA VAZIA sem erro — e o
  //    kanban "esvaziava do nada". Sem sessão válida, não sobrescrevemos nada.
  // 2) Sequência: se dois loads correm em paralelo (rede móvel lenta), só a
  //    resposta MAIS RECENTE pode escrever no estado — resposta velha é jogada
  //    fora em vez de sobrescrever dados novos.
  const loadSeqRef = useRef(0)

  const load = async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return // sem sessão: mantém a lista atual na tela
      const [c, p, dl, fs, aiPending, signedDates] = await Promise.all([
        adminService.getClients(),
        adminService.getPlans(),
        supabase.from('client_deadlines').select('client_id, deadline_date, photos_sent_at, no_deadline'),
        supabase.from('client_form_submissions').select('client_id, form_data'),
        fetchAiPhotoSenders(),
        adminService.getContractSignedDates(),
      ])
      if (seq !== loadSeqRef.current) return // resposta antiga: descarta
      setClients(c)
      setPlans(p.filter((pl: any) => pl.is_active))
      setContractSignedAt(signedDates)
      const dlMap: Record<string, DeadlineData> = {}
      ;(dl.data || []).forEach((d: any) => { dlMap[d.client_id] = { deadline_date: d.deadline_date, photos_sent_at: d.photos_sent_at, no_deadline: d.no_deadline } })
      setDeadlines(dlMap)
      const obsSet = new Set<string>()
      ;(fs.data || []).forEach((row: any) => {
        const fd = row.form_data || {}
        if (Object.keys(fd).some(k => k.endsWith('__obs') && String(fd[k] || '').trim())) {
          obsSet.add(row.client_id)
        }
      })
      setFormObsIds(obsSet)
      setAiPhotoPendingIds(aiPending)
    } catch (e) {
      // Falha de rede/token: NÃO esvazia a lista — mantém o que está na tela.
      console.warn('load() falhou; mantendo lista atual:', e)
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }

  // Sincroniza dados em segundo plano sem mostrar spinner (usado após optimistic updates)
  const silentLoad = async () => {
    const seq = ++loadSeqRef.current
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return // sem sessão (token renovando no mobile): não toca na lista
      const [c, dl, fs, aiPending, signedDates] = await Promise.all([
        adminService.getClients(),
        supabase.from('client_deadlines').select('client_id, deadline_date, photos_sent_at, no_deadline'),
        supabase.from('client_form_submissions').select('client_id, form_data'),
        fetchAiPhotoSenders(),
        adminService.getContractSignedDates(),
      ])
      if (seq !== loadSeqRef.current) return // resposta antiga: descarta
      setClients(c)
      setContractSignedAt(signedDates)
      const dlMap: Record<string, DeadlineData> = {}
      ;(dl.data || []).forEach((d: any) => { dlMap[d.client_id] = { deadline_date: d.deadline_date, photos_sent_at: d.photos_sent_at, no_deadline: d.no_deadline } })
      setDeadlines(dlMap)
      const obsSet = new Set<string>()
      ;(fs.data || []).forEach((row: any) => {
        const fd = row.form_data || {}
        if (Object.keys(fd).some(k => k.endsWith('__obs') && String(fd[k] || '').trim())) {
          obsSet.add(row.client_id)
        }
      })
      setFormObsIds(obsSet)
      setAiPhotoPendingIds(aiPending)
    } catch (e) {
      console.warn('silentLoad() falhou; mantendo lista atual:', e)
    }
  }

  const handleCreate = async () => {
    if (!form.full_name || !form.email || !form.birth_date || !form.plan_id)
      return alert('Preencha nome, e-mail, data de nascimento e plano.')
    try {
      const client = await adminService.createClient(form as any)
      setCreating(false)
      setForm({ full_name: '', email: '', phone: '', birth_date: '', plan_id: '', notes: '' })
      navigate(`/admin/clients/${client.id}`)
    } catch (e: any) { alert(e.message) }
  }

  const handleArchive = useCallback(async (id: string) => {
    // Optimistic update
    setClients(prev => prev.map(c => c.id === id ? { ...c, is_archived: true } : c))
    try {
      await adminService.archiveClient(id)
    } catch (e) {
      // Reverte em caso de erro
      setClients(prev => prev.map(c => c.id === id ? { ...c, is_archived: false } : c))
      alert('Erro ao arquivar cliente. Tente novamente.')
    }
  }, [])

  const handleRestore = useCallback(async (id: string) => {
    // Optimistic update
    setClients(prev => prev.map(c => c.id === id ? { ...c, is_archived: false } : c))
    try {
      await adminService.restoreClient(id)
    } catch (e) {
      // Reverte em caso de erro
      setClients(prev => prev.map(c => c.id === id ? { ...c, is_archived: true } : c))
      alert('Erro ao restaurar cliente. Tente novamente.')
    }
  }, [])

  // Reativação de cliente arquivada por expiração de prazo — diferente de
  // handleRestore: além de desarquivar, empurra `analysis_expires_at` pra
  // frente (senão a próxima abertura do portal a arquivaria de novo).
  const [reactivatingClient, setReactivatingClient] = useState<Client | null>(null)
  const handleReactivate = useCallback(async (id: string, extraDays: number) => {
    const newExpiresAt = new Date(Date.now() + extraDays * 86400000).toISOString()
    setClients(prev => prev.map(c => c.id === id
      ? { ...c, is_archived: false, archived_reason: null, analysis_expires_at: newExpiresAt }
      : c))
    try {
      await adminService.reactivateClient(id, extraDays)
    } catch (e) {
      setClients(prev => prev.map(c => c.id === id
        ? { ...c, is_archived: true, archived_reason: 'expired' }
        : c))
      alert('Erro ao reativar cliente. Tente novamente.')
    }
  }, [])
  const handleStar = useCallback((id: string) => setStarredIds(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s }), [])
  const handleDelete = async (id: string) => {
    const client = clients.find(c => c.id === id)
    if (!client) return
    if (!confirm(`Excluir "${client.full_name}"?\n\nTodos os dados, fotos e arquivos serão removidos permanentemente. Esta ação não pode ser desfeita.`)) return

    // Optimistic: remove da UI imediatamente
    setClients(prev => prev.filter(c => c.id !== id))

    try {
      // 1. Limpa fotos e anexos do storage
      const cleanup = await cleanClientFiles(id)
      if (!cleanup.success && cleanup.errors.length > 0) {
        console.warn('⚠️ Limpeza parcial do storage:', cleanup.errors)
      }
      // 2. Deleta o registro do banco (CASCADE cuida das tabelas filhas)
      await adminService.deleteClient(id)
    } catch (e: any) {
      console.error('Erro ao excluir cliente:', e)
      alert('Erro ao excluir cliente: ' + (e?.message ?? 'Tente novamente.'))
      load() // restaura estado real em caso de falha
    }
  }
  const toggleCollapse = useCallback((key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] })), [])

  // ── Handler de drop: pulo direto pra etapa (silencioso) ────────────────
  // Usa adminService.jumpToStep, que SÓ muda o status (sem disparar e-mails
  // de fotos aprovadas, sem calcular prazo, sem criar contrato manual).
  // Exceções tratadas dentro do jumpToStep:
  //   - destino 'awaiting_contract' → hard reset (apaga formulário/fotos/prazo/resultado)
  //   - destino 'completed' → libera resultado + e-mail final
  const handleDrop = useCallback((targetStatus: string) => {
    if (!draggingClientId) return
    const client = clients.find(c => c.id === draggingClientId)
    const clientIdSnap = draggingClientId   // captura antes de resetar
    setDraggingClientId(null)
    draggingClientIdRef.current = null
    if (!client || client.status === targetStatus) return

    const fromIdx = COL_ORDER.indexOf(client.status)
    const toIdx   = COL_ORDER.indexOf(targetStatus)
    if (fromIdx === -1 || toIdx === -1) return

    const targetLabel = STATUSES[targetStatus]?.label ?? targetStatus
    const name = client.full_name
    const previousStatus = client.status  // salva para rollback
    const goingForward = toIdx > fromIdx
    const steps = Math.abs(toIdx - fromIdx)

    // Move o card localmente antes da confirmação visual
    const applyOptimistic = () =>
      setClients(prev => prev.map(c =>
        c.id === clientIdSnap ? { ...c, status: targetStatus as any } : c
      ))

    // Reverte se a API retornar erro
    const rollback = () =>
      setClients(prev => prev.map(c =>
        c.id === clientIdSnap ? { ...c, status: previousStatus } : c
      ))

    // Mensagem de confirmação adaptada ao caso
    let body: string
    let confirmLabel = 'Confirmar'
    let confirmColor: string | undefined

    if (targetStatus === 'awaiting_contract') {
      body = `Atenção: voltar "${name}" para o contrato apaga TUDO que ela já enviou (formulário, fotos, prazo e resultado). Use só se for realmente recomeçar do zero.`
      confirmLabel = 'Recomeçar do zero'
      confirmColor = '#dc2626'
    } else if (targetStatus === 'completed') {
      body = `"${name}" será marcada como Concluída e o resultado será liberado no portal. Um e-mail de notificação será enviado pra ela.`
      confirmLabel = 'Liberar resultado'
    } else if (goingForward) {
      body = steps > 1
        ? `"${name}" vai avançar ${steps} etapas de uma vez. Os dados das etapas puladas ficam vazios — a cliente só vê a etapa atual.`
        : `"${name}" será movida para "${targetLabel}".`
    } else {
      body = `"${name}" volta para "${targetLabel}". Os dados (formulário, fotos, prazo, resultado) ficam preservados — a cliente só ajusta o que precisar.`
      confirmLabel = 'Voltar etapa'
      confirmColor = '#6366f1'
    }

    setConfirmState({
      title: targetStatus === 'awaiting_contract'
        ? `Recomeçar "${name}" do zero?`
        : `Mover para "${targetLabel}"?`,
      body,
      confirmLabel,
      confirmColor,
      onConfirm: async () => {
        applyOptimistic()
        try {
          await adminService.jumpToStep(clientIdSnap, targetStatus)
          if (targetStatus === 'completed') notifyClientCompleted(clientIdSnap)
          silentLoad()  // sincroniza em segundo plano sem spinner
        } catch (e: any) {
          rollback()
          alert(e?.message || 'Erro ao mover cliente')
        }
      },
    })
  }, [draggingClientId, clients])

  // ── Handler de quick-move via botão do card (mesma lógica do handleDrop) ──
  const handleQuickMove = useCallback((clientId: string, targetStatus: string) => {
    const client = clients.find(c => c.id === clientId)
    if (!client || client.status === targetStatus) return

    const fromIdx = COL_ORDER.indexOf(client.status)
    const toIdx   = COL_ORDER.indexOf(targetStatus)
    if (fromIdx === -1 || toIdx === -1) return

    const targetLabel = STATUSES[targetStatus]?.label ?? targetStatus
    const name = client.full_name
    const previousStatus = client.status
    const goingForward = toIdx > fromIdx
    const steps = Math.abs(toIdx - fromIdx)

    const applyOptimistic = () =>
      setClients(prev => prev.map(c =>
        c.id === clientId ? { ...c, status: targetStatus as any } : c
      ))
    const rollback = () =>
      setClients(prev => prev.map(c =>
        c.id === clientId ? { ...c, status: previousStatus } : c
      ))

    let body: string
    let confirmLabel = 'Confirmar'
    let confirmColor: string | undefined

    if (targetStatus === 'awaiting_contract') {
      body = `Atenção: voltar "${name}" para o contrato apaga TUDO que ela já enviou (formulário, fotos, prazo e resultado). Use só se for realmente recomeçar do zero.`
      confirmLabel = 'Recomeçar do zero'
      confirmColor = '#dc2626'
    } else if (targetStatus === 'completed') {
      body = `"${name}" será marcada como Concluída e o resultado será liberado no portal. Um e-mail de notificação será enviado pra ela.`
      confirmLabel = 'Liberar resultado'
    } else if (goingForward) {
      body = steps > 1
        ? `"${name}" vai avançar ${steps} etapas de uma vez. Os dados das etapas puladas ficam vazios — a cliente só vê a etapa atual.`
        : `"${name}" será movida para "${targetLabel}".`
    } else {
      body = `"${name}" volta para "${targetLabel}". Os dados ficam preservados — a cliente só ajusta o que precisar.`
      confirmLabel = 'Voltar etapa'
      confirmColor = '#6366f1'
    }

    setConfirmState({
      title: targetStatus === 'awaiting_contract'
        ? `Recomeçar "${name}" do zero?`
        : `Mover para "${targetLabel}"?`,
      body,
      confirmLabel,
      confirmColor,
      onConfirm: async () => {
        applyOptimistic()
        try {
          await adminService.jumpToStep(clientId, targetStatus)
          if (targetStatus === 'completed') notifyClientCompleted(clientId)
          silentLoad()
        } catch (e: any) { rollback(); alert(e?.message || 'Erro ao mover cliente') }
      },
    })
  }, [clients])

  const activeClients = useMemo(() => clients.filter(c => !c.is_archived), [clients])
  const archivedClients = useMemo(() => clients.filter(c => c.is_archived), [clients])

  const filteredActive = useMemo(() => {
    let list = activeClients
    if (search.trim()) {
      const qRaw = search.toLowerCase()
      const qDigits = search.replace(/\D/g, '')
      list = list.filter(c => {
        const planName = ((c as any).plan?.name || '').toLowerCase()
        const phone = (c.phone || '').toLowerCase()
        const phoneDigits = phone.replace(/\D/g, '')
        return (
          c.full_name.toLowerCase().includes(qRaw) ||
          c.email.toLowerCase().includes(qRaw) ||
          phone.includes(qRaw) ||
          (qDigits.length >= 4 && phoneDigits.includes(qDigits)) ||
          planName.includes(qRaw)
        )
      })
    }
    if (filter === 'danger') list = list.filter(c => getDeadlineInfo(c, deadlines[c.id])?.urgency === 'danger')
    else if (COL_ORDER.includes(filter)) list = list.filter(c => c.status === filter)
    return list
  }, [activeClients, search, filter, deadlines])

  const groupedByStatus = useMemo(() => {
    const groups: Record<string, Client[]> = {}
    COL_ORDER.forEach(s => { groups[s] = [] })
    filteredActive.forEach(c => { if (groups[c.status]) groups[c.status].push(c) })
    Object.keys(groups).forEach(status => {
      if (status === 'completed') {
        // Apply the user-selected sort for the completed column
        groups[status].sort((a, b) => {
          if (completedSort === 'name_asc') return a.full_name.localeCompare(b.full_name, 'pt-BR')
          if (completedSort === 'name_desc') return b.full_name.localeCompare(a.full_name, 'pt-BR')
          // For date sorts: use created_at (most reliable timestamp)
          const dateA = new Date((a as any).created_at || 0).getTime()
          const dateB = new Date((b as any).created_at || 0).getTime()
          if (completedSort === 'oldest') return dateA - dateB
          return dateB - dateA // 'recent' (default)
        })
      } else {
        groups[status].sort((a, b) => {
          const dlA = deadlines[a.id]; const dlB = deadlines[b.id]
          if (dlA && !dlB) return -1; if (!dlA && dlB) return 1; if (!dlA && !dlB) return 0
          return new Date(dlA.deadline_date).getTime() - new Date(dlB.deadline_date).getTime()
        })
      }
    })
    return groups
  }, [filteredActive, deadlines, completedSort])

  const isArchiveView = filter === 'archived'
  const btnStyle = (active: boolean) => ({
    background: active ? t.surface : 'none', border: 'none', cursor: 'pointer', padding: '5px 8px', borderRadius: 6,
    color: active ? t.text : t.text2, display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 13, fontWeight: active ? 600 : 400, boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
  })

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0', background: t.bg }}>
      <div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: t.bg, fontFamily: 'system-ui,-apple-system,sans-serif', overflow: 'hidden' }}>
      {confirmState && (
        <DragConfirmModal
          state={confirmState}
          onClose={() => setConfirmState(null)}
          theme={t}
        />
      )}
      {reactivatingClient && (
        <ReactivateModal
          client={reactivatingClient}
          onClose={() => setReactivatingClient(null)}
          onConfirm={handleReactivate}
          theme={t}
        />
      )}
      {showManualModal && (
        <AddManualClientModal
          plans={plans}
          onClose={() => setShowManualModal(false)}
          onCreated={(clientId) => {
            setShowManualModal(false)
            silentLoad()
            navigate(`/admin/clients/${clientId}`)
          }}
        />
      )}
      {/* Toolbar */}
      <div style={{
        background: t.surface,
        borderBottom: `2px solid ${t.border}`,
        padding: isMobile ? '8px 10px' : '0 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        rowGap: 8,
        flexShrink: 0,
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        minHeight: 52,
      }}>
        {/* Hamburger — junto ao menu lateral */}
        <button onClick={onOpenNav} title="Menu de navegação"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, color: t.text2, display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, transition: 'background 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.background = t.surface2)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <span style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 14, height: 2, background: 'currentColor', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 2 }} />
        </button>

        <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg, #e91e63, #ff6090)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(233,30,99,0.3)' }}>
          <Palette size={14} color="white" />
        </div>
        {!isMobile && <div style={{ width: 1, height: 22, background: t.border, flexShrink: 0, margin: '0 2px' }} />}

        {/* Título + contagem */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 0, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
          <span style={{ fontSize: isMobile ? 15 : 16, fontWeight: 800, color: t.text, letterSpacing: -0.3, flexShrink: 0 }}>Clientes</span>
          <span style={{ fontSize: isMobile ? 11 : 12, color: t.text3, marginLeft: 6, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {activeClients.length}{isMobile ? '' : ` ativa${activeClients.length !== 1 ? 's' : ''}`}
            {filteredActive.length !== activeClients.length && !isArchiveView &&
              <span style={{ color: t.accent, marginLeft: 4 }}>· {filteredActive.length}{isMobile ? '' : ` filtrada${filteredActive.length !== 1 ? 's' : ''}`}</span>
            }
          </span>
        </div>

        {/* Barra de busca com dropdown ao vivo */}
        <div ref={searchWrapRef} style={{
          flex: isMobile ? '1 0 100%' : 1,
          position: 'relative',
          maxWidth: isMobile ? '100%' : 520,
          order: isMobile ? 10 : 0,
        }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 16, color: t.text3, pointerEvents: 'none', zIndex: 1 }} />
          <input
            ref={searchInputRef}
            value={search}
            onChange={e => { setSearch(e.target.value); setSearchDropOpen(true) }}
            onFocus={() => { if (search.trim()) setSearchDropOpen(true) }}
            placeholder="Buscar por nome, e-mail, telefone, plano…"
            style={{
              width: '100%', padding: '8px 32px 8px 32px',
              borderRadius: searchDropOpen && search.trim() ? '9px 9px 0 0' : 9,
              border: `1.5px solid ${searchDropOpen && search.trim() ? t.accent : search ? t.accent : t.border}`,
              background: t.surface2, fontSize: 13, color: t.text,
              outline: 'none', boxSizing: 'border-box' as const,
              transition: 'border-color 0.15s, border-radius 0.1s',
              boxShadow: searchDropOpen && search.trim() ? `0 0 0 3px ${t.accent}22` : search ? `0 0 0 3px ${t.accent}18` : 'none',
            }}
            onKeyDown={e => { if (e.key === 'Escape') { setSearchDropOpen(false); searchInputRef.current?.blur() } }}
          />
          {search && (
            <button onClick={() => { setSearch(''); setSearchDropOpen(false) }} title="Limpar busca"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: t.text3, padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center', zIndex: 2 }}>
              <X size={13} />
            </button>
          )}

          {/* Dropdown de resultados */}
          {searchDropOpen && search.trim() && (() => {
            const q = search.toLowerCase()
            const qDigits = search.replace(/\D/g, '')
            const hits = activeClients.filter(c => {
              const planName = ((c as any).plan?.name || '').toLowerCase()
              const phone = (c.phone || '').toLowerCase()
              const phoneDigits = phone.replace(/\D/g, '')
              return (
                c.full_name.toLowerCase().includes(q) ||
                c.email.toLowerCase().includes(q) ||
                phone.includes(q) ||
                (qDigits.length >= 4 && phoneDigits.includes(qDigits)) ||
                planName.includes(q)
              )
            }).slice(0, 8)

            const highlight = (text: string) => {
              const idx = text.toLowerCase().indexOf(q)
              if (idx === -1) return <span>{text}</span>
              return <span>{text.slice(0, idx)}<mark style={{ background: t.accentLight, color: t.accent, padding: 0, borderRadius: 2 }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</span>
            }

            return (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 500,
                background: t.surface, border: `1.5px solid ${t.accent}`,
                borderTop: 'none', borderRadius: '0 0 10px 10px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                overflow: 'hidden', maxHeight: 380, overflowY: 'auto',
              }}>
                {hits.length === 0 ? (
                  <div style={{ padding: '14px 16px', fontSize: 13, color: t.text3, textAlign: 'center' }}>
                    Nenhuma cliente encontrada
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '6px 14px 4px', fontSize: 10, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Clientes — {hits.length} resultado{hits.length !== 1 ? 's' : ''}
                    </div>
                    {hits.map(c => {
                      const planName = (c as any).plan?.name
                      const statusCfg = STATUSES[c.status]
                      const [bg] = getAvatarColor(c.full_name)
                      const initials = c.full_name.trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
                      return (
                        <button
                          key={c.id}
                          onMouseDown={e => {
                            e.preventDefault()
                            setSearch('')
                            setSearchDropOpen(false)
                            navigate(`/admin/clients/${c.id}`)
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            width: '100%', padding: '9px 14px', border: 'none',
                            background: 'none', cursor: 'pointer', textAlign: 'left',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = t.surface2)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          {/* Avatar */}
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                            {initials}
                          </div>
                          {/* Info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {highlight(c.full_name)}
                            </div>
                            <div style={{ fontSize: 11, color: t.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {c.email}{c.phone ? ` · ${c.phone}` : ''}
                            </div>
                          </div>
                          {/* Status + Plano */}
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                            {planName && (
                              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: t.accentLight, color: t.accent, fontWeight: 600 }}>
                                {planName}
                              </span>
                            )}
                            {statusCfg && (
                              <span style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3, color: t.text3 }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusCfg.color, display: 'inline-block' }} />
                                {statusCfg.label}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                    {activeClients.filter(c => {
                      const planName = ((c as any).plan?.name || '').toLowerCase()
                      const phone = (c.phone || '').toLowerCase()
                      return c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || phone.includes(q) || planName.includes(q)
                    }).length > 8 && (
                      <div style={{ padding: '8px 14px', fontSize: 11, color: t.text3, borderTop: `1px solid ${t.border}`, textAlign: 'center' }}>
                        Mostrando os 8 primeiros resultados — refine a busca para ver mais
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })()}
        </div>

        <div style={{ flex: 1 }} />

        <div ref={themeRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setThemeOpen(v => !v)} title="Tema"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface2, cursor: 'pointer', fontSize: 13, color: t.text2, transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = t.surface)}
            onMouseLeave={e => (e.currentTarget.style.background = t.surface2)}
          >
            <span style={{ fontSize: 15 }}>{THEMES[themeName].icon}</span><ChevronDown size={11} />
          </button>
          {themeOpen && (
            <div style={{ position: 'absolute', right: 0, top: 38, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 200, overflow: 'hidden', minWidth: 140 }}>
              <div style={{ padding: '8px 12px 4px' }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: t.text3, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Tema</p>
              </div>
              {(Object.entries(THEMES) as [ThemeName, Theme][]).map(([key, th]) => (
                <button key={key} onClick={() => { setThemeName(key); setThemeOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 14px', background: themeName === key ? t.accentLight : 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: themeName === key ? t.accent : t.text, textAlign: 'left', fontWeight: themeName === key ? 700 : 400 }}
                  onMouseEnter={e => { if (themeName !== key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                  onMouseLeave={e => { if (themeName !== key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                ><span style={{ fontSize: 15 }}>{th.icon}</span> {th.name}</button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', background: t.surface2, borderRadius: 8, padding: 2, flexShrink: 0 }}>
          <button onClick={() => setViewMode('board')} title="Kanban" style={btnStyle(viewMode === 'board')}><LayoutGrid size={15} /></button>
          <button onClick={() => setViewMode('board-compact')} title="Kanban compacto" style={btnStyle(viewMode === 'board-compact')}><Layers size={15} /></button>
          <button onClick={() => setViewMode('list')} title="Lista" style={btnStyle(viewMode === 'list')}><List size={15} /></button>
        </div>

        {/* Botão de cadastro manual */}
        <button
          onClick={() => setShowManualModal(true)}
          title="Cadastrar cliente manualmente"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 13px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg, #e91e63, #f06292)',
            color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 700,
            boxShadow: '0 2px 8px rgba(233,30,99,0.28)',
            flexShrink: 0, transition: 'filter 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.1)')}
          onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
        >
          <Plus size={15} />
          {!isMobile && 'Nova cliente'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <KanbanSidebar theme={t} clients={activeClients} search={search} onSearch={setSearch}
          filter={filter} onFilter={setFilter} sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen(v => !v)}
          total={activeClients.length} archivedCount={archivedClients.length} deadlines={deadlines}
          columnLabels={columnLabels} aiPhotoPendingIds={aiPhotoPendingIds} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {isArchiveView && (
            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' } as React.CSSProperties}>
              <ArchiveView clients={archivedClients} theme={t} onRestore={handleRestore} onReactivate={setReactivatingClient} onDelete={handleDelete} />
            </div>
          )}

          {!isArchiveView && (viewMode === 'board' || viewMode === 'board-compact') && (
            <>
              {filteredActive.length === 0 && !search && filter === 'all' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: t.text3 }}>
                  <User size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
                  <p style={{ fontSize: 14, margin: 0, color: t.text2 }}>Nenhuma cliente cadastrada ainda</p>
                  <p style={{ fontSize: 12, margin: '4px 0 0', color: t.text3 }}>As clientes aparecerão aqui após o cadastro</p>
                </div>
              ) : (
                <div
                  ref={boardRef}
                  onMouseDown={handleBoardMouseDown}
                  onDragOver={handleBoardDragOver}
                  style={{
                    flex: 1,
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    padding: '14px 12px 16px',
                    display: 'flex',
                    gap: viewMode === 'board-compact' ? 6 : 10,
                    alignItems: 'stretch',
                    cursor: isPanning ? 'grabbing' : 'default',
                    userSelect: isPanning ? 'none' : undefined,
                    WebkitOverflowScrolling: 'touch',
                  } as React.CSSProperties}
                >
                  {COL_ORDER.filter(key => {
                    // Quando um filtro está ativo (≠ 'all'), oculta colunas sem cards
                    if (filter !== 'all') return (groupedByStatus[key]?.length ?? 0) > 0
                    return true
                  }).map(key => (
                    <KanbanColumn
                      key={key}
                      statusKey={key}
                      clients={groupedByStatus[key] || []}
                      deadlines={deadlines}
                      starredIds={starredIds}
                      theme={t}
                      collapsed={!!collapsed[key]}
                      onToggleCollapse={() => toggleCollapse(key)}
                      onView={id => { saveScrollPositions(); navigate(`/admin/clients/${id}`) }}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                      onStar={handleStar}
                      onDragStart={id => { setDraggingClientId(id); draggingClientIdRef.current = id }}
                      onDrop={handleDrop}
                      draggingClientId={draggingClientId}
                      displayLabel={getColLabel(key, columnLabels)}
                      onRenameLabel={async (newName) => {
                        await adminService.upsertColumnLabel(key, newName)
                        setColumnLabels(prev => ({ ...prev, [key]: newName }))
                      }}
                      onQuickMove={handleQuickMove}
                      columnLabels={columnLabels}
                      formObsIds={formObsIds}
                      aiPhotoPendingIds={aiPhotoPendingIds}
                      forceCompact={viewMode === 'board-compact' ? true : undefined}
                      contractSignedAt={contractSignedAt}
                      {...(key === 'completed' ? {
                        sortOrder: completedSort,
                        onSortChange: handleCompletedSortChange,
                      } : {})}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          

          {!isArchiveView && viewMode === 'list' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
              {filteredActive.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: t.text3 }}>
                  <User size={36} style={{ marginBottom: 10, opacity: 0.4 }} />
                  <p style={{ fontSize: 14, margin: 0, color: t.text2 }}>{search || filter !== 'all' ? 'Nenhuma cliente encontrada' : 'Nenhuma cliente cadastrada'}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[...filteredActive].sort((a, b) => {
                    const dlA = deadlines[a.id]; const dlB = deadlines[b.id]
                    if (dlA && !dlB) return -1; if (!dlA && dlB) return 1; if (!dlA && !dlB) return 0
                    return new Date(dlA.deadline_date).getTime() - new Date(dlB.deadline_date).getTime()
                  }).map(client => {
                    const cfg = STATUSES[client.status]
                    const dl = getDeadlineInfo(client, deadlines[client.id])
                    const aiPending = aiPhotoPendingIds.has(client.id) && client.status === 'awaiting_ai_photo'
                    const aiBorderColor = isDark ? '#f97316' : '#fb923c'
                    const baseBorderColor = dl?.urgency === 'danger'
                      ? '#fca5a5'
                      : client.status === 'photos_submitted'
                        ? '#fbcfe8'
                        : aiPending
                          ? aiBorderColor
                          : t.cardBorder
                    const baseBgColor = aiPending
                      ? `color-mix(in srgb, #f97316 ${isDark ? 14 : 7}%, ${t.cardBg})`
                      : t.cardBg
                    return (
                      <div key={client.id}
                        style={{ background: baseBgColor, border: `1px solid ${baseBorderColor}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}
                        onClick={() => navigate(`/admin/clients/${client.id}`)}
                        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = t.accent + '60'}
                        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = baseBorderColor}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(client.full_name)[0], color: getAvatarColor(client.full_name)[1], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                            {getInitials(client.full_name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{client.full_name}</span>
                              {formObsIds.has(client.id) && (
                                <Bell size={11} strokeWidth={2} style={{ color: '#f97316', opacity: 0.75, flexShrink: 0 }} title="Possui observação condicional no formulário" />
                              )}
                              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: cfg?.bg, color: cfg?.textColor, fontWeight: 600 }}>{cfg?.label}</span>
                              {aiPending && (
                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: isDark ? 'rgba(249,115,22,0.25)' : '#ffedd5', color: isDark ? '#fdba74' : '#c2410c', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>✨ Foto IA p/ revisar</span>
                              )}
                              {starredIds.has(client.id) && <span style={{ fontSize: 11, color: '#f59e0b' }}>★</span>}
                              {dl && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: dl.urgency === 'danger' ? '#fee2e2' : '#fef3c7', color: dl.urgency === 'danger' ? '#991b1b' : '#92400e' }}>📅 {dl.label}</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3 }}>
                              <span style={{ fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={11} color={t.text3} /> {client.email}</span>
                              {client.phone && <span style={{ fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} color={t.text3} /> {client.phone}</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => handleStar(client.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: starredIds.has(client.id) ? '#f59e0b' : t.text3 }} title={starredIds.has(client.id) ? 'Remover estrela' : 'Destacar'}><Star size={15} /></button>
                          <button onClick={() => navigate(`/admin/clients/${client.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: 'none', cursor: 'pointer', fontSize: 12, color: t.text2 }}
                            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
                            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                          ><Eye size={13} /> Ver</button>
                          <button onClick={() => handleArchive(client.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: t.text3 }} title="Arquivar"><Archive size={14} /></button>
                          <button onClick={() => handleDelete(client.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#ef4444' }} title="Excluir"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Form Response Modal ──────────────────────────────────────────────────
function FormResponseModal({ formSubmission, planForm, clientId, onClose }: {
  formSubmission: any; planForm: any; clientId: string; onClose: () => void
}) {
  const formData = formSubmission?.form_data || {}
  const fields: any[] = (planForm?.fields || []).sort((a: any, b: any) => a.order - b.order)
  const fieldMap = Object.fromEntries(fields.map((f: any) => [f.id, f]))
  const [generatingPDF, setGeneratingPDF] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [lightboxName, setLightboxName] = useState<string>('imagem')
  const lightboxState = useHeicSafeSrc(lightboxUrl ?? undefined)
  const [downloadingLightbox, setDownloadingLightbox] = useState(false)

  const openLightbox = (url: string, suggestedName: string) => {
    setLightboxUrl(url)
    setLightboxName(suggestedName)
  }
  const closeLightbox = () => setLightboxUrl(null)

  // Download da foto aberta no lightbox.
  // Igual ao fetchBase64 do PDF: pra URL do Drive vai via proxy (CORS-safe),
  // pra outras URLs faz fetch direto. HEIC é convertido pra JPEG antes de
  // baixar — assim o arquivo abre em qualquer visualizador (sem precisar
  // de software que entenda HEIC). O nome do arquivo vem do `lightboxName`
  // que é definido no momento em que o lightbox é aberto.
  const handleDownloadLightboxImage = async () => {
    if (!lightboxUrl) return
    setDownloadingLightbox(true)
    try {
      let blob: Blob
      const driveId = extractDriveFileId(lightboxUrl)
      if (driveId) {
        blob = await driveStorage.fetchPhotoBlob(driveId)
      } else if (lightboxState.src && lightboxState.src.startsWith('blob:')) {
        // HEIC já foi convertido pelo hook; pega o blob diretamente
        const r = await fetch(lightboxState.src)
        blob = await r.blob()
      } else {
        const r = await fetch(lightboxUrl)
        blob = await r.blob()
      }

      // HEIC → JPEG antes de baixar
      let ext = 'jpg'
      if (await detectHeicFromBytes(blob)) {
        const heic2any = (await import('heic2any')).default
        const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 })
        blob = (Array.isArray(result) ? result[0] : result) as Blob
      } else if (blob.type === 'image/png') {
        ext = 'png'
      } else if (blob.type === 'image/webp') {
        ext = 'webp'
      }

      const safeName = lightboxName.replace(/[^a-zA-Z0-9._-]/g, '_')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeName}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[Lightbox] Download falhou:', e)
      alert('Não foi possível baixar a imagem.')
    } finally {
      setDownloadingLightbox(false)
    }
  }

  const downloadFormPhoto = async (url: string, name: string) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = name.replace(/[^a-zA-Z0-9._-]/g, '_') + '.jpg'
      document.body.appendChild(a); a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch { window.open(url, '_blank') }
  }

  const isImageUrl = (val: any): boolean =>
    typeof val === 'string' && (val.startsWith('http') || val.startsWith('blob:') || val.startsWith('data:image'))

  const getImageUrls = (value: any): string[] => {
    if (!value) return []
    if (typeof value === 'string' && isImageUrl(value)) return [value]
    if (Array.isArray(value)) {
      // Novo formato salvo pelo ImageUploadFormField: [{storagePath, url}]
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'url' in value[0]) {
        return (value as { url: string }[]).map(v => v.url).filter(isImageUrl)
      }
      // Formato legado: array de strings de URL
      return value.filter(isImageUrl)
    }
    return []
  }

  const getTextValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return '—'
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  // Tenta extrair o file ID de uma URL do Google Drive (qualquer formato comum).
  const extractDriveFileId = (url: string): string | null => {
    // drive.google.com/thumbnail?id=XXX  |  drive.google.com/uc?...&id=XXX
    const q = url.match(/[?&]id=([^&]+)/)
    if (q) return q[1]
    // drive.google.com/file/d/XXX/... | /folders/XXX
    const p = url.match(/\/(?:file\/d|folders)\/([^/?#]+)/)
    if (p) return p[1]
    return null
  }

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result as string)
      reader.onerror = rej
      reader.readAsDataURL(blob)
    })

  // Detecta HEIC/HEIF inspecionando os primeiros bytes (caixa ISOBMFF 'ftyp').
  // Funciona mesmo quando a URL não tem extensão (caso típico das thumbs do Drive).
  const detectHeicFromBytes = async (blob: Blob): Promise<boolean> => {
    try {
      const buf = await blob.slice(0, 12).arrayBuffer()
      const b = new Uint8Array(buf)
      if (b.length < 12) return false
      // bytes 4..7 = 'ftyp'
      if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
      return ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc', 'hevx'].includes(brand)
    } catch { return false }
  }

  // Converte qualquer Blob (incluindo HEIC) em data:URL de imagem que o jsPDF
  // consegue embutir. HEIC → JPEG via heic2any; demais formatos passam direto.
  const blobToPdfImageBase64 = async (blob: Blob): Promise<string | null> => {
    try {
      if (await detectHeicFromBytes(blob)) {
        const heic2any = (await import('heic2any')).default
        const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 })
        const converted = (Array.isArray(result) ? result[0] : result) as Blob
        return await blobToBase64(converted)
      }
      return await blobToBase64(blob)
    } catch (e) {
      console.warn('[PDF] Falha ao preparar imagem:', e)
      return null
    }
  }

  // Busca uma imagem como base64 pronto pra embutir no PDF.
  //
  // O fetch direto em URLs do Drive (drive.google.com/thumbnail?...) falha por
  // CORS no browser, e era esse o motivo do PDF antigo sair sem as imagens.
  // Solução: quando a URL aponta pro Drive, baixamos via proxy `/photo-proxy`
  // da Edge Function, que vem com CORS liberado. Pra URLs blob:/data:/outras,
  // usamos fetch direto. Em ambos os casos, detectamos HEIC pelos bytes e
  // convertemos pra JPEG antes de devolver — jsPDF não embute HEIC.
  const fetchBase64 = async (url: string): Promise<string | null> => {
    try {
      let blob: Blob
      const driveId = extractDriveFileId(url)
      if (driveId) {
        blob = await driveStorage.fetchPhotoBlob(driveId)
      } else {
        const resp = await fetch(url)
        if (!resp.ok) return null
        blob = await resp.blob()
      }
      return await blobToPdfImageBase64(blob)
    } catch (e) {
      console.warn('[PDF] fetchBase64 falhou para', url, e)
      return null
    }
  }

  // ─── PDF builder (pure) ──────────────────────────────────────────────────
  //
  // Monta o blob do PDF sem qualquer side-effect (não baixa, não envia pro
  // Drive). É usado tanto pelo botão de download quanto pelo auto-upload na
  // abertura do modal, garantindo que o arquivo é exatamente o mesmo.
  //
  // Layout — combina com o exemplo desejado pela usuária:
  //   1. Cabeçalho: data + título "Coloração Pessoal Online" + "Formulário"
  //   2. Para cada pergunta:
  //       • Nome da pergunta em negrito
  //       • Imagens renderizadas LARGAS, logo abaixo do enunciado
  //       • Respostas de texto em parágrafo abaixo do enunciado
  const buildFormPDFBlob = async (): Promise<Blob> => {
    const { default: jsPDF } = await import('jspdf')
    const pdf = new jsPDF()
    const pageW = pdf.internal.pageSize.width
    const pageH = pdf.internal.pageSize.height
    const margin = 20
    const maxW = pageW - margin * 2
    let y = 20

    const checkPage = (space = 20) => {
      if (y + space > pageH - margin) { pdf.addPage(); y = margin }
    }
    const hline = () => {
      pdf.setDrawColor(220, 220, 220)
      pdf.line(margin, y, pageW - margin, y)
      y += 6
    }

    // Cabeçalho
    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(130, 130, 130)
    const dateStr = formSubmission?.submitted_at
      ? new Date(formSubmission.submitted_at).toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      : ''
    pdf.text(dateStr, pageW - margin - pdf.getTextWidth(dateStr), y); y += 10

    pdf.setFontSize(18); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0)
    pdf.text('Coloração Pessoal Online', margin, y); y += 8
    pdf.setFontSize(12); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80, 80, 80)
    pdf.text('Formulário', margin, y); y += 10
    hline()

    // Campos ordenados (mesma lógica usada na renderização da tela)
    const ordered: [string, any][] = (() => {
      const result: [string, any][] = []
      const handled = new Set<string>()
      for (const f of fields as any[]) {
        if (formData[f.id] !== undefined) {
          result.push([f.id, formData[f.id]])
          handled.add(f.id)
        }
        const obsKey = Object.keys(formData).find(k => k.toLowerCase() === `${f.id}__obs`)
        if (obsKey && formData[obsKey] !== undefined) {
          result.push([obsKey, formData[obsKey]])
          handled.add(obsKey)
        }
      }
      Object.keys(formData).filter(k => !handled.has(k)).forEach(k => result.push([k, formData[k]]))
      return result
    })()

    for (let i = 0; i < ordered.length; i++) {
      const [key, value] = ordered[i]
      const field = fieldMap[key]
      const label = (() => {
        if (field) return field.label
        if (key.toLowerCase().endsWith('__obs')) {
          const parentId = key.replace(/__obs$/i, '')
          const parentField = fieldMap[parentId]
          return parentField?.conditionalLabel || 'Observação'
        }
        return key
      })()
      const imgUrls = getImageUrls(value)
      const isImg = field?.type === 'image' || imgUrls.length > 0

      checkPage(30)

      // Pergunta em negrito — texto escuro pra dar mais legibilidade
      pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(20, 20, 20)
      const qLines = pdf.splitTextToSize(`${i + 1}. ${label}`, maxW)
      qLines.forEach((line: string) => { checkPage(); pdf.text(line, margin, y); y += 6 })
      y += 3

      if (isImg) {
        if (imgUrls.length === 0) {
          pdf.setFontSize(10); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(160, 160, 160)
          pdf.text('(Nenhuma imagem enviada)', margin + 5, y); y += 8
        } else {
          // Imagens em LARGURA TOTAL, uma por linha — formato que a usuária pediu.
          // Cada imagem é alta o suficiente pra ler detalhes (rosto, cabelo, etc).
          // Limite de altura: 70% da página, pra evitar imagens gigantescas que
          // estouram a página.
          const maxImgH = pageH * 0.7
          for (const url of imgUrls) {
            const b64 = await fetchBase64(url)
            if (!b64) {
              pdf.setFontSize(9); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(180, 100, 100)
              pdf.text('(Imagem não pôde ser carregada)', margin + 5, y); y += 6
              continue
            }
            try {
              const props = pdf.getImageProperties(b64)
              const ratio = props.width / props.height
              // Caber em largura E altura
              let drawW = maxW
              let drawH = drawW / ratio
              if (drawH > maxImgH) {
                drawH = maxImgH
                drawW = drawH * ratio
              }
              // Se a imagem não cabe no espaço restante da página, vai pra próxima
              if (y + drawH + 10 > pageH - margin) { pdf.addPage(); y = margin }
              // Detecta formato pelo prefixo do data URL pra evitar warnings do jsPDF
              const fmt = b64.startsWith('data:image/png') ? 'PNG'
                       : b64.startsWith('data:image/webp') ? 'WEBP'
                       : 'JPEG'
              pdf.addImage(b64, fmt, margin, y, drawW, drawH)
              y += drawH + 8
            } catch (e) {
              console.warn('[PDF] addImage falhou:', e)
            }
          }
        }
      } else {
        pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(60, 60, 60)
        const lines = pdf.splitTextToSize(getTextValue(value), maxW - 10)
        lines.forEach((line: string) => { checkPage(); pdf.text(line, margin + 5, y); y += 6 })
        y += 4
      }

      if (i < ordered.length - 1) {
        pdf.setDrawColor(235, 235, 235)
        pdf.line(margin, y, pageW - margin, y)
        y += 8
      }
    }

    // Rodapé em todas as páginas
    const total = (pdf as any).internal.pages.length - 1
    for (let p = 1; p <= total; p++) {
      pdf.setPage(p)
      pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(160, 160, 160)
      const pg = `Página ${p} de ${total}`
      pdf.text(pg, pageW - margin - pdf.getTextWidth(pg), pageH - 10)
    }

    return pdf.output('blob')
  }

  // ─── Botão "PDF" do header — só baixa local, NÃO envia pro Drive ─────────
  //
  // Antes este handler também subia o PDF pro Drive com kind='admin_photo',
  // o que (a) criava uma entrada de foto vinculada à cliente e (b) duplicava
  // o arquivo toda vez que o admin clicasse. Agora ele só baixa local.
  // O upload pro Drive acontece automaticamente no useEffect logo abaixo,
  // uma única vez por abertura do modal.
  const handleDownloadPDF = async () => {
    setGeneratingPDF(true)
    try {
      const blob = await buildFormPDFBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Formulario.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      alert('Erro ao gerar PDF. Tente novamente.')
    } finally {
      setGeneratingPDF(false)
    }
  }

  // ─── Auto-upload do PDF pro Drive ─────────────────────────────────────────
  //
  // Quando o modal abre, geramos o PDF e enviamos pra subpasta "Formulário"
  // dentro da pasta da cliente, junto das fotos do formulário. O ideal seria
  // disparar isso no momento em que a cliente envia o formulário (lado do
  // cliente / Edge Function), mas como stop-gap fazemos aqui na primeira vez
  // que o admin abre o modal.
  //
  // Importante: usamos kind='form_pdf' (em vez de 'admin_photo'), pra que a
  // Edge Function envie só pro Drive SEM criar entrada em client_photos —
  // assim o PDF não aparece "vinculado às fotos" da cliente. Veja a nota no
  // final do arquivo sobre a alteração necessária na Edge Function.
  const driveUploadedRef = useRef(false)
  useEffect(() => {
    if (driveUploadedRef.current) return
    if (!clientId || !formSubmission?.id) return
    driveUploadedRef.current = true

    let cancelled = false
    ;(async () => {
      try {
        const blob = await buildFormPDFBlob()
        if (cancelled) return
        const file = new File([blob], 'Formulario.pdf', { type: 'application/pdf' })

        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const fd = new FormData()
        fd.append('kind', 'form_pdf')          // ⚠ requer suporte na Edge Function
        fd.append('client_id', clientId)
        fd.append('subfolder', 'Formulário')
        fd.append('file', file)

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive/upload`
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: fd,
        })
        if (!res.ok) {
          console.warn('[PDF] Upload silencioso falhou:', res.status, await res.text().catch(() => ''))
        }
      } catch (e) {
        // Falha silenciosa: o admin ainda pode baixar pelo botão.
        console.warn('[PDF] Auto-upload pro Drive falhou:', e)
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, formSubmission?.id])

  const orderedEntries: [string, any][] = (() => {
    const result: [string, any][] = []
    const handled = new Set<string>()
    for (const f of fields as any[]) {
      if (formData[f.id] !== undefined) {
        result.push([f.id, formData[f.id]])
        handled.add(f.id)
      }
      // Insere a observação condicional logo após o campo pai
      const obsKey = Object.keys(formData).find(k => k.toLowerCase() === `${f.id}__obs`)
      if (obsKey && formData[obsKey] !== undefined) {
        result.push([obsKey, formData[obsKey]])
        handled.add(obsKey)
      }
    }
    // Chaves não reconhecidas (sem campo correspondente e sem __obs mapeado)
    Object.keys(formData).filter(k => !handled.has(k)).forEach(k => result.push([k, formData[k]]))
    return result
  })()

  return (
    <>
      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4" onClick={closeLightbox}>
          {/* Botões no canto superior direito: baixar + fechar.
              stopPropagation no container pra que clicar nos botões não feche o lightbox. */}
          <div className="absolute top-4 right-4 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={handleDownloadLightboxImage}
              disabled={downloadingLightbox || lightboxState.loading || !!lightboxState.error}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg backdrop-blur-sm transition-colors"
              title="Baixar imagem"
            >
              {downloadingLightbox
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">Baixar</span>
            </button>
            <button
              onClick={closeLightbox}
              className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Fechar"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
          {lightboxState.loading ? (
            <div className="text-white text-center" onClick={e => e.stopPropagation()}>
              <Loader2 className="h-12 w-12 animate-spin mx-auto mb-3" />
              <p className="text-sm">Convertendo HEIC...</p>
              <p className="text-xs text-white/60 mt-1">Fotos do iPhone precisam ser convertidas</p>
            </div>
          ) : lightboxState.error || !lightboxState.src ? (
            <div className="text-white text-center" onClick={e => e.stopPropagation()}>
              <AlertCircle className="h-12 w-12 mx-auto mb-3" />
              <p className="text-sm">Não foi possível carregar a imagem</p>
            </div>
          ) : (
            <img src={lightboxState.src} alt="Imagem ampliada" className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />
          )}
        </div>
      )}

      <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[95dvh] sm:max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0">
            <h2 className="text-base sm:text-lg font-bold text-gray-900">Respostas do Formulário</h2>
            <div className="flex items-center gap-2">
              <Btn variant="outline" size="sm" onClick={handleDownloadPDF} loading={generatingPDF}>
                <Download className="h-3.5 w-3.5" /> PDF
              </Btn>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4 space-y-5">
            {orderedEntries.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">Nenhuma resposta encontrada</p>
            ) : (
              orderedEntries.map(([key, value], i) => {
                const field = fieldMap[key]
                // Resolve label: para chaves __obs, usa conditionalLabel do campo pai
                const label = (() => {
                  if (field) return field.label
                  if (key.toLowerCase().endsWith('__obs')) {
                    const parentId = key.replace(/__obs$/i, '')
                    const parentField = fieldMap[parentId]
                    return parentField?.conditionalLabel || 'Observação'
                  }
                  return key
                })()
                const imgUrls = getImageUrls(value)
                const isImg = field?.type === 'image' || imgUrls.length > 0
                return (
                  <div key={key} className="space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{i + 1}. {label}</p>
                    {isImg ? (
                      imgUrls.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">Nenhuma imagem</p>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {imgUrls.map((url, idx) => (
                            <SafeImage key={idx} src={url} alt={`${label} ${idx + 1}`} className="w-full aspect-square object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity" onClick={() => openLightbox(url, `${label}_${idx + 1}`)} />
                          ))}
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-2.5 whitespace-pre-wrap">{getTextValue(value)}</p>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Photo Lightbox ───────────────────────────────────────────────────────
function PhotoLightbox({ photos: initialPhotos, initialIndex, onClose, onDelete, onPhotoRotated }: { photos: any[]; initialIndex: number; onClose: () => void; onDelete?: (photo: any) => Promise<void>; onPhotoRotated?: (photoId: string, blobUrl: string, newDriveFileId: string) => void }) {
  const [photos, setPhotos] = useState(initialPhotos)
  const [index, setIndex] = useState(initialIndex)

  // Sincroniza com props quando o pai atualiza URLs (ex: após rotação).
  // Preserva _blobUrl já definido internamente: o blob local é mais atual
  // que a URL do Drive (que ainda pode estar cacheada).
  useEffect(() => {
    setPhotos(prev => initialPhotos.map((incoming: any) => {
      const existing = prev.find((p: any) => p.id === incoming.id)
      if (existing?._blobUrl) return { ...incoming, url: existing._blobUrl, _blobUrl: existing._blobUrl }
      return incoming
    }))
  }, [initialPhotos])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  // pointersRef: pointers ativos (id → posição atual). Suporta multi-touch.
  // dragRef:   estado de pan com 1 dedo. Só efetiva o pan se zoom > 1.
  // pinchRef:  estado inicial do pinch (2 dedos): distância, zoom e pan no
  //            momento em que o segundo dedo desceu, mais o ponto-âncora.
  // panRef:    cópia ref do `pan` pra usar dentro de handlers sem precisar
  //            do React re-renderizar o handler.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const dragRef = useRef<{ panX: number; panY: number; startX: number; startY: number } | null>(null)
  const pinchRef = useRef<{ startDist: number; startZoom: number; startPanX: number; startPanY: number; anchorX: number; anchorY: number } | null>(null)
  // Swipe horizontal (1 dedo, sem zoom) pra navegar entre fotos/categorias.
  // Só é considerado swipe se o gesto nunca virou pinch (2 dedos).
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const gestureWasPinchRef = useRef(false)
  const panRef = useRef(pan)
  useEffect(() => { panRef.current = pan }, [pan])
  const imgContainerRef = useRef<HTMLDivElement>(null)
  const [deleting, setDeleting] = useState(false)
  const [rotating, setRotating] = useState(false)

  const handleRotate = async () => {
    if (!photo?.drive_file_id || rotating) return
    console.log('[rotate] iniciando para drive_file_id:', photo.drive_file_id)
    setRotating(true)
    const prevBlobUrl = photo._blobUrl as string | undefined
    try {
      console.log('[rotate] 1/3 baixando foto via photo-proxy...')
      const current = await driveStorage.fetchPhotoBlob(photo.drive_file_id, { bust: true })
      console.log('[rotate] 2/3 foto baixada, tamanho:', current.size, '— girando no canvas...')
      const { rotateImageBlob } = await import('../../lib/imageOrientation')
      const rotated = await rotateImageBlob(current, 90)
      console.log('[rotate] 3/3 girado, tamanho:', rotated.size, '— enviando pro Drive...')
      const newDriveFileId = await driveStorage.replaceDrivePhoto(photo.drive_file_id, rotated, photo.id)
      console.log('[rotate] sucesso! novo drive_file_id:', newDriveFileId)

      const blobUrl = URL.createObjectURL(rotated)
      if (prevBlobUrl) { try { URL.revokeObjectURL(prevBlobUrl) } catch {} }

      setPhotos(prev => prev.map((p: any, i: number) =>
        i === index
          ? { ...p, url: blobUrl, _blobUrl: blobUrl, drive_file_id: newDriveFileId }
          : p
      ))
      onPhotoRotated?.(photo.id, blobUrl, newDriveFileId)
      setZoom(1)
    } catch (e: any) {
      console.error('[rotate] ERRO:', e)
      alert(`Erro ao girar foto: ${e?.message || 'erro desconhecido'}`)
    } finally {
      setRotating(false)
    }
  }
  const prev = useCallback(() => { setIndex(i => (i - 1 + photos.length) % photos.length); setZoom(1) }, [photos.length])
  const next = useCallback(() => { setIndex(i => (i + 1) % photos.length); setZoom(1) }, [photos.length])
  // Sempre que o zoom voltar pra 1 (ou menor), recentra a imagem. Isso roda
  // tanto quando o usuário clica em "zoom out" até o fim, quanto quando prev/
  // next/thumbnail forçam zoom=1.
  useEffect(() => { if (zoom <= 1) setPan({ x: 0, y: 0 }) }, [zoom])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(); if (e.key === 'ArrowLeft') prev(); if (e.key === 'ArrowRight') next()
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.5, 4)); if (e.key === '-') setZoom(z => Math.max(z - 0.5, 0.5))
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [prev, next, onClose])
  const photo = photos[index]
  const mainImage = useDrivePhotoSrc(photo)

  // ── Drag (1 dedo / mouse) + Pinch (2 dedos) via Pointer Events ──
  // Handlers ficam no container — não na <img> — porque o 2º dedo do pinch
  // pode pousar fora da imagem. setPointerCapture mantém o evento mesmo se
  // o dedo arrastar pra fora do container.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignora pointerdown nos botões prev/next que vivem dentro do container
    if ((e.target as HTMLElement).closest('button')) return
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const count = pointersRef.current.size
    if (count === 1) {
      // Inicia drag — só pan'ará no move se zoom > 1
      dragRef.current = { panX: panRef.current.x, panY: panRef.current.y, startX: e.clientX, startY: e.clientY }
      // Candidato a swipe (navegação entre fotos) — só se confirma no pointerup
      // se o zoom continuar <= 1 e o gesto nunca virou pinch.
      swipeStartRef.current = { x: e.clientX, y: e.clientY }
      gestureWasPinchRef.current = false
    } else if (count === 2) {
      // Inicia pinch — cancela qualquer drag/swipe em andamento
      dragRef.current = null
      swipeStartRef.current = null
      gestureWasPinchRef.current = true
      const pts = Array.from(pointersRef.current.values())
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const container = imgContainerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      pinchRef.current = {
        startDist: dist,
        startZoom: zoom,
        startPanX: panRef.current.x,
        startPanY: panRef.current.y,
        // Âncora = ponto médio do pinch, em coords relativas ao centro do container
        anchorX: midX - (rect.left + rect.width / 2),
        anchorY: midY - (rect.top + rect.height / 2),
      }
      setDragging(true) // desliga animação durante o gesto
    }
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pinchRef.current && pointersRef.current.size >= 2) {
      // Pinch ativo: zoom = (distância atual / distância inicial) * zoom inicial,
      // ancorado no ponto médio inicial. Mesma matemática do wheel zoom.
      const pts = Array.from(pointersRef.current.values()).slice(0, 2)
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const ps = pinchRef.current
      const newZoom = Math.max(0.5, Math.min(4, ps.startZoom * (dist / ps.startDist)))
      if (newZoom > 1) {
        const r = newZoom / ps.startZoom
        setPan({ x: ps.anchorX - (ps.anchorX - ps.startPanX) * r, y: ps.anchorY - (ps.anchorY - ps.startPanY) * r })
      }
      setZoom(newZoom)
    } else if (dragRef.current && pointersRef.current.size === 1 && zoom > 1) {
      // Pan com 1 dedo (só quando há zoom)
      const d = dragRef.current
      setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) })
      if (!dragging) setDragging(true)
    }
  }
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.delete(e.pointerId)
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId) } catch {}
    const count = pointersRef.current.size
    if (count < 2 && pinchRef.current) {
      pinchRef.current = null
      // Transição pinch → drag: se sobrou 1 dedo, re-inicia drag a partir dele.
      // Sem isso, a imagem "trava" depois de pinch até o usuário levantar todos
      // os dedos e tocar de novo.
      if (count === 1) {
        const [remaining] = Array.from(pointersRef.current.values())
        dragRef.current = { panX: panRef.current.x, panY: panRef.current.y, startX: remaining.x, startY: remaining.y }
      }
    }
    if (count === 0) {
      // Resolve swipe: só navega se foi um arrasto de 1 dedo, sem zoom ativo
      // e sem ter virado pinch em algum momento do gesto.
      if (swipeStartRef.current && zoom <= 1 && !gestureWasPinchRef.current && photos.length > 1) {
        const dx = e.clientX - swipeStartRef.current.x
        const dy = e.clientY - swipeStartRef.current.y
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx > 0) prev(); else next()
        }
      }
      swipeStartRef.current = null
      dragRef.current = null
      setDragging(false)
    }
  }

  // ── Zoom via scroll do mouse (ancorado no cursor) ──
  // Não chamamos preventDefault: o lightbox é fixed inset-0 com overflow-hidden
  // em todos os ancestrais, então não há scroll de página pra travar.
  // O fator exp(-deltaY * 0.002) dá ~18% de mudança por "click" de mouse wheel
  // (deltaY≈100) e mudanças graduais em trackpad (deltaY≈10 por evento).
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = imgContainerRef.current
    if (!container) return
    const factor = Math.exp(-e.deltaY * 0.002)
    const newZoom = Math.max(0.5, Math.min(4, zoom * factor))
    if (newZoom === zoom) return
    const rect = container.getBoundingClientRect()
    // Coordenadas do cursor relativas ao centro do container (= centro visual
    // da imagem quando pan=0). Pra cursor-anchored zoom: o ponto da imagem
    // sob o cursor antes do zoom deve continuar sob o cursor depois.
    const cx = e.clientX - (rect.left + rect.width / 2)
    const cy = e.clientY - (rect.top + rect.height / 2)
    if (newZoom > 1) {
      const ratio = newZoom / zoom
      setPan({ x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio })
    }
    // newZoom <= 1: o useEffect existente já reseta pan pra {0,0}.
    setZoom(newZoom)
  }

  const handleDownload = async () => {
    try {
      // Se for HEIC e já temos a versão JPEG convertida em cache, baixa o JPEG (mais útil)
      if (photo && isLikelyHeic(photo.url, photo.photo_name)) {
        const cachedJpeg = __heicCache.get(photo.url)
        if (cachedJpeg) {
          const a = document.createElement('a')
          a.href = cachedJpeg
          a.download = (photo.photo_name || 'foto').replace(/\.(heic|heif)$/i, '.jpg')
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          return
        }
      }

      // Fotos do Drive: usa o proxy autenticado da Edge Function. fetch()
      // direto em drive.google.com/thumbnail não funciona — sem header CORS.
      let blob: Blob
      if (photo.drive_file_id) {
        blob = await driveStorage.fetchPhotoBlob(photo.drive_file_id)
      } else {
        const res = await fetch(photo.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        blob = await res.blob()
      }

      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = photo.photo_name || 'foto'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Pequeno delay antes de revogar pra alguns browsers (Safari) terem
      // tempo de iniciar o download usando a URL antes dela ser invalidada.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch (e: any) {
      console.error('[PhotoLightbox] handleDownload error:', e)
      alert(`Não foi possível baixar a foto: ${e?.message || 'erro desconhecido'}`)
    }
  }
  const handleDelete = async () => {
    if (!onDelete || deleting) return
    if (!confirm(`Excluir a foto "${photo.photo_name}"? Esta ação não pode ser desfeita.`)) return
    setDeleting(true)
    try {
      await onDelete(photo)
      const newPhotos = photos.filter((_, i) => i !== index)
      if (newPhotos.length === 0) { onClose(); return }
      setPhotos(newPhotos)
      setIndex(i => Math.min(i, newPhotos.length - 1))
      setZoom(1)
    } catch (e: any) {
      alert(`Erro ao excluir: ${e.message}`)
    } finally {
      setDeleting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/95 flex flex-col" style={{ zIndex: 2147483647 }} onClick={onClose}>
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-3 bg-black/40 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <div className="flex-1 min-w-0">
          {photo._categoryLabel && (
            <p className="text-pink-300 text-[10px] sm:text-xs font-semibold uppercase tracking-wide truncate">{photo._categoryLabel}</p>
          )}
          <p className="text-white text-xs sm:text-sm font-medium truncate">{photo.photo_name}</p>
        </div>

        {/* Grupo de ações: pode encolher e rolar na horizontal em telas estreitas,
            assim o botão de fechar (fora deste grupo) nunca é cortado no mobile. */}
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto flex-shrink min-w-0">
          <button onClick={() => setZoom(z => Math.max(z - 0.5, 0.5))} className="flex-shrink-0 p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation"><ZoomOut className="h-5 w-5 sm:h-4 sm:w-4" /></button>
          <span className="text-white/70 text-xs w-10 text-center hidden sm:block">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(z + 0.5, 4))} className="flex-shrink-0 p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation"><ZoomIn className="h-5 w-5 sm:h-4 sm:w-4" /></button>
          <button onClick={handleDownload} className="flex-shrink-0 p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation"><Download className="h-5 w-5 sm:h-4 sm:w-4" /></button>
          {photo?.drive_file_id && (
            <button
              onClick={handleRotate}
              disabled={rotating}
              className="flex-shrink-0 p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation disabled:opacity-40"
              title="Girar foto 90° (salva no Drive)"
            >
              {rotating
                ? <Loader2 className="h-5 w-5 sm:h-4 sm:w-4 animate-spin" />
                : <RotateCcw className="h-5 w-5 sm:h-4 sm:w-4" />}
            </button>
          )}
          {onDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-shrink-0 p-2.5 sm:p-2 text-red-400 hover:text-red-300 active:bg-red-500/20 hover:bg-red-500/10 rounded-lg touch-manipulation disabled:opacity-40"
              title="Excluir foto"
            >
              {deleting ? <Loader2 className="h-5 w-5 sm:h-4 sm:w-4 animate-spin" /> : <Trash2 className="h-5 w-5 sm:h-4 sm:w-4" />}
            </button>
          )}
          <span className="text-white/40 text-xs px-1 flex-shrink-0">{index + 1}/{photos.length}</span>
        </div>

        {/* Fechar: fora do grupo, fixo. Nunca encolhe nem sai da tela no mobile. */}
        <button onClick={onClose} className="flex-shrink-0 p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation"><X className="h-5 w-5" /></button>
      </div>
      <div
        ref={imgContainerRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex-1 flex items-center justify-center overflow-hidden relative"
        // touchAction: 'none' impede que o browser interprete os toques como
        // scroll/pinch-zoom nativo da página — quem cuida dos gestos é a gente.
        style={{ touchAction: 'none' }}
        onClick={e => e.stopPropagation()}
      >
        {photos.length > 1 && <button onClick={prev} className="absolute left-2 sm:left-4 z-10 p-3 sm:p-3 bg-black/50 hover:bg-black/70 active:bg-black/80 rounded-full text-white touch-manipulation"><ChevronLeft className="h-6 w-6" /></button>}
        {mainImage.loading ? (
          <div className="text-white text-center px-6">
            <Loader2 className="h-12 w-12 animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium">Carregando foto...</p>
            <p className="text-xs text-white/60 mt-1">Baixando do Drive (HEIC do iPhone é convertido)</p>
          </div>
        ) : mainImage.error || !mainImage.src ? (
          <div className="text-white text-center px-6">
            <AlertCircle className="h-12 w-12 mx-auto mb-3" />
            <p className="text-sm">Não foi possível carregar a imagem</p>
            <p className="text-xs text-white/60 mt-1 break-all">{photo.photo_name}</p>
          </div>
        ) : (
          <img
            key={mainImage.src}
            src={mainImage.src}
            alt={photo.photo_name}
            className="max-w-full max-h-full object-contain select-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              // Sem animação durante o arrasto/pinch pra acompanhar o gesto 1:1;
              // animação curta só pra zoom in/out via botão/teclado.
              transition: dragging ? 'none' : 'transform 0.2s',
              cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
            }}
            draggable={false}
          />
        )}
        {photos.length > 1 && <button onClick={next} className="absolute right-2 sm:right-4 z-10 p-3 sm:p-3 bg-black/50 hover:bg-black/70 active:bg-black/80 rounded-full text-white touch-manipulation"><ChevronRight className="h-6 w-6" /></button>}
      </div>
      {photos.length > 1 && (
        <div className="flex-shrink-0 bg-black/60 py-2 sm:py-3 px-4" onClick={e => e.stopPropagation()}>
          <div className="flex gap-1.5 sm:gap-2 justify-center overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => { setIndex(i); setZoom(1) }} className={`flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden transition-all touch-manipulation ${i === index ? 'ring-2 ring-rose-400 opacity-100' : 'opacity-50 hover:opacity-80'}`}>
                <DrivePhotoImg photo={p} alt={p.photo_name} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

// ─── Photo Thumbnail ──────────────────────────────────────────────────────
function PhotoThumb({ photo, onClick }: { photo: any; onClick: () => void }) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="relative aspect-square rounded-lg sm:rounded-xl overflow-hidden bg-gray-200 cursor-pointer group hover:ring-2 hover:ring-rose-400 transition-all touch-manipulation active:opacity-80"
      onClick={onClick}
    >
      {(!loaded || !visible) && !error && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <Camera className="h-6 w-6 text-gray-300" />
        </div>
      ) : visible ? (
        <SafeImage
          src={photo.url}
          fileName={photo.photo_name}
          alt={photo.photo_name}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => { setError(true); setLoaded(true) }}
        />
      ) : null}
      {loaded && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
          <Maximize2 className="h-5 w-5 sm:h-6 sm:w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}
    </div>
  )
}

// ─── Photos View ──────────────────────────────────────────────────────────
function PhotosView({ clientId, photos, photoCategories, clientToken, clientName, onPhotosChange }: { clientId: string; photos: any[]; photoCategories: any[]; clientToken: string; clientName?: string; onPhotosChange?: () => void }) {
  const { theme: t } = useTheme()
  const [photosWithUrls, setPhotosWithUrls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  // Guarda apenas o índice GLOBAL (na lista combinada de todas as categorias),
  // não um snapshot de fotos. Assim ao fechar e reabrir, sempre deriva do
  // photosWithUrls atual — inclui qualquer blob URL atualizado pela rotação —
  // e a navegação no carrossel passa naturalmente de uma categoria pra outra.
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null)
  const [uploadingToCategory, setUploadingToCategory] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const handleDeletePhoto = async (photo: any) => {
    // Legado (Supabase Storage): apaga do bucket antes de remover do banco
    if (!photo.drive_file_id && photo.storage_path) {
      const { error: storageError } = await supabase.storage
        .from('client-photos')
        .remove([photo.storage_path])
      if (storageError) throw storageError
    }
    // Drive: o arquivo fica no Drive até o cleanup automático (cron 21d após análise)
    // Aqui só removemos o registro do banco
    const { error: dbError } = await supabase
      .from('client_photos')
      .delete()
      .eq('id', photo.id)
    if (dbError) throw dbError

    setPhotosWithUrls(prev => prev.filter(p => p.id !== photo.id))
    onPhotosChange?.()
  }
  const [selectedCategoryForUpload, setSelectedCategoryForUpload] = useState<string | null>(
    photoCategories.length > 0 ? photoCategories[0].id : null
  )

  const loadPhotos = useCallback(async () => {
    const p = await adminService.getClientPhotosWithUrls(clientId)
    setPhotosWithUrls(p)
    setLoading(false)
  }, [clientId])

  useEffect(() => { loadPhotos() }, [loadPhotos])

  const handleAdminUpload = async (categoryId: string | null, files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadingToCategory(categoryId ?? 'uploading')
    try {
      // Checa uma vez se o Drive está conectado. Se estiver, qualquer erro
      // na chamada de upload é considerado erro de verdade (NÃO faz fallback
      // silencioso pro Supabase Storage) — assim o admin vê o que aconteceu.
      // Se Drive não estiver conectado, cai direto pro fallback Supabase.
      let driveConnected = false
      try {
        const status = await driveStorage.getStatus()
        driveConnected = !!status.connected
      } catch (e) {
        console.warn('[handleAdminUpload] driveStorage.getStatus falhou:', e)
        driveConnected = false
      }

      const driveErrors: string[] = []
      for (const rawFile of Array.from(files)) {
        // Comprime antes de enviar — reduz drasticamente foto de celular
        // (12MP+/4-15MB) sem perda visível, e sem esperar o backend recusar
        // por tamanho. Se falhar por qualquer motivo, usa o arquivo original.
        const file = await compressImageFile(rawFile)
        if (driveConnected) {
          try {
            const result = await driveStorage.adminUploadPhoto({ clientId, file, categoryId })
            // A Edge Function pode ter caído no fallback Supabase do lado servidor
            // (drive_file_id volta null). Avisa pra não ficar invisível.
            if (!result.driveFileId) {
              console.warn(
                `[handleAdminUpload] "${file.name}" foi salva no Supabase Storage pelo servidor ` +
                `(Edge Function não conseguiu autenticar no Drive). Verifique a conexão do Drive em Configurações.`
              )
              driveErrors.push(`${file.name}: servidor não conseguiu autenticar no Drive (foto salva no Supabase)`)
            }
            continue
          } catch (e: any) {
            console.error(`[handleAdminUpload] Falha no upload Drive de "${file.name}":`, e)
            driveErrors.push(`${file.name}: ${e?.message || 'erro desconhecido'}`)
            // Não cai pro fallback Supabase: se o Drive está conectado, o erro é real
            // e o admin precisa ver. Pula esse arquivo.
            continue
          }
        }

        // Drive NÃO conectado: usa Supabase Storage direto (igual ao legado)
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${clientId}/admin_${Date.now()}_${safeName}`
        const { error: storageErr } = await supabase.storage
          .from('client-photos')
          .upload(path, file, { contentType: file.type, upsert: true })
        if (storageErr) throw storageErr
        const { error: dbErr } = await supabase.from('client_photos').insert({
          client_id: clientId,
          storage_path: path,
          photo_name: file.name,
          category_id: categoryId,
          photo_type: file.type,
          photo_size: file.size,
        })
        if (dbErr) throw dbErr
      }
      await loadPhotos()
      onPhotosChange?.()
      if (driveErrors.length > 0) {
        alert(
          `Drive falhou em ${driveErrors.length} foto(s):\n\n${driveErrors.join('\n')}\n\n` +
          `Veja o console pra detalhes. ` +
          `Se Drive estiver desconectado, reconecte em Configurações; ` +
          `enquanto isso, desconecte o Drive pra usar Supabase Storage como fallback.`
        )
      }
    } catch (e: any) {
      alert(`Erro ao fazer upload: ${e.message}`)
    } finally {
      setUploadingToCategory(null)
      setSelectedCategoryForUpload(photoCategories.length > 0 ? photoCategories[0].id : null)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  if (loading) return (
    <div className="space-y-5">
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-violet-200 rounded-lg animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-40 bg-violet-200 rounded animate-pulse" />
          <div className="h-2.5 w-56 bg-violet-100 rounded animate-pulse" />
        </div>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${t.border}` }}>
          <div className="space-y-1.5">
            <div className="h-4 w-36 rounded animate-pulse" style={{ background: t.surface2 }} />
            <div className="h-3 w-16 rounded animate-pulse" style={{ background: t.surface2 }} />
          </div>
          <div className="h-8 w-24 rounded-lg animate-pulse" style={{ background: t.surface2 }} />
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5 sm:gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg sm:rounded-xl animate-pulse" style={{ background: t.surface2, animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
  
  const photosByCat: Record<string, any[]> = {}
  const uncategorized: any[] = []
  photosWithUrls.forEach(p => { if (p.category_id) { if (!photosByCat[p.category_id]) photosByCat[p.category_id] = []; photosByCat[p.category_id].push(p) } else uncategorized.push(p) })
  const downloadZip = async (groups: { label: string; photos: any[] }[], zipName: string, busyKey: string) => {
    if (downloadingAll) return
    setDownloadingAll(busyKey)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const failed: string[] = []
      let totalPhotos = 0

      await Promise.all(
        groups.map(async ({ label, photos }) => {
          const folder = zip.folder(label) ?? zip
          await Promise.all(
            photos.map(async (p) => {
              totalPhotos++
              try {
                // Fotos do Drive: usa o proxy autenticado da Edge Function, igual
                // ao handleDownload do lightbox. fetch() direto na URL do Drive
                // não funciona — sem header CORS, falha silenciosa e o ZIP sai vazio.
                let blob: Blob
                if (p.drive_file_id) {
                  blob = await driveStorage.fetchPhotoBlob(p.drive_file_id)
                } else {
                  const res = await fetch(p.url)
                  if (!res.ok) throw new Error(`HTTP ${res.status}`)
                  blob = await res.blob()
                }
                folder.file(p.photo_name || `foto-${p.id || Math.random().toString(36).slice(2)}`, blob)
              } catch (e) {
                console.error('[downloadZip] falha ao baixar foto:', label, p.photo_name, e)
                failed.push(`${label}/${p.photo_name || 'foto sem nome'}`)
              }
            })
          )
        })
      )

      if (failed.length === totalPhotos) {
        throw new Error('Nenhuma foto pôde ser baixada (todas falharam)')
      }
      if (failed.length > 0) {
        console.warn(`[downloadZip] ${failed.length} de ${totalPhotos} fotos falharam:`, failed)
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${zipName}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e: any) {
      alert(`Erro ao gerar ZIP: ${e.message}`)
    } finally {
      setDownloadingAll(null)
    }
  }

  const downloadAll = (catPhotos: any[], label: string) =>
    downloadZip([{ label, photos: catPhotos }], label, label)

  // Lista combinada de TODAS as fotos, na ordem das categorias (+ sem categoria
  // por último), com _categoryLabel marcado em cada foto. Usada pro lightbox
  // navegar em carrossel único, passando de uma categoria pra outra.
  const allPhotosOrdered = (): any[] => {
    const combined: any[] = []
    photoCategories.forEach(cat => {
      const catPhotos = photosByCat[cat.id] || []
      catPhotos.forEach(p => combined.push({ ...p, _categoryLabel: cat.title }))
    })
    uncategorized.forEach(p => combined.push({ ...p, _categoryLabel: 'Sem categoria' }))
    return combined
  }

  const downloadAllCategories = () => {
    const groups: { label: string; photos: any[] }[] = []
    photoCategories.forEach(cat => {
      const catPhotos = photosByCat[cat.id] || []
      if (catPhotos.length > 0) groups.push({ label: cat.title, photos: catPhotos })
    })
    if (uncategorized.length > 0) groups.push({ label: 'Fotos sem categoria', photos: uncategorized })
    if (groups.length === 0) return
    const zipName = `Fotos - ${clientName || 'Cliente'}`
    downloadZip(groups, zipName, '__ALL__')
  }
  const hasPhotos = photosWithUrls.length > 0

  const CategoryCard = ({ title, catPhotos, label, categoryId }: { title: string; catPhotos: any[]; label: string; categoryId: string | null }) => (
    <div className="rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="w-12 h-12 bg-rose-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Camera className="h-6 w-6 text-rose-400" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate" style={{ color: t.text }}>{title}</p>
          <p className="text-sm mt-0.5" style={{ color: t.text3 }}>{catPhotos.length} foto{catPhotos.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Btn variant="outline" size="sm" onClick={() => downloadAll(catPhotos, label)} loading={downloadingAll === label} disabled={downloadingAll !== null}>
          <Download className="h-3.5 w-3.5" /> ZIP
        </Btn>
        <Btn variant="primary" size="sm" onClick={() => {
          if (catPhotos.length === 0) return
          const combined = allPhotosOrdered()
          const startIdx = combined.findIndex(p => p.id === catPhotos[0].id)
          setLightbox({ index: startIdx >= 0 ? startIdx : 0 })
        }}>
          <Eye className="h-3.5 w-3.5" /> Ver Fotos
        </Btn>
      </div>
    </div>
  )

  return (
    <>
      <div className="space-y-3">
        {/* Adicionar fotos */}
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Upload className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-violet-900">Adicionar fotos complementares</p>
              <p className="text-xs text-violet-600 mt-0.5">Faça upload de fotos adicionais pelo admin — fotos grandes são otimizadas automaticamente</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {photoCategories.length > 0 && (
              <select
                value={selectedCategoryForUpload || ''}
                onChange={e => setSelectedCategoryForUpload(e.target.value || null)}
                className="flex-1 sm:flex-none px-3 py-2 border border-violet-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white min-w-0"
              >
                {photoCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.title}</option>
                ))}
              </select>
            )}
            <input ref={uploadInputRef} type="file" multiple accept="image/*" className="hidden"
              onChange={e => handleAdminUpload(selectedCategoryForUpload ?? null, e.target.files)} />
            <Btn variant="primary" size="sm" onClick={() => uploadInputRef.current?.click()} loading={uploadingToCategory !== null} className="whitespace-nowrap">
              <Upload className="h-3.5 w-3.5" /> Adicionar Fotos
            </Btn>
          </div>
        </div>

        {/* Baixar tudo — só faz sentido com mais de uma categoria com fotos */}
        {(photoCategories.filter(cat => (photosByCat[cat.id] || []).length > 0).length + (uncategorized.length > 0 ? 1 : 0)) > 1 && (
          <div className="rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-12 h-12 bg-violet-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Download className="h-6 w-6 text-violet-500" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate" style={{ color: t.text }}>Baixar todas as fotos</p>
                <p className="text-sm mt-0.5" style={{ color: t.text3 }}>{photosWithUrls.length} foto{photosWithUrls.length !== 1 ? 's' : ''} em todas as categorias, organizadas em pastas</p>
              </div>
            </div>
            <Btn variant="primary" size="sm" onClick={downloadAllCategories} loading={downloadingAll === '__ALL__'} disabled={downloadingAll !== null} className="flex-shrink-0">
              <Download className="h-3.5 w-3.5" /> Baixar Tudo (ZIP)
            </Btn>
          </div>
        )}

        {/* Cards por categoria */}
        {photoCategories.map(cat => {
          const catPhotos = photosByCat[cat.id] || []
          if (catPhotos.length === 0) return null
          return <CategoryCard key={cat.id} title={cat.title} catPhotos={catPhotos} label={cat.title} categoryId={cat.id} />
        })}
        {uncategorized.length > 0 && (
          <CategoryCard title="Fotos sem categoria" catPhotos={uncategorized} label="Fotos" categoryId={null} />
        )}

        {!hasPhotos && (
          <div className="rounded-xl p-12 text-center" style={{ background: t.surface, border: `1px dashed ${t.border}` }}>
            <Camera className="h-10 w-10 mx-auto mb-3" style={{ color: t.text3 }} />
            <p style={{ color: t.text2 }}>Nenhuma foto enviada ainda</p>
            <p className="text-xs mt-2" style={{ color: t.text3 }}>Use o botão acima para adicionar fotos</p>
          </div>
        )}
      </div>
      {lightbox && (() => {
        // Deriva as fotos SEMPRE do photosWithUrls atual (nunca de um snapshot).
        // Assim ao fechar e reabrir, a foto já aparece girada sem recarregar do Drive.
        // Combina TODAS as categorias num único carrossel — a navegação passa
        // de uma categoria pra outra automaticamente.
        const liveAllPhotos = allPhotosOrdered()
        if (liveAllPhotos.length === 0) return null
        return (
          <PhotoLightbox
            photos={liveAllPhotos}
            initialIndex={Math.min(lightbox.index, liveAllPhotos.length - 1)}
            onClose={() => setLightbox(null)}
            onDelete={handleDeletePhoto}
            onPhotoRotated={(photoId, blobUrl, newDriveFileId) => {
              // Atualiza só photosWithUrls; o lightbox recomputa liveCatPhotos
              // no próximo render automaticamente, sem precisar atualizar lightbox.photos.
              setPhotosWithUrls(prev => prev.map(p =>
                p.id === photoId
                  ? { ...p, url: blobUrl, _blobUrl: blobUrl, drive_file_id: newDriveFileId }
                  : p
              ))
            }}
          />
        )
      })()}
    </>
  )
}

// ─── Folder Picker ────────────────────────────────────────────────────────
function FolderPicker({ folders, linkedFolderId, onSelect }: {
  folders: any[]
  linkedFolderId: string | null
  onSelect: (id: string | null) => void
}) {
  const { theme: t } = useTheme()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const selectedFolder = folders.find((f: any) => f.id === linkedFolderId)
  const filtered = folders.filter((f: any) => f.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all"
        style={{
          background: t.surface,
          borderColor: open ? '#8b5cf6' : t.border,
          boxShadow: open ? '0 0 0 2px rgba(139,92,246,0.15)' : 'none',
        }}
      >
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: selectedFolder ? 'rgba(139,92,246,0.15)' : t.surface2 }}>
          <FolderOpen className={`h-4 w-4 ${selectedFolder ? 'text-violet-600' : 'text-gray-400'}`} />
        </div>
        <div className="flex-1 min-w-0">
          {selectedFolder ? (() => {
            const cfg = typeof selectedFolder.config === 'string' ? JSON.parse(selectedFolder.config) : selectedFolder.config
            return (
              <>
                <p className="text-sm font-semibold" style={{ color: t.accent }}>{selectedFolder.name}</p>
                <p className="text-xs mt-0.5" style={{ color: t.text3 }}>{cfg?.categories?.length || 0} cat · {cfg?.categories?.reduce((s: number, c: any) => s + (c.prompts?.length || 0), 0) || 0} prompts</p>
              </>
            )
          })() : (
            <p className="text-sm" style={{ color: t.text3 }}>Selecione uma pasta…</p>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-1.5 left-0 right-0 rounded-xl shadow-2xl overflow-hidden" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
          {folders.length > 3 && (
            <div className="p-2" style={{ borderBottom: `1px solid ${t.border}` }}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: t.text3 }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar pasta..."
                  autoFocus
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                  style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }}
                />
              </div>
            </div>
          )}
          <div className="max-h-60 overflow-y-auto">
            <button
              onClick={() => { onSelect(null); setOpen(false) }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
              style={{ background: linkedFolderId === null ? t.accentLight : 'transparent' }}
              onMouseEnter={e => { if (linkedFolderId !== null) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
              onMouseLeave={e => { if (linkedFolderId !== null) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: t.surface2 }}>
                <FolderOpen className="h-3.5 w-3.5" style={{ color: t.text3 }} />
              </div>
              <span className="text-sm flex-1" style={{ color: t.text2 }}>Nenhuma pasta vinculada</span>
              {linkedFolderId === null && <Check className="h-3.5 w-3.5 flex-shrink-0" style={{ color: t.accent }} />}
            </button>
            {filtered.map((f: any) => {
              const cfg = typeof f.config === 'string' ? JSON.parse(f.config) : f.config
              const isLinked = linkedFolderId === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => { onSelect(f.id); setOpen(false); setSearch('') }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                  style={{ background: isLinked ? t.accentLight : 'transparent' }}
                  onMouseEnter={e => { if (!isLinked) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                  onMouseLeave={e => { if (!isLinked) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: isLinked ? t.accentLight : t.surface2 }}>
                    <FolderOpen className="h-3.5 w-3.5" style={{ color: isLinked ? t.accent : t.text3 }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: isLinked ? t.accent : t.text }}>{f.name}</p>
                    <p className="text-xs" style={{ color: t.text3 }}>{cfg?.categories?.length || 0} cat · {cfg?.categories?.reduce((s: number, c: any) => s + (c.prompts?.length || 0), 0) || 0} prompts</p>
                  </div>
                  {cfg?.driveLink && (
                    <a href={cfg.driveLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="flex-shrink-0 p-1" style={{ color: t.accent }}>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {isLinked && <Check className="h-3.5 w-3.5 flex-shrink-0" style={{ color: t.accent }} />}
                </button>
              )
            })}
            {filtered.length === 0 && search && <p className="text-xs text-center py-5" style={{ color: t.text3 }}>Nenhuma pasta encontrada</p>}
            {folders.length === 0 && !search && <p className="text-xs text-center py-5" style={{ color: t.text3 }}>Crie pastas em <strong>Pastas IA</strong> para vincular aqui</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers: tags do tipo IMAGEM ─────────────────────────────────────────
// Resolve um imagePath salvo em ai_info_templates.options para URL pública.
// Bucket é público pra leitura (catálogo de opções, não dado sensível).
const getOptionImageUrl = (imagePath: string): string => {
  if (!imagePath) return ''
  const { data } = supabase.storage
    .from('ai-tag-option-images')
    .getPublicUrl(imagePath)
  return data.publicUrl
}

// Normaliza uma opção: aceita string (formato antigo, type='text') ou
// objeto { label, imagePath } (type='image'). Retorna sempre objeto.
const normalizeTagOption = (opt: any): { label: string; imagePath: string } => {
  if (typeof opt === 'string') return { label: opt, imagePath: '' }
  return { label: opt?.label ?? '', imagePath: opt?.imagePath ?? '' }
}

// ─── Client Detail ────────────────────────────────────────────────────────
function ClientDetail({ onOpenNav }: { onOpenNav?: () => void }) {
  const { theme: t } = useTheme()
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(window.innerWidth >= 768)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'overview' | 'photos' | 'result' | 'documents' | 'ai' | 'chat'>('overview')
  const [docsSubTab, setDocsSubTab] = useState<'docs' | 'compositions'>('docs')
  const [showFormModal, setShowFormModal] = useState(false)
  const [resultForm, setResultForm] = useState({ observations: '', custom_link_url: '' })
  const [savingResult, setSavingResult] = useState(false)
  // Upload de arquivos do Resultado — separados por tipo pra que cada botão
  // tenha seu próprio loading spinner sem afetar os outros.
  const [uploadingKind, setUploadingKind] = useState<null | 'pdf' | 'audio' | 'photo'>(null)
  const [downloadingResultFileId, setDownloadingResultFileId] = useState<string | null>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  // Estado do gravador de áudio. Lifecycle:
  //   idle → (clica Gravar) → recording → (clica Parar) → preview
  //   preview → (Salvar)  → uploading → idle
  //   preview → (Descartar) → idle
  type RecState =
    | { kind: 'idle' }
    | { kind: 'recording'; startedAt: number; recorder: MediaRecorder; stream: MediaStream }
    | { kind: 'preview'; blob: Blob; url: string; durationMs: number }
    | { kind: 'uploading' }
  const [recState, setRecState] = useState<RecState>({ kind: 'idle' })
  const [recTick, setRecTick] = useState(0) // tick pra atualizar timer no UI
  useEffect(() => {
    if (recState.kind !== 'recording') return
    const id = setInterval(() => setRecTick(t => t + 1), 250)
    return () => clearInterval(id)
  }, [recState.kind])
  // Lightbox pras fotos do Resultado (reaproveita PhotoLightbox existente)
  const [resultLightbox, setResultLightbox] = useState<{ photos: any[]; index: number } | null>(null)
  const [aiFolders, setAiFolders] = useState<any[]>([])
  const [tagTemplates, setTagTemplates] = useState<any[]>([])
  const [clientTags, setClientTags] = useState<{ templateId: string; name: string; value: string }[]>([])
  const [linkedFolderId, setLinkedFolderId] = useState<string | null>(null)
  const [linkedFolderConfig, setLinkedFolderConfig] = useState<any>(null)
  const [savingAI, setSavingAI] = useState(false)
  const [aiSaveStatus, setAiSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // ── Ferramenta de Contraste ───────────────────────────────────────────
  // Estado salvo em clients.contrast_layout (JSONB). O valor formatado
  // ("Alto (8 a 10)") vai pra tag "Contraste" no clients.ai_info_tags,
  // que dispara o auto-save existente do clientTags.
  const [contrastLayout, setContrastLayout] = useState<ContrastLayoutData | null>(null)
  const [contrastDialogOpen, setContrastDialogOpen] = useState(false)
  const [irisAnalysis, setIrisAnalysis] = useState<IrisAnalysisRecord | null>(null)
  const [irisDialogOpen, setIrisDialogOpen] = useState(false)
  const [irisTemplates, setIrisTemplates] = useState<import('./documents/client/irisAnalysisTypes').IrisTextTemplate[]>([])
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [approvingPhotos, setApprovingPhotos] = useState(false)
  const [showRejection, setShowRejection] = useState(false)
  const [rejectingPhotos, setRejectingPhotos] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [approvingAiPhoto, setApprovingAiPhoto] = useState(false)
  const [showAiPhotoRejectionModal, setShowAiPhotoRejectionModal] = useState(false)
  const [rejectingAiPhoto, setRejectingAiPhoto] = useState(false)
  const [aiPhotoRejectionReason, setAiPhotoRejectionReason] = useState('')
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [savingDeadline, setSavingDeadline] = useState(false)
  const [chatEnabled, setChatEnabled] = useState(false)
  const [cleaningFiles, setCleaningFiles] = useState(false)
  const [filesCleanedUp, setFilesCleanedUp] = useState(false)
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Qual dropdown de tag-imagem está aberto (apenas 1 por vez, igual select nativo)
  const [openImagePicker, setOpenImagePicker] = useState<string | null>(null)

  useEffect(() => { load() }, [clientId])

  // Fecha o dropdown de tag-imagem ao clicar fora dele ou ao apertar ESC
  useEffect(() => {
    if (!openImagePicker) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target?.closest('[data-image-picker]')) setOpenImagePicker(null)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenImagePicker(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [openImagePicker])

  const buildSystemPrompt = (name: string, folderConfig: any, tags: { name: string; value: string }[]): string => {
    const filled = tags.filter(t => t.value.trim())
    let tagSection = ''
    if (filled.length > 0) tagSection = `\n═══ INFORMAÇÕES DA ANÁLISE DESTA CLIENTE ═══\n${filled.map(t => `${t.name}: ${t.value}`).join('\n')}\n\nUse ESTAS informações como base para TODAS as respostas.`
    if (!folderConfig && !filled.length) return ''
    let categoriesSection = ''
    if (folderConfig) {
      const catLines = (folderConfig.categories || []).map((cat: any) => { const prompts = (cat.prompts || []).map((p: any) => { let d = '  - ' + p.name; if (p.options?.length) d += ' [' + p.options.join(', ') + ']'; if (p.instructions) d += ' → ' + p.instructions; return d }).join('\n'); return '📌 ' + cat.name + ':\n' + (prompts || '  (vazio)') }).join('\n\n')
      categoriesSection = '\n═══ CATEGORIAS ═══\n' + catLines
    }
    return ['Você é a "MS Color IA", assistente virtual de coloração pessoal.', 'Atende a cliente ' + name + '.', '', '═══ REGRAS ABSOLUTAS ═══', '1. FOTO: Já está anexada. NUNCA peça foto.', '2. ROSTO: Mantenha feições idênticas ao gerar imagens.', '3. RESPOSTAS: Baseie-se EXCLUSIVAMENTE nas informações abaixo.', '4. ESCOPO: Só coloração pessoal, moda, estilo, cabelo, maquiagem, acessórios.', '5. TOM: Entusiasmada, positiva. Português brasileiro.', tagSection, categoriesSection, '═══ GERAÇÃO ═══', '- Use a foto da categoria correta (cabelo/roupa/geral) como base.'].join('\n')
  }

  const load = async () => {
    if (!clientId) return
    // Só mostra a tela de loading no carregamento inicial. Em refreshes
    // (depois que data já existe), mantém a UI atual visível e só substitui
    // o conteúdo ao final — evita pisca-pisca quando outras abas chamam load().
    const initialLoad = data === null
    if (initialLoad) setLoading(true)

    // ── Ficha da cliente (inclui as fotos — fonte da contagem da aba
    // "Fotos") é CRÍTICA e busca separada. Antes ia tudo num Promise.all
    // só: se QUALQUER uma das 4 consultas falhasse (rede instável,
    // timeout), a função inteira rejeitava sem try/catch nenhum — nenhum
    // setState rodava, e a contagem da aba ficava travada no valor de
    // quando a tela abriu, mesmo com uploads novos acontecendo depois
    // (a aba Fotos em si mostra o valor certo porque faz sua própria
    // consulta isolada, sem depender desse load()).
    let detail: Awaited<ReturnType<typeof adminService.getClientDetail>>
    try {
      detail = await adminService.getClientDetail(clientId)
    } catch (e) {
      console.error('[ClientsManager] Falha ao carregar dados da cliente:', e)
      if (initialLoad) setLoading(false)
      return
    }
    setData(detail)
    setNotes(detail.client.notes || '')
    if (detail.result) setResultForm({
      observations: detail.result.observations || '',
      custom_link_url: (detail.result as any).custom_link_url || '',
    })
    if (detail.result) setChatEnabled(detail.result.chat_enabled ?? false)
    // carrega estado da ferramenta de contraste (gravado em clients.contrast_layout)
    const cl = (detail.client as any).contrast_layout
    setContrastLayout(cl && typeof cl === 'object' ? cl as ContrastLayoutData : null)
    // carrega estado da análise da íris (gravado em clients.iris_analysis)
    const ia = (detail.client as any).iris_analysis
    setIrisAnalysis(ia && typeof ia === 'object' ? ia as IrisAnalysisRecord : null)

    // ── Dados auxiliares (pastas de IA, templates de tags/íris, role do
    // admin) — secundários. Usa allSettled: uma falha isolada aqui não
    // pode mais travar a atualização acima (fotos, contrato, resultado).
    const [foldersRes, templatesRes, adminRes, irisTemplatesRes] = await Promise.allSettled([
      supabase.from('ai_folders').select('id, name, config').order('name'),
      supabase.from('ai_info_templates').select('id, name, type, options').order('sort_order'),
      adminService.getCurrentAdmin(),
      adminService.listIrisTextTemplates(),
    ])

    const warnFail = (label: string, r: PromiseSettledResult<unknown>) => {
      if (r.status === 'rejected') console.warn(`[ClientsManager] load(): falha ao buscar ${label}:`, r.reason)
    }
    warnFail('ai_folders', foldersRes)
    warnFail('ai_info_templates', templatesRes)
    warnFail('admin atual', adminRes)
    warnFail('templates de íris', irisTemplatesRes)

    setIsSuperAdmin(adminRes.status === 'fulfilled' && (adminRes.value as any)?.role === 'super_admin')

    const folders = foldersRes.status === 'fulfilled' ? (foldersRes.value.data || []) : []
    setAiFolders(folders)
    const tpls = (templatesRes.status === 'fulfilled' ? (templatesRes.value.data || []) : []).map((t: any) => ({
      ...t,
      type: t.type === 'image' ? 'image' : 'text',
      options: Array.isArray(t.options) ? t.options : []
    }))
    setTagTemplates(tpls)
    const folderId = detail.client.ai_folder_id || null
    setLinkedFolderId(folderId)
    if (folderId) { const fc = folders.find((f: any) => f.id === folderId); setLinkedFolderConfig(fc ? (typeof fc.config === 'string' ? JSON.parse(fc.config) : fc.config) : null) }
    const savedTags: any[] = detail.client.ai_info_tags || []
    setClientTags(tpls.map((t: any) => { const saved = savedTags.find((s: any) => s.templateId === t.id); return { templateId: t.id, name: t.name, value: saved?.value || '' } }))

    setIrisTemplates(
      (irisTemplatesRes.status === 'fulfilled' ? (irisTemplatesRes.value as any[]) : []).map((r: any) => ({
        id: r.id,
        name: r.name,
        title: r.title,
        body: r.body,
        fontFamily: r.font_family ?? r.fontFamily,
        textColor: r.text_color ?? r.textColor,
        bgColor: r.bg_color ?? r.bgColor,
        titleSize: r.title_size ?? r.titleSize,
        bodySize: r.body_size ?? r.bodySize,
        createdAt: r.created_at ?? r.createdAt,
        updatedAt: r.updated_at ?? r.updatedAt,
      }))
    )
    // marca a baseline pro auto-save (assim o primeiro render não dispara save)
    savedAiTagsRef.current = JSON.stringify(
      tpls.map((t: any) => { const saved = savedTags.find((s: any) => s.templateId === t.id); return { templateId: t.id, name: t.name, value: saved?.value || '' } })
    )
    if (initialLoad) setLoading(false)
  }

  // ─── Auto-save das tags de "Informações da análise" ────────────────────
  // Dispara 600ms depois de qualquer mudança em `clientTags`. Persiste
  // ai_info_tags + ai_prompt direto, sem mexer em ai_folder_id ou folder_url
  // (esses continuam saindo só pelo botão "Salvar" do rodapé).
  // savedAiTagsRef segura a versão "limpa" pra evitar saves redundantes.
  const savedAiTagsRef = useRef<string>('')

  useEffect(() => {
    if (!data || loading) return
    const serialized = JSON.stringify(clientTags)
    if (serialized === savedAiTagsRef.current) return   // sem mudança

    const handle = setTimeout(async () => {
      setAiSaveStatus('saving')
      try {
        const prompt = buildSystemPrompt(data.client.full_name, linkedFolderConfig, clientTags)
        const { error } = await supabase
          .from('clients')
          .update({ ai_info_tags: clientTags, ai_prompt: prompt })
          .eq('id', clientId)
        if (error) throw error
        savedAiTagsRef.current = serialized
        setAiSaveStatus('saved')
        setTimeout(() => setAiSaveStatus(s => s === 'saved' ? 'idle' : s), 1500)
      } catch (e) {
        setAiSaveStatus('error')
      }
    }, 600)

    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientTags])

  /**
   * Persiste o estado da Ferramenta de Contraste em clients.contrast_layout.
   * O valor formatado (ex: "Alto (8 a 10)") é exposto automaticamente como
   * variável built-in `{{Contraste}}` via documentsService.getTextImportSources.
   * Não precisa de tag cadastrada em TagsManager.
   *
   * O parâmetro `formatted` permanece na assinatura pra compatibilidade com
   * o ContrastLayoutDialog, mas não é gravado aqui — a fonte de verdade é
   * `data` (a edge consumindo getTextImportSources sempre recalcula a string).
   */
  const handleSaveContrastLayout = async (data: ContrastLayoutData, _formatted: string) => {
    if (!clientId) return
    const { error } = await supabase
      .from('clients')
      .update({ contrast_layout: data })
      .eq('id', clientId)
    if (error) throw error
    setContrastLayout(data)
  }

  const handleSaveIrisAnalysis = async (record: IrisAnalysisRecord) => {
    if (!clientId) return
    const { error } = await supabase
      .from('clients')
      .update({ iris_analysis: record })
      .eq('id', clientId)
    if (error) throw error
    setIrisAnalysis(record)
  }

  const handleSaveNotes = async () => {
    setSavingNotes(true)
    try { await adminService.updateClient(clientId!, { notes } as any); setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000) }
    catch (e: any) { alert(e.message) } finally { setSavingNotes(false) }
  }

  const handleStartEditName = () => {
    if (!data?.client) return
    setNameInput(data.client.full_name)
    setEditingName(true)
  }

  const handleCancelEditName = () => {
    setEditingName(false)
    setNameInput('')
  }

  const handleSaveName = async () => {
    const newName = nameInput.trim()
    if (!newName) { alert('O nome não pode ficar vazio.'); return }
    if (!data?.client) return
    if (newName === data.client.full_name) { setEditingName(false); return }
    setSavingName(true)
    try {
      await adminService.updateClient(clientId!, { full_name: newName } as any)
      await load()
      setEditingName(false)
    } catch (e: any) {
      alert(e?.message || 'Erro ao salvar nome')
    } finally {
      setSavingName(false)
    }
  }

  // Approva fotos + formulário e inicia análise
  const handleApprovePhotos = async () => {
    const clientName = data?.client?.full_name ?? 'esta cliente'
    const hasForm = !!formSubmission
    const photosCount = photos.length

    if (photosCount === 0) {
      alert('Nenhuma foto enviada ainda.')
      return
    }

    const formWarning = hasForm
      ? ''
      : '\n\n⚠️ O formulário ainda não foi enviado pela cliente. Deseja aprovar mesmo assim?'

    if (!confirm(
      `Aprovar fotos e formulário de ${clientName}?${formWarning}\n\nIsso irá:\n• Mover para "Análise em Andamento"\n• Definir o prazo de entrega\n• Enviar e-mail de confirmação para a cliente`
    )) return

    setApprovingPhotos(true)
    try {
      const deadlineDays = (data?.client as any)?.plan?.deadline_days ?? 5
      await adminService.approvePhotos(clientId!, deadlineDays)
      load()
    } catch (e: any) { alert(e.message) } finally { setApprovingPhotos(false) }
  }

  // Aprova foto IA → avança para Simulações
  const handleApproveAiPhoto = async () => {
    setApprovingAiPhoto(true)
    try {
      await adminService.advanceStep(clientId!) // awaiting_ai_photo → simulating
      load()
    } catch (e: any) { alert(e?.message || 'Erro ao aprovar foto IA') } finally { setApprovingAiPhoto(false) }
  }

  // Rejeita foto IA: apaga a foto e mantém status awaiting_ai_photo para cliente reenviar
  const handleRejectAiPhoto = async () => {
    if (!aiPhotoRejectionReason.trim()) { alert('Por favor, informe o motivo.'); return }
    setRejectingAiPhoto(true)
    try {
      const aiPhotosToDelete = (data?.photos || []).filter((p: any) => p.category_id === aiCat?.id)
      for (const photo of aiPhotosToDelete) {
        if (photo.storage_path) {
          await supabase.storage.from('client-photos').remove([photo.storage_path])
        }
        await supabase.from('client_photos').delete().eq('id', photo.id)
      }
      // Guarda o motivo para o portal exibir ao cliente (reutilizamos o campo de rejeição de fotos)
      await supabase.from('clients').update({
        photos_rejection_reason: aiPhotoRejectionReason.trim(),
        photos_rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', clientId!)
      setShowAiPhotoRejectionModal(false)
      setAiPhotoRejectionReason('')
      load()
    } catch (e: any) { alert(e?.message || 'Erro ao rejeitar foto IA') } finally { setRejectingAiPhoto(false) }
  }

  const handleReject = async (payload: {
    rejectForm: boolean; formReason: string
    rejectPhotos: boolean; photosReason: string
  }) => {
    const id = clientId!
    if (payload.rejectForm && payload.rejectPhotos)
      await adminService.rejectBoth(id, payload.formReason, payload.photosReason)
    else if (payload.rejectForm)
      await adminService.rejectForm(id, payload.formReason)
    else
      await adminService.rejectPhotos(id, payload.photosReason)
    setShowRejection(false)
    load()
  }

  const handleSaveDeadline = async () => {
    if (!deadlineInput) return
    setSavingDeadline(true)
    try {
      // UPSERT: cria o registro se não existir (sem fotos aprovadas ainda),
      // ou atualiza se já existir (permite edição a qualquer momento).
      // A aprovação de fotos pode sobrescrever com o prazo calculado pelo plano.
      const { error } = await supabase
        .from('client_deadlines')
        .upsert(
          {
            client_id: clientId!,
            deadline_date: deadlineInput,
            no_deadline: false,
            // photos_sent_at: mantém o valor existente se já houver um registro
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'client_id', ignoreDuplicates: false }
        )
      if (error) throw error
      setEditingDeadline(false)
      load()
    } catch (e: any) { alert(e.message) } finally { setSavingDeadline(false) }
  }

  const handleSetNoDeadline = async () => {
    setSavingDeadline(true)
    try {
      if (deadline) {
        // Registro já existe — só atualiza o flag
        const { error } = await supabase
          .from('client_deadlines')
          .update({ no_deadline: true, updated_at: new Date().toISOString() })
          .eq('client_id', clientId!)
        if (error) throw error
      } else {
        // Nenhum registro ainda — insere marcando sem prazo
        const { error } = await supabase
          .from('client_deadlines')
          .insert({
            client_id: clientId!,
            no_deadline: true,
            deadline_date: null,
            photos_sent_at: null,
          })
        if (error) throw error
      }
      setEditingDeadline(false)
      load()
    } catch (e: any) { alert(e.message) } finally { setSavingDeadline(false) }
  }

  const handleCleanupFiles = async () => {
    setCleaningFiles(true)
    setShowCleanupModal(false)
    try {
      // 0. Usa cleanClientFiles (mesmo caminho do handleDelete) para remover
      //    todos os arquivos do Storage com as permissões corretas.
      //    O removePaths inline falhava silenciosamente por RLS no client-side.
      const storageCleanup = await cleanClientFiles(clientId!)
      if (!storageCleanup.success && storageCleanup.errors.length > 0) {
        console.warn('⚠️ Limpeza parcial do storage:', storageCleanup.errors)
      }

      // 1. Remove registros da tabela client_photos
      await supabase.from('client_photos').delete().eq('client_id', clientId)

      // 2. Remove registros de client_tag_values (texto + refs de imagem)
      //    O storage de client-tag-images já foi coberto pelo cleanClientFiles acima.
      try {
        await supabase.from('client_tag_values').delete().eq('client_id', clientId)
      } catch { /* tabela pode não existir em instâncias antigas */ }

      // 3. Remove registros de anexos da tabela client_attachments
      await supabase.from('client_attachments').delete().eq('client_id', clientId)

      // 4. Remove dados do formulário de client_form_submissions
      try {
        const { error: formErr } = await supabase
          .from('client_form_submissions')
          .delete()
          .eq('client_id', clientId)
        if (formErr) console.warn('Aviso ao limpar client_form_submissions:', formErr.message)
      } catch { /* tabela pode não existir em instâncias antigas */ }

      // 4b. Fallback: remove da tabela client_progress (legado)
      try {
        await supabase
          .from('client_progress')
          .delete()
          .eq('user_id', clientId)
          .eq('step', 2)
      } catch { /* ignorar se não existir */ }

      setFilesCleanedUp(true)
      await load()
    } catch (e: any) {
      alert(`Erro ao limpar arquivos: ${e.message}`)
    } finally {
      setCleaningFiles(false)
    }
  }

  const copyLink = () => { const link = `${window.location.origin}/c/${data.client.token}`; navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const handleSaveResult = async () => {
    setSavingResult(true)
    try {
      await adminService.saveResult(clientId!, resultForm)
      // Primeira vez que o resultado é salvo: avança para "Preparando Materiais"
      if (data?.client?.status === 'in_analysis') {
        await adminService.updateClient(clientId!, { status: 'preparing_materials' } as any)
      }
    } catch (e: any) { alert(e.message) } finally { setSavingResult(false) }
  }
  const handleSaveChatEnabled = async () => {
    const { error } = await supabase.from('client_results').upsert(
      { client_id: clientId!, chat_enabled: chatEnabled, updated_at: new Date().toISOString() },
      { onConflict: 'client_id' }
    )
    if (error) throw error
  }
  const handleSaveAIConfig = async () => {
    setSavingAI(true); setAiSaveStatus('idle')
    try {
      const prompt = buildSystemPrompt(data.client.full_name, linkedFolderConfig, clientTags)
      await supabase.from('clients').update({ ai_folder_id: linkedFolderId, ai_info_tags: clientTags, ai_prompt: prompt }).eq('id', clientId)
      // O folder_url do FoldersManager só é propagado pro client_results de
      // clientes pertencentes ao super_admin. Pra admins comuns o link da
      // pasta nunca é salvo, então também nunca aparece no ClientPortal.
      //
      // SEMPRE sincroniza, inclusive limpando com null: antes, ao trocar pra
      // "Nenhuma pasta vinculada" (ou pra uma pasta sem driveLink), o
      // folder_url antigo ficava órfão no client_results e a cliente
      // continuava vendo o card "Pasta com Materiais" da pasta anterior.
      if (isSuperAdmin) {
        const driveLink = linkedFolderConfig?.driveLink || null
        await adminService.saveResult(clientId!, { ...resultForm, folder_url: driveLink })
      }
      setAiSaveStatus('saved'); setTimeout(() => setAiSaveStatus('idle'), 3000)
    } catch { setAiSaveStatus('error') } finally { setSavingAI(false) }
  }
  const handleLinkFolder = async (folderId: string | null) => { setLinkedFolderId(folderId); if (folderId) { const fc = aiFolders.find((f: any) => f.id === folderId); const config = fc ? (typeof fc.config === 'string' ? JSON.parse(fc.config) : fc.config) : null; setLinkedFolderConfig(config) } else { setLinkedFolderConfig(null) } }
  // Handler genérico de upload de arquivo de resultado. O `kind` é só pra
  // controlar o spinner do botão correto. O backend (Edge Function `drive`)
  // já detecta o tipo pelo file.type/extensão e armazena em client_result_files
  // sem distinção.
  const handleUploadResultFile = async (file: File, kind: 'pdf' | 'audio' | 'photo') => {
    setUploadingKind(kind)
    try {
      await adminService.uploadResultFile(clientId!, file)
      load()
    } catch (e: any) {
      alert(e.message || 'Erro ao enviar arquivo')
    } finally {
      setUploadingKind(null)
    }
  }
  const onPickPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await handleUploadResultFile(file, 'pdf')
    if (pdfInputRef.current) pdfInputRef.current.value = ''
  }
  const onPickAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await handleUploadResultFile(file, 'audio')
    if (audioInputRef.current) audioInputRef.current.value = ''
  }
  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) await handleUploadResultFile(file, 'photo')
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  // ─── Gravação de áudio ─────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      // Constraints explícitas pra qualidade decente:
      //   • echoCancellation: tira eco da própria voz pelo speaker (sem isso
      //     fica "metálico" em laptop com mic embutido).
      //   • noiseSuppression: filtra ruído de fundo.
      //   • autoGainControl: normaliza volume — é o que resolve o "baixo".
      //     Sem isso, browsers capturam no ganho cru do mic, que varia muito.
      //   • channelCount: 1 (mono) — voz não precisa de stereo, economiza 50%
      //     do tamanho do arquivo.
      //   • sampleRate: 48000 — padrão pra Opus, melhor que o default em
      //     alguns navegadores (que pode cair pra 16k).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      })
      // Codec: Chrome/Firefox → webm/opus; Safari → mp4/aac.
      // É importante cobrir o caso Safari explicitamente: sem isso, quando
      // mime fica '' o MediaRecorder usa o default interno do browser (mp4 no
      // Safari), mas a extensão era derivada erroneamente como 'webm', gerando
      // arquivos .webm com conteúdo mp4 que não tocam no cliente.
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : ''
      // 128 kbps é "voice quality" — quase 4x o default (~32k). Pra voz é
      // suficiente pra som limpo sem inflar muito o tamanho (~1MB por minuto).
      const recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 128000,
      })
      const chunks: Blob[] = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const durationMs = Date.now() - (rec.startedAt ?? Date.now())
        const url = URL.createObjectURL(blob)
        setRecState({ kind: 'preview', blob, url, durationMs })
        stream.getTracks().forEach(t => t.stop())
      }
      // Pequena espera pra pipeline de áudio do browser "esquentar".
      // Sem isso, os primeiros ~200-400ms da gravação saem mudos ou cortados —
      // é o que dá a sensação de "atrasado" (você fala mas o início some).
      await new Promise(r => setTimeout(r, 250))
      const rec = { startedAt: Date.now() }
      recorder.start(250) // emite chunk a cada 250ms (não afeta áudio, ajuda em recovery)
      setRecState({ kind: 'recording', startedAt: rec.startedAt, recorder, stream })
    } catch (e: any) {
      alert('Não foi possível acessar o microfone. Verifique a permissão do navegador.')
    }
  }
  const stopRecording = () => {
    if (recState.kind !== 'recording') return
    try { recState.recorder.stop() } catch {}
  }
  const discardRecording = () => {
    if (recState.kind === 'preview') URL.revokeObjectURL(recState.url)
    setRecState({ kind: 'idle' })
  }
  const saveRecording = async () => {
    if (recState.kind !== 'preview') return
    const { blob: rawBlob, url, durationMs } = recState
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    // O WebM do MediaRecorder sai sem o elemento Duration → o Chrome do Android
    // se recusa a tocar (no desktop e no Safari funciona). Re-encodamos pra WAV,
    // que tem duração correta e toca em qualquer navegador. Se a decodificação
    // falhar (raro), mandamos o arquivo original pra não perder a gravação.
    let uploadBlob = rawBlob
    let ext = rawBlob.type.includes('mp4') || rawBlob.type.includes('m4a') ? 'm4a'
            : rawBlob.type.includes('ogg') ? 'ogg'
            : 'webm'
    if (rawBlob.type.includes('webm')) {
      try {
        uploadBlob = await reencodeToWav(rawBlob, 16000)
        ext = 'wav'
      } catch (err) {
        console.warn('[audio] re-encode falhou — enviando WebM original', err)
      }
    }
    const file = new File([uploadBlob], `Audio_${stamp}.${ext}`, { type: uploadBlob.type })
    setRecState({ kind: 'uploading' })
    try {
      await adminService.uploadResultFile(clientId!, file)
      load()
      URL.revokeObjectURL(url)
      setRecState({ kind: 'idle' })
    } catch (e: any) {
      alert(e.message || 'Erro ao enviar áudio')
      // mantém preview pra usuário tentar de novo
      setRecState({ kind: 'preview', blob: rawBlob, url, durationMs })
    }
  }
  const handleDeleteFile = async (fileId: string, storagePath: string) => { if (!confirm('Remover este arquivo?')) return; await adminService.deleteResultFile(fileId, storagePath); load() }

  // Baixa arquivo de Resultado (PDF/áudio) forçando o nome correto.
  // Antes usava <a href> direto pra URL do Drive, que baixa com o nome
  // interno do arquivo no Drive (ex: "1778272089164_Karla...") em vez do
  // file_name salvo no banco. Usa o proxy autenticado (/photo-proxy) —
  // mesmo padrão já usado pro download de fotos — pra trazer os bytes e
  // forçar o nome via blob + <a download>.
  const handleDownloadResultFile = async (f: { id: string; file_name: string; drive_file_id?: string | null; storage_path?: string | null }) => {
    if (downloadingResultFileId) return
    setDownloadingResultFileId(f.id)
    try {
      let blob: Blob
      if (f.drive_file_id) {
        blob = await driveStorage.fetchPhotoBlob(f.drive_file_id)
      } else {
        const res = await fetch(adminService.getResultFileUrl(f as any))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        blob = await res.blob()
      }
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = f.file_name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
    } catch (e: any) {
      console.error('[handleDownloadResultFile] erro:', e)
      // fallback: abre na aba mesmo, se o proxy falhar
      window.open(adminService.getResultFileUrl(f as any), '_blank')
    } finally {
      setDownloadingResultFileId(null)
    }
  }

  if (loading) return <div className="flex justify-center py-20" style={{ background: t.bg, flex: 1 }}><div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" /></div>
  if (!data) return <div className="text-center py-20" style={{ background: t.bg, color: t.text2, flex: 1 }}>Cliente não encontrado</div>

  const { client, contract, formSubmission, photos, deadline, result, resultFiles, photoCategories, planForm } = data
  const status = STATUSES[client.status]
  const portalLink = `${window.location.origin}/c/${client.token}`
  // Foto IA: detecta categoria de simulação IA e se já foi enviada
  const aiCat = (photoCategories || []).find((c: any) => c.is_ai_simulation)
  const aiPhotoSent = !!aiCat && (photos || []).some((p: any) => p.category_id === aiCat.id)
  const hasAiPhotoToReview = client.status === 'awaiting_ai_photo' && aiPhotoSent

  // ── Dados para o Chat IA do admin (espelha o que o ClientPortal monta) ──
  // Sempre reconstruímos o systemPrompt a partir das configurações atuais
  // (folder + tags) para refletir mudanças não-salvas. Assim o admin pode
  // testar o efeito de uma nova tag antes de bater "Salvar".
  const adminAiSystemPrompt = buildSystemPrompt(client.full_name, linkedFolderConfig, clientTags)

  // Helper: infere o tipo de referência de IA a partir do título da categoria.
  const inferRefType = (title: string): 'cabelo' | 'roupa' | 'geral' => {
    const low = title.toLowerCase()
    if (low.includes('cabelo') || low.includes('hair')) return 'cabelo'
    if (low.includes('roupa') || low.includes('corpo') || low.includes('look') || low.includes('vestim')) return 'roupa'
    return 'geral'
  }

  // Fotos de referência para o chat admin:
  // 1. ai_reference_photos salvo no banco (atribuído formalmente)
  // 2. ai_reference_photo_path legado
  // 3. Fallback automático a partir das fotos enviadas pela cliente
  //    → permite usar o chat antes de liberar o resultado
  const adminAiRefPhotos: { type: string; label: string; storagePath: string; url: string; driveFileId?: string | null }[] = (() => {
    if (Array.isArray(client.ai_reference_photos) && client.ai_reference_photos.length > 0) {
      return client.ai_reference_photos.map((p: any) => {
        // Fotos salvas com driveFileId: usar Drive thumbnail como URL e
        // carregar driveFileId pra que o chat use o proxy autenticado (evita CORS).
        const driveFileId: string | null = p.driveFileId || null
        const url = driveFileId
          ? driveStorage.viewUrl(driveFileId)
          : (p.storagePath
              ? supabase.storage.from('client-photos').getPublicUrl(p.storagePath).data.publicUrl
              : (p.url || ''))
        return {
          type: (p.typeId || p.type || 'geral') as string,
          label: p.typeName || p.label || p.typeId || p.type || 'Geral',
          storagePath: p.storagePath || '',
          url,
          driveFileId,
        }
      })
    }
    if (client.ai_reference_photo_path) {
      const url = supabase.storage.from('client-photos').getPublicUrl(client.ai_reference_photo_path).data.publicUrl
      return [{ type: 'geral', label: 'Foto Geral/Rosto', storagePath: client.ai_reference_photo_path, url, driveFileId: null }]
    }
    // Fallback: deriva das fotos enviadas, uma por categoria
    const seen = new Set<string>()
    const derived: { type: string; label: string; storagePath: string; url: string; driveFileId: string | null }[] = []
    for (const cat of (photoCategories || [])) {
      if ((cat as any).is_ai_simulation) continue
      const catPhotos = (photos || []).filter((p: any) => p.category_id === cat.id && (p.storage_path || p.drive_file_id))
      if (catPhotos.length === 0) continue
      const photo = catPhotos[catPhotos.length - 1] // usa a mais recente
      const type = inferRefType(cat.title)
      if (!seen.has(type)) {
        seen.add(type)
        const photoKey = photo.drive_file_id || photo.storage_path
        const photoUrl = photo.drive_file_id
          ? driveStorage.viewUrl(photo.drive_file_id)
          : supabase.storage.from('client-photos').getPublicUrl(photo.storage_path).data.publicUrl
        derived.push({
          type,
          label: cat.title,
          storagePath: photoKey,
          url: photoUrl,
          driveFileId: photo.drive_file_id || null,
        })
      }
    }
    // Garante sempre uma entrada 'geral'
    if (!seen.has('geral') && derived.length > 0) {
      derived.unshift({ ...derived[0], type: 'geral', label: `${derived[0].label} (principal)` })
    }
    return derived
  })()

  // URL "geral" das fotos de referência (vindas da aba IA): usada como capa do chat
  const adminAiRefPhotoGeral = adminAiRefPhotos.find(p => p.type === 'geral') || adminAiRefPhotos[0] || null
  const adminAiRefPhotoUrl = adminAiRefPhotoGeral?.url || null
  const adminAiRefPhotoDriveFileId = adminAiRefPhotoGeral?.driveFileId || null
  const adminResultFileUrls = (resultFiles || []).map((f: any) => ({
    url: adminService.getResultFileUrl(f),
    name: f.file_name,
  }))

  return (
    <div className="flex flex-col h-full w-full" style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: t.bg }}>
      {/* Topbar */}
      {/* position:relative + zIndex:1 cria stacking context explícito e baixo,
          garantindo que o portal da PhotoGallery (z-index: MAX_INT) sempre vença */}
      <div style={{ background: t.surface, borderBottom: `2px solid ${t.border}`, flexShrink: 0, position: 'relative', zIndex: 1 }}>
        {/* Linha principal */}
        <div style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: 8, height: 52 }}>
          <button onClick={onOpenNav} title="Menu" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, color: t.text2, display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <span style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 2 }} />
            <span style={{ display: 'block', width: 14, height: 2, background: 'currentColor', borderRadius: 2 }} />
            <span style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 2 }} />
          </button>
          <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg, #e91e63, #ff6090)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(233,30,99,0.3)' }}>
            <Palette size={14} color="white" />
          </div>
          <div style={{ width: 1, height: 22, background: t.border, flexShrink: 0, margin: '0 2px' }} />
          <button onClick={() => navigate('/admin/clients')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 6, color: t.text2, flexShrink: 0 }}>
            <ArrowLeft size={14} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text2 }} className="hidden sm:inline">Clientes</span>
          </button>
          <span style={{ fontSize: 14, color: t.text3, flexShrink: 0 }} className="hidden sm:block">/</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{client.full_name}</span>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: status?.bg, color: status?.textColor, flexShrink: 0 }} className="hidden sm:inline">{status?.short || status?.label}</span>

          {/* Approve buttons — desktop inline */}
          {client.status === 'photos_submitted' && (
            <div style={{ marginLeft: 'auto', gap: 8, flexShrink: 0 }} className="hidden sm:flex">
              <Btn variant="outline" size="sm" onClick={() => setShowRejection(true)} className="border-amber-300 text-amber-700 hover:bg-amber-50">
                <AlertTriangle className="h-3.5 w-3.5" /> Solicitar Ajustes
              </Btn>
              <Btn variant="pink" size="sm" onClick={handleApprovePhotos} loading={approvingPhotos}>
                <CheckCircle className="h-3.5 w-3.5" /> Aprovar e Iniciar Análise
              </Btn>
            </div>
          )}
          {/* Botões Foto IA — desktop */}
          {hasAiPhotoToReview && (
            <div style={{ marginLeft: 'auto', gap: 8, flexShrink: 0 }} className="hidden sm:flex">
              <Btn variant="outline" size="sm" onClick={() => setShowAiPhotoRejectionModal(true)} className="border-amber-300 text-amber-700 hover:bg-amber-50">
                <AlertTriangle className="h-3.5 w-3.5" /> Solicitar Nova Foto
              </Btn>
              <Btn variant="pink" size="sm" onClick={handleApproveAiPhoto} loading={approvingAiPhoto}>
                <CheckCircle className="h-3.5 w-3.5" /> Aprovar Foto IA → Simulações
              </Btn>
            </div>
          )}
        </div>

        {/* Linha de aprovação — mobile only */}
        {client.status === 'photos_submitted' && (
          <div className="sm:hidden flex gap-2 px-3 pb-2.5">
            <Btn variant="outline" size="sm" onClick={() => setShowRejection(true)} className="flex-1 justify-center border-amber-300 text-amber-700 hover:bg-amber-50">
              <AlertTriangle className="h-3.5 w-3.5" /> Ajustes
            </Btn>
            <Btn variant="pink" size="sm" onClick={handleApprovePhotos} loading={approvingPhotos} className="flex-1 justify-center">
              <CheckCircle className="h-3.5 w-3.5" /> Aprovar Análise
            </Btn>
          </div>
        )}
        {/* Linha Foto IA — mobile only */}
        {hasAiPhotoToReview && (
          <div className="sm:hidden flex gap-2 px-3 pb-2.5">
            <Btn variant="outline" size="sm" onClick={() => setShowAiPhotoRejectionModal(true)} className="flex-1 justify-center border-amber-300 text-amber-700 hover:bg-amber-50">
              <AlertTriangle className="h-3.5 w-3.5" /> Nova Foto
            </Btn>
            <Btn variant="pink" size="sm" onClick={handleApproveAiPhoto} loading={approvingAiPhoto} className="flex-1 justify-center">
              <CheckCircle className="h-3.5 w-3.5" /> Aprovar Foto IA
            </Btn>
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none', minHeight: 0 }}>
        <div className="space-y-4 sm:space-y-6 px-3 py-4 sm:p-6 max-w-3xl lg:max-w-5xl mx-auto w-full" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)' }}>

          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 sm:w-12 sm:h-12 bg-gradient-to-br from-rose-100 to-pink-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-rose-600 font-bold text-base sm:text-lg">{client.full_name[0].toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                  {editingName ? (
                    <div className="flex items-center gap-1.5 w-full">
                      <input
                        autoFocus
                        type="text"
                        value={nameInput}
                        onChange={e => setNameInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveName() }
                          else if (e.key === 'Escape') { e.preventDefault(); handleCancelEditName() }
                        }}
                        disabled={savingName}
                        maxLength={120}
                        placeholder="Nome completo"
                        className="text-lg sm:text-xl font-bold px-2 py-1 rounded-lg focus:outline-none disabled:opacity-50 flex-1 min-w-0"
                        style={{ background: t.surface2, border: `1px solid ${t.accent}`, color: t.text }}
                      />
                      <button
                        onClick={handleSaveName}
                        disabled={savingName || !nameInput.trim()}
                        className="p-1.5 rounded-lg disabled:opacity-40 transition-colors flex-shrink-0"
                        style={{ background: t.accent, color: t.accentFg }}
                        title="Salvar (Enter)"
                      >
                        {savingName
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Save className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={handleCancelEditName}
                        disabled={savingName}
                        className="p-1.5 rounded-lg disabled:opacity-40 transition-colors flex-shrink-0"
                        style={{ background: t.surface2, color: t.text2, border: `1px solid ${t.border}` }}
                        title="Cancelar (Esc)"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 min-w-0">
                      <h1 className="text-lg sm:text-xl font-bold truncate" style={{ color: t.text }}>{client.full_name}</h1>
                      <button
                        onClick={handleStartEditName}
                        className="p-1 rounded transition-colors hover:opacity-100 opacity-60 flex-shrink-0"
                        style={{ color: t.text3 }}
                        title="Editar nome"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" style={{ background: status?.bg, color: status?.textColor }}>{status?.label}</span>
                  {client.plan && <span className="text-xs px-2 py-1 rounded font-medium flex-shrink-0" style={{ background: t.surface2, color: t.text2 }}>{(client as any).plan.name}</span>}
                </div>
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-3 gap-y-0.5 text-xs sm:text-sm mt-1" style={{ color: t.text3 }}>
                  <span className="flex items-center gap-1 min-w-0"><Mail className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" /><span className="truncate">{client.email}</span></span>
                  {client.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                      {client.phone}
                      <a 
                        href={whatsappHref(client.phone)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="ml-0.5 text-green-600 hover:text-green-700"
                        title="Enviar mensagem no WhatsApp"
                      >
                        <MessageSquare className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      </a>
                    </span>
                  )}
                </div>
              </div>
            </div>

          {/* Portal link */}
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Link2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Link de Acesso do Cliente</p>
                  <p className="text-xs text-gray-500">Compartilhe este link para o cliente acessar o portal</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:flex-shrink-0">
                <Btn 
                  variant="outline" 
                  size="sm" 
                  onClick={copyLink}
                  className="bg-white hover:bg-violet-50 border-violet-300 w-full sm:w-auto justify-center whitespace-nowrap"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-green-600" />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar Link</span>
                    </>
                  )}
                </Btn>
                <a href={portalLink} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
                  <Btn 
                    variant="outline" 
                    size="sm"
                    className="bg-white hover:bg-violet-50 border-violet-300 w-full justify-center whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Abrir Portal</span>
                  </Btn>
                </a>
              </div>
            </div>
          </div>

          {/* Tabs */}
          {/* z-[1]: stacking context baixo; nunca deve competir com portal da galeria */}
          <div className="sticky top-0 z-[1] -mx-3 sm:mx-0 px-3 sm:px-0 py-2 sm:py-0 sm:static" style={{ background: t.bg }}>
            <div className="flex gap-1 p-1 rounded-xl overflow-x-auto scrollbar-hide w-full sm:w-fit" style={{ background: t.surface2 }}>
            {[
              { id: 'overview', label: 'Visão Geral' },
              { id: 'photos', label: `Fotos (${photos.length})` },
              { id: 'result', label: 'Resultado' },
              { id: 'documents', label: 'Documentos' },
              { id: 'ai', label: '✨ IA' },
              { id: 'chat', label: '💬 Chat IA' },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id as any)}
                className="px-3 sm:px-4 py-2.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors touch-manipulation active:opacity-80"
                style={tab === id
                  ? { background: t.surface, color: t.text, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
                  : { background: 'transparent', color: t.text3 }}
              >
                {label}
              </button>
            ))}
            </div>
          </div>

          {/* Overview Tab */}
          {tab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Limpeza de arquivos — aviso no overview para concluídos com fotos */}
              {client.status === 'completed' && photos.length > 0 && !filesCleanedUp && (
                <div className="md:col-span-2 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                  style={{ background: '#fff5f5', border: '1px solid #fecaca' }}>
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-red-900">
                        {photos.length} foto{photos.length !== 1 ? 's' : ''} ainda no storage
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        Cliente concluída. Você pode liberar espaço removendo os arquivos do servidor.
                      </p>
                    </div>
                  </div>
                  <Btn variant="danger" size="sm" onClick={() => setTab('photos' as any)} className="flex-shrink-0">
                    <Trash2 className="h-3.5 w-3.5" /> Ir para Fotos e Limpar
                  </Btn>
                </div>
              )}

              {/* Approve banner */}
              {client.status === 'photos_submitted' && (
                <div className="md:col-span-2 bg-gradient-to-r from-pink-50 to-rose-50 border border-rose-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Camera className="h-5 w-5 text-pink-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-rose-900">Fotos recebidas, aguardando sua revisão</p>
                      <p className="text-xs text-rose-600 mt-0.5">Revise as fotos na aba <strong>Fotos</strong> e, quando estiver pronto, aprove para iniciar a análise e notificar a cliente.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Btn variant="outline" size="sm" onClick={() => setShowRejection(true)} className="flex-1 sm:flex-none justify-center border-amber-300 text-amber-700 hover:bg-amber-50">
                      <AlertTriangle className="h-4 w-4" /> <span className="sm:inline">Solicitar Ajustes</span>
                    </Btn>
                    <Btn variant="pink" size="sm" onClick={handleApprovePhotos} loading={approvingPhotos} className="flex-1 sm:flex-none justify-center">
                      <CheckCircle className="h-4 w-4" /> <span className="sm:inline">Aprovar Fotos</span>
                    </Btn>
                  </div>
                </div>
              )}

              {/* Banner Foto IA — aguardando aprovação */}
              {hasAiPhotoToReview && (
                <div className="md:col-span-2 bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-10 h-10 bg-violet-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Image className="h-5 w-5 text-violet-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-violet-900">Foto IA recebida — aguardando sua revisão</p>
                      <p className="text-xs text-violet-600 mt-0.5">Revise a foto na aba <strong>Fotos</strong>. Se estiver boa, aprove para iniciar as simulações. Se não estiver, solicite uma nova foto.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Btn variant="outline" size="sm" onClick={() => setShowAiPhotoRejectionModal(true)} className="flex-1 sm:flex-none justify-center border-amber-300 text-amber-700 hover:bg-amber-50">
                      <AlertTriangle className="h-4 w-4" /> <span className="sm:inline">Solicitar Nova Foto</span>
                    </Btn>
                    <Btn variant="pink" size="sm" onClick={handleApproveAiPhoto} loading={approvingAiPhoto} className="flex-1 sm:flex-none justify-center">
                      <CheckCircle className="h-4 w-4" /> <span className="sm:inline">Aprovar → Simulações</span>
                    </Btn>
                  </div>
                </div>
              )}

              {/* Controle de Etapas */}
              <StageController
                client={client}
                contract={contract}
                formSubmission={formSubmission}
                photos={photos}
                result={result}
                deadline={deadline}
                planHasAiPhoto={photoCategories.some((c: any) => c.is_ai_simulation)}
                onChange={load}
              />

              {/* Prazo */}
              <div className="rounded-xl p-4 sm:p-5 min-w-0" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
                <div className="flex items-center justify-between mb-4 gap-2">
                  <h3 className="font-semibold" style={{ color: t.text }}>Prazo</h3>
                  {!editingDeadline && (
                    <Btn variant="outline" size="sm" onClick={() => { setDeadlineInput(deadline?.no_deadline ? '' : (deadline?.deadline_date ?? '')); setEditingDeadline(true) }} className="flex-shrink-0">
                      <Calendar className="h-3.5 w-3.5" />
                      <span className="whitespace-nowrap">{deadline?.deadline_date && !deadline?.no_deadline ? 'Editar' : 'Definir prazo'}</span>
                    </Btn>
                  )}
                </div>

                {/* Aviso informativo quando fotos ainda não foram aprovadas */}
                {client.status === 'photos_submitted' && (
                  <div className="flex items-start gap-2 bg-pink-50 rounded-lg p-3 border border-pink-100 mb-3">
                    <Clock className="h-4 w-4 text-pink-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-pink-700">A aprovação das fotos sobrescreve o prazo com o valor calculado pelo plano. Você pode definir manualmente caso queira antecipar.</p>
                  </div>
                )}

                {editingDeadline ? (
                  // Formulário de edição/inserção
                  <div className="space-y-2 min-w-0">
                    {/* overflow-hidden aqui é uma rede de segurança: em alguns WebViews
                        (iOS Safari/Capacitor) o input[type=date] ignora width:100% e
                        renderiza mais largo que o container por causa do chrome nativo
                        do seletor. O wrapper garante que ele nunca "vaze" pra fora do
                        card, mesmo se isso acontecer — sem mexer no appearance nativo
                        (senão o ícone/placeholder do seletor de data some no iOS). */}
                    <div className="relative w-full min-w-0 overflow-hidden rounded-lg" style={{ border: `1px solid ${t.border}` }}>
                      <input
                        type="date"
                        value={deadlineInput}
                        onChange={e => setDeadlineInput(e.target.value)}
                        className="text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                        style={{
                          background: t.surface2,
                          color: t.text,
                          border: 'none',
                          width: '100%',
                          maxWidth: '100%',
                          minWidth: 0,
                          boxSizing: 'border-box',
                          display: 'block',
                          padding: '8px 12px',
                          position: 'relative',
                          zIndex: 0,
                        }}
                      />
                      {/* Placeholder visual: iOS/WebKit não mostra ícone nem texto no
                          input[type=date] vazio, então sem isso o campo parece em
                          branco/quebrado. pointer-events:none deixa o toque passar
                          direto pro input abaixo, que abre o seletor nativo. */}
                      {!deadlineInput && (
                        <div
                          className="absolute inset-0 flex items-center gap-2 text-sm pointer-events-none"
                          style={{ padding: '8px 12px', color: t.text3, zIndex: 1 }}
                        >
                          <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                          <span>Toque para escolher a data</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                      <Btn size="sm" onClick={handleSaveDeadline} loading={savingDeadline} className="w-full sm:w-auto justify-center"><Check className="h-3.5 w-3.5" /> Salvar</Btn>
                      <div className="flex gap-2 sm:contents">
                        <Btn variant="outline" size="sm" onClick={handleSetNoDeadline} loading={savingDeadline} className="flex-1 sm:flex-none justify-center">Sem prazo</Btn>
                        <Btn variant="outline" size="sm" onClick={() => setEditingDeadline(false)} className="flex-1 sm:flex-none justify-center">Cancelar</Btn>
                      </div>
                    </div>
                  </div>
                ) : deadline?.no_deadline ? (
                  <p className="text-sm" style={{ color: t.text3 }}>Sem prazo de entrega</p>
                ) : deadline?.deadline_date ? (
                  <div className="space-y-3">
                    {deadline.photos_sent_at && (
                      <div>
                        <p className="text-xs mb-0.5" style={{ color: t.text3 }}>Fotos enviadas em</p>
                        <p className="text-sm font-medium" style={{ color: t.text }}>{new Date(deadline.photos_sent_at).toLocaleString('pt-BR')}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs mb-0.5" style={{ color: t.text3 }}>Prazo de entrega</p>
                      <p className="text-sm font-medium" style={{ color: t.text }}>{formatDeadlineDate(deadline.deadline_date)}</p>
                      {client.status !== 'completed' && (() => {
                        const dias = calendarDaysUntil(deadline.deadline_date)
                        return (
                          <p className="text-xs text-orange-600 mt-0.5">
                            {dias === 0 ? 'Vence hoje' : `${dias} dia${dias !== 1 ? 's' : ''} restante${dias !== 1 ? 's' : ''}`}
                          </p>
                        )
                      })()}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: t.text3 }}>Nenhum prazo definido</p>
                )}
              </div>

              {/* Observações internas */}
              <div className="rounded-xl p-5" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2" style={{ color: t.text }}><MessageSquare className="h-4 w-4" style={{ color: t.text3 }} /> Observações Internas</h3>
                  <Btn variant={notesSaved ? 'green' : 'outline'} size="sm" onClick={handleSaveNotes} loading={savingNotes} disabled={notes === (client.notes || '')}>
                    {notesSaved ? <><Check className="h-3.5 w-3.5" /> Salvo</> : <><Save className="h-3.5 w-3.5" /> Salvar</>}
                  </Btn>
                </div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Anotações internas (não visível para a cliente)..."
                  className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none transition-colors"
                  style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }} />
                {notes !== (client.notes || '') && <p className="text-xs text-amber-500 mt-1.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Alterações não salvas</p>}
              </div>

              {/* Formulário */}
              <div className="rounded-xl p-5 md:col-span-2" style={{ background: t.surface, border: formSubmission ? `1px solid ${t.border}` : `1px dashed ${t.border}` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: formSubmission ? 'rgba(59,130,246,0.1)' : t.surface2 }}>
                      <ClipboardList className="h-5 w-5" style={{ color: formSubmission ? '#3b82f6' : t.text3 }} />
                    </div>
                    <div>
                      <h3 className="font-semibold" style={{ color: t.text }}>Formulário</h3>
                      {formSubmission ? <p className="text-xs" style={{ color: t.text3 }}>Enviado em {new Date(formSubmission.submitted_at).toLocaleDateString('pt-BR')}</p> : <p className="text-xs" style={{ color: t.text3 }}>Aguardando envio do cliente</p>}
                    </div>
                  </div>
                  {formSubmission && <Btn variant="outline" size="sm" onClick={() => setShowFormModal(true)}><Eye className="h-3.5 w-3.5" /> Ver Respostas</Btn>}
                </div>
              </div>
            </div>
          )}

          {tab === 'photos' && (
            <div className="space-y-4">
              <PhotosView clientId={clientId!} photos={photos} photoCategories={photoCategories} clientToken={client.token} clientName={client.full_name} onPhotosChange={load} />

              {/* Zona de limpeza — visível apenas para clientes concluídos */}
              {client.status === 'completed' && (
                <div className="flex items-center justify-between py-3 px-4 rounded-xl" style={{ background: '#fff5f5', border: '1px solid #fecaca' }}>
                  <div className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-red-400 flex-shrink-0" />
                    <span className="text-sm text-red-700 font-medium">Limpar arquivos</span>
                  </div>
                  <div className="flex-shrink-0">
                    {filesCleanedUp || (photos.length === 0 && !formSubmission) ? (
                      <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                        <CheckCircle className="h-3.5 w-3.5" />
                        {filesCleanedUp ? 'Removidos' : 'Nenhum arquivo'}
                      </span>
                    ) : (
                      <Btn variant="danger" size="sm" onClick={() => setShowCleanupModal(true)} loading={cleaningFiles}>
                        <Trash2 className="h-3.5 w-3.5" /> Limpar
                      </Btn>
                    )}
                  </div>
                </div>
              )}

              {/* Modal de confirmação de limpeza */}
              {showCleanupModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <Trash2 className="h-5 w-5 text-red-500" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">Limpar arquivos?</p>
                        <p className="text-xs text-gray-500 mt-0.5">{data?.client?.full_name}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      Fotos, anexos e dados do formulário serão removidos permanentemente do servidor.
                      Contrato, resultado e análise <span className="font-medium text-gray-800">são preservados</span>.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => setShowCleanupModal(false)}
                        className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleCleanupFiles}
                        className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <div className="space-y-4">
              {/* Sub-abas */}
              {isSuperAdmin && (
                <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: t.surface2 }}>
                  {[
                    { id: 'docs',         label: 'Documentos' },
                    { id: 'compositions', label: '✨ Geração por IA' },
                  ].map(({ id, label }) => (
                    <button
                      key={id}
                      onClick={() => setDocsSubTab(id as any)}
                      className="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
                      style={docsSubTab === id
                        ? { background: t.surface, color: t.text, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
                        : { background: 'transparent', color: t.text3 }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {isSuperAdmin && docsSubTab === 'docs' && <ClientDocumentsTab clientId={clientId!} />}
              {(!isSuperAdmin || docsSubTab === 'compositions') && (
                <AiCompositionsManager
                  clientId={clientId!}
                  clientName={client.full_name}
                  onGoToDocuments={() => setDocsSubTab('docs')}
                  onSavedToResult={load}
                />
              )}
            </div>
          )}

          {tab === 'result' && (
            <div className="space-y-5">
              {result?.is_released ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                  <div><p className="text-sm font-medium text-green-800">Resultado liberado</p><p className="text-xs text-green-600">A cliente pode visualizar desde {new Date(result.released_at).toLocaleString('pt-BR')}</p></div>
                </div>
              ) : (client.status === 'preparing_materials' || client.status === 'validating_materials' || client.status === 'sending_dossier') ? (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-teal-600 flex-shrink-0" />
                  <div><p className="text-sm font-medium text-teal-800">Resultado registrado, preparando materiais</p><p className="text-xs text-teal-600">Continue avançando as etapas internas no Controle de Etapas. O resultado só é liberado ao avançar de "Enviar Dossiê Capilar" para "Resultado".</p></div>
                </div>
              ) : (client.status === 'simulating' || client.status === 'making_capillary_dossier' || client.status === 'validating_capillary_dossier' || client.status === 'sending_capillary_dossier') ? (
                <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-violet-600 flex-shrink-0" />
                  <div><p className="text-sm font-medium text-violet-800">Resultado registrado, finalizando dossiê capilar</p><p className="text-xs text-violet-600">A cliente vê "simulações sendo feitas". O resultado é liberado ao avançar de "Enviar Dossiê Capilar" para "Resultado".</p></div>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                  <Lock className="h-5 w-5 text-amber-500 flex-shrink-0" />
                  <div><p className="text-sm font-medium text-amber-800">Resultado ainda não liberado</p><p className="text-xs text-amber-600">Preencha abaixo e salve. O resultado é liberado ao avançar para Concluído no Controle de Etapas</p></div>
                </div>
              )}

              <div className="rounded-xl p-4 space-y-3" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: t.text }}>
                    <FolderOpen className="h-4 w-4 text-violet-500" /> Pasta vinculada
                  </h3>
                  {linkedFolderConfig?.driveLink && (
                    <a
                      href={linkedFolderConfig.driveLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir Drive
                    </a>
                  )}
                </div>
                <FolderPicker folders={aiFolders} linkedFolderId={linkedFolderId} onSelect={handleLinkFolder} />
              </div>

              {tagTemplates.length > 0 && (
                <div className="rounded-xl p-5 space-y-4" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="font-semibold flex items-center gap-2" style={{ color: t.text }}>
                      <Tag className="h-4 w-4 text-emerald-500" /> Informações da análise
                    </h3>
                    {/* status do auto-save */}
                    {aiSaveStatus === 'saving' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: t.text3 }}>
                        <div className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
                        Salvando...
                      </span>
                    )}
                    {aiSaveStatus === 'saved' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                        <CheckCircle className="h-3 w-3" /> Salvo
                      </span>
                    )}
                    {aiSaveStatus === 'error' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600">
                        <AlertTriangle className="h-3 w-3" /> Erro ao salvar
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {clientTags.map(tag => {
                      const template = tagTemplates.find(tpl => tpl.id === tag.templateId)
                      const options  = template?.options || []
                      const tagType: 'text' | 'image' = template?.type === 'image' ? 'image' : 'text'

                      const updateValue = (newValue: string) =>
                        setClientTags(prev => prev.map(x =>
                          x.templateId === tag.templateId ? { ...x, value: newValue } : x
                        ))

                      return (
                        <div key={tag.templateId}>
                          <label className="block text-xs font-medium mb-1" style={{ color: t.text2 }}>
                            {tag.name}
                          </label>

                          {/* ── Tag IMAGEM: dropdown com preview ──────────────────── */}
                          {tagType === 'image' && options.length > 0 && (() => {
                            const isPickerOpen = openImagePicker === tag.templateId
                            const normalized   = options.map((o: any) => normalizeTagOption(o))
                            const selectedOpt  = normalized.find(o => o.label === tag.value)
                            return (
                              <div className="relative" data-image-picker>
                                {/* Trigger (parece um select) */}
                                <button
                                  type="button"
                                  onClick={() => setOpenImagePicker(isPickerOpen ? null : tag.templateId)}
                                  className="w-full px-3 py-2 rounded-lg text-sm flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
                                  style={{
                                    background: t.surface2,
                                    border: `1px solid ${t.border}`,
                                    color: tag.value ? t.text : t.text3,
                                  }}
                                >
                                  {selectedOpt?.imagePath ? (
                                    <img
                                      src={getOptionImageUrl(selectedOpt.imagePath)}
                                      alt=""
                                      className="w-7 h-7 rounded object-cover flex-shrink-0"
                                    />
                                  ) : selectedOpt ? (
                                    <div className="w-7 h-7 rounded flex-shrink-0" style={{ background: t.surface }} />
                                  ) : null}
                                  <span className="flex-1 text-left truncate">
                                    {tag.value || '— Selecione —'}
                                  </span>
                                  <ChevronDown
                                    className={`h-4 w-4 flex-shrink-0 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`}
                                    style={{ color: t.text3 }}
                                  />
                                </button>

                                {/* Painel de opções (lista vertical) */}
                                {isPickerOpen && (
                                  <div
                                    className="absolute z-20 left-0 right-0 mt-1 rounded-lg shadow-lg overflow-y-auto"
                                    style={{
                                      background: t.surface,
                                      border: `1px solid ${t.border}`,
                                      maxHeight: '18rem',
                                    }}
                                  >
                                    {/* opção "Nenhuma" */}
                                    <button
                                      type="button"
                                      onClick={() => { updateValue(''); setOpenImagePicker(null) }}
                                      className="w-full px-3 py-2 flex items-center gap-2 text-sm text-left hover:bg-emerald-50/60 transition-colors"
                                      style={{ color: tag.value === '' ? '#059669' : t.text3 }}
                                    >
                                      <div
                                        className="w-7 h-7 rounded border border-dashed flex items-center justify-center text-xs flex-shrink-0"
                                        style={{ borderColor: t.border, color: t.text3 }}
                                      >
                                        —
                                      </div>
                                      <span className="flex-1">Nenhuma</span>
                                      {tag.value === '' && <Check className="h-4 w-4 text-emerald-500" />}
                                    </button>

                                    {normalized.map((opt, i) => {
                                      const isSelected = tag.value === opt.label
                                      return (
                                        <button
                                          type="button"
                                          key={i}
                                          onClick={() => { updateValue(opt.label); setOpenImagePicker(null) }}
                                          className={`w-full px-3 py-2 flex items-center gap-2 text-sm text-left transition-colors ${
                                            isSelected ? 'bg-emerald-50' : 'hover:bg-gray-50'
                                          }`}
                                          style={{ color: isSelected ? '#059669' : t.text }}
                                        >
                                          {opt.imagePath ? (
                                            <img
                                              src={getOptionImageUrl(opt.imagePath)}
                                              alt=""
                                              className="w-7 h-7 rounded object-cover flex-shrink-0"
                                              loading="lazy"
                                            />
                                          ) : (
                                            <div
                                              className="w-7 h-7 rounded flex items-center justify-center text-[9px] flex-shrink-0"
                                              style={{ color: t.text3, background: t.surface2 }}
                                            >
                                              s/img
                                            </div>
                                          )}
                                          <span className="flex-1 truncate">{opt.label}</span>
                                          {isSelected && <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* ── Tag TEXTO com opções: select ─────────────────────────── */}
                          {tagType === 'text' && options.length > 0 && (
                            <select
                              value={tag.value}
                              onChange={e => updateValue(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                              style={{
                                background: t.surface2,
                                border: `1px solid ${t.border}`,
                                color: tag.value ? t.text : t.text3,
                              }}
                            >
                              <option value="">— Selecione —</option>
                              {options.map((opt: any, i: number) => {
                                const label = typeof opt === 'string' ? opt : (opt?.label ?? '')
                                return <option key={i} value={label}>{label}</option>
                              })}
                            </select>
                          )}

                          {/* ── Tag TEXTO sem opções: input livre ────────────────────── */}
                          {tagType === 'text' && options.length === 0 && (
                            <input
                              value={tag.value}
                              onChange={e => updateValue(e.target.value)}
                              placeholder="Digite o valor..."
                              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                              style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }}
                            />
                          )}

                          {/* ── Tag IMAGEM sem opções: aviso ────────────────────────── */}
                          {tagType === 'image' && options.length === 0 && (
                            <p
                              className="text-xs italic px-3 py-2 rounded-lg"
                              style={{ color: t.text3, background: t.surface2, border: `1px dashed ${t.border}` }}
                            >
                              Cadastre opções desta tag em <strong>Configurações</strong>.
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Ferramenta de Contraste ──────────────────────────────── */}
              {(() => {
                const hasSaved = !!contrastLayout?.photoId
                const formattedValue = contrastLayout
                  ? formatContrastValue(contrastLayout.label, contrastLayout.cMin, contrastLayout.cMax)
                  : null
                return (
                  <div className="rounded-xl p-5 space-y-4" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <h3 className="font-semibold flex items-center gap-2" style={{ color: t.text }}>
                        <SlidersHorizontal className="h-4 w-4 text-rose-500" /> Ferramenta de Contraste
                      </h3>
                      <Btn
                        variant="primary"
                        size="sm"
                        onClick={() => setContrastDialogOpen(true)}
                        className="w-full sm:w-auto justify-center whitespace-nowrap"
                      >
                        {hasSaved ? (<><Pencil className="h-3.5 w-3.5" /> Editar</>) : (<><Plus className="h-3.5 w-3.5" /> Abrir ferramenta</>)}
                      </Btn>
                    </div>

                    {hasSaved ? (
                      <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: t.surface2, border: `1px solid ${t.border}` }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: t.text3 }}>
                            Valor atual <span className="ml-1 normal-case font-normal" style={{ color: t.text3 }}>— disponível como <code>{'{{Contraste}}'}</code> nos prompts</span>
                          </p>
                          <p className="text-base font-mono mt-0.5 break-words" style={{ color: t.text }}>
                            {formattedValue}
                          </p>
                          {contrastLayout?.savedAt && (
                            <p className="text-[10px] mt-1" style={{ color: t.text3 }}>
                              Atualizado em {new Date(contrastLayout.savedAt).toLocaleString('pt-BR')}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm py-4 text-center rounded-lg" style={{ color: t.text3, border: `1px dashed ${t.border}` }}>
                        Ferramenta ainda não configurada para esta cliente.
                      </p>
                    )}
                  </div>
                )
              })()}

              {contrastDialogOpen && data?.client && (
                <ContrastLayoutDialog
                  clientId={clientId!}
                  clientName={data.client.full_name}
                  initial={contrastLayout}
                  onClose={() => setContrastDialogOpen(false)}
                  onSave={handleSaveContrastLayout}
                  onSaveToResults={file => handleUploadResultFile(file, 'photo')}
                />
              )}

              {/* ── Análise da Íris ───────────────────────────────────────── */}
              {isSuperAdmin && (
                <IrisAnalysisSection
                  irisAnalysis={irisAnalysis}
                  onOpen={() => setIrisDialogOpen(true)}
                />
              )}

              {isSuperAdmin && irisDialogOpen && data?.client && (
                <IrisAnalysisDialog
                  clientId={clientId!}
                  clientName={data.client.full_name}
                  initial={irisAnalysis}
                  onClose={() => setIrisDialogOpen(false)}
                  onSave={handleSaveIrisAnalysis}
                  onSaveToResults={file => handleUploadResultFile(file, 'photo')}
                  templates={irisTemplates}
                  onSaveTemplate={async (payload) => {
                    const created = await adminService.createIrisTextTemplate({
                      name: payload.name,
                      title: payload.title,
                      body: payload.body,
                      font_family: payload.fontFamily,
                      text_color: payload.textColor,
                      bg_color: payload.bgColor,
                      title_size: payload.titleSize,
                      body_size: payload.bodySize,
                    })
                    // Adiciona na lista local sem precisar recarregar tudo
                    setIrisTemplates(prev => [...prev, {
                      id: created.id,
                      name: created.name,
                      title: created.title,
                      body: created.body,
                      fontFamily: created.font_family,
                      textColor: created.text_color,
                      bgColor: created.bg_color,
                      titleSize: created.title_size,
                      bodySize: created.body_size,
                      createdAt: created.created_at,
                      updatedAt: created.updated_at,
                    }])
                  }}
                />
              )}

              <div className="rounded-xl p-5 space-y-4" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
                <h3 className="font-semibold" style={{ color: t.text }}>Observações e arquivos</h3>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: t.text2 }}>Observações</label>
                  <textarea value={resultForm.observations} onChange={e => setResultForm({ ...resultForm, observations: e.target.value })} rows={4} placeholder="Comentários, recomendações, paleta de cores..." className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: t.text2 }}>
                Link de acesso <span className="font-normal" style={{ color: t.text3 }}>(opcional)</span>
              </label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: t.text3 }} />
                <input
                  type="url"
                  value={resultForm.custom_link_url}
                  onChange={e => setResultForm({ ...resultForm, custom_link_url: e.target.value })}
                  placeholder="https://..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                  style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text }}
                />
              </div>
              <p className="text-xs mt-1.5" style={{ color: t.text3 }}>
                Aparece pra cliente como botão "Acessar link" no Resultado.
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium" style={{ color: t.text2 }}>Arquivos PDF</label>
                <Btn variant="outline" size="sm" onClick={() => pdfInputRef.current?.click()} loading={uploadingKind === 'pdf'}>
                  <Upload className="h-3.5 w-3.5" /> Upload PDF
                </Btn>
                <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={onPickPdf} />
              </div>
              {(() => {
                const pdfs = (resultFiles || []).filter((f: any) => getResultFileKind(f.file_name) === 'pdf')
                if (pdfs.length === 0) return <p className="text-sm py-4 text-center rounded-lg" style={{ color: t.text3, border: `1px dashed ${t.border}` }}>Nenhum PDF adicionado</p>
                return (
                  <div className="space-y-2">
                    {pdfs.map((f: any) => (
                      <div key={f.id} className="flex items-center justify-between gap-2 p-3 rounded-lg" style={{ background: t.surface2 }}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />
                          <span className="text-sm truncate min-w-0" style={{ color: t.text }}>{f.file_name}</span>
                          <span className="text-xs whitespace-nowrap flex-shrink-0" style={{ color: t.text3 }}>{(f.file_size / 1024).toFixed(0)} KB</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Btn
                            variant="ghost"
                            size="sm"
                            loading={downloadingResultFileId === f.id}
                            onClick={() => handleDownloadResultFile(f)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Btn>
                          <Btn variant="ghost" size="sm" onClick={() => handleDeleteFile(f.id, f.storage_path)} className="text-red-500 hover:bg-red-50">
                            <X className="h-3.5 w-3.5" />
                          </Btn>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* ── Áudios ──────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <label className="text-sm font-medium" style={{ color: t.text2 }}>Áudios</label>
                <div className="flex gap-2">
                  <Btn variant="outline" size="sm" onClick={() => audioInputRef.current?.click()} loading={uploadingKind === 'audio'} disabled={recState.kind === 'recording' || recState.kind === 'uploading'}>
                    <Upload className="h-3.5 w-3.5" /> Upload áudio
                  </Btn>
                  {recState.kind === 'idle' || recState.kind === 'preview' ? (
                    <Btn variant="outline" size="sm" onClick={startRecording} disabled={uploadingKind === 'audio' || recState.kind === 'preview'}>
                      <Mic className="h-3.5 w-3.5" /> Gravar
                    </Btn>
                  ) : recState.kind === 'recording' ? (
                    <Btn variant="outline" size="sm" onClick={stopRecording} className="text-red-600 border-red-300 hover:bg-red-50">
                      <Square className="h-3.5 w-3.5 fill-current" /> Parar ({formatDuration(Date.now() - recState.startedAt)})
                    </Btn>
                  ) : (
                    <Btn variant="outline" size="sm" loading>Enviando…</Btn>
                  )}
                </div>
                <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={onPickAudio} />
              </div>

              {/* Indicador de gravação ao vivo */}
              {recState.kind === 'recording' && (
                <div className="mb-3 px-4 py-3 rounded-lg flex items-center gap-3" style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)' }}>
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                  <span className="text-sm font-medium text-red-700">Gravando… {formatDuration(Date.now() - recState.startedAt)}</span>
                </div>
              )}

              {/* Preview pós-gravação */}
              {recState.kind === 'preview' && (
                <div className="mb-3 px-4 py-3 rounded-lg" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <p className="text-sm font-medium mb-2" style={{ color: t.text }}>Áudio gravado ({formatDuration(recState.durationMs)}) — confira antes de salvar:</p>
                  <audio src={recState.url} controls className="w-full mb-3" />
                  <div className="flex gap-2">
                    <Btn size="sm" onClick={saveRecording}><Save className="h-3.5 w-3.5" /> Salvar</Btn>
                    <Btn variant="outline" size="sm" onClick={discardRecording}><X className="h-3.5 w-3.5" /> Descartar</Btn>
                  </div>
                </div>
              )}

              {(() => {
                const audios = (resultFiles || []).filter((f: any) => getResultFileKind(f.file_name) === 'audio')
                if (audios.length === 0) return <p className="text-sm py-4 text-center rounded-lg" style={{ color: t.text3, border: `1px dashed ${t.border}` }}>Nenhum áudio adicionado</p>
                return (
                  <div className="space-y-2">
                    {audios.map((f: any) => (
                      <div key={f.id} className="p-3 rounded-lg" style={{ background: t.surface2 }}>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Music className="h-4 w-4 text-violet-500 flex-shrink-0" />
                            <span className="text-sm truncate min-w-0" style={{ color: t.text }}>{f.file_name}</span>
                            <span className="text-xs whitespace-nowrap flex-shrink-0" style={{ color: t.text3 }}>{(f.file_size / 1024).toFixed(0)} KB</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <a href={adminService.getResultFileUrl(f)} target="_blank" rel="noopener noreferrer">
                              <Btn variant="ghost" size="sm"><Download className="h-3.5 w-3.5" /></Btn>
                            </a>
                            <Btn variant="ghost" size="sm" onClick={() => handleDeleteFile(f.id, f.storage_path)} className="text-red-500 hover:bg-red-50">
                              <X className="h-3.5 w-3.5" />
                            </Btn>
                          </div>
                        </div>
                        {f.drive_file_id
                          ? <DriveAudioPlayer driveFileId={f.drive_file_id} className="w-full" />
                          : <audio src={adminService.getResultFileUrl(f)} controls preload="auto" className="w-full" />
                        }
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* ── Fotos ───────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium" style={{ color: t.text2 }}>Fotos</label>
                <Btn variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} loading={uploadingKind === 'photo'}>
                  <Upload className="h-3.5 w-3.5" /> Upload foto
                </Btn>
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickPhoto} />
              </div>
              {(() => {
                const images = (resultFiles || []).filter((f: any) => getResultFileKind(f.file_name) === 'image')
                if (images.length === 0) return <p className="text-sm py-4 text-center rounded-lg" style={{ color: t.text3, border: `1px dashed ${t.border}` }}>Nenhuma foto adicionada</p>
                // Mapeia pro shape esperado pelo PhotoLightbox: { id, url, photo_name }
                const lightboxPhotos = images.map((f: any) => ({
                  id: f.id,
                  url: f.drive_file_id ? driveStorage.viewUrl(f.drive_file_id) : adminService.getResultFileUrl(f),
                  photo_name: f.file_name,
                  storage_path: f.storage_path,
                }))
                return (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {images.map((f: any, idx: number) => {
                      const url = f.drive_file_id ? driveStorage.viewUrl(f.drive_file_id, 400) : adminService.getResultFileUrl(f)
                      return (
                        <div key={f.id} className="relative group aspect-square rounded-lg overflow-hidden" style={{ background: t.surface2 }}>
                          <button
                            type="button"
                            onClick={() => setResultLightbox({ photos: lightboxPhotos, index: idx })}
                            className="block w-full h-full"
                            title={f.file_name}
                          >
                            <SafeImage src={url} alt={f.file_name} className="w-full h-full object-cover hover:opacity-80 transition-opacity" />
                          </button>
                          <Btn
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteFile(f.id, f.storage_path)}
                            className="absolute top-1 right-1 text-red-500 bg-white/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Btn>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
            <div className="flex flex-col items-start sm:flex-row sm:items-center gap-3 pt-3" style={{ borderTop: `1px solid ${t.border}` }}>
              <Btn onClick={async () => { await handleSaveResult(); await handleSaveAIConfig(); await load() }} loading={savingResult || savingAI} className="w-full sm:w-auto justify-center">
                <Save className="h-4 w-4" /> Salvar
              </Btn>
              {aiSaveStatus === 'saved' && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Salvo!</span>}
              <span className="text-xs sm:ml-auto flex items-center gap-1" style={{ color: t.text3 }}><Lock className="h-3 w-3" /> Liberação via Controle de Etapas</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="">
          <div className="rounded-xl p-6" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
            <AIPromptConfig
              clientId={clientId!}
              clientName={client.full_name}
              isReleased={result?.is_released || false}
              chatEnabled={chatEnabled}
              onChatEnabledChange={setChatEnabled}
              onSaveChatEnabled={handleSaveChatEnabled}
              clientPhotos={photos}
              photoCategories={photoCategories}
              onAfterSaveRefPhotos={load}
              isSuperAdmin={isSuperAdmin}
            />
          </div>
        </div>
      )}

      {/* ── Aba Chat IA (admin) ──────────────────────────────────────────────
          Reaproveita o GeminiChat que a cliente vê, mas em modo `unlimited`
          (sem checagem/consumo de créditos) e com chave de localStorage
          própria para não misturar com o histórico real da cliente. */}
      {tab === 'chat' && (
        <div className="space-y-3">
          <div className="rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
            style={{ background: t.surface, border: `1px solid ${t.border}` }}>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center flex-shrink-0">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: t.text }}>
                Pré-visualização do Chat IA — modo admin
              </p>
              <p className="text-xs" style={{ color: t.text3 }}>
                Sem limite de imagens ou textos, e sem caixa de texto livre — aqui você só dispara os prompts já cadastrados, pra testar como cada um se comporta. As mensagens ficam em histórico separado do chat real da cliente.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {result?.chat_enabled
                ? <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200"><Unlock className="h-3 w-3" /> Liberado p/ cliente</span>
                : <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-50 text-gray-500 border border-gray-200"><Lock className="h-3 w-3" /> Não liberado</span>}
              <button onClick={() => setTab('ai')} className="text-xs px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50">
                Configurar
              </button>
            </div>
          </div>

          {!adminAiSystemPrompt ? (
            <div className="rounded-xl p-6 text-center" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
              <Wand2 className="h-8 w-8 mx-auto mb-2" style={{ color: t.text3 }} />
              <p className="text-sm font-medium" style={{ color: t.text }}>Configuração de IA ainda não preenchida</p>
              <p className="text-xs mt-1" style={{ color: t.text3 }}>
                Vincule uma pasta de IA e preencha as informações da análise na aba <strong>Resultado</strong> para liberar o chat.
              </p>
            </div>
          ) : (
            <GeminiChat
              clientName={client.full_name}
              systemPrompt={adminAiSystemPrompt}
              referencePhotoUrl={adminAiRefPhotoUrl}
              referencePhotoDriveFileId={adminAiRefPhotoDriveFileId}
              referencePhotos={adminAiRefPhotos}
              folderConfig={linkedFolderConfig}
              clientId={clientId!}
              resultFileUrls={adminResultFileUrls}
              resultObservations={result?.observations || ''}
              unlimited
              promptsOnly
              chatStorageKey={`mscolors_chat_admin_${clientId}`}
              onSavePdf={async (blob, fileName) => {
                // Salva o PDF gerado pelo chat IA direto em
                // client_result_files (aba Resultado → Arquivos PDF).
                // Após o upload damos um reload pra lista atualizar na hora.
                const file = new File([blob], fileName, { type: 'application/pdf' })
                await adminService.uploadResultFile(clientId!, file)
                await load()
              }}
            />
          )}
        </div>
      )}

      {showFormModal && formSubmission && (
        <FormResponseModal formSubmission={formSubmission} planForm={planForm} clientId={client.id} onClose={() => setShowFormModal(false)} />
      )}

      {/* Lightbox para fotos do Resultado — reaproveita o PhotoLightbox que
          já tem zoom, pan, pinch, navegação por teclado e prev/next. Quando
          o admin clica em "deletar" dentro do lightbox, delega pro handler
          comum handleDeleteFile (mesmo usado nas listas de PDF/áudio). */}
      {resultLightbox && (
        <PhotoLightbox
          photos={resultLightbox.photos}
          initialIndex={resultLightbox.index}
          onClose={() => setResultLightbox(null)}
          onDelete={async photo => {
            await handleDeleteFile(photo.id, photo.storage_path)
            // remove a foto deletada do array local pra navegação seguir certa
            setResultLightbox(s => {
              if (!s) return null
              const next = s.photos.filter((p: any) => p.id !== photo.id)
              if (next.length === 0) return null
              return { photos: next, index: Math.min(s.index, next.length - 1) }
            })
          }}
        />)}
      {/* Modal de rejeição de Foto IA */}
      {showAiPhotoRejectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget && !rejectingAiPhoto) setShowAiPhotoRejectionModal(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Solicitar nova foto IA</p>
                <p className="text-xs text-gray-500 mt-0.5">{data?.client?.full_name}</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Motivo / orientação para a cliente</label>
              <textarea
                value={aiPhotoRejectionReason}
                onChange={e => setAiPhotoRejectionReason(e.target.value)}
                rows={3}
                placeholder="Ex: A foto precisa ser com o rosto mais iluminado, sem filtros..."
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1.5">A foto atual será removida e a cliente poderá enviar uma nova.</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowAiPhotoRejectionModal(false); setAiPhotoRejectionReason('') }}
                disabled={rejectingAiPhoto}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >Cancelar</button>
              <button
                onClick={handleRejectAiPhoto}
                disabled={rejectingAiPhoto || !aiPhotoRejectionReason.trim()}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {rejectingAiPhoto && <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
                Solicitar Nova Foto
              </button>
            </div>
          </div>
        </div>
      )}
      <RejectionModal
        open={showRejection}
        clientName={data?.client?.full_name ?? ''}
        hasForm={!!formSubmission}
        hasPhotos={photos.length > 0}
        onCancel={() => setShowRejection(false)}
        onConfirm={handleReject}
      />
      </div>{/* end inner space-y-6 */}
      </div>{/* end overflow-y-auto */}
    </div>
  )
}

// ─── Router ───────────────────────────────────────────────────────────────
export function ClientsManager({ onOpenNav }: { onOpenNav?: () => void }) {
  return (
    <Routes>
      <Route index element={<ClientsList onOpenNav={onOpenNav} />} />
      <Route path=":clientId" element={<ClientDetail onOpenNav={onOpenNav} />} />
    </Routes>
  )
}