// src/components/admin/documents/ai-compositions/AiCompositionsManager.tsx
//
// Subtab "Composições IA" no Documents Hub.
//
// Fluxo:
//   1. Escolhe um cliente
//   2. Clica "Adicionar" → AddPageDialog retorna N páginas (1 por parte do prompt)
//   3. Gera cada imagem individualmente OU "Gerar pendentes"
//      → preview inline no card
//   4. Reordena/remove se quiser
//   5. "Finalizar e Gerar PDF" → baixa todas as imagens prontas e monta o PDF
//      (com capa + contracapa do admin logado, se configuradas no Settings)
//
// Branding:
//   No momento de montar o PDF, busca o branding do ADMIN LOGADO em duas
//   linhas separadas de `admin_content`:
//     - `ai_composition_cover`  → { pdfBase64, fileName }
//     - `ai_composition_final`  → { pdfBase64, fileName }
//   Cada admin tem o seu (mesmo padrão do `pdf_template` do Gemini).
//   Se não estiverem configurados (ou falharem em carregar), o PDF é
//   montado só com as imagens IA — feature 100% opt-in.
//
// Mudanças vs versão anterior:
//   • CompositionPage agora tem partId + partLabel (sem modelOverride nem uploadedImageBase64)
//   • handleAdd aceita AddPageResult[] e cria múltiplas páginas de uma vez
//   • generateCompositionImage passa partId pra o backend saber qual sub-prompt usar
//   • Fotos podem ser da galeria ou upload (uploadedPhotoBase64)
//   • handleFinalizePdf agora resolve capa + contracapa do admin logado antes
//     de montar o PDF, lendo direto do banco em base64 (não do Drive)

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles, Plus, Trash2, ArrowUp, ArrowDown,
  Play, AlertCircle, Loader2, Users, X, Check, Download,
  FileText, RefreshCw, Image as ImageIcon, Wand2, Eye,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { driveStorage } from '../../../../lib/driveStorage'
import { adminService } from '../../../../lib/services'
import { supabase } from '../../../../lib/supabase'
import { AddPageDialog, AddPageResult } from './AddPageDialog'
import {
  generateCompositionPdf,
  fetchAllByDriveId,
  base64PdfToArrayBuffer,
} from './generateCompositionPdf'
import type { ClientGeneratedDocument } from '../types'

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
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ── Types ─────────────────────────────────────────────────────────────

type PageStatus = 'pending' | 'generating' | 'done' | 'error'

interface CompositionPage {
  id:          string           // uuid local (react key)
  promptId:    string
  promptName:  string
  partId:      string           // id da parte específica dentro do prompt
  partLabel:   string           // ex: "Parte 1", "Outono manhã"
  partPrompt:  string           // texto do prompt desta parte
  // Foto base — galeria ou upload
  photoId?:    string           // presente se veio da galeria
  photoName:   string
  photoUrl:    string           // thumbnail (galeria) ou data URL (upload)
  driveFileId?: string
  uploadedPhotoBase64?: string  // presente se veio de upload
  uploadedPhotoMime?:   string
  // Status
  status:               PageStatus
  /** ID do arquivo gerado no Drive — referência persistente da imagem produzida. */
  generatedDriveFileId?: string
  /** URL estática do Drive (thumbnail). Não expira, mas refrescamos no load
   *  pra páginas legadas e por consistência. */
  generatedImageUrl?:   string
  /** Base64 PNG da imagem gerada — presente no modo standalone (sem Drive).
   *  Usado como fallback de preview e pra montar o PDF sem precisar do Drive. */
  generatedImageBase64?: string
  errorMsg?:            string
}

interface ClientLite {
  id:        string
  full_name: string
  email:     string | null
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

function buildFileName(clientName: string): string {
  const clean = clientName
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60) || 'Cliente'
  return `Dossiê ${clean}.pdf`
}

// ─── Component ────────────────────────────────────────────────────────

interface AiCompositionsManagerProps {
  clientId?:   string
  clientName?: string
  onGoToDocuments?: () => void
  /** Disparado depois de salvar com sucesso em client_result_files.
   *  Permite que o componente pai (ex: ClientsManager) recarregue a aba
   *  Resultado pra mostrar o PDF novo sem precisar de F5. */
  onSavedToResult?: () => void
}

export function AiCompositionsManager({ clientId: propClientId, clientName: propClientName, onGoToDocuments, onSavedToResult }: AiCompositionsManagerProps = {}) {
  const isEmbedded = !!propClientId

  // ── Clientes (só no modo global) ──
  const [clients, setClients]               = useState<ClientLite[]>([])
  const [loadingClients, setLoadingClients] = useState(!isEmbedded)
  const [clientsError, setClientsError]     = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<string>(propClientId ?? '')

  // ── Páginas ──
  const [pages, setPages] = useState<CompositionPage[]>([])

  // ── UI state ──
  const [showAdd, setShowAdd]           = useState(false)
  const [runningBatch, setRunningBatch] = useState(false)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [buildingPdf, setBuildingPdf]   = useState(false)
  const [savingDoc, setSavingDoc]       = useState(false)
  const [globalError, setGlobalError]   = useState<string | null>(null)
  const [savedDoc, setSavedDoc]         = useState<ClientGeneratedDocument | null>(null)
  const [pdfBlob, setPdfBlob]           = useState<Blob | null>(null)
  const [saveError, setSaveError]       = useState<string | null>(null)

  const compositionIdRef = useRef<string>('')

  // ── Load clientes ──
  useEffect(() => {
    if (isEmbedded) return
    let cancelled = false
    setLoadingClients(true); setClientsError(null)
    ;(documentsService as any).listClientsLight()
      .then((list: ClientLite[]) => { if (!cancelled) setClients(list || []) })
      .catch((e: any) => { if (!cancelled) setClientsError(e?.message || 'Erro ao carregar clientes') })
      .finally(() => { if (!cancelled) setLoadingClients(false) })
    return () => { cancelled = true }
  }, [isEmbedded])

  const selectedClient = useMemo((): ClientLite | null => {
    if (isEmbedded && propClientId && propClientName)
      return { id: propClientId, full_name: propClientName, email: null }
    return clients.find(c => c.id === selectedClientId) || null
  }, [isEmbedded, propClientId, propClientName, clients, selectedClientId])

  // ── Load localStorage no modo EMBEDDED (on mount) ──
  useEffect(() => {
    if (!isEmbedded || !propClientId) return
    let cancelled = false
    try {
      const raw = localStorage.getItem(`ai_composition_${propClientId}`)
      if (raw) {
        const { pages: saved, compositionId } = JSON.parse(raw)
        if (Array.isArray(saved) && saved.length > 0) {
          setPages(saved)
          compositionIdRef.current = compositionId || ''
          // URLs do Drive são estáticas (sem TTL). Esse refresh trata
          // páginas legacy (vindas do Supabase Storage) e preenche a
          // URL pra páginas novas que ainda não tinham.
          refreshDriveUrls(saved).then(refreshed => {
            if (!cancelled) setPages(refreshed)
          })
        }
      }
    } catch {}
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // só no mount

  // ── Restore pages from localStorage when client changes (modo GLOBAL) ──
  useEffect(() => {
    if (isEmbedded) return
    setSavedDoc(null)
    setPdfBlob(null)
    setGlobalError(null)

    if (!selectedClientId) {
      setPages([])
      compositionIdRef.current = ''
      return
    }

    let cancelled = false
    let loaded = false
    try {
      const raw = localStorage.getItem(`ai_composition_${selectedClientId}`)
      if (raw) {
        const { pages: saved, compositionId } = JSON.parse(raw)
        if (Array.isArray(saved) && saved.length > 0) {
          setPages(saved)
          compositionIdRef.current = compositionId || ''
          loaded = true
          // URLs do Drive são estáticas — preenche o que falta + migra legacy.
          refreshDriveUrls(saved).then(refreshed => {
            if (!cancelled) setPages(refreshed)
          })
        }
      }
    } catch {}
    if (!loaded) {
      setPages([])
      compositionIdRef.current = ''
    }
    return () => { cancelled = true }
  }, [selectedClientId, isEmbedded])

  // ── Persist pages to localStorage sempre que mudarem ──
  useEffect(() => {
    const clientId = isEmbedded ? propClientId : selectedClientId
    if (!clientId || pages.length === 0) return
    try {
      const toSave = pages.map(p => ({
        ...p,
        uploadedPhotoBase64: undefined,
        uploadedPhotoMime:   undefined,
      }))
      localStorage.setItem(
        `ai_composition_${clientId}`,
        JSON.stringify({ pages: toSave, compositionId: compositionIdRef.current })
      )
    } catch {}
  }, [pages, selectedClientId, isEmbedded, propClientId])

  const getCompositionId = () => {
    if (!compositionIdRef.current && selectedClient) {
      compositionIdRef.current = `${selectedClient.id}_${Date.now()}_${uid()}`
    }
    return compositionIdRef.current
  }

  const patchPage = (id: string, patch: Partial<CompositionPage>) =>
    setPages(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))

  // ── Refresh / migração de URLs ────────────────────────────────────────
  //
  // A feature foi migrada do Supabase Storage (signed URL com TTL de 1h)
  // pro Google Drive (URL estática). Este helper trata dois casos:
  //
  //   1. PÁGINAS NOVAS (driveFileId presente): garante que `generatedImageUrl`
  //      esteja preenchida com a URL estática do Drive. Sem chamada de rede.
  //
  //   2. PÁGINAS LEGACY (storagePath presente, sem driveFileId): vieram do
  //      Supabase Storage. Como não temos mais como gerar signed URL daquele
  //      bucket pra elas (ou a URL já expirou), marcamos como `pending` pro
  //      usuário regerar. A imagem antiga fica órfã no bucket — o cleanup
  //      faz o resto.
  const refreshDriveUrls = async (pgs: CompositionPage[]): Promise<CompositionPage[]> => {
    return pgs.map((p) => {
      if (p.status !== 'done') return p

      // Caso 1: já tá no Drive — só garante a URL preenchida.
      if (p.generatedDriveFileId) {
        return {
          ...p,
          generatedImageUrl: p.generatedImageUrl || driveStorage.viewUrl(p.generatedDriveFileId),
        }
      }

      // Caso 2: página legacy (vinda do Supabase Storage). Marca como pending
      // pra usuário regerar — agora vai pro Drive automaticamente.
      const isLegacy = !!(p as any).storagePath
      if (isLegacy) {
        return {
          ...p,
          status:            'pending' as PageStatus,
          generatedImageUrl: undefined,
          errorMsg:          undefined,
        }
      }

      // Estado inconsistente (done sem id nem storagePath) — pending também.
      return { ...p, status: 'pending' as PageStatus, generatedImageUrl: undefined }
    })
  }

  // ── Geração individual ──
  const handleGenerateSingle = async (pageId: string) => {
    if (!selectedClient) return
    if (runningBatch || generatingId) return

    const page = pages.find(p => p.id === pageId)
    if (!page) return

    setGeneratingId(pageId)
    setGlobalError(null)
    setSavedDoc(null)

    const compositionId = getCompositionId()
    const index = pages.findIndex(p => p.id === pageId)

    patchPage(pageId, { status: 'generating', errorMsg: undefined })

    try {
      const res = await (documentsService as any).generateCompositionImage({
        promptId:      page.promptId,
        partId:        page.partId,
        promptOverride: page.partPrompt,  // texto já resolvido — evita a edge function ler prompt.prompt vazio
        clientId:      selectedClient.id,
        photoId:       page.photoId,
        compositionId,
        index,
        ...(page.uploadedPhotoBase64 ? { uploadedImageBase64: page.uploadedPhotoBase64, uploadedImageMime: page.uploadedPhotoMime } : {}),
        ...(page.driveFileId ? { driveFileId: page.driveFileId } : {}),
      })
      // res = { driveFileId, url, ... } no modo galeria.
      // res = { imageBase64, imageMime, ... } no modo standalone (sem Drive).
      const previewUrl = res.url || (res.imageBase64 ? `data:${res.imageMime || 'image/png'};base64,${res.imageBase64}` : undefined)
      patchPage(pageId, {
        status:                'done',
        generatedDriveFileId:  res.driveFileId || undefined,
        generatedImageUrl:     previewUrl,
        generatedImageBase64:  res.imageBase64 || undefined,
        errorMsg:              undefined,
      })
    } catch (e: any) {
      patchPage(pageId, { status: 'error', errorMsg: e?.message || 'Erro na geração' })
    } finally {
      setGeneratingId(null)
    }
  }

  // ── Gerar pendentes (batch) ──
  const handleGenerateBatch = async () => {
    if (!selectedClient) return
    if (runningBatch || generatingId) return

    const pending = pages.filter(p => p.status === 'pending' || p.status === 'error')
    if (pending.length === 0) return

    setRunningBatch(true)
    setGlobalError(null)
    setSavedDoc(null)

    const compositionId = getCompositionId()
    let snapshot = [...pages]

    const commit = (mutator: (snap: CompositionPage[]) => CompositionPage[]) => {
      snapshot = mutator(snapshot)
      setPages([...snapshot])
    }

    for (const page of pending) {
      const idx = snapshot.findIndex(p => p.id === page.id)
      if (idx < 0) continue

      commit(snap => snap.map(p =>
        p.id === page.id ? { ...p, status: 'generating', errorMsg: undefined } : p
      ))

      try {
        const res = await (documentsService as any).generateCompositionImage({
          promptId:       page.promptId,
          partId:         page.partId,
          promptOverride: page.partPrompt,
          clientId:       selectedClient.id,
          photoId:        page.photoId,
          compositionId,
          index:          idx,
          ...(page.uploadedPhotoBase64 ? { uploadedImageBase64: page.uploadedPhotoBase64, uploadedImageMime: page.uploadedPhotoMime } : {}),
          ...(page.driveFileId ? { driveFileId: page.driveFileId } : {}),
        })
        // res = { driveFileId, url, downloadUrl, ... } — URL do Drive é estática.

        const previewUrlB = res.url || (res.imageBase64 ? `data:${res.imageMime || 'image/png'};base64,${res.imageBase64}` : undefined)
        commit(snap => snap.map(p =>
          p.id === page.id
            ? {
                ...p,
                status:               'done',
                generatedDriveFileId: res.driveFileId || undefined,
                generatedImageUrl:    previewUrlB,
                generatedImageBase64: res.imageBase64 || undefined,
                errorMsg:             undefined,
              }
            : p
        ))
      } catch (e: any) {
        commit(snap => snap.map(p =>
          p.id === page.id ? { ...p, status: 'error', errorMsg: e?.message || 'Erro na geração' } : p
        ))
      }
    }

    setRunningBatch(false)

    const nowErrored = snapshot.filter(p => p.status === 'error').length
    if (nowErrored > 0) {
      setGlobalError(
        `${nowErrored} página${nowErrored !== 1 ? 's' : ''} falharam. ` +
        `Veja o motivo em cada card, clique em ↺ pra tentar de novo individualmente ` +
        `ou em "Gerar pendentes" pra reprocessar todos os erros.`
      )
    }
  }

  // ── Finalizar: monta o blob (capa + IA + contracapa) ─────────────
  //
  // O branding (capa e contracapa) vem do Settings do ADMIN LOGADO,
  // armazenado em duas linhas de admin_content (tipos `ai_composition_cover`
  // e `ai_composition_final`), cada uma com um PDF em base64. Cada admin
  // tem o seu — mesmo padrão do `pdf_template` do Gemini.
  //
  // Best-effort: se algum dos dois falhar (não configurado, base64 inválido,
  // PDF corrompido), o builder ignora e segue. Melhor entregar PDF sem
  // branding do que travar o fluxo.
  const handleFinalizePdf = async () => {
    if (!selectedClient) return
    const donePages = pages.filter(p => p.status === 'done' && p.generatedDriveFileId)
    if (donePages.length === 0) return

    setBuildingPdf(true)
    setGlobalError(null)
    setPdfBlob(null)
    setSavedDoc(null)

    try {
      // 1. Resolve branding do admin logado (capa + contracapa) ────
      let coverBytes: ArrayBuffer | null = null
      let finalBytes: ArrayBuffer | null = null

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Lê as duas rows em paralelo. Cada uma traz { pdfBase64, fileName }.
        const [{ data: coverRow }, { data: finalRow }] = await Promise.all([
          supabase.from('admin_content')
            .select('content')
            .eq('admin_id', user.id)
            .eq('type', 'ai_composition_cover')
            .maybeSingle(),
          supabase.from('admin_content')
            .select('content')
            .eq('admin_id', user.id)
            .eq('type', 'ai_composition_final')
            .maybeSingle(),
        ])

        const coverB64 = (coverRow?.content as any)?.pdfBase64 as string | undefined
        const finalB64 = (finalRow?.content as any)?.pdfBase64 as string | undefined

        if (coverB64) {
          try {
            coverBytes = base64PdfToArrayBuffer(coverB64)
          } catch (e) {
            console.warn('[AiCompositionsManager] Capa de branding inválida (base64 corrompido?):', e)
          }
        }
        if (finalB64) {
          try {
            finalBytes = base64PdfToArrayBuffer(finalB64)
          } catch (e) {
            console.warn('[AiCompositionsManager] Contracapa de branding inválida (base64 corrompido?):', e)
          }
        }
      }

      // 2. Monta lista de imagens — dois caminhos por página:
      //   • Drive (driveFileId presente): baixa via proxy autenticado
      //   • Standalone (imageBase64 presente): decodifica direto, sem rede
      const ordered = pages.filter(p => p.status === 'done' && (p.generatedDriveFileId || p.generatedImageBase64))

      const drivePages      = ordered.filter(p => !!p.generatedDriveFileId)
      const standalonePages = ordered.filter(p => !p.generatedDriveFileId && !!p.generatedImageBase64)

      const driveImages = drivePages.length > 0
        ? await fetchAllByDriveId(drivePages.map(p => p.generatedDriveFileId as string))
        : []

      // Reconstrói na ordem original intercalando Drive + standalone
      let driveIdx = 0
      const images = ordered.map(p => {
        if (p.generatedDriveFileId) {
          return driveImages[driveIdx++]
        }
        const b64 = p.generatedImageBase64 as string
        const binStr = atob(b64)
        const bytes = new Uint8Array(binStr.length)
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
        return { bytes: bytes.buffer as ArrayBuffer, mime: 'image/png' as string }
      })

      const blob   = await generateCompositionPdf(images, {
        cover: coverBytes,
        final: finalBytes,
      })
      setPdfBlob(blob)
    } catch (e: any) {
      setGlobalError(e?.message || 'Erro ao montar o PDF')
    } finally {
      setBuildingPdf(false)
    }
  }

  // ── Baixar PDF direto (sem salvar no banco) ──
  const handleDownloadPdf = () => {
    if (!pdfBlob || !selectedClient) return
    const fileName = buildFileName(selectedClient.full_name)
    const url = URL.createObjectURL(pdfBlob)
    const a   = document.createElement('a')
    a.href = url; a.download = fileName; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Salvar em Resultados (client_result_files via adminService) ──
  const handleSaveToResults = async () => {
    if (!pdfBlob || !selectedClient) return
    setSavingDoc(true)
    setSaveError(null)
    try {
      const fileName = buildFileName(selectedClient.full_name)
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' })
      await adminService.uploadResultFile(selectedClient.id, file)
      setSavedDoc({ id: 'ok' } as any) // marca como salvo pro banner mudar
      onSavedToResult?.()
    } catch (e: any) {
      const msg = e?.message || String(e) || 'Erro desconhecido ao salvar'
      console.error('[AiCompositionsManager] handleSaveToResults error:', e)
      setSaveError(msg)
    } finally {
      setSavingDoc(false)
    }
  }



  // ── Adicionar páginas (array — 1 por parte do prompt) ──
  const handleAddPages = (results: AddPageResult[]) => {
    const newPages: CompositionPage[] = results.map(r => ({
      id:          uid(),
      promptId:    r.promptId,
      promptName:  r.promptName,
      partId:      r.partId,
      partLabel:   r.partLabel,
      partPrompt:  r.partPrompt,
      photoId:     r.photoId,
      photoName:   r.photoName,
      photoUrl:    r.photoUrl,
      driveFileId: r.driveFileId,
      uploadedPhotoBase64: r.uploadedPhotoBase64,
      uploadedPhotoMime:   r.uploadedPhotoMime,
      status:      'pending',
    }))
    setPages(prev => [...prev, ...newPages])
    setShowAdd(false)
    setSavedDoc(null)
  }

  const handleRemove = (id: string) => {
    if (isBusy) return
    setPages(prev => prev.filter(p => p.id !== id))
    setSavedDoc(null)
  }

  const handleMove = (id: string, dir: -1 | 1) => {
    if (isBusy) return
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === id)
      if (idx < 0) return prev
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  const handleClearAll = () => {
    if (isBusy) return
    if (!confirm('Limpar todas as páginas? As imagens já geradas ficam no storage.')) return
    const clientId = isEmbedded ? propClientId : selectedClientId
    if (clientId) {
      try { localStorage.removeItem(`ai_composition_${clientId}`) } catch {}
    }
    setPages([])
    setSavedDoc(null)
    setPdfBlob(null)
    setGlobalError(null)
    compositionIdRef.current = ''
  }

  const handleResetPage = (id: string) => {
    if (isBusy) return
    patchPage(id, { status: 'pending', errorMsg: undefined, generatedDriveFileId: undefined, generatedImageUrl: undefined, generatedImageBase64: undefined })
    setSavedDoc(null)
  }

  // ── Computed ──
  const stats = useMemo(() => {
    const done    = pages.filter(p => p.status === 'done').length
    const erred   = pages.filter(p => p.status === 'error').length
    const pending = pages.filter(p => p.status === 'pending').length
    const gen     = pages.filter(p => p.status === 'generating').length
    return { done, erred, pending, gen, total: pages.length }
  }, [pages])

  const isBusy      = runningBatch || !!generatingId || buildingPdf || savingDoc
  const hasPending  = stats.pending > 0 || stats.erred > 0
  const canBatch    = !isBusy && hasPending && pages.length > 0
  const canFinalize = !isBusy && stats.done > 0

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-fuchsia-50 to-rose-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-fuchsia-500 to-rose-500 rounded-xl flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Composições IA</h2>
            <p className="text-sm text-gray-500">
              Selecione um prompt (com N partes) + foto e gere todas as imagens de uma vez.
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">

        {/* ═══ Bloco: cliente (só no modo global) ═══ */}
        {!isEmbedded && (
          <section>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-gray-500" /> Cliente
              <span className="text-rose-500">*</span>
            </label>
            {loadingClients ? (
              <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-xs text-gray-400 flex items-center gap-2">
                <div className="animate-spin h-3 w-3 border-2 border-gray-300 border-t-fuchsia-400 rounded-full" />
                Carregando clientes…
              </div>
            ) : clientsError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{clientsError}</p>
              </div>
            ) : (
              <select
                value={selectedClientId}
                onChange={e => setSelectedClientId(e.target.value)}
                disabled={isBusy}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:border-fuchsia-400 disabled:opacity-60"
              >
                <option value="">— Escolha um cliente —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}{c.email ? ` (${c.email})` : ''}
                  </option>
                ))}
              </select>
            )}
          </section>
        )}

        {/* ═══ Bloco: páginas ═══ */}
        {selectedClient && (
          <section className="space-y-3">

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-gray-900">Páginas da composição</p>
                <p className="text-xs text-gray-500">
                  {stats.total === 0
                    ? 'Adicione um prompt pra começar. Cada parte gera uma página.'
                    : `${stats.total} página${stats.total !== 1 ? 's' : ''} · ${stats.done} gerada${stats.done !== 1 ? 's' : ''}${stats.erred > 0 ? ` · ${stats.erred} com erro` : ''}${stats.pending > 0 ? ` · ${stats.pending} aguardando` : ''}`
                  }
                </p>
              </div>
              <Btn variant="outline" size="sm" onClick={() => setShowAdd(true)} disabled={isBusy}>
                <Plus className="h-4 w-4" /> Adicionar
              </Btn>
            </div>

            {/* Lista vazia */}
            {pages.length === 0 ? (
              <div className="border border-dashed border-gray-300 rounded-xl p-10 text-center">
                <div className="w-12 h-12 rounded-xl bg-fuchsia-50 flex items-center justify-center mx-auto mb-3">
                  <Wand2 className="h-6 w-6 text-fuchsia-400" />
                </div>
                <p className="text-sm font-medium text-gray-700">Nenhuma página ainda</p>
                <p className="text-xs text-gray-500 mt-1">
                  Clique em "Adicionar", escolha um prompt com suas partes e a foto da cliente.<br />
                  O sistema vai enfileirar uma imagem pra cada parte automaticamente.
                </p>
              </div>
            ) : (
              <ol className="space-y-2">
                {pages.map((p, idx) => (
                  <PageRow
                    key={p.id}
                    page={p}
                    index={idx}
                    total={pages.length}
                    isBusy={isBusy}
                    isThisGenerating={generatingId === p.id}
                    onGenerate={() => handleGenerateSingle(p.id)}
                    onMoveUp={() => handleMove(p.id, -1)}
                    onMoveDown={() => handleMove(p.id, 1)}
                    onRemove={() => handleRemove(p.id)}
                    onReset={() => handleResetPage(p.id)}
                  />
                ))}
              </ol>
            )}

            {/* Erro global */}
            {globalError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-red-700">Atenção</p>
                  <p className="text-xs text-red-600 mt-0.5 break-words">{globalError}</p>
                </div>
              </div>
            )}

            {/* PDF pronto — botões de ação */}
            {pdfBlob && !buildingPdf && (
              <div className="space-y-2">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="h-10 w-10 rounded-lg bg-emerald-500/15 text-emerald-700 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-800">
                      {savedDoc ? 'PDF salvo nos Resultados!' : 'PDF pronto!'}
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      {savedDoc
                        ? 'O arquivo já aparece na aba Resultado → Arquivos PDF.'
                        : 'Baixe agora ou salve diretamente nos Resultados da cliente.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    <Btn variant="outline" size="sm" onClick={handleDownloadPdf}>
                      <Download className="h-3.5 w-3.5" /> Baixar PDF
                    </Btn>
                    {!savedDoc && (
                      <Btn variant="success" size="sm" onClick={handleSaveToResults} loading={savingDoc} disabled={savingDoc}>
                        <FileText className="h-3.5 w-3.5" />
                        {savingDoc ? 'Salvando…' : 'Salvar em Resultados'}
                      </Btn>
                    )}
                    {savedDoc && onGoToDocuments && (
                      <Btn variant="outline" size="sm" onClick={onGoToDocuments}>
                        <FileText className="h-3.5 w-3.5" /> Ver Resultado
                      </Btn>
                    )}
                  </div>
                </div>
                {saveError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-red-700">Erro ao salvar nos Resultados</p>
                      <p className="text-xs text-red-600 mt-0.5 break-words">{saveError}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSaveError(null)}
                      className="ml-auto text-red-400 hover:text-red-600 flex-shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Barra de ações */}
            {pages.length > 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap border-t border-gray-100 pt-4">
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={isBusy}
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Limpar tudo
                </Btn>

                <div className="flex items-center gap-2 flex-wrap">
                  {hasPending && (
                    <Btn variant="outline" onClick={handleGenerateBatch} loading={runningBatch} disabled={!canBatch}>
                      <Play className="h-4 w-4" />
                      {runningBatch
                        ? 'Gerando…'
                        : `Gerar pendentes (${stats.pending + stats.erred})`}
                    </Btn>
                  )}
                  <Btn variant="success" onClick={handleFinalizePdf} loading={buildingPdf} disabled={!canFinalize}>
                    <FileText className="h-4 w-4" />
                    {buildingPdf ? 'Montando PDF…' : `Montar PDF (${stats.done} ${stats.done !== 1 ? 'imagens' : 'imagem'})`}
                  </Btn>
                </div>
              </div>
            )}

            {/* Banner de progresso */}
            {(runningBatch || buildingPdf || generatingId || savingDoc) && (
              <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-fuchsia-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fuchsia-800">
                    {buildingPdf ? 'Montando o PDF final…' : savingDoc ? 'Salvando nos Resultados…' : 'Gerando imagem com a OpenAI…'}
                  </p>
                  <p className="text-xs text-fuchsia-700 mt-0.5">
                    {buildingPdf
                      ? 'Baixando imagens e empacotando. Aguarde…'
                      : savingDoc
                      ? 'Enviando o PDF para o perfil da cliente…'
                      : 'Cada imagem leva 15–30s. Não feche essa aba.'}
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Estado sem cliente (modo global) */}
        {!isEmbedded && !selectedClient && !loadingClients && !clientsError && (
          <div className="border border-dashed border-gray-300 rounded-xl p-8 text-center">
            <Users className="h-5 w-5 text-gray-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700">Escolha um cliente acima</p>
            <p className="text-xs text-gray-500 mt-1">
              As fotos da galeria dele vão ficar disponíveis pra combinar com seus prompts.
            </p>
          </div>
        )}
      </div>

      {/* Modal: adicionar páginas */}
      {showAdd && selectedClient && (
        <AddPageDialog
          clientId={selectedClient.id}
          clientName={selectedClient.full_name}
          onClose={() => setShowAdd(false)}
          onConfirm={handleAddPages}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//   parseGenerationError — transforma erros técnicos em mensagens legíveis
// ═══════════════════════════════════════════════════════════════════════

/**
 * Converte mensagens de erro crus da OpenAI / Edge Function em texto
 * amigável pra exibir no card. O erro bruto fica no console.
 */
function parseGenerationError(raw: string): { title: string; detail: string } {
  if (!raw) return { title: 'Erro desconhecido', detail: 'Tente novamente.' }

  // ── Erros de arquivo de imagem inválido ──────────────────────────────
  if (/invalid image file/i.test(raw) || /invalid.*mode.*image/i.test(raw)) {
    return {
      title: 'Foto incompatível com a API',
      detail:
        'O formato da foto não foi aceito pela OpenAI. ' +
        'Tente trocar a foto da cliente por uma imagem JPEG ou PNG diferente e gere novamente.',
    }
  }

  // ── Cota / billing ───────────────────────────────────────────────────
  if (/rate.?limit|quota|billing|insufficient_quota/i.test(raw)) {
    return {
      title: 'Limite de API atingido',
      detail:
        'Sua cota da OpenAI foi excedida ou a cobrança está pendente. ' +
        'Verifique seu painel em platform.openai.com e aguarde antes de tentar novamente.',
    }
  }

  // ── Chave inválida ───────────────────────────────────────────────────
  if (/invalid.*api.*key|incorrect.*api.*key|api.?key/i.test(raw)) {
    return {
      title: 'Chave da OpenAI inválida',
      detail: 'A chave configurada em Configurações → OpenAI está incorreta ou foi revogada.',
    }
  }

  // ── Chave não configurada ────────────────────────────────────────────
  if (/chave.*openai.*não configurada|openai.*not configured/i.test(raw)) {
    return {
      title: 'Chave da OpenAI não configurada',
      detail: 'Vá em Configurações e cole sua chave da OpenAI em "Geração de Imagem OpenAI".',
    }
  }

  // ── Prompt vazio ─────────────────────────────────────────────────────
  if (/texto da parte está vazio|empty prompt/i.test(raw)) {
    return {
      title: 'Prompt sem texto',
      detail: 'Vá em Prompts IA, edite este prompt e preencha o texto de cada parte.',
    }
  }

  // ── Foto não encontrada ──────────────────────────────────────────────
  if (/photo not found|foto.*não.*disponível|failed to download photo/i.test(raw)) {
    return {
      title: 'Foto não encontrada',
      detail:
        'Não foi possível recuperar a foto desta página. ' +
        'Verifique se o Google Drive está conectado ou remova e adicione esta página novamente.',
    }
  }

  // ── Timeout / conexão ────────────────────────────────────────────────
  if (/timeout|ETIMEDOUT|network|fetch failed/i.test(raw)) {
    return {
      title: 'Tempo de resposta excedido',
      detail: 'A geração demorou mais do que o esperado. Tente novamente, costuma funcionar na segunda tentativa.',
    }
  }

  // ── Erro genérico da OpenAI (HTTP 4xx/5xx sem detalhe acima) ─────────
  if (/openai api error|openai.*error/i.test(raw)) {
    return {
      title: 'Erro na API da OpenAI',
      detail: 'A geração foi recusada pela OpenAI. Tente novamente ou verifique o prompt desta parte.',
    }
  }

  // ── Fallback ─────────────────────────────────────────────────────────
  // Trunca mensagens muito longas antes de exibir
  const truncated = raw.length > 160 ? raw.slice(0, 157) + '…' : raw
  return { title: 'Erro na geração', detail: truncated }
}

// ═══════════════════════════════════════════════════════════════════════
//   PageRow
// ═══════════════════════════════════════════════════════════════════════

function PageRow({
  page, index, total, isBusy, isThisGenerating,
  onGenerate, onMoveUp, onMoveDown, onRemove, onReset,
}: {
  page:             CompositionPage
  index:            number
  total:            number
  isBusy:           boolean
  isThisGenerating: boolean
  onGenerate:  () => void
  onMoveUp:    () => void
  onMoveDown:  () => void
  onRemove:    () => void
  onReset:     () => void
}) {
  const [showPreview, setShowPreview] = useState(false)

  // ── Zoom/pan do preview ─────────────────────────────────────────────
  // Scroll do mouse = zoom (centrado no cursor).
  // Drag = pan (quando ampliado).
  // Double-click = reset.
  const [zoom, setZoom]           = useState(1)
  const [pan, setPan]             = useState({ x: 0, y: 0 })
  const [isDragging, setDragging] = useState(false)

  const wrapperRef   = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 })
  // Refs espelhados pro handler de wheel não capturar valores velhos
  // (o listener é criado uma vez só por abertura do modal).
  const zoomRef = useRef(zoom)
  const panRef  = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current  = pan },  [pan])

  // Reset toda vez que abre o preview
  useEffect(() => {
    if (showPreview) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }
  }, [showPreview])

  // Wheel zoom — precisa de addEventListener manual pra { passive: false }.
  // No onWheel do React, preventDefault não funciona porque o listener
  // é registrado como passive por padrão (React 17+).
  useEffect(() => {
    if (!showPreview) return
    const el = wrapperRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top

      const prevZoom = zoomRef.current
      const prevPan  = panRef.current

      const factor   = e.deltaY > 0 ? 0.85 : 1.18
      const nextZoom = Math.max(1, Math.min(6, prevZoom * factor))

      // Zerou: reseta pan junto.
      if (nextZoom === 1) {
        if (prevZoom !== 1 || prevPan.x !== 0 || prevPan.y !== 0) {
          setZoom(1)
          setPan({ x: 0, y: 0 })
        }
        return
      }
      if (nextZoom === prevZoom) return

      // Zoom-to-cursor: mantém o ponto sob o cursor estável.
      // Como transform-origin é 0 0, o ponto da imagem original que está
      // em (cx, cy) é ((cx - pan.x) / zoom, (cy - pan.y) / zoom).
      // Pra mantê-lo sob o cursor depois do zoom: pan' = c - (c - pan) * k.
      const k = nextZoom / prevZoom
      setPan({
        x: cx - (cx - prevPan.x) * k,
        y: cy - (cy - prevPan.y) * k,
      })
      setZoom(nextZoom)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [showPreview])

  // Drag pan: listeners no window pra continuar funcionando se o
  // cursor sair do wrapper durante o arrasto.
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      setPan({ x: dragStartRef.current.px + dx, y: dragStartRef.current.py + dy })
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging])

  const startDrag = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    e.preventDefault()
    setDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
  }

  const resetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const statusBadge: Record<PageStatus, React.ReactNode> = {
    pending: (
      <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
        aguardando
      </span>
    ),
    generating: (
      <span className="text-[10px] uppercase tracking-wider font-semibold text-fuchsia-700 bg-fuchsia-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> gerando
      </span>
    ),
    done: (
      <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
        <Check className="h-3 w-3" /> gerado
      </span>
    ),
    error: (
      <span className="text-[10px] uppercase tracking-wider font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
        <AlertCircle className="h-3 w-3" /> erro
      </span>
    ),
  }

  const borderColor =
    page.status === 'error'      ? 'border-red-200 bg-red-50/40' :
    page.status === 'generating' ? 'border-fuchsia-200 bg-fuchsia-50/40' :
    page.status === 'done'       ? 'border-emerald-200 bg-emerald-50/30' :
    'border-gray-200 bg-white'

  return (
    <>
      <li className={`border rounded-xl transition-colors ${borderColor}`}>
        <div className="p-3 flex items-center gap-3">
          {/* Número */}
          <div className="w-7 h-7 rounded-lg bg-gray-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
            {index + 1}
          </div>

          {/* Thumbnail */}
          <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 group">
            <img
              src={page.status === 'done' && page.generatedImageUrl ? page.generatedImageUrl : page.photoUrl}
              alt={page.photoName}
              loading="lazy"
              className="w-full h-full object-cover"
            />
            {page.status === 'done' && page.generatedImageUrl && (
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                title="Ver imagem gerada"
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

          {/* Texto — mostra promptName + partLabel */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-gray-900 truncate">
                {page.promptName}
                <span className="text-gray-400 font-normal"> · </span>
                <span className="text-fuchsia-700">{page.partLabel}</span>
              </p>
              {statusBadge[page.status]}
            </div>
            {page.status === 'error' && page.errorMsg && (() => {
              const { title, detail } = parseGenerationError(page.errorMsg)
              return (
                <div className="mt-1 space-y-0.5">
                  <p className="text-xs font-semibold text-red-700">{title}</p>
                  <p className="text-xs text-red-600 break-words">{detail}</p>
                </div>
              )
            })()}
          </div>

          {/* Ações */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {page.status === 'done' && page.generatedDriveFileId && (
              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault()
                  if (!page.generatedDriveFileId) return
                  try {
                    // Baixa via proxy autenticado — drive.google.com bloqueia
                    // fetch direto no browser por CORS.
                    const blob = await driveStorage.fetchPhotoBlob(page.generatedDriveFileId)
                    const objUrl = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = objUrl
                    a.download = `${page.promptName} - ${page.partLabel}.png`
                    a.click()
                    URL.revokeObjectURL(objUrl)
                  } catch (err: any) {
                    alert('Falha ao baixar imagem: ' + (err?.message || err))
                  }
                }}
                title="Baixar imagem gerada"
                className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors inline-flex items-center"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            {(page.status === 'pending' || page.status === 'error') && (
              <button
                type="button"
                onClick={onGenerate}
                disabled={isBusy}
                title="Gerar esta imagem"
                className="p-2 rounded-lg text-fuchsia-600 hover:bg-fuchsia-50 disabled:opacity-30 transition-colors"
              >
                {isThisGenerating
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="h-3.5 w-3.5" />
                }
              </button>
            )}
            {page.status === 'error' && (
              <button type="button" onClick={onReset} disabled={isBusy} title="Resetar pra tentar de novo"
                className="p-2 rounded-lg text-amber-600 hover:bg-amber-50 disabled:opacity-30 transition-colors">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {page.status === 'done' && (
              <button type="button" onClick={onReset} disabled={isBusy} title="Regenerar"
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-fuchsia-600 disabled:opacity-30 transition-colors">
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
            <button type="button" onClick={onRemove} disabled={isBusy} title="Remover esta página"
              className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </li>

      {/* Modal de preview */}
      {showPreview && page.generatedImageUrl && (
        <div
          className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="relative flex flex-col items-center max-w-full"
            onClick={e => e.stopPropagation()}
          >
            {/* Wrapper com overflow-hidden: corta a img quando ampliada
                (efeito de viewer de imagem). inline-block faz o div se
                ajustar ao tamanho NATURAL da img sem transform — o transform
                CSS não muda layout, então o wrapper fica fixo no tamanho
                display original mesmo com zoom maior. */}
            <div
              ref={wrapperRef}
              className="relative w-fit overflow-hidden rounded-2xl shadow-2xl bg-black"
              onMouseDown={startDrag}
              onDoubleClick={resetZoom}
            >
              <img
                src={page.generatedImageUrl}
                alt={`Imagem gerada ${page.promptName} · ${page.partLabel}`}
                draggable={false}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  cursor: zoom > 1
                    ? (isDragging ? 'grabbing' : 'grab')
                    : 'zoom-in',
                  // Sem transition: scroll do mouse já é discreto,
                  // qualquer suavização deixa o feedback lento.
                }}
                className="block w-auto h-auto max-w-[min(90vw,720px)] max-h-[82vh] select-none"
              />
            </div>

            <button
              onClick={() => setShowPreview(false)}
              className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            <p className="mt-3 text-center text-sm text-white/70 max-w-[min(90vw,720px)] truncate">
              {page.promptName} · {page.partLabel} · Foto: {page.photoName}
              {zoom > 1 ? (
                <span className="ml-2 text-white/40">
                  · {Math.round(zoom * 100)}% · clique duplo pra resetar
                </span>
              ) : (
                <span className="ml-2 text-white/40">
                  · use o scroll do mouse pra dar zoom
                </span>
              )}
            </p>
          </div>
        </div>
      )}
    </>
  )
}