// src/components/admin/StandaloneAiGenerationPage.tsx
//
// Página de geração de imagens por IA sem vínculo com cliente.
// Disponível apenas para o plano "Salão + IA" (role: 'full_admin').
//
// Fluxo:
//   1. Seleciona o prompt PAI (com N partes)
//   2. Faz upload de uma foto diretamente (sem galeria)
//   3. Clica "Adicionar páginas" → N cards na fila (1 por parte)
//   4. Gera as imagens (batch ou individual)
//   5. "Finalizar e Gerar PDF" → baixa o PDF com branding do admin
//
// Diferenças vs AiCompositionsManager:
//   • Sem seleção de cliente (usa o ID do admin logado como clientId)
//   • Foto via upload direto (base64) — sem galeria
//   • Download apenas — sem "Salvar no resultado do cliente"

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Sparkles, Plus, Trash2, ArrowUp, ArrowDown,
  Play, AlertCircle, Loader2, X, Download,
  FileText, RefreshCw, Image as ImageIcon, Wand2, Eye,
  Camera, ImagePlus, SlidersHorizontal, Tag, Check, Save,
} from 'lucide-react'
import { documentsService } from './documents/lib/documentsService'
import { driveStorage } from '../../lib/driveStorage'
import { supabase } from '../../lib/supabase'
import { adminService } from '../../lib/services'
import {
  generateCompositionPdf,
  fetchAllByDriveId,
  base64PdfToArrayBuffer,
} from './documents/ai-compositions/generateCompositionPdf'
import { substitutePromptVars, type PromptVarSource } from './documents/lib/promptVars'
import type { AiPromptPart } from './documents/prompts/AiImagePromptsManager'

// ── Btn ───────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, type = 'button', className = '',
}: any) => {
  const v: any = {
    primary:   'bg-fuchsia-500 text-white hover:bg-fuchsia-600',
    secondary: 'bg-rose-500 text-white hover:bg-rose-600',
    success:   'bg-emerald-500 text-white hover:bg-emerald-600',
    outline:   'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:     'text-gray-600 hover:bg-gray-100',
    danger:    'text-red-600 hover:bg-red-50',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ── Types ─────────────────────────────────────────────────────────────

type PageStatus = 'pending' | 'generating' | 'done' | 'error'

interface CompositionPage {
  id:          string
  promptId:    string
  promptName:  string
  partId:      string
  partLabel:   string
  partPrompt:  string
  // Foto uploadada (base64) — sem galeria nesta página
  photoPreviewUrl:      string       // blob URL só pra preview
  uploadedPhotoBase64:  string
  uploadedPhotoMime:    string
  // Status
  status:               PageStatus
  generatedDriveFileId?: string   // usado no modo galeria (AiCompositionsManager)
  generatedImageBase64?: string   // usado no modo standalone (sem Drive)
  generatedImageMime?:  string
  generatedImageUrl?:   string
  errorMsg?:            string
}

interface AiPromptLite {
  id:    string
  name:  string
  parts: AiPromptPart[]
  model: string
  size:  string
  quality: string
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

// ── Types extras ──────────────────────────────────────────────────────

interface TagTemplate {
  id:      string
  name:    string
  type:    'text' | 'image'
  options: string[]
}

interface ContrastData {
  cMin:  number
  cMax:  number
  zoom:  number
  yOff:  number
  label: string
}

// ── LocalStorage: persistência da geração IA ──────────────────────────
//
// Estratégia v3 — imagens em chaves individuais:
//
//   config    → prompt, foto original (base64), subtom, contraste
//   workspace → lista de páginas SEM os base64 das imagens geradas
//               (só metadados: id, status, promptId, labels…)
//   img:{pageId} → base64 da imagem gerada daquela página (chave separada)
//
// Isso evita o estouro de quota do localStorage (~5 MB) que ocorria quando
// todas as imagens eram serializadas juntas no workspace. Cada imagem ocupa
// sua própria chave; se uma falhar, as outras continuam salvas.
//
// A foto de upload (photoBase64) continua na config pois só há uma e é
// comprimida (≤ ~400 KB após compressão 1280px/0.88).

const STANDALONE_AI_STORAGE_V = 3

const standaloneAiStorageKeys = (adminId: string) => ({
  config:    `standalone_ai_generation_${adminId}_config_v${STANDALONE_AI_STORAGE_V}`,
  workspace: `standalone_ai_generation_${adminId}_workspace_v${STANDALONE_AI_STORAGE_V}`,
  img:       (pageId: string) => `standalone_ai_generation_${adminId}_img_${pageId}_v${STANDALONE_AI_STORAGE_V}`,
  // prefixo para listar/limpar chaves de imagem
  imgPrefix: `standalone_ai_generation_${adminId}_img_`,
})

interface PersistedConfig {
  selectedPromptId:  string
  photoBase64:       string | null
  photoMime:         string
  aiInfoValues:      Record<string, string>
  contrastData:      ContrastData | null
  contrastFormatted: string
}

// Workspace NÃO contém base64 de imagens geradas — ficam em chaves separadas
interface PersistedWorkspace {
  pages:         Omit<CompositionPage, 'generatedImageBase64' | 'generatedImageMime' | 'generatedImageUrl' | 'photoPreviewUrl'>[]
  compositionId: string
}

function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function safeSetItem(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true } catch (e) {
    console.warn('[standalone storage] falha ao salvar — quota excedida ou storage indisponível:', key, e)
    return false
  }
}

function safeRemoveItem(key: string) {
  try { localStorage.removeItem(key) } catch {}
}

// Remove todas as chaves de imagens geradas de um adminId
function clearStoredImages(adminId: string) {
  try {
    const prefix = standaloneAiStorageKeys(adminId).imgPrefix
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix)) toRemove.push(k)
    }
    toRemove.forEach(k => localStorage.removeItem(k))
  } catch {}
}

// Remove chaves de versões ANTERIORES do mesmo adminId para liberar quota.
// Chamado uma vez na inicialização (quando adminId fica disponível).
// Padrão das chaves: standalone_ai_generation_{adminId}_*_v{N} onde N < versão atual.
function evictStaleStorage(adminId: string) {
  try {
    const prefix = `standalone_ai_generation_${adminId}_`
    const currentSuffix = `_v${STANDALONE_AI_STORAGE_V}`
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix) && !k.endsWith(currentSuffix)) {
        toRemove.push(k)
      }
    }
    if (toRemove.length > 0) {
      console.info(`[standalone storage] removendo ${toRemove.length} chave(s) de versões antigas`)
      toRemove.forEach(k => localStorage.removeItem(k))
    }
  } catch {}
}

/**
 * Tenta salvar `value` em `key`.
 *
 * Estratégia de evict em 3 camadas — para assim que a tentativa de salvar
 * tiver sucesso:
 *
 * 1. Imagens de páginas standalone mais antigas do mesmo adminId
 *    (chaves img_* de outras páginas, mais antiga → mais nova).
 * 2. Todas as imagens standalone do adminId (clearStoredImages).
 * 3. Qualquer chave do localStorage ordenada por tamanho (maior → menor),
 *    excluindo a própria chave destino e as chaves críticas de config/workspace
 *    do standalone atual. Isso libera espaço ocupado por outros módulos do app.
 *
 * Só retorna false se mesmo após esvaziar tudo o valor não couber.
 *
 * @param pageIds  Ordem atual das páginas (mais antigas primeiro). A página
 *                 da própria chave sendo salva é excluída do evict para não
 *                 apagar a imagem que acabou de chegar.
 */
function safeSetItemWithEvict(
  key: string,
  value: string,
  adminId: string,
  pageIds: string[],
): boolean {
  // Tentativa direta
  try { localStorage.setItem(key, value); return true } catch { /* quota */ }

  const stKeys = standaloneAiStorageKeys(adminId)
  const suffix  = `_v${STANDALONE_AI_STORAGE_V}`

  // Chaves críticas que nunca devem ser apagadas
  const critical = new Set([key, stKeys.config, stKeys.workspace])

  // ── Camada 1: imagens standalone de outras páginas (mais antiga → mais nova) ──
  const currentPageId = (() => {
    const prefix = stKeys.imgPrefix
    if (!key.startsWith(prefix)) return null
    const mid = key.slice(prefix.length)
    return mid.endsWith(suffix) ? mid.slice(0, -suffix.length) : null
  })()

  for (const pid of pageIds) {
    if (pid === currentPageId) continue
    const imgKey = stKeys.img(pid)
    if (safeGetItem(imgKey) === null) continue
    try { localStorage.removeItem(imgKey) } catch { continue }
    console.info(`[standalone storage] evict L1: removeu img página ${pid}`)
    try { localStorage.setItem(key, value); return true } catch { /* próximo */ }
  }

  // ── Camada 2: todas as imagens standalone restantes ──
  clearStoredImages(adminId)
  try { localStorage.setItem(key, value); return true } catch { /* próximo */ }

  // ── Camada 3: qualquer chave do localStorage, ordenada por tamanho (maior → menor) ──
  // O localStorage do app pode ter dados de outros módulos (ClientsManager, etc.)
  // que estão consumindo a quota. Sacrificamos os maiores primeiro.
  try {
    const allKeys: { k: string; size: number }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || critical.has(k)) continue
      const v = localStorage.getItem(k)
      allKeys.push({ k, size: (v?.length ?? 0) })
    }
    allKeys.sort((a, b) => b.size - a.size)   // maior primeiro

    for (const { k } of allKeys) {
      try { localStorage.removeItem(k) } catch { continue }
      console.info(`[standalone storage] evict L3: removeu chave externa ${k}`)
      try { localStorage.setItem(key, value); return true } catch { /* próximo */ }
    }
  } catch { /* em ambientes restritos getItem pode lançar */ }

  console.warn('[standalone storage] não foi possível salvar mesmo após evict total:', key)
  return false
}

// ── Canvas helpers (espelho do ContrastLayoutDialog) ──────────────────

const CW = 1340, CH = 950
const LABEL_OPTIONS_C = ['baixo', 'médio', 'médio alto', 'alto', 'muito alto'] as const

function formatContrastStandalone(label: string, cMin: number, cMax: number): string {
  const cap = (s: string) => s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ')
  return `${cap(label)} (${cMin} a ${cMax})`
}

function roundRectPathC(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r)
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r)
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r)
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r); ctx.closePath()
}
function fillRRC(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); roundRectPathC(ctx, x, y, w, h, r); ctx.fill()
}
function strokeRRC(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); roundRectPathC(ctx, x, y, w, h, r); ctx.stroke()
}

function drawContrastLayout(
  canvas: HTMLCanvasElement, img: HTMLImageElement,
  opts: { cMin: number; cMax: number; zoom: number; yOff: number; label: string },
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = CW; canvas.height = CH
  const { cMin, cMax, zoom: zoomPct, yOff, label } = opts
  const scale = zoomPct / 100

  ctx.fillStyle = '#F7F5F0'; ctx.fillRect(0, 0, CW, CH)
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`
    ctx.fillRect(Math.random() * CW, Math.random() * CH, 1, 1)
  }
  ctx.strokeStyle = '#D4D0C8'; ctx.lineWidth = 1; strokeRRC(ctx, 40, 28, CW-80, CH-56, 4)

  const title = `Sua escala de profundidade resulta em um contraste ${label} (${cMin} a ${cMax}).`
  ctx.fillStyle = '#1A1A1A'
  ctx.font = `400 ${title.length > 60 ? 28 : 30}px Georgia, serif`
  ctx.textAlign = 'center'; ctx.fillText(title, CW/2, 75)

  ctx.strokeStyle = '#DAD7CF'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(120, 93); ctx.lineTo(CW-120, 93); ctx.stroke()

  const sx = 180, sw = CW-360, segW = sw/10, scaleY = 150
  const bx1 = sx+(cMin-1)*segW, bx2 = sx+cMax*segW, bY = scaleY-28

  ctx.strokeStyle = '#2A2A2A'; ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bx1,bY); ctx.lineTo(bx2,bY)
  ctx.moveTo(bx1,bY); ctx.lineTo(bx1,bY+14)
  ctx.moveTo(bx2,bY); ctx.lineTo(bx2,bY+14)
  ctx.stroke()
  ctx.fillStyle = '#555'; ctx.font = '400 22px Helvetica,Arial,sans-serif'
  ctx.textAlign = 'center'; ctx.fillText(`${cMin} a ${cMax}`, (bx1+bx2)/2, bY-8)

  const grad = ctx.createLinearGradient(sx, 0, sx+sw, 0)
  grad.addColorStop(0, '#F0F0F0'); grad.addColorStop(1, '#0A0A0A')
  ctx.fillStyle = grad; fillRRC(ctx, sx, scaleY, sw, 28, 2)
  ctx.strokeStyle = '#BBBBBB'; ctx.lineWidth = 1; strokeRRC(ctx, sx, scaleY, sw, 28, 2)

  ctx.lineWidth = 1
  for (let i = 1; i < 10; i++) {
    const tx = sx+i*segW
    ctx.strokeStyle = i >= 5 ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.15)'
    ctx.beginPath(); ctx.moveTo(tx, scaleY); ctx.lineTo(tx, scaleY+28); ctx.stroke()
  }
  ctx.font = '400 20px Helvetica,Arial,sans-serif'
  for (let i = 1; i <= 10; i++) {
    ctx.fillStyle = (i < cMin || i > cMax) ? '#AAAAAA' : '#444444'
    ctx.textAlign = 'center'; ctx.fillText(String(i), sx+(i-0.5)*segW, scaleY+48)
  }

  const photoY = scaleY+67, photoW = 530, photoH = 660, gap = 50
  const startX = (CW-(photoW*2+gap))/2
  const lx = startX, rx = startX+photoW+gap

  function drawPhoto(px: number, py: number, pw: number, ph: number, bw: boolean) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4
    ctx.fillStyle = '#fff'; fillRRC(ctx, px, py, pw, ph, 4); ctx.restore()
    ctx.fillStyle = '#fff'; fillRRC(ctx, px, py, pw, ph, 4)
    ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 1; strokeRRC(ctx, px, py, pw, ph, 4)
    const pad = 8, ix = px+pad, iy = py+pad, iw = pw-pad*2, ih = ph-pad*2
    ctx.save(); ctx.beginPath(); roundRectPathC(ctx, ix, iy, iw, ih, 2); ctx.clip()
    const imgAsp = img.naturalWidth/img.naturalHeight, frameAsp = iw/ih
    let drawW: number, drawH: number
    if (imgAsp > frameAsp) { drawH = ih*scale; drawW = drawH*imgAsp }
    else { drawW = iw*scale; drawH = drawW/imgAsp }
    const dx = ix+(iw-drawW)/2, dy = iy+(ih-drawH)/2+yOff*4
    if (bw) {
      const oc = document.createElement('canvas')
      oc.width = Math.round(drawW); oc.height = Math.round(drawH)
      const oc2 = oc.getContext('2d')!
      oc2.drawImage(img, 0, 0, oc.width, oc.height)
      const id = oc2.getImageData(0, 0, oc.width, oc.height), d = id.data
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114
        d[i] = d[i+1] = d[i+2] = g
      }
      oc2.putImageData(id, 0, 0); ctx.drawImage(oc, dx, dy, drawW, drawH)
    } else {
      ctx.drawImage(img, dx, dy, drawW, drawH)
    }
    ctx.restore()
  }
  drawPhoto(lx, photoY, photoW, photoH, true)
  drawPhoto(rx, photoY, photoW, photoH, false)
  ctx.fillStyle = '#777'; ctx.font = '400 24px Helvetica,Arial,sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('Preto e branco', lx+photoW/2, photoY+photoH+32)
  ctx.fillText('Colorida', rx+photoW/2, photoY+photoH+32)
}

// ── StandaloneContrastDialog ──────────────────────────────────────────
// Versão simplificada do ContrastLayoutDialog: usa a foto já upada
// (blob URL) em vez de carregar da galeria do cliente.

function StandaloneContrastDialog({
  photoUrl, initial, onClose, onSave,
}: {
  photoUrl: string
  initial?: ContrastData | null
  onClose: () => void
  onSave:  (data: ContrastData, formatted: string) => void
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null)
  const [loadErr,   setLoadErr]   = useState<string | null>(null)

  const [cMin,  setCMin]  = useState(initial?.cMin  ?? 2)
  const [cMax,  setCMax]  = useState(initial?.cMax  ?? 9)
  const [zoom,  setZoom]  = useState(initial?.zoom  ?? 108)
  const [yOff,  setYOff]  = useState(initial?.yOff  ?? 0)
  const [label, setLabel] = useState(initial?.label ?? 'médio alto')

  // Carrega a foto na montagem
  useEffect(() => {
    const img = new Image()
    img.onload  = () => setLoadedImg(img)
    img.onerror = () => setLoadErr('Não foi possível carregar a foto.')
    img.src = photoUrl
  }, [photoUrl])

  // Redesenha ao mudar controles
  const redraw = useCallback(() => {
    if (!canvasRef.current || !loadedImg) return
    drawContrastLayout(canvasRef.current, loadedImg, { cMin, cMax, zoom, yOff, label })
  }, [loadedImg, cMin, cMax, zoom, yOff, label])

  useEffect(() => { redraw() }, [redraw])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  function handleDownload() {
    if (!canvasRef.current) return
    const a = document.createElement('a')
    a.download = 'layout-contraste.png'
    a.href = canvasRef.current.toDataURL('image/png')
    a.click()
  }

  function handleSave() {
    const data: ContrastData = { cMin, cMax, zoom, yOff, label }
    onSave(data, formatContrastStandalone(label, cMin, cMax))
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col"
        style={{ maxWidth: 860, maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-semibold text-gray-900">Ferramenta de Contraste</p>
            <p className="text-xs text-gray-500 mt-0.5">Ajuste a faixa de contraste. O valor vira tag nos prompts.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-4 items-end bg-gray-50 flex-shrink-0">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Faixa de contraste</label>
            <div className="flex items-center gap-2">
              <input type="number" value={cMin} min={1} max={10} onChange={e => setCMin(Number(e.target.value))}
                className="w-12 text-center border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
              <span className="text-sm text-gray-400">a</span>
              <input type="number" value={cMax} min={1} max={10} onChange={e => setCMax(Number(e.target.value))}
                className="w-12 text-center border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tipo</label>
            <select value={label} onChange={e => setLabel(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400">
              {LABEL_OPTIONS_C.map(v => (
                <option key={v} value={v}>{v.split(/\s+/).map(w => w ? w[0].toUpperCase()+w.slice(1) : '').join(' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Zoom {zoom}%</label>
            <input type="range" min={80} max={160} step={1} value={zoom} onChange={e => setZoom(Number(e.target.value))} className="w-28 accent-rose-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Posição {yOff > 0 ? `+${yOff}` : yOff}</label>
            <input type="range" min={-50} max={50} step={1} value={yOff} onChange={e => setYOff(Number(e.target.value))} className="w-28 accent-rose-500" />
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadErr ? (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" />
              <p className="text-sm text-red-700">{loadErr}</p>
            </div>
          ) : !loadedImg ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 text-rose-400 animate-spin" />
            </div>
          ) : (
            <>
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-[#F7F5F0]" style={{ aspectRatio: `${CW}/${CH}` }}>
                <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5 text-right">{CW}×{CH}px · PNG</p>
              <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
                <Save className="h-4 w-4 text-violet-600 flex-shrink-0" />
                <div>
                  <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wide">Valor da tag {`{{Contraste}}`}</p>
                  <p className="text-sm font-mono text-violet-900">{formatContrastStandalone(label, cMin, cMax)}</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
          <button onClick={handleDownload} disabled={!loadedImg}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Baixar PNG
          </button>
          <button onClick={handleSave} disabled={!loadedImg}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}



export function StandaloneAiGenerationPage() {
  // Admin
  const [adminId,   setAdminId]   = useState<string | null>(null)
  const [adminName, setAdminName] = useState('Geração IA')

  // Prompts
  const [prompts,        setPrompts]        = useState<AiPromptLite[]>([])
  const [loadingPrompts, setLoadingPrompts] = useState(true)
  const [promptsError,   setPromptsError]   = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState('')

  // Foto de upload
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoPreview,       setPhotoPreview]       = useState<string | null>(null)
  const [photoBase64,        setPhotoBase64]        = useState<string | null>(null)
  const [photoMime,          setPhotoMime]          = useState<string>('image/jpeg')
  const [photoError,         setPhotoError]         = useState<string | null>(null)

  // Páginas
  const [pages,         setPages]         = useState<CompositionPage[]>([])
  const compositionIdRef = useRef<string>('')

  // Estado de geração
  const [runningBatch,  setRunningBatch]  = useState(false)
  const [generatingId,  setGeneratingId]  = useState<string | null>(null)
  const [globalError,   setGlobalError]   = useState<string | null>(null)

  // PDF
  const [buildingPdf,   setBuildingPdf]   = useState(false)
  const [pdfBlob,       setPdfBlob]       = useState<Blob | null>(null)

  // Informações da análise (AI Info Templates — texto)
  const [aiInfoTemplates, setAiInfoTemplates] = useState<TagTemplate[]>([])
  const [aiInfoValues,    setAiInfoValues]    = useState<Record<string, string>>({})

  // Ferramenta de Contraste standalone
  const [showContrastDialog, setShowContrastDialog] = useState(false)
  const [contrastData,       setContrastData]       = useState<ContrastData | null>(null)
  const [contrastFormatted,  setContrastFormatted]  = useState<string>('')

  const isBusy = runningBatch || !!generatingId || buildingPdf

  // ── Load admin + prompts ──────────────────────────────────────────

  useEffect(() => {
    void loadInit()
  }, [])

  async function loadInit() {
    try {
      const admin = await adminService.getCurrentAdmin()
      if (admin) {
        setAdminId(admin.id)
        setAdminName(admin.nome || 'Geração IA')
        evictStaleStorage(admin.id)   // libera quota de versões antigas antes de qualquer leitura
      }
    } catch {}

    setLoadingPrompts(true)
    setPromptsError(null)
    try {
      const list = await documentsService.listAiImagePrompts({ promptKind: 'composition' })
      setPrompts(list as AiPromptLite[])
    } catch (e: any) {
      setPromptsError(e?.message || 'Erro ao carregar prompts')
    } finally {
      setLoadingPrompts(false)
    }

    // Carrega os AI Info Templates (tipo texto) — exibe apenas Subtom e Subtom Secundário
    const VISIBLE_AI_INFO = ['subtom', 'subtom secundário', 'subtom secundario']
    try {
      const raw = await documentsService.listAiInfoTemplates()
      setAiInfoTemplates(
        raw
          .filter(t =>
            t.type === 'text' &&
            VISIBLE_AI_INFO.includes(t.name.toLowerCase().trim())
          )
          .map(t => ({
            id:      t.id,
            name:    t.name,
            type:    'text' as const,
            options: (t.options || [])
              .map((o: any) => (typeof o === 'string' ? o : (o?.label || '')))
              .filter(Boolean),
          }))
      )
    } catch { /* silencioso — templates são opcionais */ }
  }

  // ── LocalStorage: restauração ─────────────────────────────────────
  //
  // Dispara quando adminId fica disponível. Lê config + workspace
  // do localStorage e repopula o estado.
  //
  // v3: imagens geradas ficam em chaves individuais (img:{pageId}),
  // separadas do workspace. Isso evita estouro de quota (~5 MB) que
  // ocorria ao serializar todas as imagens base64 juntas.
  //
  // `restored` é state (não ref) de propósito: ao virar true ele
  // dispara mais um render, e só DEPOIS desse render os effects
  // de persistência veem os valores restaurados — evitando que
  // eles sobrescrevam o localStorage com os valores iniciais
  // vazios na mesma passada em que o restore acontece.

  const [restored, setRestored] = useState(false)

  useEffect(() => {
    if (!adminId || restored) return

    const keys = standaloneAiStorageKeys(adminId)

    // ─ Config ─
    const rawCfg = safeGetItem(keys.config)
    if (rawCfg) {
      try {
        const cfg = JSON.parse(rawCfg) as PersistedConfig
        if (cfg.selectedPromptId)  setSelectedPromptId(cfg.selectedPromptId)
        if (cfg.photoBase64) {
          const mime = cfg.photoMime || 'image/jpeg'
          setPhotoBase64(cfg.photoBase64)
          setPhotoMime(mime)
          setPhotoPreview(`data:${mime};base64,${cfg.photoBase64}`)
        }
        if (cfg.aiInfoValues)      setAiInfoValues(cfg.aiInfoValues)
        if (cfg.contrastData)      setContrastData(cfg.contrastData)
        if (cfg.contrastFormatted) setContrastFormatted(cfg.contrastFormatted)
      } catch {
        safeRemoveItem(keys.config)
      }
    }

    // ─ Workspace (metadados das páginas, sem imagens geradas) ─
    const rawWs = safeGetItem(keys.workspace)
    console.log('[restore] workspace existe:', !!rawWs, '| chave:', keys.workspace)
    if (rawWs) {
      try {
        const ws = JSON.parse(rawWs) as PersistedWorkspace
        if (ws.compositionId) {
          compositionIdRef.current = ws.compositionId
        }
        if (Array.isArray(ws.pages) && ws.pages.length > 0) {
          console.log('[restore] páginas:', ws.pages.length, '| ids:', ws.pages.map((p: any) => p.id))
          const cfgBase64 = (() => { try { return JSON.parse(safeGetItem(keys.config) || '{}') as PersistedConfig } catch { return null } })()
          const restoredPages: CompositionPage[] = ws.pages.map(p => {
            const photoBase64Restored = cfgBase64?.photoBase64 || (p as any).uploadedPhotoBase64 || ''
            const photoMimeRestored   = cfgBase64?.photoMime   || (p as any).uploadedPhotoMime   || 'image/jpeg'
            const photoPreviewUrl = photoBase64Restored
              ? `data:${photoMimeRestored};base64,${photoBase64Restored}`
              : ''

            let generatedImageBase64: string | undefined
            let generatedImageMime:   string | undefined
            let generatedImageUrl:    string | undefined
            const imgKey = keys.img(p.id)
            const rawImg = safeGetItem(imgKey)
            console.log(`[restore] página ${p.id} status=${p.status} imgKey=${imgKey} found=${!!rawImg}`)
            if (rawImg) {
              try {
                const stored = JSON.parse(rawImg) as { base64: string; mime: string }
                generatedImageBase64 = stored.base64
                generatedImageMime   = stored.mime
                generatedImageUrl    = `data:${stored.mime};base64,${stored.base64}`
                console.log(`[restore] página ${p.id} → imagem OK (${stored.base64.length} chars b64)`)
              } catch {
                console.warn(`[restore] página ${p.id} → img JSON inválido, removendo`)
                safeRemoveItem(imgKey)
              }
            }

            return {
              ...p,
              photoPreviewUrl,
              uploadedPhotoBase64: photoBase64Restored,
              uploadedPhotoMime:   photoMimeRestored,
              generatedImageBase64,
              generatedImageMime,
              generatedImageUrl,
              status: p.status === 'generating'
                ? (generatedImageBase64 ? 'done' : 'pending')
                : p.status,
            } as CompositionPage
          })
          setPages(restoredPages)
        }
      } catch {
        console.warn('[restore] workspace corrompido, removendo')
        safeRemoveItem(keys.workspace)
      }
    }

    setRestored(true)
  }, [adminId, restored])

  // ── LocalStorage: persistência da CONFIG ──────────────────────────
  // Salva sempre que qualquer campo de configuração muda.

  useEffect(() => {
    if (!adminId || !restored) return
    const payload: PersistedConfig = {
      selectedPromptId,
      photoBase64,
      photoMime,
      aiInfoValues,
      contrastData,
      contrastFormatted,
    }
    safeSetItem(
      standaloneAiStorageKeys(adminId).config,
      JSON.stringify(payload),
    )
  }, [
    adminId,
    restored,
    selectedPromptId,
    photoBase64,
    photoMime,
    aiInfoValues,
    contrastData,
    contrastFormatted,
  ])

  // ── LocalStorage: persistência do WORKSPACE ───────────────────────
  // Salva apenas metadados das páginas (sem base64 de imagens geradas).
  // As imagens ficam em chaves individuais (persistidas em patchPage/handleReset).

  useEffect(() => {
    if (!adminId || !restored) return
    const keys = standaloneAiStorageKeys(adminId)
    if (pages.length === 0) {
      console.log('[workspace effect] pages vazio — limpando workspace e imagens')
      safeRemoveItem(keys.workspace)
      clearStoredImages(adminId)
      return
    }
    console.log('[workspace effect] salvando', pages.length, 'páginas | restored=', restored)
    // Serializa páginas sem os campos base64:
    //   - generatedImageBase64/Mime/Url → ficam em chaves individuais (img:{pageId})
    //   - uploadedPhotoBase64/Mime      → já estão na config; duplicar aqui estoura a quota
    //                                     com 3-4 páginas (~400 KB × N páginas)
    //   - photoPreviewUrl               → é um blob:// URL efêmero, inválido após reload;
    //                                     é reconstruído na restauração a partir da config
    const pagesLite = pages.map(({
      generatedImageBase64, generatedImageMime, generatedImageUrl,
      uploadedPhotoBase64, uploadedPhotoMime, photoPreviewUrl,
      ...rest
    }) => rest)
    const payload: PersistedWorkspace = {
      pages: pagesLite as any,
      compositionId: compositionIdRef.current,
    }
    safeSetItem(keys.workspace, JSON.stringify(payload))
  }, [adminId, restored, pages])

  // ── Upload de foto ────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setPhotoError('Selecione uma imagem (JPG, PNG, WebP…).')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setPhotoError('Imagem muito grande. O limite é 15 MB.')
      return
    }
    setPhotoError(null)

    // Preview imediato
    const previewUrl = URL.createObjectURL(file)
    setPhotoPreview(previewUrl)

    try {
      const compressed = await compressImage(file, 1280, 0.88)
      const b64 = await blobToBase64(compressed)
      setPhotoBase64(b64)
      setPhotoMime('image/jpeg')
    } catch (err: any) {
      setPhotoError(err?.message || 'Erro ao processar a foto.')
      setPhotoPreview(null)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleRemovePhoto() {
    setPhotoPreview(null)
    setPhotoBase64(null)
    setPhotoError(null)
  }

  // ── Adicionar páginas ─────────────────────────────────────────────

  function handleAddPages() {
    const prompt = prompts.find(p => p.id === selectedPromptId)
    if (!prompt || !photoBase64 || !photoPreview) return

    // Monta as variáveis de prompt: AI Info templates + Contraste
    const promptVarSources: PromptVarSource[] = [
      ...aiInfoTemplates.map(t => ({
        label: t.name,
        value: aiInfoValues[t.id] || '',
      })),
      { label: 'Contraste', value: contrastFormatted },
    ]

    const newPages: CompositionPage[] = (prompt.parts || []).map((part, idx) => ({
      id:           uid(),
      promptId:     prompt.id,
      promptName:   prompt.name,
      partId:       part.id,
      partLabel:    part.label || `Parte ${idx + 1}`,
      partPrompt:   substitutePromptVars(part.prompt, promptVarSources),
      photoPreviewUrl:     photoPreview,
      uploadedPhotoBase64: photoBase64,
      uploadedPhotoMime:   photoMime,
      status:       'pending',
    }))

    setPages(prev => [...prev, ...newPages])
    setPdfBlob(null)
    setGlobalError(null)
  }

  // ── Helpers de state ──────────────────────────────────────────────

  const patchPage = (id: string, patch: Partial<CompositionPage>) => {
    // Se a atualização inclui uma imagem gerada, persiste imediatamente
    // na chave individual — antes do useEffect de workspace rodar.
    // Garante que mudar de aba DURANTE a geração não perca a imagem.
    if (adminId && patch.generatedImageBase64) {
      const pageIds = pages.map(p => p.id)
      const saved = safeSetItemWithEvict(
        standaloneAiStorageKeys(adminId).img(id),
        JSON.stringify({ base64: patch.generatedImageBase64, mime: patch.generatedImageMime || 'image/png' }),
        adminId,
        pageIds,
      )
      if (!saved) {
        // Quota esgotada mesmo após evict — imagem existe em memória mas não será
        // restaurada após reload. Avisa o usuário para gerar o PDF antes de sair.
        patch = {
          ...patch,
          errorMsg: '⚠️ Imagem gerada mas não salva localmente (armazenamento cheio). Gere o PDF antes de sair desta página.',
        }
      }
    }
    // Se está resetando (↺), remove a imagem salva
    if (adminId && patch.status === 'pending' && patch.generatedImageBase64 === undefined) {
      safeRemoveItem(standaloneAiStorageKeys(adminId).img(id))
    }
    setPages(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
  }

  const getCompositionId = () => {
    if (!compositionIdRef.current) {
      compositionIdRef.current = `standalone_${adminId || 'admin'}_${Date.now()}_${uid()}`
    }
    return compositionIdRef.current
  }

  // ── Geração individual ────────────────────────────────────────────

  const handleGenerateSingle = async (pageId: string) => {
    if (!adminId) return
    if (isBusy) return
    const page = pages.find(p => p.id === pageId)
    if (!page) return

    setGeneratingId(pageId)
    setGlobalError(null)
    setPdfBlob(null)
    patchPage(pageId, { status: 'generating', errorMsg: undefined })

    const compositionId = getCompositionId()
    const index = pages.findIndex(p => p.id === pageId)

    try {
      const res = await (documentsService as any).generateCompositionImage({
        promptId:            page.promptId,
        promptOverride:      page.partPrompt,
        clientId:            adminId,   // standalone: usa o admin como "cliente"
        compositionId,
        index,
        uploadedImageBase64: page.uploadedPhotoBase64,
        uploadedImageMime:   page.uploadedPhotoMime,
      })
      // Modo standalone: a edge function devolve base64 diretamente (sem Drive)
      const imageUrl = res.imageBase64
        ? `data:${res.imageMime || 'image/png'};base64,${res.imageBase64}`
        : res.url
      patchPage(pageId, {
        status:               'done',
        generatedDriveFileId: res.driveFileId,       // presente só no modo galeria
        generatedImageBase64: res.imageBase64,        // presente só no modo standalone
        generatedImageMime:   res.imageMime,
        generatedImageUrl:    imageUrl,
        errorMsg:             undefined,
      })
    } catch (e: any) {
      patchPage(pageId, { status: 'error', errorMsg: e?.message || 'Erro na geração' })
    } finally {
      setGeneratingId(null)
    }
  }

  // ── Batch ─────────────────────────────────────────────────────────

  const handleGenerateBatch = async () => {
    if (!adminId || isBusy) return
    const pending = pages.filter(p => p.status === 'pending' || p.status === 'error')
    if (pending.length === 0) return

    setRunningBatch(true)
    setGlobalError(null)
    setPdfBlob(null)

    const compositionId = getCompositionId()
    let snapshot = [...pages]

    const commit = (mutator: (s: CompositionPage[]) => CompositionPage[]) => {
      snapshot = mutator(snapshot)
      setPages([...snapshot])
    }

    for (const page of pending) {
      const idx = snapshot.findIndex(p => p.id === page.id)
      if (idx < 0) continue

      commit(s => s.map(p =>
        p.id === page.id ? { ...p, status: 'generating', errorMsg: undefined } : p
      ))

      try {
        const res = await (documentsService as any).generateCompositionImage({
          promptId:            page.promptId,
          promptOverride:      page.partPrompt,
          clientId:            adminId,
          compositionId,
          index:               idx,
          uploadedImageBase64: page.uploadedPhotoBase64,
          uploadedImageMime:   page.uploadedPhotoMime,
        })
        const imageUrl = res.imageBase64
          ? `data:${res.imageMime || 'image/png'};base64,${res.imageBase64}`
          : res.url
        // Persiste imagem imediatamente na chave individual (batch bypassa patchPage)
        if (adminId && res.imageBase64) {
          const pageIds = snapshot.map(p => p.id)
          const saved = safeSetItemWithEvict(
            standaloneAiStorageKeys(adminId).img(page.id),
            JSON.stringify({ base64: res.imageBase64, mime: res.imageMime || 'image/png' }),
            adminId,
            pageIds,
          )
          if (!saved) {
            console.warn('[standalone storage] batch: falha ao persistir imagem mesmo após evict — página', page.id)
          }
        }
        commit(s => s.map(p =>
          p.id === page.id
            ? {
                ...p,
                status: 'done',
                generatedDriveFileId: res.driveFileId,
                generatedImageBase64: res.imageBase64,
                generatedImageMime: res.imageMime,
                generatedImageUrl: imageUrl,
                errorMsg: undefined,
              }
            : p
        ))
      } catch (e: any) {
        commit(s => s.map(p =>
          p.id === page.id ? { ...p, status: 'error', errorMsg: e?.message || 'Erro na geração' } : p
        ))
      }
    }

    setRunningBatch(false)
    const erros = snapshot.filter(p => p.status === 'error').length
    if (erros > 0) {
      setGlobalError(`${erros} página${erros !== 1 ? 's' : ''} falharam. Clique em ↺ e tente de novo.`)
    }
  }

  // ── Gerar PDF ─────────────────────────────────────────────────────

  const handleFinalizePdf = async () => {
    const donePages = pages.filter(p => p.status === 'done' && p.generatedImageBase64)
    if (donePages.length === 0) return

    setBuildingPdf(true)
    setGlobalError(null)
    setPdfBlob(null)

    try {
      // Branding do admin logado (capa + contracapa)
      let coverBytes: ArrayBuffer | null = null
      let finalBytes: ArrayBuffer | null = null

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const [{ data: coverRow }, { data: finalRow }] = await Promise.all([
          supabase.from('admin_content').select('content')
            .eq('admin_id', user.id).eq('type', 'ai_composition_cover').maybeSingle(),
          supabase.from('admin_content').select('content')
            .eq('admin_id', user.id).eq('type', 'ai_composition_final').maybeSingle(),
        ])
        try { if ((coverRow?.content as any)?.pdfBase64) coverBytes = base64PdfToArrayBuffer((coverRow!.content as any).pdfBase64) } catch {}
        try { if ((finalRow?.content as any)?.pdfBase64) finalBytes = base64PdfToArrayBuffer((finalRow!.content as any).pdfBase64) } catch {}
      }

      // Modo standalone: imagens já estão em memória como base64 — sem chamada de Drive/Storage
      const images = donePages.map(p => {
        const mime = p.generatedImageMime || 'image/png'
        const b64  = p.generatedImageBase64!
        const binStr = atob(b64)
        const bytes  = new Uint8Array(binStr.length)
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
        return { bytes: bytes.buffer as ArrayBuffer, mime }
      })

      const blob = await generateCompositionPdf(images, { cover: coverBytes, final: finalBytes })
      setPdfBlob(blob)
    } catch (e: any) {
      setGlobalError(e?.message || 'Erro ao montar o PDF')
    } finally {
      setBuildingPdf(false)
    }
  }

  // ── Download PDF ──────────────────────────────────────────────────

  const handleDownloadPdf = () => {
    if (!pdfBlob) return
    const url = URL.createObjectURL(pdfBlob)
    const a   = document.createElement('a')
    a.href = url
    a.download = `Composição IA - ${adminName} - ${new Date().toLocaleDateString('pt-BR')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Mover / remover ───────────────────────────────────────────────

  const handleRemove = (id: string) => {
    if (isBusy) return
    // Remove imagem salva individualmente
    if (adminId) safeRemoveItem(standaloneAiStorageKeys(adminId).img(id))
    setPages(prev => prev.filter(p => p.id !== id))
    setPdfBlob(null)
  }

  const handleMove = (id: string, dir: -1 | 1) => {
    if (isBusy) return
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === id)
      if (idx < 0) return prev
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
    setPdfBlob(null)
  }

  const handleReset = (id: string) => {
    patchPage(id, { status: 'pending', generatedDriveFileId: undefined, generatedImageUrl: undefined, errorMsg: undefined })
    setPdfBlob(null)
  }

  // ── Derived ───────────────────────────────────────────────────────

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId) || null
  const canAdd = !!selectedPrompt && !!photoBase64
  const pendingCount = pages.filter(p => p.status === 'pending' || p.status === 'error').length
  const doneCount    = pages.filter(p => p.status === 'done').length
  const allDone      = pages.length > 0 && pendingCount === 0 && !pages.some(p => p.status === 'generating')

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-10">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-fuchsia-700 flex items-center justify-center shadow-md">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Geração por IA</h1>
          <p className="text-xs text-gray-500">Selecione um prompt, envie uma foto e gere o dossiê em PDF</p>
        </div>
      </div>

      {/* ═══ Painel de configuração: prompt + foto + botão adicionar ═══ */}
      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-fuchsia-500" />
          <h2 className="font-semibold text-gray-900 text-sm">Nova composição</h2>
        </div>

        <div className="p-5 space-y-5">

          {/* ─ Prompt ─ */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Prompt <span className="text-rose-500">*</span>
            </label>
            {loadingPrompts ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 px-3 py-2.5 border border-gray-200 rounded-lg">
                <div className="animate-spin h-3 w-3 border-2 border-gray-300 border-t-fuchsia-400 rounded-full" />
                Carregando prompts…
              </div>
            ) : promptsError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{promptsError}</p>
              </div>
            ) : prompts.length === 0 ? (
              <p className="text-xs italic text-gray-500 px-3 py-2.5 border border-dashed border-gray-300 rounded-lg">
                Nenhum prompt ativo. Crie em <strong>Documents → Prompts IA</strong>.
              </p>
            ) : (
              <select
                value={selectedPromptId}
                onChange={e => setSelectedPromptId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
              >
                <option value="">— Escolha um prompt —</option>
                {prompts.map(p => {
                  const cnt = Array.isArray(p.parts) ? p.parts.length : 0
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  )
                })}
              </select>
            )}

            {/* Preview das partes */}
            {selectedPrompt && Array.isArray(selectedPrompt.parts) && selectedPrompt.parts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedPrompt.parts.map((part, i) => (
                  <span key={part.id} className="inline-flex items-center gap-1 text-[11px] font-medium text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-100 rounded-full px-2.5 py-0.5">
                    {part.label || `Parte ${i + 1}`}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ─ Foto ─ */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Foto base <span className="text-rose-500">*</span>
            </label>

            <div className="flex items-start gap-4">
              {/* Thumbnail */}
              <div className="flex-shrink-0">
                {photoPreview ? (
                  <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-fuchsia-200 shadow-sm">
                    <img src={photoPreview} alt="Foto base" className="w-full h-full object-cover" />
                    <button
                      onClick={handleRemovePhoto}
                      disabled={isBusy}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center gap-1">
                    <Camera className="h-6 w-6 text-gray-400" />
                    <span className="text-[10px] text-gray-400">Sem foto</span>
                  </div>
                )}
              </div>

              {/* Ações */}
              <div className="flex-1">
                {photoError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
                    {photoError}
                  </p>
                )}
                {!photoBase64 && !photoError && (
                  <p className="text-xs text-gray-500 mb-2 leading-relaxed">
                    Envie uma foto frontal com boa iluminação — será usada como base em todas as partes do prompt.
                  </p>
                )}
                {photoBase64 && (
                  <p className="text-xs text-emerald-600 font-medium mb-2">
                    ✓ Foto pronta para geração
                  </p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {photoPreview ? <><RefreshCw className="h-3.5 w-3.5" /> Trocar foto</> : <><ImagePlus className="h-3.5 w-3.5" /> Selecionar foto</>}
                </button>
              </div>
            </div>
          </div>

          {/* ─ Informações da análise ─ */}
          {aiInfoTemplates.length > 0 && (
            <div className="bg-violet-50/70 border border-violet-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Tag className="h-3.5 w-3.5 text-violet-600" />
                <p className="text-xs font-semibold text-violet-800">Informações da análise</p>
                <span className="ml-auto text-[10px] text-violet-500">
                  {Object.values(aiInfoValues).filter(Boolean).length}/{aiInfoTemplates.length} preenchidas
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {aiInfoTemplates.map(t => (
                  <div key={t.id}>
                    <label className="block text-[11px] font-semibold text-violet-700 mb-1">{t.name}</label>
                    <select
                      value={aiInfoValues[t.id] || ''}
                      onChange={e => setAiInfoValues(prev => ({ ...prev, [t.id]: e.target.value }))}
                      className="w-full px-3 py-2 border border-violet-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/40 text-gray-700"
                    >
                      <option value="">— Selecione —</option>
                      {t.options.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─ Ferramenta de Contraste ─ */}
          <div className={`border rounded-xl p-4 transition-colors ${contrastFormatted ? 'border-violet-200 bg-violet-50/40' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5 text-violet-600" />
                <p className="text-xs font-semibold text-gray-700">Ferramenta de Contraste</p>
              </div>
              <Btn
                variant="outline"
                size="sm"
                onClick={() => setShowContrastDialog(true)}
                disabled={!photoPreview || isBusy}
              >
                {contrastFormatted
                  ? <><RefreshCw className="h-3.5 w-3.5" /> Reajustar</>
                  : <><SlidersHorizontal className="h-3.5 w-3.5" /> Abrir ferramenta</>}
              </Btn>
            </div>

            {!photoPreview && (
              <p className="text-[11px] text-gray-400 mt-2">
                Envie uma foto primeiro para usar esta ferramenta.
              </p>
            )}

            {contrastFormatted ? (
              <div className="mt-3 flex items-center gap-2 bg-white border border-violet-100 rounded-lg px-3 py-2.5">
                <Check className="h-3.5 w-3.5 text-violet-600 flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wide">{`{{Contraste}}`}</p>
                  <p className="text-xs font-mono text-gray-800">{contrastFormatted}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setContrastData(null); setContrastFormatted('') }}
                  disabled={isBusy}
                  className="ml-auto p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Limpar contraste"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : photoPreview ? (
              <p className="text-[11px] text-gray-400 mt-2">
                Nenhum contraste definido — a variável{' '}
                <code className="text-violet-700 bg-violet-50 px-1 rounded">{`{{Contraste}}`}</code>{' '}
                ficará vazia no prompt.
              </p>
            ) : null}
          </div>

          {/* ─ Banner confirmação ─ */}
          {canAdd && (
            <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-fuchsia-500 flex-shrink-0" />
              <p className="text-sm text-fuchsia-800">
                <strong>{selectedPrompt!.parts.length} página{selectedPrompt!.parts.length !== 1 ? 's' : ''}</strong> serão adicionadas a fila de geração.
              </p>
            </div>
          )}

          {/* ─ Botão adicionar ─ */}
          <div className="flex justify-end">
            <Btn
              variant="primary"
              onClick={handleAddPages}
              disabled={!canAdd || isBusy}
            >
              <Plus className="h-4 w-4" />
              Adicionar páginas
            </Btn>
          </div>
        </div>
      </section>

      {/* ═══ Lista de páginas ═══ */}
      {pages.length > 0 && (        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Cabeçalho */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-fuchsia-500" />
                Páginas da composição
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {doneCount}/{pages.length} geradas
                {pendingCount > 0 && ` · ${pendingCount} pendente${pendingCount !== 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {pendingCount > 0 && (
                <Btn
                  variant="primary"
                  size="sm"
                  onClick={handleGenerateBatch}
                  loading={runningBatch}
                  disabled={isBusy}
                >
                  <Play className="h-3.5 w-3.5" />
                  Gerar pendentes ({pendingCount})
                </Btn>
              )}

              {doneCount > 0 && (
                <Btn
                  variant="success"
                  size="sm"
                  onClick={handleFinalizePdf}
                  loading={buildingPdf}
                  disabled={isBusy}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Finalizar e gerar PDF
                </Btn>
              )}
            </div>
          </div>

          {/* Error global */}
          {globalError && (
            <div className="mx-5 mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{globalError}</p>
            </div>
          )}

          {/* PDF pronto */}
          {pdfBlob && (
            <div className="mx-5 mt-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                <p className="text-sm text-emerald-800 font-medium">
                  PDF pronto — {(pdfBlob.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <Btn variant="success" size="sm" onClick={handleDownloadPdf}>
                <Download className="h-3.5 w-3.5" /> Baixar PDF
              </Btn>
            </div>
          )}

          {/* Lista */}
          <ul className="divide-y divide-gray-100 mx-5 my-4 border border-gray-200 rounded-xl overflow-hidden">
            {pages.map((page, index) => (
              <PageCard
                key={page.id}
                page={page}
                index={index}
                total={pages.length}
                isBusy={isBusy}
                isThisGenerating={generatingId === page.id}
                onGenerate={() => handleGenerateSingle(page.id)}
                onReset={() => handleReset(page.id)}
                onRemove={() => handleRemove(page.id)}
                onMoveUp={() => handleMove(page.id, -1)}
                onMoveDown={() => handleMove(page.id, 1)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ═══ Ferramenta de Contraste (dialog) ═══ */}
      {showContrastDialog && photoPreview && (
        <StandaloneContrastDialog
          photoUrl={photoPreview}
          initial={contrastData}
          onClose={() => setShowContrastDialog(false)}
          onSave={(data, formatted) => {
            setContrastData(data)
            setContrastFormatted(formatted)
          }}
        />
      )}
    </div>
  )
}

// ─── PageCard ─────────────────────────────────────────────────────────

const statusBadge: Record<PageStatus, React.ReactNode> = {
  pending:    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Pendente</span>,
  generating: <span className="text-[10px] font-medium text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 rounded-full px-2 py-0.5 flex items-center gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" />Gerando</span>,
  done:       <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Pronta</span>,
  error:      <span className="text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Erro</span>,
}

function PageCard({
  page, index, total, isBusy, isThisGenerating,
  onGenerate, onReset, onRemove, onMoveUp, onMoveDown,
}: {
  page: CompositionPage
  index: number
  total: number
  isBusy: boolean
  isThisGenerating: boolean
  onGenerate: () => void
  onReset: () => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [showPreview, setShowPreview] = useState(false)
  const [zoom, setZoom]               = useState(1)
  const [pan, setPan]                 = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging]   = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dragStart  = useRef({ mx: 0, my: 0, px: 0, py: 0 })

  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  const startDrag = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    setIsDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
    const stop = (ev: MouseEvent) => {
      setIsDragging(false)
      const dx = ev.clientX - dragStart.current.mx
      const dy = ev.clientY - dragStart.current.my
      setPan({ x: dragStart.current.px + dx, y: dragStart.current.py + dy })
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
    const move = (ev: MouseEvent) => {
      setPan({ x: dragStart.current.px + ev.clientX - dragStart.current.mx, y: dragStart.current.py + ev.clientY - dragStart.current.my })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  const borderColor =
    page.status === 'done'      ? 'border-emerald-200' :
    page.status === 'error'     ? 'border-red-200' :
    page.status === 'generating'? 'border-fuchsia-200' :
    'border-gray-200'

  const thumbSrc = page.status === 'done' && page.generatedImageUrl
    ? page.generatedImageUrl
    : page.photoPreviewUrl

  return (
    <>
      <li className={`border-b last:border-b-0 transition-colors ${borderColor}`}>
        <div className="p-3 flex items-center gap-3">
          {/* Número */}
          <div className="w-7 h-7 rounded-lg bg-gray-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
            {index + 1}
          </div>

          {/* Thumbnail */}
          <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 group">
            <img src={thumbSrc} alt={page.partLabel} loading="lazy" className="w-full h-full object-cover" />
            {page.status === 'done' && page.generatedImageUrl && (
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors"
              >
                <Eye className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
              </button>
            )}
            {isThisGenerating && (
              <div className="absolute inset-0 bg-fuchsia-900/50 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-white animate-spin" />
              </div>
            )}
          </div>

          {/* Texto */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-gray-900 truncate">
                {page.promptName}
                <span className="text-gray-400 font-normal"> · </span>
                <span className="text-fuchsia-700">{page.partLabel}</span>
              </p>
              {statusBadge[page.status]}
            </div>
            {page.status === 'error' && page.errorMsg && (
              <p className="text-xs text-red-600 mt-0.5 break-words line-clamp-2">{page.errorMsg}</p>
            )}
          </div>

          {/* Ações */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {page.status === 'done' && page.generatedDriveFileId && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const blob = await driveStorage.fetchPhotoBlob(page.generatedDriveFileId!)
                    const objUrl = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = objUrl; a.download = `${page.promptName} - ${page.partLabel}.png`; a.click()
                    URL.revokeObjectURL(objUrl)
                  } catch (err: any) { alert('Falha ao baixar: ' + (err?.message || err)) }
                }}
                title="Baixar imagem"
                className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            {(page.status === 'pending' || page.status === 'error') && (
              <button type="button" onClick={onGenerate} disabled={isBusy} title="Gerar"
                className="p-2 rounded-lg text-fuchsia-600 hover:bg-fuchsia-50 disabled:opacity-30 transition-colors">
                {isThisGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              </button>
            )}
            {(page.status === 'error' || page.status === 'done') && (
              <button type="button" onClick={onReset} disabled={isBusy} title="Resetar"
                className="p-2 rounded-lg text-amber-600 hover:bg-amber-50 disabled:opacity-30 transition-colors">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" onClick={onMoveUp} disabled={isBusy || index === 0} title="Mover para cima"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onMoveDown} disabled={isBusy || index === total - 1} title="Mover para baixo"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors">
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onRemove} disabled={isBusy} title="Remover"
              className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </li>

      {/* Preview modal */}
      {showPreview && page.generatedImageUrl && (
        <div
          className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4"
          onClick={() => { setShowPreview(false); resetZoom() }}
        >
          <div className="relative flex flex-col items-center max-w-full" onClick={e => e.stopPropagation()}>
            <div
              ref={wrapperRef}
              className="relative w-fit overflow-hidden rounded-2xl shadow-2xl bg-black"
              onMouseDown={startDrag}
              onDoubleClick={resetZoom}
              onWheel={e => {
                e.preventDefault()
                setZoom(z => Math.max(0.5, Math.min(5, z - e.deltaY * 0.001)))
              }}
            >
              <img
                src={page.generatedImageUrl}
                alt={`${page.promptName} · ${page.partLabel}`}
                draggable={false}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
                }}
                className="block w-auto h-auto max-w-[min(90vw,720px)] max-h-[82vh] select-none"
              />
            </div>
            <button
              onClick={() => { setShowPreview(false); resetZoom() }}
              className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="mt-3 text-center text-sm text-white/70 max-w-[min(90vw,720px)] truncate">
              {page.promptName} · {page.partLabel}
              {zoom > 1
                ? <span className="ml-2 text-white/40">· {Math.round(zoom * 100)}% · duplo clique pra resetar</span>
                : <span className="ml-2 text-white/40">· scroll pra zoom</span>}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function compressImage(file: File, maxSize = 1280, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objUrl)
      let { width: w, height: h } = img
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize }
        else       { w = Math.round(w * maxSize / h); h = maxSize }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Falha ao comprimir')),
        'image/jpeg', quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Falha ao carregar imagem')) }
    img.src = objUrl
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}