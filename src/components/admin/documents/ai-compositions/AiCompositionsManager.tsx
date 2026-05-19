// src/components/admin/documents/ai-compositions/AiCompositionsManager.tsx
//
// Subtab "Composições IA" no Documents Hub.
//
// Fluxo:
//   1. Escolhe um cliente
//   2. Adiciona N páginas (cada uma = prompt + foto)
//   3. Gera cada imagem individualmente (botão por linha) OU clica "Gerar pendentes"
//      → preview da imagem gerada aparece inline no card
//   4. Reordena/remove se quiser
//   5. Clica "Finalizar e Gerar PDF" → baixa todas as imagens prontas e monta o PDF
//      → salva no histórico do cliente (client_generated_documents)

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles, Plus, Trash2, ArrowUp, ArrowDown,
  Play, AlertCircle, Loader2, Users, X, Check, Download,
  FileText, RefreshCw, Image as ImageIcon, Wand2, Eye,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
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
  id:                   string          // uuid local (react key)
  promptId:             string
  promptName:           string
  photoId:              string
  photoName:            string
  photoUrl:             string          // thumbnail original (galeria do cliente)
  status:               PageStatus
  storagePath?:         string          // populado quando done
  generatedImageUrl?:   string          // URL assinada da imagem gerada (preview)
  errorMsg?:            string
  /** Imagem extra de referência em base64 puro */
  uploadedImageBase64?: string
  uploadedImageMime?:   string
  /** Sobrescreve o model do prompt para esta página */
  modelOverride?:       string
}

interface ClientLite {
  id:        string
  full_name: string
  email:     string | null
}

// helpers
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

function buildFileName(clientName: string): string {
  const clean = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
     .replace(/[^a-zA-Z0-9 _-]+/g, '')
     .trim().replace(/\s+/g, '_')
     .slice(0, 40)
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
  return `composicao_ia_${clean(clientName) || 'cliente'}_${stamp}.pdf`
}

// ─── Component ────────────────────────────────────────────────────────

interface AiCompositionsManagerProps {
  /** Quando passado (ex: de dentro do ClientsManager), pula o seletor de cliente. */
  clientId?:   string
  clientName?: string
}

export function AiCompositionsManager({ clientId: propClientId, clientName: propClientName }: AiCompositionsManagerProps = {}) {
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
  const [runningBatch, setRunningBatch] = useState(false)   // "Gerar pendentes"
  const [generatingId, setGeneratingId] = useState<string | null>(null) // geração individual
  const [buildingPdf, setBuildingPdf]   = useState(false)
  const [globalError, setGlobalError]   = useState<string | null>(null)
  const [savedDoc, setSavedDoc]         = useState<ClientGeneratedDocument | null>(null)

  // Ref pra compositionId ser estável durante o batch
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

  // Trocar cliente reseta composição
  useEffect(() => {
    if (isEmbedded) return
    setPages([])
    setSavedDoc(null)
    setGlobalError(null)
    compositionIdRef.current = ''
  }, [selectedClientId, isEmbedded])

  // ── Garante compositionId estável ──
  const getCompositionId = () => {
    if (!compositionIdRef.current && selectedClient) {
      compositionIdRef.current = `${selectedClient.id}_${Date.now()}_${uid()}`
    }
    return compositionIdRef.current
  }

  // ── Helpers de mutation ──
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
        promptId:             page.promptId,
        clientId:             selectedClient.id,
        photoId:              page.photoId,
        compositionId,
        index,
        ...(page.uploadedImageBase64 ? { uploadedImageBase64: page.uploadedImageBase64, uploadedImageMime: page.uploadedImageMime } : {}),
        ...(page.modelOverride ? { modelOverride: page.modelOverride } : {}),
      })
      // Busca URL assinada pra mostrar o preview
      const signedUrl = await (documentsService as any).getSignedCompositionImageUrl(res.storagePath)
      patchPage(pageId, {
        status:            'done',
        storagePath:       res.storagePath,
        generatedImageUrl: signedUrl,
        errorMsg:          undefined,
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

    // Trabalha com snapshot mutável pra não capturar stale state no loop
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
          promptId:      page.promptId,
          clientId:      selectedClient.id,
          photoId:       page.photoId,
          compositionId,
          index:         idx,
          ...(page.uploadedImageBase64 ? { uploadedImageBase64: page.uploadedImageBase64, uploadedImageMime: page.uploadedImageMime } : {}),
          ...(page.modelOverride ? { modelOverride: page.modelOverride } : {}),
        })
        // Busca signed URL pra preview inline
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
        // Não aborta o lote — segue pra próxima
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

  // ── Finalizar: montar o PDF com as páginas done ──
  const handleFinalizePdf = async () => {
    if (!selectedClient) return
    const donePages = pages.filter(p => p.status === 'done' && p.storagePath)
    if (donePages.length === 0) return

    setBuildingPdf(true)
    setGlobalError(null)
    setSavedDoc(null)

    try {
      // 1. Signed URLs em ordem da lista (só as done)
      const ordered = pages.filter(p => p.status === 'done' && p.storagePath)
      const signedUrls: string[] = []
      for (const p of ordered) {
        const url = p.generatedImageUrl
          ?? await (documentsService as any).getSignedCompositionImageUrl(p.storagePath)
        signedUrls.push(url)
      }
      // 2. Download e montagem
      const images = await fetchAllAsBytes(signedUrls)
      const blob   = await generateCompositionPdf(images)
      // 3. Salva no histórico
      const fileName = buildFileName(selectedClient.full_name)
      const doc = await (documentsService as any).saveGeneratedDocument({
        clientId:   selectedClient.id,
        templateId: null,
        fileName,
        blob,
        mappings: [],
        source:   'ai_composition',
      })
      setSavedDoc(doc)
    } catch (e: any) {
      setGlobalError(e?.message || 'Erro ao montar / salvar o PDF')
    } finally {
      setBuildingPdf(false)
    }
  }

  // ── Download ──
  const handleDownload = async () => {
    if (!savedDoc) return
    try {
      const blob = await documentsService.downloadGeneratedDoc(savedDoc.storage_path)
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = savedDoc.file_name; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e?.message || 'Erro ao baixar')
    }
  }

  // ── Handlers de lista ──
  const handleAdd = (r: AddPageResult) => {
    setPages(prev => [...prev, {
      id:         uid(),
      promptId:   r.promptId,
      promptName: r.promptName,
      photoId:    r.photoId,
      photoName:  r.photoName,
      photoUrl:   r.photoUrl,
      status:     'pending',
      ...(r.uploadedImageBase64 ? { uploadedImageBase64: r.uploadedImageBase64, uploadedImageMime: r.uploadedImageMime } : {}),
      modelOverride: r.modelVersion !== 'gpt-image-1' ? r.modelVersion : undefined,
    }])
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
    setPages([])
    setSavedDoc(null)
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

  const isBusy       = runningBatch || !!generatingId || buildingPdf
  const hasPending   = stats.pending > 0 || stats.erred > 0
  const canBatch     = !isBusy && hasPending && pages.length > 0
  const canFinalize  = !isBusy && stats.done > 0

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
              Adicione páginas (prompt + foto), gere cada imagem e finalize como PDF.
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

            {/* Cabeçalho da lista */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-gray-900">Páginas da composição</p>
                <p className="text-xs text-gray-500">
                  {stats.total === 0
                    ? 'Adicione pelo menos uma página pra começar.'
                    : `${stats.total} página${stats.total !== 1 ? 's' : ''} · ${stats.done} gerada${stats.done !== 1 ? 's' : ''}${stats.erred > 0 ? ` · ${stats.erred} com erro` : ''}${stats.pending > 0 ? ` · ${stats.pending} aguardando` : ''}`
                  }
                </p>
              </div>
              <Btn
                variant="outline"
                size="sm"
                onClick={() => setShowAdd(true)}
                disabled={isBusy}
              >
                <Plus className="h-4 w-4" /> Adicionar página
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
                  Clique em "Adicionar página" pra escolher um prompt + foto da galeria do cliente.
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

            {/* ═══ Erro global ═══ */}
            {globalError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-red-700">Atenção</p>
                  <p className="text-xs text-red-600 mt-0.5 break-words">{globalError}</p>
                </div>
              </div>
            )}

            {/* ═══ PDF pronto ═══ */}
            {savedDoc && !buildingPdf && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="h-10 w-10 rounded-lg bg-green-500/15 text-green-700 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-800">PDF gerado e salvo no histórico</p>
                  <p className="text-xs text-green-700 mt-0.5 truncate">{savedDoc.file_name}</p>
                </div>
                <Btn variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-3.5 w-3.5" /> Baixar agora
                </Btn>
              </div>
            )}

            {/* ═══ Barra de ações ═══ */}
            {pages.length > 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap border-t border-gray-100 pt-4">
                {/* Esquerda: limpar */}
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={isBusy}
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Limpar tudo
                </Btn>

                {/* Direita: gerar pendentes + finalizar PDF */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* "Gerar pendentes" só aparece se tiver algum pendente/erro */}
                  {hasPending && (
                    <Btn
                      variant="outline"
                      onClick={handleGenerateBatch}
                      loading={runningBatch}
                      disabled={!canBatch}
                    >
                      <Play className="h-4 w-4" />
                      {runningBatch
                        ? `Gerando…`
                        : `Gerar pendentes (${stats.pending + stats.erred})`}
                    </Btn>
                  )}

                  {/* "Finalizar e Gerar PDF" — ativado assim que qualquer página estiver pronta */}
                  <Btn
                    variant="success"
                    onClick={handleFinalizePdf}
                    loading={buildingPdf}
                    disabled={!canFinalize}
                  >
                    <FileText className="h-4 w-4" />
                    {buildingPdf
                      ? 'Montando PDF…'
                      : `Finalizar e Gerar PDF (${stats.done})`}
                  </Btn>
                </div>
              </div>
            )}

            {/* ═══ Banner de progresso ═══ */}
            {(runningBatch || buildingPdf || generatingId) && (
              <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-fuchsia-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fuchsia-800">
                    {buildingPdf
                      ? 'Montando o PDF final…'
                      : 'Gerando imagem com a OpenAI…'}
                  </p>
                  <p className="text-xs text-fuchsia-700 mt-0.5">
                    {buildingPdf
                      ? 'Baixando imagens e empacotando. Aguarde…'
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

      {/* ═══ Modal: adicionar página ═══ */}
      {showAdd && selectedClient && (
        <AddPageDialog
          clientId={selectedClient.id}
          clientName={selectedClient.full_name}
          onClose={() => setShowAdd(false)}
          onConfirm={handleAdd}
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
  page:              CompositionPage
  index:             number
  total:             number
  isBusy:            boolean
  isThisGenerating:  boolean
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

          {/* Thumbnail: mostra gerada quando done, original caso contrário */}
          <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 group">
            <img
              src={page.status === 'done' && page.generatedImageUrl ? page.generatedImageUrl : page.photoUrl}
              alt={page.photoName}
              loading="lazy"
              className="w-full h-full object-cover"
            />
            {/* Overlay "ver ampliado" quando done */}
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
            {/* Spinner se gerando */}
            {isThisGenerating && (
              <div className="absolute inset-0 bg-fuchsia-900/50 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-white animate-spin" />
              </div>
            )}
          </div>

          {/* Texto */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-gray-900 truncate">{page.promptName}</p>
              {statusBadge[page.status]}
            </div>
            <p className="text-xs text-gray-500 truncate">Foto: {page.photoName}</p>
            {page.status === 'error' && page.errorMsg && (
              <p className="text-xs text-red-600 mt-0.5 break-words line-clamp-2">{page.errorMsg}</p>
            )}
          </div>

          {/* Ações */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Gerar (pending ou error) */}
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

            {/* Reset (error) */}
            {page.status === 'error' && (
              <button
                type="button"
                onClick={onReset}
                disabled={isBusy}
                title="Resetar pra tentar de novo"
                className="p-2 rounded-lg text-amber-600 hover:bg-amber-50 disabled:opacity-30 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Regenerar (done) */}
            {page.status === 'done' && (
              <button
                type="button"
                onClick={onReset}
                disabled={isBusy}
                title="Regenerar (descarta imagem atual)"
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-fuchsia-600 disabled:opacity-30 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onMoveUp}
              disabled={isBusy || index === 0}
              title="Mover para cima"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={isBusy || index === total - 1}
              title="Mover para baixo"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={isBusy}
              title="Remover esta página"
              className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </li>

      {/* ── Modal de preview da imagem gerada ── */}
      {showPreview && page.generatedImageUrl && (
        <div
          className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="relative max-w-2xl w-full"
            onClick={e => e.stopPropagation()}
          >
            <img
              src={page.generatedImageUrl}
              alt={`Imagem gerada — ${page.promptName}`}
              className="w-full h-auto rounded-2xl shadow-2xl"
            />
            <button
              onClick={() => setShowPreview(false)}
              className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="mt-3 text-center text-sm text-white/70">
              {page.promptName} · Foto: {page.photoName}
            </p>
          </div>
        </div>
      )}
    </>
  )
}