// src/components/client/UploadProgressModal.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2, WifiOff, RefreshCw } from 'lucide-react'
import {
  uploadBatch, withRetry, MAX_ATTEMPTS,
  type UploadItem, type UploadItemState,
} from '../../lib/photoUpload'

const pt = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt')
const L = pt
  ? {
      title: 'Enviando suas fotos',
      keepOpen: 'Mantenha esta tela aberta até terminar. Pode demorar um pouco se a internet estiver fraca.',
      sent: (a: number, b: number) => `${a} de ${b} fotos enviadas`,
      finishing: 'Finalizando…',
      offlineTitle: 'Sem conexão com a internet',
      offlineBody: 'Suas fotos estão guardadas aqui. O envio continua sozinho assim que a internet voltar — não precisa fazer nada.',
      slowTitle: 'Conexão instável',
      slowBody: 'Estamos tentando de novo automaticamente. Não feche a página.',
      queued: 'Na fila', prep: 'Preparando…', up: 'Enviando…', done: 'Enviada',
      retrying: (a: number, m: number) => `Tentando de novo (${a}/${m})…`,
      waiting: 'Aguardando internet…',
      errTitle: 'Algumas fotos não foram enviadas',
      errBody: 'Suas fotos continuam aqui. Confira a internet e tente novamente — só as que faltam serão enviadas.',
      finishErr: 'As fotos foram enviadas, mas não conseguimos concluir. Toque para tentar de novo.',
      retry: 'Tentar novamente', close: 'Fechar',
      leave: 'Suas fotos ainda estão sendo enviadas. Sair agora pode interromper o envio.',
    }
  : {
      title: 'Uploading your photos',
      keepOpen: 'Keep this screen open until it finishes. It may take a while on a weak connection.',
      sent: (a: number, b: number) => `${a} of ${b} photos sent`,
      finishing: 'Finishing…',
      offlineTitle: 'No internet connection',
      offlineBody: 'Your photos are kept here. Uploading resumes by itself as soon as you are back online — nothing to do.',
      slowTitle: 'Unstable connection',
      slowBody: 'We are retrying automatically. Please do not close the page.',
      queued: 'Queued', prep: 'Preparing…', up: 'Uploading…', done: 'Sent',
      retrying: (a: number, m: number) => `Retrying (${a}/${m})…`,
      waiting: 'Waiting for internet…',
      errTitle: 'Some photos were not sent',
      errBody: 'Your photos are still here. Check your connection and try again — only the missing ones will be sent.',
      finishErr: 'Photos were sent, but we could not finish. Tap to try again.',
      retry: 'Try again', close: 'Close',
      leave: 'Your photos are still uploading. Leaving now may interrupt the upload.',
    }

function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false)
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false)
    window.addEventListener('online', u); window.addEventListener('offline', d)
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d) }
  }, [])
  return on
}

export type BatchPhase = 'idle' | 'uploading' | 'finishing' | 'error'

export function UploadProgressModal({
  items, states, phase, finishError, onRetry, onClose,
}: {
  items: UploadItem[]
  states: Record<string, UploadItemState>
  phase: BatchPhase
  finishError: boolean
  onRetry: () => void
  onClose: () => void
}) {
  const online = useOnline()
  const previews = useMemo<Record<string, string>>(
    () => Object.fromEntries(items.map(i => [i.id, URL.createObjectURL(i.file)] as [string, string])),
    [items],
  )
  useEffect(() => () => { (Object.values(previews) as string[]).forEach((u: string) => URL.revokeObjectURL(u)) }, [previews])

  const total = items.length
  const doneCount = items.filter(i => states[i.id]?.status === 'done').length
  // Percentual ponderado pelo tamanho do arquivo (barra anda de forma mais fiel).
  const totalBytes = items.reduce((s, i) => s + i.file.size, 0) || 1
  const overall = Math.round(items.reduce((s, i) => s + i.file.size * ((states[i.id]?.percent ?? 0) / 100), 0) / totalBytes * 100)
  const unstable = items.some(i => ['retrying', 'waiting'].includes(states[i.id]?.status ?? ''))
  const failedCount = items.filter(i => states[i.id]?.status === 'error').length
  const showError = phase === 'error'

  const label = (st: UploadItemState) => {
    switch (st.status) {
      case 'done': return L.done
      case 'compressing': return L.prep
      case 'uploading': return `${L.up} ${st.percent}%`
      case 'retrying': return L.retrying(st.attempt ?? 1, st.maxAttempts ?? MAX_ATTEMPTS)
      case 'waiting': return L.waiting
      case 'error': return st.error || ''
      default: return L.queued
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
      role="dialog" aria-modal="true" aria-live="polite"
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[85vh] pb-[env(safe-area-inset-bottom)]">
        {/* Cabeçalho */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-[var(--client-accent)]/10 flex items-center justify-center flex-shrink-0">
              {showError
                ? <AlertCircle className="h-6 w-6 text-red-500" />
                : !online
                  ? <WifiOff className="h-6 w-6 text-amber-500" />
                  : <Loader2 className="h-6 w-6 text-[var(--client-accent)] animate-spin" />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 leading-tight">
                {showError ? L.errTitle : phase === 'finishing' ? L.finishing : L.title}
              </h3>
              <p className="text-sm text-gray-500">{L.sent(doneCount, total)}</p>
            </div>
            <span className="text-2xl font-bold tabular-nums text-[var(--client-accent)]">{overall}%</span>
          </div>

          <div className="h-3 bg-gray-100 rounded-full overflow-hidden mt-4">
            <div
              className={`h-full rounded-full transition-all duration-300 ${showError ? 'bg-red-400' : 'bg-[var(--client-accent)]'} ${!showError && phase !== 'finishing' ? 'animate-pulse' : ''}`}
              style={{ width: `${Math.max(overall, 3)}%` }}
            />
          </div>
        </div>

        {/* Avisos */}
        <div className="px-4 pt-3 space-y-2">
          {!online && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
              <p className="text-sm font-semibold text-amber-800">{L.offlineTitle}</p>
              <p className="text-xs text-amber-700 mt-0.5">{L.offlineBody}</p>
            </div>
          )}
          {online && unstable && !showError && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
              <p className="text-sm font-semibold text-amber-800">{L.slowTitle}</p>
              <p className="text-xs text-amber-700 mt-0.5">{L.slowBody}</p>
            </div>
          )}
          {showError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
              <p className="text-xs text-red-700">{finishError && failedCount === 0 ? L.finishErr : L.errBody}</p>
            </div>
          )}
          {!showError && <p className="text-xs text-gray-500 px-1">{L.keepOpen}</p>}
        </div>

        {/* Lista */}
        <ul className="overflow-y-auto p-3 space-y-2 flex-1 min-h-0">
          {items.map(it => {
            const st = states[it.id] ?? { status: 'queued', percent: 0 }
            const bad = st.status === 'error'
            const warn = st.status === 'retrying' || st.status === 'waiting'
            return (
              <li key={it.id} className="flex items-center gap-3 p-2 rounded-xl bg-gray-50">
                <img src={previews[it.id]} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs truncate ${bad ? 'text-red-600' : warn ? 'text-amber-700' : 'text-gray-700'}`}>
                    {label(st)}
                  </p>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden mt-1.5">
                    <div
                      className={`h-full transition-all duration-200 ${bad ? 'bg-red-500' : warn ? 'bg-amber-400' : st.status === 'done' ? 'bg-green-500' : 'bg-[var(--client-accent)]'}`}
                      style={{ width: `${bad || warn ? 100 : st.percent}%` }}
                    />
                  </div>
                </div>
                <div className="w-6 flex-shrink-0 flex justify-center">
                  {st.status === 'done' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                  {bad && <AlertCircle className="h-5 w-5 text-red-500" />}
                  {(st.status === 'compressing' || st.status === 'uploading') && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                  {warn && <RefreshCw className="h-4 w-4 text-amber-500 animate-spin" />}
                </div>
              </li>
            )
          })}
        </ul>

        {showError && (
          <div className="p-4 border-t border-gray-100 flex gap-2">
            <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-3.5 text-base hover:bg-gray-50 active:bg-gray-100">{L.close}</button>
            <button onClick={onRetry} className="flex-[2] bg-[var(--client-accent)] text-white rounded-xl py-3.5 text-base font-semibold active:opacity-80">{L.retry}</button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Orquestra o lote: upload resiliente, estado por foto, "tentar novamente"
 * só das que faltam, tela ligada (celular) e aviso ao tentar sair da página.
 * `afterSuccess` roda quando TODAS estiverem salvas (também após um retry) e
 * é repetido automaticamente em caso de falha de rede.
 */
export function useBatchUpload(token: string, kind: 'photo' | 'ai_photo' = 'photo') {
  const [items, setItems] = useState<UploadItem[]>([])
  const [states, setStates] = useState<Record<string, UploadItemState>>({})
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<BatchPhase>('idle')
  const [finishError, setFinishError] = useState(false)
  const statesRef = useRef<Record<string, UploadItemState>>({})
  const itemsRef = useRef<UploadItem[]>([])
  const doneRef = useRef<Set<string>>(new Set())   // já salvas — nunca reenviar
  const afterRef = useRef<(() => Promise<void>) | null>(null)
  const busy = phase === 'uploading' || phase === 'finishing'

  // Mantém a tela do celular acesa enquanto envia (senão a aba pausa e o envio morre).
  useEffect(() => {
    if (!busy) return
    let lock: any = null
    const req = async () => { try { lock = await (navigator as any).wakeLock?.request('screen') } catch { /* sem suporte */ } }
    req()
    const onVis = () => { if (document.visibilityState === 'visible') req() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); try { lock?.release() } catch { /* */ } }
  }, [busy])

  // Avisa se tentar fechar/recarregar a página no meio do envio.
  useEffect(() => {
    if (!busy) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = L.leave; return L.leave }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [busy])

  const exec = useCallback(async () => {
    setPhase('uploading')
    setFinishError(false)
    const anyDone = doneRef.current.size > 0
    // Fotos IA: se alguma já subiu, reenvio NÃO pode limpar as anteriores.
    const pending = itemsRef.current
      .filter(i => !doneRef.current.has(i.id))
      .map(i => (anyDone ? { ...i, clearPrevious: false } : i))

    const failed = pending.length === 0 ? [] : await uploadBatch({
      token, kind, items: pending,
      onItem: (id, st) => {
        if (st.status === 'done') doneRef.current.add(id)
        statesRef.current = { ...statesRef.current, [id]: st }
        setStates(statesRef.current)
      },
    })

    if (failed.length > 0) { setPhase('error'); return }

    setPhase('finishing')
    try {
      await withRetry(async () => { await afterRef.current?.() }, 3)
      setPhase('idle')
      setOpen(false)
    } catch {
      setFinishError(true)
      setPhase('error')
    }
  }, [token, kind])

  const run = useCallback(async (list: UploadItem[], afterSuccess: () => Promise<void>) => {
    itemsRef.current = list
    afterRef.current = afterSuccess
    // fotos que já subiram numa tentativa anterior aparecem como concluídas
    const initial: Record<string, UploadItemState> = {}
    for (const i of list) if (doneRef.current.has(i.id)) initial[i.id] = { status: 'done', percent: 100 }
    statesRef.current = initial
    setItems(list)
    setStates(initial)
    setOpen(true)
    await exec()
  }, [exec])

  const modal = open
    ? <UploadProgressModal items={items} states={states} phase={phase} finishError={finishError} onRetry={exec} onClose={() => { setOpen(false); setPhase('idle') }} />
    : null

  return { run, busy, modal }
}