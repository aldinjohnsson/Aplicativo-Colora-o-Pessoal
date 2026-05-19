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
//
// Mudanças vs versão anterior:
//   • CompositionPage agora tem partId + partLabel (sem modelOverride nem uploadedImageBase64)
//   • handleAdd aceita AddPageResult[] e cria múltiplas páginas de uma vez
//   • generateCompositionImage passa partId pra o backend saber qual sub-prompt usar
//   • Fotos podem ser da galeria ou upload (uploadedPhotoBase64)

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles, Plus, Trash2, ArrowUp, ArrowDown,
  Play, AlertCircle, Loader2, Users, X, Check, Download,
  FileText, RefreshCw, Image as ImageIcon, Wand2, Eye,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { adminService } from '../../../../lib/services'
import { AddPageDialog, AddPageResult } from './AddPageDialog'
import { generateCompositionPdf, fetchAllAsBytes } from './generateCompositionPdf'
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
  storagePath?:         string
  generatedImageUrl?:   string
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
}

export function AiCompositionsManager({ clientId: propClientId, clientName: propClientName, onGoToDocuments }: AiCompositionsManagerProps = {}) {
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
    try {
      const raw = localStorage.getItem(`ai_composition_${propClientId}`)
      if (raw) {
        const { pages: saved, compositionId } = JSON.parse(raw)
        if (Array.isArray(saved) && saved.length > 0) {
          setPages(saved)
          compositionIdRef.current = compositionId || ''
        }
      }
    } catch {}
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

    try {
      const raw = localStorage.getItem(`ai_composition_${selectedClientId}`)
      if (raw) {
        const { pages: saved, compositionId } = JSON.parse(raw)
        if (Array.isArray(saved) && saved.length > 0) {
          setPages(saved)
          compositionIdRef.current = compositionId || ''
          return
        }
      }
    } catch {}
    setPages([])
    compositionIdRef.current = ''
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
        ...(page.uploadedPhotoBase64 ? { uploadedPhotoBase64: page.uploadedPhotoBase64, uploadedPhotoMime: page.uploadedPhotoMime } : {}),
        ...(page.driveFileId ? { driveFileId: page.driveFileId } : {}),
      })
      const signedUrl = await (documentsService as any).getSignedCompositionImageUrl(res.storagePath)
      patchPage(pageId, {
        status:           'done',
        storagePath:      res.storagePath,
        generatedImageUrl: signedUrl,
        errorMsg:         undefined,
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
          ...(page.uploadedPhotoBase64 ? { uploadedPhotoBase64: page.uploadedPhotoBase64, uploadedPhotoMime: page.uploadedPhotoMime } : {}),
          ...(page.driveFileId ? { driveFileId: page.driveFileId } : {}),
        })
        const signedUrl = await (documentsService as any)
          .getSignedCompositionImageUrl(res.storagePath)
          .catch(() => undefined as string | undefined)

        commit(snap => snap.map(p =>
          p.id === page.id
            ? { ...p, status: 'done', storagePath: res.storagePath, generatedImageUrl: signedUrl, errorMsg: undefined }
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
        `Clique em ↺ na linha pra tentar de novo, depois em "Gerar pendentes".`
      )
    }
  }

  // ── Finalizar: apenas monta o blob (sem salvar) ──
  const handleFinalizePdf = async () => {
    if (!selectedClient) return
    const donePages = pages.filter(p => p.status === 'done' && p.storagePath)
    if (donePages.length === 0) return

    setBuildingPdf(true)
    setGlobalError(null)
    setPdfBlob(null)
    setSavedDoc(null)

    try {
      const ordered = pages.filter(p => p.status === 'done' && p.storagePath)
      const signedUrls: string[] = []
      for (const p of ordered) {
        const url = p.generatedImageUrl
          ?? await (documentsService as any).getSignedCompositionImageUrl(p.storagePath)
        signedUrls.push(url)
      }
      const images = await fetchAllAsBytes(signedUrls)
      const blob   = await generateCompositionPdf(images)
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
    patchPage(id, { status: 'pending', errorMsg: undefined, storagePath: undefined, generatedImageUrl: undefined })
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
                    {buildingPdf ? 'Montando PDF…' : `Montar PDF (${stats.done} imagem${stats.done !== 1 ? 'ns' : ''})`}
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
            {page.status === 'error' && page.errorMsg && (
              <p className="text-xs text-red-600 mt-0.5 break-words line-clamp-2">{page.errorMsg}</p>
            )}
          </div>

          {/* Ações */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {page.status === 'done' && page.generatedImageUrl && (
              <a
                href={page.generatedImageUrl}
                download={`${page.promptName} - ${page.partLabel}.png`}
                target="_blank"
                rel="noreferrer"
                title="Baixar imagem gerada"
                className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors inline-flex items-center"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
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
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <img
              src={page.generatedImageUrl}
              alt={`Imagem gerada — ${page.promptName} · ${page.partLabel}`}
              className="w-full h-auto rounded-2xl shadow-2xl"
            />
            <button
              onClick={() => setShowPreview(false)}
              className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="mt-3 text-center text-sm text-white/70">
              {page.promptName} · {page.partLabel} · Foto: {page.photoName}
            </p>
          </div>
        </div>
      )}
    </>
  )
}