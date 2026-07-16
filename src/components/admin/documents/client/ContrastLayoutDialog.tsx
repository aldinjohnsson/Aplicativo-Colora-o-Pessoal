// src/components/admin/documents/client/ContrastLayoutDialog.tsx
//
// Ferramenta de Contraste — modal usado a partir da aba Resultado do
// ClientsManager. Não persiste sozinha; devolve o estado completo + o
// valor formatado ("Alto (8 a 10)") pro caller via `onSave`.
//
// O caller (ClientsManager) é responsável por gravar o estado em
// `clients.contrast_layout`. O valor formatado é exposto automaticamente
// como variável built-in {{Contraste}} pelo documentsService.getTextImportSources
// — não precisa cadastrar tag em TagsManager.

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react'
import {
  X, Download, ChevronLeft, Loader2,
  Image as ImageIcon, Check, AlertCircle, Save, FolderOpen,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { formatContrastValue, type ContrastLayoutData } from '../lib/contrastLayout'
import { driveStorage } from '../../../../lib/driveStorage'

// Re-export pra não quebrar imports antigos (ex: ClientsManager.tsx).
export { formatContrastValue }
export type { ContrastLayoutData }

// ── Canvas constants ───────────────────────────────────────────────────

const W = 1340
const H = 950

// ── Types ──────────────────────────────────────────────────────────────

interface ClientPhoto { id: string; url: string; thumb?: string; driveFileId?: string | null; categoryId?: string | null; categoryTitle?: string | null }
interface PhotoCategory { id: string | null; title: string; count: number }

interface Props {
  clientId:   string
  clientName: string
  /** Estado anterior (modo editar). Null/undefined = abre limpo. */
  initial?:   ContrastLayoutData | null
  onClose:    () => void
  /** Recebe o estado novo + a string formatada ("Alto (8 a 10)"). */
  onSave:     (data: ContrastLayoutData, formatted: string) => Promise<void>
  /** Opcional: envia o PNG gerado direto pra aba Resultado (client_result_files). */
  onSaveToResults?: (file: File) => Promise<void>
}

const LABEL_OPTIONS = ['baixo', 'médio baixo', 'médio', 'médio alto', 'alto'] as const

/** "médio alto" → "Médio Alto" — usado só no <select> de label (UI). */
function titleCase(s: string): string {
  return s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ')
}

// ── Canvas helpers ─────────────────────────────────────────────────────

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r); ctx.closePath()
}
function fillRR(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); ctx.fill()
}
function strokeRR(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); ctx.stroke()
}

// ── Draw layout ────────────────────────────────────────────────────────
//
// Distribuição vertical do canvas (W=1340, H=950):
//   28              borda superior do retângulo decorativo
//   75              título
//   93              linha horizontal
//   97  → 122       bracket "X a Y" → topo do bracket (bY=scaleY-28)
//   150             topo da escala (scaleY)
//   178             fundo da escala (scaleY+28)
//   198             números 1–10 (scaleY+48)
//   217             topo das fotos (photoY = scaleY+67)
//   852             fundo das fotos (192 + 660)
//   884             label "Preto e branco / Colorida"
//   922             borda inferior do retângulo decorativo
//
// Fotos: 530 × 660 (antes: 450 × 560 — ganho de ~38% em área)
// Gap entre fotos: 50 (antes 60)

function drawLayout(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  opts: { cMin: number; cMax: number; zoom: number; yOff: number; label: string },
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = W; canvas.height = H

  const { cMin, cMax, zoom: zoomPct, yOff, label } = opts
  const scale = zoomPct / 100

  ctx.fillStyle = '#F7F5F0'; ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`
    ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1)
  }

  ctx.strokeStyle = '#D4D0C8'; ctx.lineWidth = 1; strokeRR(ctx, 40, 28, W - 80, H - 56, 4)

  // Título — puxado pra cima (era y=90)
  const title = `Sua escala de profundidade resulta em um contraste ${label} (${cMin} a ${cMax}).`
  ctx.fillStyle = '#1A1A1A'
  ctx.font = `400 ${title.length > 60 ? 28 : 30}px Georgia, serif`
  ctx.textAlign = 'center'; ctx.fillText(title, W / 2, 75)

  // Linha horizontal (era y=108)
  ctx.strokeStyle = '#DAD7CF'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(120, 93); ctx.lineTo(W - 120, 93); ctx.stroke()

  // Escala de profundidade — scaleY=150 para dar espaço ao bracket acima
  // Gradiente: 1 (esquerda) = mais claro → 10 (direita) = mais escuro
  const sx = 180, sw = W - 360, segW = sw / 10, scaleY = 150
  const bx1 = sx + (cMin - 1) * segW, bx2 = sx + cMax * segW, bY = scaleY - 28

  ctx.strokeStyle = '#2A2A2A'; ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bx1, bY); ctx.lineTo(bx2, bY)
  ctx.moveTo(bx1, bY); ctx.lineTo(bx1, bY + 14)
  ctx.moveTo(bx2, bY); ctx.lineTo(bx2, bY + 14)
  ctx.stroke()
  ctx.fillStyle = '#555'; ctx.font = '400 22px Helvetica,Arial,sans-serif'
  ctx.textAlign = 'center'; ctx.fillText(`${cMin} a ${cMax}`, (bx1 + bx2) / 2, bY - 8)

  const grad = ctx.createLinearGradient(sx, 0, sx + sw, 0)
  grad.addColorStop(0, '#F0F0F0'); grad.addColorStop(1, '#0A0A0A')
  ctx.fillStyle = grad; fillRR(ctx, sx, scaleY, sw, 28, 2)
  ctx.strokeStyle = '#BBBBBB'; ctx.lineWidth = 1; strokeRR(ctx, sx, scaleY, sw, 28, 2)

  ctx.lineWidth = 1
  for (let i = 1; i < 10; i++) {
    const tx = sx + i * segW
    ctx.strokeStyle = i >= 5 ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.15)'
    ctx.beginPath(); ctx.moveTo(tx, scaleY); ctx.lineTo(tx, scaleY + 28); ctx.stroke()
  }
  ctx.font = '400 20px Helvetica,Arial,sans-serif'
  for (let i = 1; i <= 10; i++) {
    ctx.fillStyle = (i < cMin || i > cMax) ? '#AAAAAA' : '#444444'
    ctx.textAlign = 'center'; ctx.fillText(String(i), sx + (i - 0.5) * segW, scaleY + 48)
  }

  // ── Fotos: 530×660 com gap=50 ──────────────────────────────────────
  // (antes: 450×560 com gap=60 → mudou pra preencher melhor o espaço)
  const photoY = scaleY + 67   // 192 (antes scaleY+72=230)
  const photoW = 530           // antes 450
  const photoH = 660           // antes 560
  const gap = 50               // antes 60
  const startX = (W - (photoW * 2 + gap)) / 2  // 115
  const lx = startX, rx = startX + photoW + gap

  function drawPhoto(px: number, py: number, pw: number, ph: number, bw: boolean) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4
    ctx.fillStyle = '#fff'; fillRR(ctx, px, py, pw, ph, 4)
    ctx.restore()
    ctx.fillStyle = '#fff'; fillRR(ctx, px, py, pw, ph, 4)
    ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 1; strokeRR(ctx, px, py, pw, ph, 4)

    const pad = 8, ix = px + pad, iy = py + pad, iw = pw - pad * 2, ih = ph - pad * 2
    ctx.save(); ctx.beginPath(); roundRectPath(ctx, ix, iy, iw, ih, 2); ctx.clip()

    const imgAsp = img.naturalWidth / img.naturalHeight, frameAsp = iw / ih
    let drawW: number, drawH: number
    if (imgAsp > frameAsp) { drawH = ih * scale; drawW = drawH * imgAsp }
    else { drawW = iw * scale; drawH = drawW / imgAsp }
    const dx = ix + (iw - drawW) / 2, dy = iy + (ih - drawH) / 2 + yOff * 4

    if (bw) {
      const oc = document.createElement('canvas')
      oc.width = Math.round(drawW); oc.height = Math.round(drawH)
      const oc2 = oc.getContext('2d')!
      oc2.drawImage(img, 0, 0, oc.width, oc.height)
      const id = oc2.getImageData(0, 0, oc.width, oc.height), d = id.data
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
        d[i] = d[i + 1] = d[i + 2] = g
      }
      oc2.putImageData(id, 0, 0); ctx.drawImage(oc, dx, dy, drawW, drawH)
    } else {
      ctx.drawImage(img, dx, dy, drawW, drawH)
    }
    ctx.restore()
  }

  // Colorida à esquerda, preto e branco à direita.
  drawPhoto(lx, photoY, photoW, photoH, false)
  drawPhoto(rx, photoY, photoW, photoH, true)

  // Labels — fonte um pouco maior (24 vs 22) pra equilibrar com fotos maiores
  ctx.fillStyle = '#777'; ctx.font = '400 24px Helvetica,Arial,sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('Colorida',       lx + photoW / 2, photoY + photoH + 32)
  ctx.fillText('Preto e branco', rx + photoW / 2, photoY + photoH + 32)
}

// ── Btn ────────────────────────────────────────────────────────────────

const Btn = ({ children, onClick, variant = 'primary', size = 'md', loading = false, disabled = false, className = '' }: any) => {
  const v: any = { primary: 'bg-rose-500 text-white hover:bg-rose-600', outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50' }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}>
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ── Component ──────────────────────────────────────────────────────────

export function ContrastLayoutDialog({
  clientId, clientName, initial = null, onClose, onSave, onSaveToResults,
}: Props) {
  const [step, setStep]                 = useState<'category' | 'pick' | 'edit'>(initial?.photoId ? 'edit' : 'category')
  const [photos, setPhotos]             = useState<ClientPhoto[]>([])
  const [categories, setCategories]     = useState<PhotoCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null | undefined>(undefined) // undefined = não escolhida ainda
  const [blobUrls, setBlobUrls]         = useState<Record<string, string>>({})
  const [photoLoading, setPhotoLoading] = useState(true)
  const [blobLoading, setBlobLoading]   = useState(false)
  const [photoError, setPhotoError]     = useState<string | null>(null)
  const [loadedImg, setLoadedImg]       = useState<HTMLImageElement | null>(null)
  const [loadingImg, setLoadingImg]     = useState(false)
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(initial?.photoId ?? null)

  const [cMin, setCMin]   = useState(initial?.cMin   ?? 2)
  const [cMax, setCMax]   = useState(initial?.cMax   ?? 9)
  const [zoom, setZoom]   = useState(initial?.zoom   ?? 108)
  const [yOff, setYOff]   = useState(initial?.yOff   ?? 0)
  const [label, setLabel] = useState(initial?.label  ?? 'médio alto')

  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)
  const [saved, setSaved]           = useState(false)

  const [savingToResults, setSavingToResults] = useState(false)
  const [resultsError, setResultsError]       = useState<string | null>(null)
  const [savedToResults, setSavedToResults]   = useState(false)

  // Ref para o objectURL da foto — evita taint de canvas por CORS
  const objectUrlRef = useRef<string | null>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)

  // Revoga objectURL ao desmontar
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  // ── Carrega metadados das fotos (sem blobs) ──────────────────────

  useEffect(() => {
    let cancelled = false
    setPhotoLoading(true)
    documentsService.listClientPhotos(clientId)
      .then(list => {
        if (cancelled) return
        const mapped: ClientPhoto[] = list.map(p => ({
          id: p.id,
          url: p.url,
          driveFileId: (p as any).drive_file_id ?? null,
          categoryId: (p as any).category_id ?? null,
          categoryTitle: (p as any).category_title ?? null,
        }))
        setPhotos(mapped)

        // Monta lista de categorias com contagem
        const catMap: Record<string, PhotoCategory> = {}
        for (const p of mapped) {
          const key = p.categoryId ?? '__none__'
          if (!catMap[key]) {
            catMap[key] = {
              id: p.categoryId ?? null,
              title: p.categoryTitle ?? 'Sem categoria',
              count: 0,
            }
          }
          catMap[key].count++
        }
        setCategories(Object.values(catMap).sort((a, b) => {
          if (a.id === null) return 1   // "Sem categoria" vai pro final
          if (b.id === null) return -1
          return a.title.localeCompare(b.title)
        }))
      })
      .catch(e => { if (!cancelled) setPhotoError(e?.message || 'Erro ao carregar fotos') })
      .finally(() => { if (!cancelled) setPhotoLoading(false) })
    return () => { cancelled = true }
  }, [clientId])

  // ── Quando categoria é selecionada, carrega blobs apenas das fotos dela ──

  useEffect(() => {
    if (selectedCategory === undefined) return   // ainda não escolheu
    let cancelled = false
    const subset = photos.filter(p =>
      selectedCategory === '__none__'
        ? p.categoryId === null
        : p.categoryId === selectedCategory
    )
    const driveSubset = subset.filter(p => p.driveFileId)
    if (driveSubset.length === 0) return

    setBlobLoading(true)
    Promise.allSettled(
      driveSubset.map(async p => {
        const blob = await driveStorage.fetchPhotoBlob(p.driveFileId!)
        return { id: p.id, blobUrl: URL.createObjectURL(blob) }
      })
    ).then(entries => {
      if (cancelled) return
      const map: Record<string, string> = {}
      for (const r of entries) {
        if (r.status === 'fulfilled') map[r.value.id] = r.value.blobUrl
      }
      setBlobUrls(prev => ({ ...prev, ...map }))
    }).finally(() => { if (!cancelled) setBlobLoading(false) })
    return () => { cancelled = true }
  }, [selectedCategory, photos])

  // Se abriu em modo edit (initial.photoId presente), tenta carregar a
  // foto automaticamente assim que a lista de fotos chega.
  useEffect(() => {
    if (step !== 'edit' || loadedImg || loadingImg) return
    if (!selectedPhotoId || photos.length === 0) return
    const photo = photos.find(p => p.id === selectedPhotoId)
    if (photo) {
      void selectPhoto(photo.url, photo.id, photo.driveFileId)
    } else {
      setSelectedPhotoId(null)
      setStep('category')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, step])

  // ── Redesenha ao mudar controles ─────────────────────────────────

  const redraw = useCallback(() => {
    if (!canvasRef.current || !loadedImg) return
    drawLayout(canvasRef.current, loadedImg, { cMin, cMax, zoom, yOff, label })
  }, [loadedImg, cMin, cMax, zoom, yOff, label])

  useEffect(() => { redraw() }, [redraw])

  // ── Esc fecha ────────────────────────────────────────────────────

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ── Seleciona foto ───────────────────────────────────────────────
  //
  // Fotos do Drive: baixa via proxy do Edge Function (/drive/photo-proxy)
  // pra evitar bloqueio CORS. O blob: URL mantém o canvas sem "taint".
  // Fotos legadas (Storage): fetch direto ainda funciona (URL pública).

  const selectPhoto = async (url: string, photoId: string, driveFileId?: string | null) => {
    setLoadingImg(true)
    setPhotoError(null)
    try {
      let blob: Blob

      if (driveFileId) {
        // Foto do Drive: proxy via Edge Function (/drive/photo-proxy)
        blob = await driveStorage.fetchPhotoBlob(driveFileId)
      } else {
        // Foto legada (Supabase Storage): URL pública, sem CORS
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        blob = await res.blob()
      }

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const objectUrl = URL.createObjectURL(blob)
      objectUrlRef.current = objectUrl

      const i = new Image()
      i.onload  = () => { setLoadedImg(i); setLoadingImg(false); setSelectedPhotoId(photoId); setStep('edit') }
      i.onerror = () => { setLoadingImg(false); setPhotoError('Não foi possível carregar a foto.') }
      i.src = objectUrl
    } catch (e: any) {
      setLoadingImg(false)
      setPhotoError(e?.message || 'Erro ao baixar a foto.')
    }
  }

  // ── Download PNG ─────────────────────────────────────────────────

  const handleDownload = () => {
    if (!canvasRef.current) return
    const a = document.createElement('a')
    a.download = `layout-contraste-${clientName.toLowerCase().replace(/\s+/g, '-')}.png`
    a.href = canvasRef.current.toDataURL('image/png')
    a.click()
  }

  // ── Salvar em Resultados (client_result_files) ────────────────────
  //
  // Gera o PNG do canvas e manda pro caller (que faz upload via
  // adminService.uploadResultFile) — o arquivo aparece direto na aba
  // Resultado, junto das outras fotos.

  const handleSaveToResults = async () => {
    if (!canvasRef.current || !onSaveToResults) return
    setSavingToResults(true)
    setResultsError(null)
    try {
      const blob: Blob = await new Promise((resolve, reject) => {
        canvasRef.current!.toBlob(
          b => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))),
          'image/png',
        )
      })
      const file = new File(
        [blob],
        `layout-contraste-${clientName.toLowerCase().replace(/\s+/g, '-')}.png`,
        { type: 'image/png' },
      )
      await onSaveToResults(file)
      setSavedToResults(true)
      setTimeout(() => setSavedToResults(false), 2500)
    } catch (e: any) {
      setResultsError(e?.message || 'Erro ao salvar em Resultados.')
    } finally {
      setSavingToResults(false)
    }
  }

  // ── Salvar (devolve ao caller) ───────────────────────────────────

  const handleSave = async () => {
    if (!selectedPhotoId) {
      setSaveError('Selecione uma foto primeiro.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const data: ContrastLayoutData = {
        photoId: selectedPhotoId,
        cMin, cMax, zoom, yOff, label,
        savedAt: new Date().toISOString(),
      }
      const formatted = formatContrastValue(label, cMin, cMax)
      await onSave(data, formatted)
      setSaved(true)
      // fecha sozinho após 600ms — UX igual ao banner de save do GeminiChat
      setTimeout(onClose, 600)
    } catch (e: any) {
      setSaveError(e?.message || 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  // ── Step: category ───────────────────────────────────────────────

  const handleSelectCategory = (catId: string | null) => {
    setSelectedCategory(catId ?? '__none__')
    setStep('pick')
  }

  const renderCategory = () => (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {photoLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 text-rose-400 animate-spin" />
        </div>
      ) : photoError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{photoError}</p>
        </div>
      ) : categories.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <ImageIcon className="h-6 w-6 text-gray-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700">Nenhuma foto encontrada</p>
          <p className="text-xs text-gray-500 mt-1">Adicione fotos ao perfil da cliente primeiro.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">De qual categoria você quer escolher a foto?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {categories.map(cat => (
              <button
                key={cat.id ?? '__none__'}
                onClick={() => handleSelectCategory(cat.id)}
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white hover:border-rose-300 hover:bg-rose-50/40 transition-colors text-left group"
              >
                <div className="h-9 w-9 rounded-lg bg-rose-50 text-rose-400 flex items-center justify-center flex-shrink-0 group-hover:bg-rose-100">
                  <FolderOpen className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate group-hover:text-rose-700">
                    {cat.title}
                  </p>
                  <p className="text-xs text-gray-400">
                    {cat.count} foto{cat.count !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-gray-300 group-hover:text-rose-400 text-lg leading-none">→</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  // ── Step: pick ───────────────────────────────────────────────────

  const renderPick = () => {
    const visiblePhotos = selectedCategory === undefined
      ? photos
      : photos.filter(p =>
          selectedCategory === '__none__'
            ? p.categoryId === null
            : p.categoryId === selectedCategory
        )

    return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {blobLoading && (
        <div className="flex items-center gap-2 mb-3 text-sm text-rose-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando fotos...
        </div>
      )}
      {loadingImg && (
        <div className="flex items-center gap-2 mb-3 text-sm text-rose-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Baixando foto...
        </div>
      )}
      {photoError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 mb-3">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{photoError}</p>
        </div>
      )}
      {visiblePhotos.length === 0 && !blobLoading ? (
        <div className="border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <ImageIcon className="h-6 w-6 text-gray-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700">Nenhuma foto nesta categoria</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500">Clique em uma foto para usá-la no layout.</p>
            <button
              onClick={() => setStep('category')}
              className="text-xs text-gray-400 hover:text-rose-600 flex items-center gap-1"
            >
              <ChevronLeft className="h-3 w-3" /> Categorias
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {visiblePhotos.map(p => (
              <button key={p.id} onClick={() => selectPhoto(p.url, p.id, p.driveFileId)} disabled={loadingImg}
                className="aspect-square rounded-xl overflow-hidden border-2 border-transparent hover:border-rose-400 transition-colors relative group disabled:opacity-50">
                <img src={blobUrls[p.id] || p.thumb || p.url} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
    )
  }

  // ── Step: edit ───────────────────────────────────────────────────

  const renderEdit = () => (
    <>
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-4 items-end bg-gray-50">
        {/* Faixa de contraste */}
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

        {/* Tipo */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tipo de contraste</label>
          <select value={label} onChange={e => setLabel(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400">
            {LABEL_OPTIONS.map(v => (
              <option key={v} value={v}>{titleCase(v)}</option>
            ))}
          </select>
        </div>

        {/* Zoom */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            Zoom <span className="font-normal text-gray-400">{zoom}%</span>
          </label>
          <input type="range" min={80} max={160} step={1} value={zoom}
            onChange={e => setZoom(Number(e.target.value))} className="w-28 accent-rose-500" />
        </div>

        {/* Posição */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            Posição <span className="font-normal text-gray-400">{yOff > 0 ? `+${yOff}` : yOff}</span>
          </label>
          <input type="range" min={-50} max={50} step={1} value={yOff}
            onChange={e => setYOff(Number(e.target.value))} className="w-28 accent-rose-500" />
        </div>

        <button onClick={() => setStep('category')}
          className="ml-auto text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1 underline">
          <ChevronLeft className="h-3 w-3" /> Trocar foto
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="rounded-xl overflow-hidden border border-gray-200 bg-[#F7F5F0]"
          style={{ aspectRatio: `${W}/${H}` }}>
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5 text-right">{W}×{H}px · PNG</p>

        {/* Preview do valor que será gravado na tag "Contraste" */}
        <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Save className="h-4 w-4 text-violet-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wide">Valor da tag "Contraste"</p>
            <p className="text-sm font-mono text-violet-900 break-words">{formatContrastValue(label, cMin, cMax)}</p>
          </div>
        </div>

        {saveError && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{saveError}</p>
          </div>
        )}

        {saved && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2 flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">Salvo! Fechando…</p>
          </div>
        )}

        {resultsError && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{resultsError}</p>
          </div>
        )}

        {savedToResults && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2 flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">Imagem enviada para a aba Resultado.</p>
          </div>
        )}
      </div>
    </>
  )

  const renderFooter = () => step === 'edit' && (
    <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-wrap">
      <Btn variant="outline" onClick={handleDownload} disabled={saving}>
        <Download className="h-3.5 w-3.5" /> Baixar PNG
      </Btn>
      {onSaveToResults && (
        <Btn variant="outline" onClick={handleSaveToResults} loading={savingToResults} disabled={savingToResults}>
          <ImageIcon className="h-3.5 w-3.5" /> {savedToResults ? 'Enviado' : 'Salvar em Resultados'}
        </Btn>
      )}
      <Btn variant="primary" onClick={handleSave} loading={saving} disabled={saving || saved}>
        <Save className="h-3.5 w-3.5" /> {saved ? 'Salvo' : 'Salvar'}
      </Btn>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col"
        style={{ maxWidth: 860, maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-semibold text-gray-900">Ferramenta de Contraste</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {step === 'category'
                ? `Escolha a categoria de fotos de ${clientName}`
                : step === 'pick'
                ? `Escolha uma foto de ${clientName} para começar`
                : 'Ajuste a faixa de contraste e salve. O valor vira tag pra usar em prompts.'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {step === 'category' ? renderCategory() : step === 'pick' ? renderPick() : renderEdit()}
        {renderFooter()}
      </div>
    </div>
  )
}