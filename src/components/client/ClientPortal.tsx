// src/components/client/ClientPortal.tsx
import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  Palette, Check, Lock, Clock, CheckCircle, X, Upload, Send,
  Camera, AlertCircle, FileText, ExternalLink, Download,
  ChevronLeft, ChevronRight, Play, Image as ImageIcon,
  CheckCircle2, ArrowRight, Loader2, ChevronDown, ChevronUp,
  Package, Sparkles, ZoomIn, ZoomOut, Mic,
} from 'lucide-react'
import { clientService, ClientPortalData } from '../../lib/services'
import { businessDaysUntil } from '../../lib/deadlineCalculator'
import { supabase } from '../../lib/supabase'
import { driveStorage } from '../../lib/driveStorage'
import { GeminiChat } from './GeminiChat'
import { LanguageProvider, useTranslation, useLanguage } from '../../lib/i18n'
import { getCountryOptions } from '../../lib/i18n/countries'
import { LanguageSwitcher } from './LanguageSwitcher'

// ── Tiny UI ──────────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, className = '',
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-5 py-2.5 text-sm', lg: 'px-6 py-3' }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-xl font-medium transition-all
        disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ── Portal root ──────────────────────────────────────────────────────────────

export function ClientPortal() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ClientPortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setError('invalid-token'); setLoading(false); return }
    clientService.getPortalData(token).then(d => {
      if (!d) setError('invalid-link')
      else setData(d)
      setLoading(false)
    })
  }, [token])

  const reload = async () => {
    if (!token) return
    const d = await clientService.getPortalData(token)
    if (d) setData(d)
  }

  // idioma: prioriza o já salvo pro cliente (data.client.language), senão o
  // padrão do admin (data.admin_default_language) — ambos só existem depois
  // que o portal carrega, então o LanguageProvider fica por fora do
  // loading/error state também, pra já mostrar esses textos no idioma certo
  // assim que possível (localStorage resolve isso mesmo antes do fetch).
  return (
    <LanguageProvider
      persistKey={token}
      initialLanguage={data?.client?.language}
      fallbackLanguage={(data as any)?.admin_default_language}
      onLanguageChange={lang => token && clientService.updateClientLanguage(token, lang)}
    >
      <ClientPortalInner
        token={token}
        data={data}
        loading={loading}
        error={error}
        reload={reload}
      />
    </LanguageProvider>
  )
}

function ClientPortalInner({
  token, data, loading, error, reload,
}: {
  token?: string
  data: ClientPortalData | null
  loading: boolean
  error: string
  reload: () => Promise<void>
}) {
  const { t, language } = useTranslation()

  // Nota: a sincronização de "idioma resolvido -> banco" (pra cliente que
  // nunca clicou no seletor manualmente) agora é feita centralmente dentro
  // do próprio LanguageProvider — ver LanguageContext.tsx. Não precisa de
  // um efeito duplicado aqui.

  if (loading) return (
    <div className="min-h-screen bg-rose-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-rose-500 mx-auto mb-3" />
        <p className="text-rose-600 text-sm">{t('portal.root.loading')}</p>
      </div>
    </div>
  )

  if (error || !data) {
    const errorMessage =
      error === 'invalid-token' ? t('portal.root.invalidTokenError')
      : error === 'invalid-link' ? t('portal.root.invalidLinkError')
      : t('portal.root.invalidLinkFallback')

    return (
      <div className="min-h-screen bg-rose-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm p-8 max-w-sm w-full text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="font-semibold text-gray-900 mb-2">{t('portal.root.accessNotFoundTitle')}</h2>
          <p className="text-sm text-gray-500">{errorMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-rose-100 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-gradient-to-br from-rose-400 to-pink-500 rounded-lg flex items-center justify-center">
              <Palette className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-gray-800">IA Color</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher variant="minimal" />
            <div className="text-right">
              <p className="text-sm font-medium text-gray-800">{data.client.full_name.split(' ')[0]}</p>
              {data.plan && <p className="text-xs text-gray-400">{data.plan.name}</p>}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {data.client.status === 'awaiting_contract' && (
          <ContractStep token={token!} data={data} onDone={reload} />
        )}
        {data.client.status === 'awaiting_form' && (
          <FormAndPhotoFlow token={token!} data={data} onDone={reload} />
        )}
        {data.client.status === 'awaiting_photos' && (
          <PhotoStep token={token!} data={data} onDone={reload} />
        )}
        {data.client.status === 'photos_submitted' && (
          <ReviewScreen />
        )}
        {data.client.status === 'in_analysis' && (
          <AnalysisScreen data={data} />
        )}
        {/* Etapas internas anteriores ao parcial — cliente vê "Análise em andamento". */}
        {['preparing_materials', 'validating_materials', 'sending_dossier'].includes(data.client.status) && (
          <AnalysisScreen data={data} materialsBeingPrepared />
        )}
        {/* AGUARDANDO FOTO IA — etapa condicional. Aqui o resultado parcial
            já foi liberado pela admin e a cliente precisa enviar a foto pra
            simulação. Após enviar, vê tela de "verificando". */}
        {data.client.status === 'awaiting_ai_photo' && (
          <AiPhotoStep token={token!} data={data} onDone={reload} />
        )}
        {/* Etapas internas pós-foto-IA — cliente vê "Simulações em andamento"
            com o parcial liberado. O resultado FINAL só é liberado em
            'completed'. */}
        {['simulating', 'making_capillary_dossier', 'validating_capillary_dossier', 'sending_capillary_dossier'].includes(data.client.status) && (
          !!data.result
            ? <ResultScreen token={token!} data={data} simulatingMode />
            : <AnalysisScreen data={data} materialsBeingPrepared />
        )}
        {data.client.status === 'completed' && (
          <ResultScreen token={token!} data={data} />
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classifica um arquivo de resultado pelo nome (extensão). Usado pra separar
 *  PDFs, áudios e fotos em seções distintas na tela de Resultado. */
function getResultFileKind(fileName: string): 'pdf' | 'audio' | 'image' | 'other' {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['mp3','wav','ogg','webm','m4a','aac','opus','oga','flac','mpga','mpeg'].includes(ext)) return 'audio'
  if (['jpg','jpeg','png','webp','heic','heif','gif','bmp'].includes(ext)) return 'image'
  return 'other'
}

/** Deriva um MIME de áudio específico a partir da extensão do arquivo.
 *  Necessário porque o /audio-proxy às vezes devolve Content-Type genérico
 *  (application/octet-stream) e o Chrome não toca um blob: URL sem um tipo
 *  de mídia reconhecido — o Safari "fareja" os bytes e toca mesmo assim. */
function audioMimeFromName(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'webm':            return 'audio/webm'
    case 'm4a':
    case 'mp4':             return 'audio/mp4'
    case 'aac':             return 'audio/aac'
    case 'mp3':
    case 'mpga':
    case 'mpeg':            return 'audio/mpeg'
    case 'ogg':
    case 'oga':
    case 'opus':            return 'audio/ogg'
    case 'wav':             return 'audio/wav'
    case 'flac':            return 'audio/flac'
    default:                return 'audio/mpeg'
  }
}

// ── Portal Audio Player ───────────────────────────────────────────────────────
//
// Faz fetch do áudio via proxy (Edge Function) e cria um blob: URL local antes
// de passar pro <audio>. Isso contorna dois problemas críticos no mobile:
//
//  1. iOS Safari e Chrome mobile não conseguem reproduzir áudio via URLs de
//     proxy customizadas que não suportam range requests (HTTP 206). A Edge
//     Function responde com 200, o que trava o player nativo no mobile.
//
//  2. Arquivos .webm gravados pelo admin não tocam no Safari em hipótese alguma
//     (o Safari não suporta o codec WebM/Opus). Com blob: URL o browser ainda
//     tenta decodificar, mas ao menos arquivos .m4a gravados no Safari admin
//     chegam com o tipo correto.
//
// Ao fazer fetch aqui e expor um blob: URL, o <audio> lê bytes locais — sem
// restrições de range request nem de CORS — e funciona em qualquer browser.

function PortalAudioPlayer({ audioSrc, fileName, className }: { audioSrc: string; fileName?: string; className?: string }) {
  const { t } = useTranslation()
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState(false)

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    ;(async () => {
      try {
        const res = await fetch(audioSrc)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const raw = await res.blob()
        if (cancelled) return
        // Reembrulha os bytes forçando um MIME de áudio derivado da extensão.
        // Sem isso, quando o proxy devolve Content-Type genérico, o Chrome se
        // recusa a tocar o blob: URL (erro de decode); o Safari toca mesmo assim.
        const mime = fileName ? audioMimeFromName(fileName) : (raw.type || 'audio/mpeg')
        const typed = raw.type === mime ? raw : new Blob([raw], { type: mime })
        created = URL.createObjectURL(typed)
        setBlobUrl(created)
      } catch {
        if (!cancelled) setLoadErr(true)
      }
    })()
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [audioSrc, fileName])

  if (loadErr) return (
    <p className="text-xs text-red-400 py-2 flex items-center gap-1.5">
      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {t('portal.result.audioLoadError')}
    </p>
  )
  if (!blobUrl) return (
    <div className="flex items-center gap-2 py-2">
      <div className="animate-spin h-3.5 w-3.5 border-2 border-violet-300 border-t-transparent rounded-full flex-shrink-0" />
      <span className="text-xs text-violet-400">{t('portal.result.audioLoading')}</span>
    </div>
  )
  return (
    <audio
      src={blobUrl}
      controls
      preload="none"
      className={className ?? 'w-full rounded-xl'}
      style={{ colorScheme: 'light' }}
    />
  )
}

// ── Step Header ──────────────────────────────────────────────────────────────

function StepHeader({ current, total, label }: { current: number; total: number; label: string }) {
  const { t } = useTranslation()
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-900">{label}</span>
        <span className="text-xs text-gray-400">{t('portal.common.stepOf', { current: String(current), total: String(total) })}</span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < current ? 'bg-rose-400' : i === current - 1 ? 'bg-rose-300' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// ── Step 1: Contract ─────────────────────────────────────────────────────────

function ContractStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const { t, language } = useTranslation()
  const countryOptions = React.useMemo(() => getCountryOptions(language), [language])

  const [read, setRead] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [signing, setSigning] = useState(false)
  const [countryCode, setCountryCode] = useState(countryOptions[0]?.code || 'BR')
  const [clientIp, setClientIp] = useState<string>(t('portal.contract.fetchingIp'))
  const [signTime] = useState(() => new Date())
  const [scrollProgress, setScrollProgress] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Busca o IP real do cliente ao montar o componente
  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => setClientIp(d.ip || t('portal.contract.ipUnavailable')))
      .catch(() => setClientIp(t('portal.contract.ipUnavailable')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Verifica se o contrato é curto o suficiente para não precisar de scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Se não há scroll (conteúdo cabe na área), marca como lido automaticamente
    if (el.scrollHeight <= el.clientHeight + 10) {
      setRead(true)
      setScrollProgress(100)
    }
  }, [data.contract])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const total = el.scrollHeight - el.clientHeight
    if (total <= 0) { setRead(true); setScrollProgress(100); return }
    const pct = Math.round((el.scrollTop / total) * 100)
    setScrollProgress(pct)
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) setRead(true)
  }

  // Guardamos o NOME do país (não o código) no cadastro do cliente e no PDF
  // do contrato — mesmo formato que já era usado antes, só que agora o nome
  // é resolvido no idioma que a cliente está usando no momento da assinatura.
  const countryName = countryOptions.find(c => c.code === countryCode)?.name || countryCode

  const handleSign = async () => {
    if (!agreed) return
    setSigning(true)
    try {
      await clientService.signContract(token, {
        country: countryName,
        ip: clientIp,
        signedAt: new Date().toISOString(),
      })
      onDone()
    } catch (e: any) { alert(e.message) } finally { setSigning(false) }
  }

  const contract = data.contract

  const formattedDate = signTime.toLocaleDateString(language, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
  const formattedTime = signTime.toLocaleTimeString(language, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <div className="space-y-4">
      <StepHeader current={1} total={3} label={t('portal.contract.stepLabel')} />

      {/* ── Banner de metadados (IP / Data / Hora) ── */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 space-y-1.5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {t('portal.contract.accessLog')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs text-gray-700">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
            <span><strong>{t('portal.contract.ip')}:</strong> {clientIp}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
            <span><strong>{t('portal.contract.date')}:</strong> {formattedDate}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
            <span><strong>{t('portal.contract.time')}:</strong> {formattedTime}</span>
          </span>
        </div>
        <p className="text-[10px] text-gray-400 pt-0.5">
          {t('portal.contract.recordNote')}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header com barra de progresso de leitura */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-900">{t('portal.contract.readContract')}</h2>
            {!read && (
              <span className="text-xs font-bold text-amber-700 bg-amber-100 border border-amber-300 px-2.5 py-1 rounded-full">
                {t('portal.contract.percentRead', { percent: scrollProgress })}
              </span>
            )}
            {read && (
              <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Check className="h-3 w-3" /> {t('portal.contract.readDone')}
              </span>
            )}
          </div>
          {/* Barra de progresso de leitura — mais alta pra ficar visível */}
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${read ? 'bg-green-400' : 'bg-amber-400'}`}
              style={{ width: `${scrollProgress}%` }}
            />
          </div>
          {/* Aviso prominente — só aparece enquanto não terminou de ler */}
          {!read && (
            <div className="mt-3 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-900 leading-snug">
                <span className="font-semibold">{t('portal.contract.scrollWarningBold')}</span> {t('portal.contract.scrollWarningRest')}
              </p>
            </div>
          )}
        </div>

        {/* Área de conteúdo do contrato */}
        <div className="relative">
          <div
            ref={scrollRef}
            className="px-4 sm:px-6 py-4 sm:py-5 max-h-72 overflow-y-auto text-sm text-gray-700 space-y-4 leading-relaxed"
            onScroll={handleScroll}
          >
            <h3 className="font-bold text-base text-gray-800">{contract?.title || t('portal.contract.defaultTitle')}</h3>
            {contract?.sections?.length === 0 && (
              <p className="text-gray-400 text-center py-8">{t('portal.contract.noClauses')}</p>
            )}
            {contract?.sections?.map(s => (
              <div key={s.id}>
                <h4 className="font-semibold text-gray-800 mb-1.5">{s.title}</h4>
                <p className="whitespace-pre-wrap">{s.content}</p>
              </div>
            ))}
          </div>

          {/* Overlay gradiente quando não leu até o final */}
          {!read && scrollProgress < 80 && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
          )}
        </div>

        {/* Indicador de "continue rolando" flutuante */}
        {!read && (
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-50 border-t border-amber-100">
            <div className="flex flex-col items-center animate-bounce">
              <ChevronDown className="h-3.5 w-3.5 text-amber-500" />
              <ChevronDown className="h-3.5 w-3.5 text-amber-300 -mt-2" />
            </div>
            <p className="text-xs font-semibold text-amber-700">
              {t('portal.contract.continueScrolling')}
            </p>
            <div className="flex flex-col items-center animate-bounce">
              <ChevronDown className="h-3.5 w-3.5 text-amber-500" />
              <ChevronDown className="h-3.5 w-3.5 text-amber-300 -mt-2" />
            </div>
          </div>
        )}

        <div className="px-4 sm:px-6 py-4 sm:py-5 border-t border-gray-100 space-y-4">
          {/* Campo de País */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('portal.contract.countryLabel')}
            </label>
            <select
              value={countryCode}
              onChange={e => setCountryCode(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent bg-white"
            >
              {countryOptions.map(c => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Checkbox — bloqueado até ler */}
          <label className={`flex items-start gap-2.5 ${read ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => read && setAgreed(e.target.checked)}
              disabled={!read}
              className="mt-0.5 w-4 h-4 accent-rose-500"
            />
            <span className="text-sm text-gray-700">{t('portal.contract.agreeLabel')}</span>
          </label>

          {/* Botão de assinar — estado visual claro */}
          {!read ? (
            <div className="w-full flex flex-col items-center justify-center gap-1 py-3.5 rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-800 cursor-not-allowed select-none">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                <span className="font-semibold text-sm">{t('portal.contract.lockedTitle')}</span>
              </div>
              <p className="text-xs text-amber-700">
                {t('portal.contract.lockedNote', { percent: scrollProgress })}
              </p>
            </div>
          ) : (
            <Btn onClick={handleSign} disabled={!agreed} loading={signing} className="w-full">
              <Check className="h-4 w-4" /> {t('portal.contract.signButton')}
            </Btn>
          )}

          {read && !agreed && (
            <p className="text-xs text-gray-400 text-center">
              {t('portal.contract.confirmNote')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── NOVO: Fluxo combinado Form + Photos quando ambos são rejeitados ─────────

function FormAndPhotoFlow({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const { t } = useTranslation()
  const hasFormRejection   = !!data.client.form_rejection_reason
  const hasPhotosRejection = !!data.client.photos_rejection_reason
  const hasExistingPhotos  = (data.photos || []).length > 0

  // Mostra abas quando:
  // 1. Já há fotos (cliente precisa ver/gerenciar)
  // 2. OU o formulário foi rejeitado (cliente já estava além desta etapa e
  //    pode precisar adicionar/editar fotos mesmo que ainda não apareçam)
  const showTabLayout = hasExistingPhotos || hasFormRejection

  const [activeTab, setActiveTab] = useState<'form' | 'photos'>('form')

  if (!showTabLayout) {
    // Primeira vez, sem rejeição → apenas o formulário
    return <FormStep token={token} data={data} onDone={onDone} />
  }

  // Tem fotos → formulário + aba de fotos editável
  // submitForm já move para photos_submitted quando há fotos (ver services.ts)
  // então ao confirmar o form chamamos onDone direto
  return (
    <div className="space-y-4">
      <StepHeader current={2} total={3} label={hasFormRejection ? t('portal.formPhotoFlow.adjustmentsTitle') : t('portal.form.stepLabel')} />

      {(hasFormRejection || hasPhotosRejection) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <div className="flex gap-3 items-start">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">{t('portal.formPhotoFlow.adjustmentsRequested')}</p>
              <p className="text-sm text-amber-700 mt-0.5">
                {hasFormRejection && hasPhotosRejection
                  ? t('portal.formPhotoFlow.adjustmentsBoth')
                  : hasFormRejection
                    ? data.client.form_rejection_reason
                    : data.client.photos_rejection_reason}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('form')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'form'
                ? 'text-rose-600 border-b-2 border-rose-500 bg-rose-50/40'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <FileText className="h-4 w-4" />
              {t('portal.formPhotoFlow.formTab')}
              {hasFormRejection && <div className="w-2 h-2 bg-amber-400 rounded-full" />}
            </div>
          </button>
          <button
            onClick={() => setActiveTab('photos')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'photos'
                ? 'text-rose-600 border-b-2 border-rose-500 bg-rose-50/40'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Camera className="h-4 w-4" />
              {t('portal.formPhotoFlow.photosTab')}
              {hasPhotosRejection && <div className="w-2 h-2 bg-amber-400 rounded-full" />}
            </div>
          </button>
        </div>

        {activeTab === 'form' ? (
          <FormStepContent token={token} data={data} onDone={onDone} />
        ) : (
          <PhotoStepContent
            token={token}
            data={data}
            onDone={onDone}
            showBackButton
            onBack={() => setActiveTab('form')}
          />
        )}
      </div>
    </div>
  )
}

// ── Step 2: Form (conteúdo reutilizável) ─────────────────────────────────────

function FormStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <StepHeader current={2} total={3} label={t('portal.form.stepLabel')} />

      {data.client.form_rejection_reason && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-3 items-start">
          <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">{t('portal.form.adjustmentRequested')}</p>
            <p className="text-sm text-amber-700 mt-0.5">{data.client.form_rejection_reason}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <FormStepContent token={token} data={data} onDone={onDone} />
      </div>
    </div>
  )
}

function FormStepContent({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const { t } = useTranslation()
  const form = data.form
  const fields = form?.fields || []
  const savedData = data.form_submission?.form_data || {}
  const [formData, setFormData] = useState<Record<string, any>>(savedData)
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (id: string, value: any) => setFormData({ ...formData, [id]: value })

  const handleSubmit = async () => {
    const missing = fields.filter(f => {
      if (!f.required) return false
      if (f.type === 'image') return !(Array.isArray(formData[f.id]) && formData[f.id].length > 0)
      return !formData[f.id]
    }).map(f => f.label)

    // Valida campos de observação condicional obrigatórios
    fields.forEach(f => {
      if (
        (f as any).conditionalTrigger &&
        (f as any).conditionalRequired &&
        formData[f.id] === (f as any).conditionalTrigger &&
        !String(formData[`${f.id}__obs`] || '').trim()
      ) {
        missing.push((f as any).conditionalLabel || t('portal.form.observationLabel'))
      }
    })

    if (missing.length > 0) {
      alert(t('portal.form.missingFieldsAlert', { list: missing.join('\n• ') }))
      return
    }
    setSubmitting(true)
    try {
      await clientService.submitForm(token, formData)
      onDone()
    } catch (e: any) { alert(e.message) } finally { setSubmitting(false) }
  }

  return (
    <>
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">{form?.title || t('portal.form.defaultTitle')}</h2>
        {form?.description && <p className="text-sm text-gray-500 mt-0.5">{form.description}</p>}
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">
        {fields.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">{t('portal.form.noFields')}</p>
        ) : (
          fields.map(f => (
            <div key={f.id}>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {f.label} {f.required && <span className="text-red-500">*</span>}
              </label>
              {f.type === 'text' && (
                <input value={formData[f.id] || ''} onChange={e => handleChange(f.id, e.target.value)} placeholder={f.placeholder} className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
              )}
              {f.type === 'textarea' && (
                <textarea value={formData[f.id] || ''} onChange={e => handleChange(f.id, e.target.value)} placeholder={f.placeholder} rows={4} className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
              )}
              {f.type === 'select' && (
                <select value={formData[f.id] || ''} onChange={e => handleChange(f.id, e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-400">
                  <option value="">{t('portal.form.selectPlaceholder')}</option>
                  {(f.options || []).map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
                </select>
              )}
              {f.type === 'radio' && (
                <div className="space-y-2">
                  {(f.options || []).map((opt, i) => (
                    <label key={i} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name={f.id} value={opt} checked={formData[f.id] === opt} onChange={e => handleChange(f.id, e.target.value)} className="w-4 h-4 accent-rose-500" />
                      <span className="text-sm text-gray-700">{opt}</span>
                    </label>
                  ))}
                  {/* Campo condicional de observação */}
                  {(f as any).conditionalTrigger && formData[f.id] === (f as any).conditionalTrigger && (
                    <div className="mt-2 pl-5 border-l-2 border-rose-300">
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        {(f as any).conditionalLabel || t('portal.form.observationLabel')}
                        {(f as any).conditionalRequired && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      <textarea
                        value={formData[`${f.id}__obs`] || ''}
                        onChange={e => handleChange(`${f.id}__obs`, e.target.value)}
                        placeholder={t('portal.form.observationPlaceholder')}
                        rows={3}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
                      />
                    </div>
                  )}
                </div>
              )}
              {f.type === 'checkbox' && (
                <div className="space-y-2">
                  {(f.options || []).map((opt, i) => (
                    <label key={i} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={(formData[f.id] || []).includes(opt)} onChange={e => {
                        const arr = formData[f.id] || []
                        handleChange(f.id, e.target.checked ? [...arr, opt] : arr.filter((x: string) => x !== opt))
                      }} className="w-4 h-4 accent-rose-500" />
                      <span className="text-sm text-gray-700">{opt}</span>
                    </label>
                  ))}
                </div>
              )}
              {f.type === 'image' && (
                <ImageUploadFormField
                  field={f}
                  token={token}
                  clientId={data.client.id}
                  value={formData[f.id] || []}
                  onChange={imgs => handleChange(f.id, imgs)}
                />
              )}
            </div>
          ))
        )}
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 border-t border-gray-100">
        <Btn onClick={handleSubmit} loading={submitting} className="w-full">
          <Send className="h-4 w-4" /> {t('portal.form.submit')}
        </Btn>
      </div>
    </>
  )
}

// ── Image upload field (inside form) ────────────────────────────────────────

interface FormImage {
  storagePath: string
  url: string
}

function ImageUploadFormField({
  field,
  token,
  clientId,
  value,
  onChange,
}: {
  field: any
  token: string
  clientId: string
  value: FormImage[]
  onChange: (imgs: FormImage[]) => void
}) {
  const { t } = useTranslation()
  const maxImages: number = field.maxImages ?? 1
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const isFull = value.length >= maxImages

  const handleAdd = async (files: FileList | null) => {
    if (!files) return
    const toAdd = Array.from(files).slice(0, maxImages - value.length)
    if (toAdd.length === 0) {
      setError(t('portal.imageUpload.limitReached', { count: maxImages, max: maxImages }))
      return
    }
    setError('')
    setUploading(true)
    try {
      const uploaded: FormImage[] = []
      for (const file of toAdd) {
        const processed = await processImage(file)
        // Upload via Edge Function drive/upload → arquivo vai pro Drive da admin
        const result = await driveStorage.uploadPhoto({
          portalToken: token,
          file: processed,
          categoryId: null,
          kind: 'form_image',
        })
        // Reaproveitamos `storagePath` pra guardar o drive_file_id
        // (mantém o tipo intacto e o resto do código continua funcionando)
        uploaded.push({ storagePath: result.driveFileId, url: result.url })
      }
      onChange([...value, ...uploaded])
    } catch (e: any) {
      setError(t('portal.imageUpload.uploadError', { error: e.message }))
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async (idx: number) => {
    const img = value[idx]
    setRemoving(s => new Set([...s, img.storagePath]))
    // Drive: o cleanup automático apaga junto com a pasta do cliente em 21d
    //        (após análise entregue). Não removemos imediatamente do Drive.
    // Legado: se o storagePath é caminho do bucket antigo (contém '/'), remove
    if (img.storagePath.includes('/')) {
      try { await supabase.storage.from('client-photos').remove([img.storagePath]) } catch {}
    }
    onChange(value.filter((_, i) => i !== idx))
    setRemoving(s => { const n = new Set(s); n.delete(img.storagePath); return n })
  }

  return (
    <div className="space-y-3">
      {field.imageInstructions && (
        <p className="text-xs text-gray-500 leading-relaxed">{field.imageInstructions}</p>
      )}

      {/* Grid of already-uploaded images + add-more slot */}
      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {value.map((img, idx) => (
            <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
              <img src={img.url} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => handleRemove(idx)}
                disabled={removing.has(img.storagePath)}
                className="absolute top-1 right-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-sm transition-colors disabled:opacity-50"
              >
                {removing.has(img.storagePath)
                  ? <div className="animate-spin h-3 w-3 border border-white border-t-transparent rounded-full" />
                  : <X className="h-3 w-3" />}
              </button>
            </div>
          ))}

          {/* Slot para adicionar mais fotos */}
          {!isFull && !uploading && (
            <label className="aspect-square rounded-xl border-2 border-dashed border-gray-200 hover:border-rose-300 hover:bg-rose-50/40 flex flex-col items-center justify-center cursor-pointer transition-colors gap-1">
              <input
                type="file" multiple accept="image/*,image/heic,image/heif" className="hidden"
                onChange={e => handleAdd(e.target.files)}
              />
              <Camera className="h-5 w-5 text-gray-300" />
              <span className="text-[10px] text-gray-400">
                {t('portal.imageUpload.remaining', { count: maxImages - value.length })}
              </span>
            </label>
          )}

          {/* Spinner inline quando está enviando e já tem fotos */}
          {uploading && (
            <div className="aspect-square rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/60 flex items-center justify-center">
              <div className="animate-spin h-5 w-5 border-2 border-rose-300 border-t-transparent rounded-full" />
            </div>
          )}
        </div>
      )}

      {/* Drop zone — só aparece quando não há nenhuma foto ainda */}
      {value.length === 0 && (
        <label className={`block rounded-2xl cursor-pointer transition-all ${
          uploading
            ? 'bg-rose-50/60 border-2 border-rose-200 pointer-events-none'
            : 'border-2 border-dashed border-gray-200 hover:border-rose-300 hover:bg-rose-50/40 active:scale-[0.99]'
        }`}>
          <input
            type="file" multiple accept="image/*,image/heic,image/heif" className="hidden"
            onChange={e => handleAdd(e.target.files)} disabled={uploading}
          />
          <div className="px-6 py-8 text-center">
            {uploading ? (
              <div className="animate-spin h-8 w-8 border-2 border-rose-300 border-t-transparent rounded-full mx-auto" />
            ) : (
              <>
                <div className="w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-2">
                  <Camera className="h-5 w-5 text-rose-400" />
                </div>
                <p className="text-sm font-medium text-gray-700 mb-0.5">{t('portal.imageUpload.tapToAddPhotos')}</p>
                <p className="text-xs text-gray-400">
                  {t('portal.imageUpload.formatsHint', { count: maxImages, max: maxImages })}
                </p>
              </>
            )}
          </div>
        </label>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {value.length > 0 && (
        <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2 border border-green-100">
          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
          <p className="text-sm text-green-700">
            {t('portal.imageUpload.photosAdded', { count: value.length })}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Photos ───────────────────────────────────────────────────────────

interface InstructionItem {
  id: string
  type: 'text' | 'video' | 'image' | 'pdf' | 'link'
  content: string
  imageUrl?: string
  storagePath?: string
  fileName?: string
  linkLabel?: string
}

interface PhotoCategory {
  id: string
  title: string
  description?: string
  max_photos: number
  instruction_items?: InstructionItem[]
  is_ai_simulation?: boolean
  // legacy fields
  video_url?: string
  instructions?: string[]
}

interface ExistingPhoto {
  id: string
  url: string
  photo_name: string
  category_id: string | null
}

/** Normalise legacy video_url + instructions[] to unified InstructionItem[] */
function normalizeInstructions(cat: PhotoCategory): InstructionItem[] {
  if (cat.instruction_items && cat.instruction_items.length > 0) return cat.instruction_items
  const result: InstructionItem[] = []
  if (cat.video_url) result.push({ id: 'v0', type: 'video', content: cat.video_url })
  if (cat.instructions) {
    cat.instructions.forEach((text, i) => {
      if (text?.trim()) result.push({ id: `t${i}`, type: 'text', content: text })
    })
  }
  return result
}

function getYouTubeEmbed(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|watch\?v=|embed\/)([^#&?]{11})/)
  return match ? `https://www.youtube.com/embed/${match[1]}?rel=0&modestbranding=1` : null
}

async function processImage(file: File): Promise<File> {
  const MAX = 8 * 1024 * 1024
  if (file.size < MAX) return file
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const max = 3000
        let { width, height } = img
        if (width > max || height > max) {
          if (width > height) { height = (height / width) * max; width = max }
          else { width = (width / height) * max; height = max }
        }
        canvas.width = width; canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          blob => blob
            ? resolve(new File([blob], file.name, { type: 'image/jpeg' }))
            : reject(new Error('Erro ao processar imagem')),
          'image/jpeg', 0.85,
        )
      }
      img.onerror = reject
      img.src = e.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── PDF instruction (visualizador + tela cheia) ──────────────────────────────

function PdfInstruction({ item }: { item: InstructionItem }) {
  const { t } = useTranslation()
  const [fullscreen, setFullscreen] = useState(false)
  const src = item.imageUrl || item.content
  if (!src) return null
  const label = item.fileName || 'PDF'
  // Google Docs Viewer: renderiza o PDF AJUSTADO À LARGURA, inclusive no mobile
  // (o visualizador nativo via <object> não ajusta o tamanho no celular).
  // Requer URL pública — PDFs enviados ficam em bucket público; links colados
  // precisam ser de acesso público.
  const viewerUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(src)}`

  return (
    <>
      <div className="rounded-xl overflow-hidden border border-rose-200 shadow-sm bg-white">
        <div className="flex items-center gap-2 px-3 py-2.5 bg-gradient-to-r from-rose-500 to-pink-500">
          <FileText className="h-4 w-4 text-white flex-shrink-0" />
          <span className="text-sm font-semibold text-white flex-1 truncate">{label}</span>
        </div>

        {/* Prévia clicável */}
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="relative w-full block group"
          title={t('portal.pdfInstruction.openFullscreen')}
        >
          <iframe src={viewerUrl} className="w-full pointer-events-none bg-gray-50" style={{ height: 260 }} title={label} />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-end justify-center pb-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/95 rounded-full shadow text-xs font-medium text-rose-700">
              <ZoomIn className="h-3.5 w-3.5" /> {t('portal.pdfInstruction.tapToEnlarge')}
            </span>
          </div>
        </button>

        {/* Ações claras */}
        <div className="flex items-stretch border-t border-rose-100">
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-rose-700 hover:bg-rose-50 transition-colors"
          >
            <ZoomIn className="h-4 w-4" /> {t('portal.pdfInstruction.viewFullscreen')}
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors border-l border-rose-100"
          >
            <Download className="h-4 w-4" /> {t('portal.pdfInstruction.downloadOpen')}
          </a>
        </div>
      </div>

      {/* Modal tela cheia */}
      {fullscreen && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col" onClick={() => setFullscreen(false)}>
          <div className="flex items-center justify-between px-4 py-3 bg-white shadow" onClick={e => e.stopPropagation()}>
            <span className="text-sm font-semibold text-gray-800 flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-rose-500 flex-shrink-0" />
              <span className="truncate">{label}</span>
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 px-2 py-1">
                <ExternalLink className="h-3.5 w-3.5" /> {t('portal.common.open')}
              </a>
              <button onClick={() => setFullscreen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden bg-gray-100" onClick={e => e.stopPropagation()}>
            <iframe src={viewerUrl} className="w-full h-full" title={label} />
          </div>
        </div>
      )}
    </>
  )
}

// ── Media item (video or image instruction) ──────────────────────────────────

function MediaItem({ item }: { item: InstructionItem }) {
  const { t } = useTranslation()
  const embedUrl = item.type === 'video' ? getYouTubeEmbed(item.content) : null

  if (item.type === 'video' && embedUrl) {
    return (
      <div className="rounded-xl overflow-hidden border border-rose-100 shadow-sm bg-black" style={{ aspectRatio: '16/9' }}>
        <iframe
          src={embedUrl}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title={t('portal.instructions.videoTitle')}
        />
      </div>
    )
  }

  if (item.type === 'image') {
    const src = item.imageUrl || item.content
    if (!src) return null
    return (
      <div className="rounded-xl overflow-hidden border border-rose-100 shadow-sm">
        <img src={src} alt={t('portal.instructions.imageAlt')} className="w-full object-contain max-h-80 bg-gray-50" />
      </div>
    )
  }

  if (item.type === 'pdf') {
    return <PdfInstruction item={item} />
  }

  if (item.type === 'link') {
    if (!item.content) return null
    return (
      <a href={item.content} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors">
        <ExternalLink className="h-4 w-4 text-emerald-600 flex-shrink-0" />
        <span className="text-sm font-medium text-emerald-700 flex-1 truncate">{item.linkLabel || item.content}</span>
        <ArrowRight className="h-4 w-4 text-emerald-500 flex-shrink-0" />
      </a>
    )
  }

  return null
}

// ── Instructions panel (collapsible) ────────────────────────────────────────

function InstructionsPanel({ items, defaultOpen = true }: { items: InstructionItem[]; defaultOpen?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)

  const mediaItems = items.filter(i => i.type !== 'text')
  const textItems  = items.filter(i => i.type === 'text')

  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-rose-100 bg-rose-50/50 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-rose-50/80 transition-colors"
      >
        <span className="text-xs font-semibold text-rose-700 uppercase tracking-wide flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" />
          {t('portal.instructions.panelTitle')}
        </span>
        {open
          ? <ChevronUp className="h-4 w-4 text-rose-400 flex-shrink-0" />
          : <ChevronDown className="h-4 w-4 text-rose-400 flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {mediaItems.map(item => <MediaItem key={item.id} item={item} />)}

          {textItems.length > 0 && (
            <ol className="space-y-2.5">
              {textItems.map((item, i) => (
                <li key={item.id} className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center text-[10px] font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{item.content}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

// ── Category card ────────────────────────────────────────────────────────────

interface CategoryCardProps {
  cat: PhotoCategory
  index: number
  uploads: File[]
  existingPhotos: ExistingPhoto[]
  processing: boolean
  error: string
  onAdd: (files: File[]) => void
  onRemove: (idx: number) => void
  onRemoveExisting: (photoId: string) => void
  removingExisting: Set<string>
}

function CategoryCard({ cat, index, uploads, existingPhotos, processing, error, onAdd, onRemove, onRemoveExisting, removingExisting }: CategoryCardProps) {
  const { t } = useTranslation()
  const instructions = normalizeInstructions(cat)
  const totalCount = existingPhotos.length + uploads.length
  const isFull = totalCount >= cat.max_photos
  const isDone = totalCount > 0

  return (
    <div
      id={`photo-cat-${cat.id}`}
      className={`rounded-2xl border shadow-sm overflow-hidden transition-colors ${
        isDone ? 'border-green-200 bg-green-50/20' : 'border-gray-200 bg-white'
      }`}
    >
      {/* Header */}
      <div className={`px-4 sm:px-5 py-4 border-b ${isDone ? 'border-green-100 bg-green-50/40' : 'border-gray-100'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 ${
                isDone
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-600'
              }`}>
                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <h3 className="font-semibold text-gray-900">{cat.title}</h3>
            </div>
            {cat.description && <p className="text-xs text-gray-500 ml-8">{cat.description}</p>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs font-medium text-gray-500">
              {t('portal.categoryCard.photoCountOf', { count: cat.max_photos, current: totalCount, max: cat.max_photos })}
            </p>
          </div>
        </div>
      </div>

      {/* Instructions */}
      {instructions.length > 0 && (
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
          <InstructionsPanel items={instructions} defaultOpen={!isDone} />
        </div>
      )}

      {/* Photo grid */}
      <div className="px-4 sm:px-5 py-4 space-y-3">
        {(existingPhotos.length > 0 || uploads.length > 0) && (
          <div className="grid grid-cols-3 gap-2">
            {/* Existing photos */}
            {existingPhotos.map(photo => (
              <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img src={photo.url} alt={photo.photo_name} className="w-full h-full object-cover" />
                <button
                  onClick={() => onRemoveExisting(photo.id)}
                  disabled={removingExisting.has(photo.id)}
                  className="absolute top-1 right-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-sm transition-colors disabled:opacity-50"
                >
                  {removingExisting.has(photo.id) ? (
                    <div className="animate-spin h-3 w-3 border border-white border-t-transparent rounded-full" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>
              </div>
            ))}

            {/* New uploads */}
            {uploads.map((file, idx) => {
              const url = URL.createObjectURL(file)
              return (
                <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border-2 border-rose-300 bg-rose-50">
                  <img src={url} alt={file.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => onRemove(idx)}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-sm transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <div className="absolute bottom-1 left-1 bg-rose-500 text-white text-[9px] px-1.5 py-0.5 rounded font-medium">
                    {t('portal.categoryCard.newBadge')}
                  </div>
                </div>
              )
            })}

            {/* Add-more slot inline with photos */}
            {!isFull && !processing && (
              <label className="aspect-square rounded-xl border-2 border-dashed border-gray-200 hover:border-rose-300
                hover:bg-rose-50/40 flex flex-col items-center justify-center cursor-pointer transition-colors gap-1">
                <input
                  type="file" multiple accept="image/*,image/heic,image/heif" className="hidden"
                  onChange={e => e.target.files && onAdd(Array.from(e.target.files))}
                />
                <Camera className="h-5 w-5 text-gray-300" />
                <span className="text-[10px] text-gray-400">
                  {t('portal.imageUpload.remaining', { count: cat.max_photos - totalCount })}
                </span>
              </label>
            )}
          </div>
        )}

        {/* Drop zone — only when no photos yet (neither existing nor new) */}
        {existingPhotos.length === 0 && uploads.length === 0 && (
          <label className={`block relative rounded-2xl cursor-pointer transition-all ${
            processing
              ? 'bg-rose-50/60 border-2 border-rose-200 pointer-events-none'
              : 'border-2 border-dashed border-gray-200 hover:border-rose-300 hover:bg-rose-50/40 active:scale-[0.99]'
          }`}>
            <input type="file" multiple accept="image/*,image/heic,image/heif" className="hidden" onChange={e => e.target.files && onAdd(Array.from(e.target.files))} disabled={processing} />
            <div className="px-6 py-10 text-center">
              {processing ? (
                <div className="animate-spin h-8 w-8 border-3 border-rose-300 border-t-transparent rounded-full mx-auto" />
              ) : (
                <>
                  <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Camera className="h-6 w-6 text-rose-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-0.5">
                      {t('portal.imageUpload.tapToAddPhotos')}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t('portal.imageUpload.formatsHint', { count: cat.max_photos, max: cat.max_photos })}
                    </p>
                  </div>
                </>
              )}
            </div>
          </label>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Done confirmation */}
        {isDone && (
          <div className="flex items-center gap-2 bg-green-50 rounded-xl px-4 py-2.5 border border-green-100">
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            <p className="text-sm text-green-700 font-medium">
              {t('portal.imageUpload.photosAdded', { count: totalCount })}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── PhotoStep ────────────────────────────────────────────────────────────────

function PhotoStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <StepHeader current={3} total={3} label={t('portal.photoStep.stepLabel')} />

      {data.client.photos_rejection_reason && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-3 items-start">
          <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">{t('portal.photoStep.adjustmentRequested')}</p>
            <p className="text-sm text-amber-700 mt-0.5">{data.client.photos_rejection_reason}</p>
          </div>
        </div>
      )}

      <PhotoStepContent token={token} data={data} onDone={onDone} />
    </div>
  )
}

function PhotoStepContent({ 
  token, 
  data, 
  onDone, 
  showBackButton = false, 
  onBack 
}: { 
  token: string
  data: ClientPortalData
  onDone: () => void
  showBackButton?: boolean
  onBack?: () => void
}) {
  const { t } = useTranslation()
  // Filtra a categoria de Foto IA — ela é enviada em outra etapa do fluxo
  // (status 'awaiting_ai_photo'), pelo componente AiPhotoStep. Não deve
  // aparecer junto das fotos iniciais.
  const categories: PhotoCategory[] = (data.photo_categories || []).filter(c => !c.is_ai_simulation)
  const [uploads, setUploads]       = useState<Record<string, File[]>>({})
  const [existingByCat, setExistingByCat] = useState<Record<string, ExistingPhoto[]>>({})
  const [removingExisting, setRemovingExisting] = useState<Set<string>>(new Set())
  const [processing, setProcessing] = useState<Record<string, boolean>>({})
  const [finalizing, setFinalizing] = useState(false)
  const [errors, setErrors]         = useState<Record<string, string>>({})

  // Load existing photos from portal data (populated after rejection)
  useEffect(() => {
    const byCat: Record<string, ExistingPhoto[]> = {}
    for (const p of (data.photos || [])) {
      if (!p.url) continue
      const catId = p.category_id || '__none__'
      if (!byCat[catId]) byCat[catId] = []
      byCat[catId].push({ id: p.id, url: p.url, photo_name: p.photo_name, category_id: p.category_id })
    }
    setExistingByCat(byCat)
  }, [data.photos])

  const addFiles = async (catId: string, files: File[], maxPhotos: number) => {
    const currentExisting = (existingByCat[catId] || []).length
    const current   = uploads[catId] || []
    const remaining = maxPhotos - currentExisting - current.length
    const toAdd     = Array.from(files).slice(0, remaining)
    if (toAdd.length === 0) {
      setErrors(e => ({ ...e, [catId]: t('portal.imageUpload.limitReached', { count: maxPhotos, max: maxPhotos }) }))
      return
    }
    setErrors(e => ({ ...e, [catId]: '' }))
    setProcessing(p => ({ ...p, [catId]: true }))
    const processed = await Promise.all(toAdd.map(f => processImage(f)))
    setUploads(u => ({ ...u, [catId]: [...(u[catId] || []), ...(processed.filter(Boolean) as File[])] }))
    setProcessing(p => ({ ...p, [catId]: false }))
  }

  const removeFile = (catId: string, idx: number) => {
    setUploads(u => ({ ...u, [catId]: (u[catId] || []).filter((_, i) => i !== idx) }))
  }

  const removeExistingPhoto = async (catId: string, photoId: string) => {
    setRemovingExisting(s => new Set([...s, photoId]))
    try {
      await clientService.deletePhoto(token, photoId)
      setExistingByCat(prev => ({
        ...prev,
        [catId]: (prev[catId] || []).filter(p => p.id !== photoId),
      }))
    } catch (e: any) {
      alert(t('portal.imageUpload.removeError', { error: e.message }))
    } finally {
      setRemovingExisting(s => { const n = new Set(s); n.delete(photoId); return n })
    }
  }

  const totalByCategory = (catId: string) =>
    (existingByCat[catId] || []).length + (uploads[catId] || []).length

  const allFilled   = categories.every(c => totalByCategory(c.id) > 0)
  const doneCount   = categories.filter(c => totalByCategory(c.id) > 0).length
  const totalPhotos = categories.reduce((s, c) => s + totalByCategory(c.id), 0)

  const handleFinalize = async () => {
    if (!allFilled) return
    setFinalizing(true)
    try {
      // Only upload brand-new files — existing photos are already in the DB
      for (const cat of categories) {
        for (const file of (uploads[cat.id] || [])) {
          await clientService.uploadPhoto(token, data.client.id, file, cat.id)
        }
      }
      await clientService.finalizePhotos(token)
      onDone()
    } catch (e: any) {
      alert(t('portal.photoStep.uploadPhotosError', { error: e.message }))
    } finally {
      setFinalizing(false)
    }
  }

  const scrollToCat = (catId: string) => {
    document.getElementById(`photo-cat-${catId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (categories.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
        <Camera className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-400">{t('portal.photoStep.noCategoriesConfigured')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Sticky overview bar ── */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-100 shadow-sm px-4 sm:px-5 py-3 sticky top-[3.75rem] z-10">
        {/* Progress bar + label */}
        <div className="flex items-center gap-3 mb-2.5">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-400 to-pink-500 rounded-full transition-all duration-500"
              style={{ width: `${(doneCount / categories.length) * 100}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">
            {doneCount}/{categories.length}
            {doneCount === categories.length
              ? ` ${t('portal.photoStep.completeSuffix')}`
              : ` ${t('portal.photoStep.categoriesSuffix')}`}
          </span>
        </div>

        {/* Quick-jump pills */}
        {categories.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
            {categories.map((cat, idx) => {
              const done = totalByCategory(cat.id) > 0
              return (
                <button
                  key={cat.id}
                  onClick={() => scrollToCat(cat.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                    done
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-500 border border-gray-200 hover:border-rose-200 hover:text-rose-600'
                  }`}
                >
                  {done
                    ? <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                    : <span className="w-3.5 h-3.5 rounded-full bg-gray-300 text-[9px] text-white flex items-center justify-center font-bold flex-shrink-0">
                        {idx + 1}
                      </span>
                  }
                  <span className="max-w-[84px] truncate">{cat.title}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── One card per category — all visible on the same page ── */}
      {categories.map((cat, idx) => (
        <CategoryCard
          key={cat.id}
          cat={cat}
          index={idx}
          uploads={uploads[cat.id] || []}
          existingPhotos={existingByCat[cat.id] || []}
          processing={!!processing[cat.id]}
          error={errors[cat.id] || ''}
          onAdd={files => addFiles(cat.id, files, cat.max_photos)}
          onRemove={i => removeFile(cat.id, i)}
          onRemoveExisting={photoId => removeExistingPhoto(cat.id, photoId)}
          removingExisting={removingExisting}
        />
      ))}

      {/* ── Submit card ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 sm:px-5 py-4 space-y-3">

        {/* Pending shortcuts */}
        {categories
          .filter(c => totalByCategory(c.id) === 0)
          .map(cat => {
            const idx = categories.findIndex(c => c.id === cat.id)
            return (
              <button
                key={cat.id}
                onClick={() => scrollToCat(cat.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
              >
                <span className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800 truncate">{cat.title}</p>
                  <p className="text-xs text-amber-600">{t('portal.photoStep.noPhotoSent')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-amber-500 flex-shrink-0" />
              </button>
            )
          })}

        {/* Summary */}
        {allFilled && (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-green-800">{t('portal.photoStep.allReadyTitle')}</p>
                <p className="text-xs text-green-700 mt-0.5">
                  {t('portal.photoStep.photoCount', { count: totalPhotos })} {t('portal.common.inLabel')} {t('portal.photoStep.categoryCount', { count: categories.length })}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          {showBackButton && onBack && (
            <Btn onClick={onBack} variant="outline" className="flex-1">
              <ChevronLeft className="h-4 w-4" /> {t('portal.photoStep.backButton')}
            </Btn>
          )}
          <Btn
            onClick={handleFinalize}
            disabled={!allFilled}
            loading={finalizing}
            className={showBackButton ? "flex-1" : "w-full"}
          >
            {finalizing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t('portal.photoStep.finalizing')}
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4" /> {t('portal.photoStep.finalizeSubmit')}
              </>
            )}
          </Btn>
        </div>

        {!allFilled && (
          <p className="text-xs text-gray-400 text-center">
            {t('portal.photoStep.fillAllCategoriesNote')}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Review screen ────────────────────────────────────────────────────────────

function ReviewScreen() {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl mb-4">
          <Clock className="h-8 w-8 text-blue-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('portal.review.title')}</h2>
        <p className="text-sm text-gray-500 leading-relaxed max-w-md mx-auto">
          {t('portal.review.body')}
        </p>
      </div>

      {/* Aviso de prazo de revisão */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
            <Clock className="h-5 w-5 text-blue-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">{t('portal.review.deadlineTitle')}</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              {t('portal.review.deadlineBodyPre')} <strong className="text-gray-900">{t('portal.review.oneBusinessDay')}</strong>{t('portal.review.deadlineBodyPost')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Analysis screen ──────────────────────────────────────────────────────────
//
// Usada para os status: in_analysis, preparing_materials, validating_materials.
// Quando `materialsBeingPrepared` é true, mostra um aviso discreto abaixo do
// prazo informando que os materiais estão sendo preparados.
// Visualmente o cliente continua vendo "Análise em andamento" (mantém o prazo
// de entrega original) — apenas ganha uma linha extra de status.

function AnalysisScreen({
  data,
  materialsBeingPrepared = false,
}: {
  data: ClientPortalData
  materialsBeingPrepared?: boolean
}) {
  const { t, language } = useTranslation()
  const deadline = data.deadline

  if (!deadline?.deadline_date) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
        <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h2 className="font-semibold text-gray-900 mb-2">{t('portal.analysis.approvedTitle')}</h2>
        <p className="text-sm text-gray-500">{t('portal.analysis.waitingDeadline')}</p>
      </div>
    )
  }

  const daysLeft = businessDaysUntil(deadline.deadline_date)
  const formatted = new Date(deadline.deadline_date + 'T12:00:00').toLocaleDateString(language, {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className="bg-gradient-to-br from-blue-500 via-indigo-500 to-blue-600 rounded-2xl p-7 text-white text-center relative overflow-hidden shadow-lg">
        <div
          className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }}
        />
        <div className="relative">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4 backdrop-blur-sm">
            <Palette className="h-9 w-9 text-white" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-1">{t('portal.analysis.inProgressTitle')}</h2>
          <p className="text-blue-100 text-sm">{t('portal.analysis.inProgressSubtitle')}</p>
        </div>
      </div>

      {/* Deadline card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Clock className="h-7 w-7 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-gray-500 mb-0.5">{t('portal.analysis.deliveryForecast')}</p>
            <p className="text-lg font-bold text-gray-900">{formatted}</p>
            <p className="text-xs text-gray-400 mt-1">
              {daysLeft > 0
                ? t('portal.analysis.daysLeft', { count: daysLeft })
                : daysLeft === 0
                  ? t('portal.analysis.dueToday')
                  : t('portal.analysis.overdue', { count: Math.abs(daysLeft) })
              }
            </p>
          </div>
        </div>
      </div>

      {/* Aviso discreto: materiais sendo preparados */}
      {materialsBeingPrepared && (
        <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-2xl border border-teal-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
              <Package className="h-5 w-5 text-teal-500" />
            </div>
            <p className="text-sm text-gray-700 leading-snug">
              <strong className="text-gray-900">{t('portal.analysis.materialsPreparedBold')}</strong>{' '}
              {t('portal.analysis.materialsPreparedRest')}
            </p>
          </div>
        </div>
      )}

      <div className="text-center py-2">
        <p className="text-xs text-gray-400">
          {t('portal.analysis.emailNotice')}
        </p>
      </div>
    </div>
  )
}

// ── AI photo step ─────────────────────────────────────────────────────────────
// Etapa "Aguardando Foto IA". Aqui o resultado parcial JÁ foi liberado pela
// admin e a cliente precisa enviar a foto adicional para a simulação.
// Após enviar, vê tela de "consultora verificando".
function AiPhotoStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const { t } = useTranslation()
  const aiCat = (data.photo_categories || []).find(c => (c as any).is_ai_simulation) as PhotoCategory | undefined

  // Foto já enviada nessa categoria? (status "verificando")
  const aiPhotoSent = !!aiCat && (data.photos || []).some(p => p.category_id === aiCat.id)

  // upload local (apenas durante o envio, não persiste após reload)
  const [uploads, setUploads] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Defesa: o plano da cliente NÃO tem categoria de Foto IA, mas a admin
  // mandou pra esta etapa (provavelmente via "Mover para…"). Sem categoria
  // IA não dá pra fazer upload, então o portal mostra:
  //   - Se result já foi liberado: ResultScreen com aiPhotoMode (banner pedindo
  //     a foto adicional). A admin vai coletar a foto fora do sistema (chat
  //     interno, WhatsApp, e-mail).
  //   - Se result NÃO foi liberado: mensagem amigável "aguardando consultora"
  //     pra evitar que a cliente fique sem feedback.
  if (!aiCat) {
    if (data.result) {
      return <ResultScreen token={token} data={data} aiPhotoMode />
    }
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h2 className="font-semibold text-amber-900">{t('portal.aiPhoto.waitingConsultantTitle')}</h2>
        <p className="text-sm text-amber-700 mt-2">
          {t('portal.aiPhoto.waitingConsultantBody')}
        </p>
      </div>
    )
  }

  const addFiles = async (files: File[]) => {
    const remaining = aiCat.max_photos - uploads.length - (aiPhotoSent ? 1 : 0)
    const toAdd = Array.from(files).slice(0, remaining)
    if (toAdd.length === 0) {
      setError(t('portal.imageUpload.limitReached', { count: aiCat.max_photos, max: aiCat.max_photos }))
      return
    }
    setError('')
    setProcessing(true)
    try {
      const processed = await Promise.all(toAdd.map(f => processImage(f)))
      setUploads(u => [...u, ...(processed.filter(Boolean) as File[])])
    } finally {
      setProcessing(false)
    }
  }

  const removeFile = (idx: number) => setUploads(u => u.filter((_, i) => i !== idx))

  const handleSubmit = async () => {
    if (uploads.length === 0) return
    setSubmitting(true)
    setError('')
    try {
      // Envia uma a uma. Só a PRIMEIRA foto do lote limpa as fotos antigas
      // da categoria (clearPrevious=true) — cobre o reenvio pós-rejeição.
      // As demais acumulam (antes, cada upload apagava o anterior e só a
      // última foto do lote sobrevivia no banco).
      // submitAiPhoto SÓ faz o upload — não dispara e-mail.
      for (let i = 0; i < uploads.length; i++) {
        await clientService.submitAiPhoto(token, data.client.id, aiCat.id, uploads[i], i === 0)
      }
      // Notificação ÚNICA pra consultora, só depois que TODAS as fotos
      // subiram. Antes o e-mail saía por foto (5 fotos = 5 e-mails).
      await clientService.notifyAiPhotosSubmitted(token)
      setUploads([])
      onDone()
    } catch (e: any) {
      setError(e?.message || t('portal.aiPhoto.genericSendError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. Resultado parcial com banner adaptado para esta etapa.
            Quando a foto JÁ FOI enviada, troca o banner para "verificando". */}
      {data.result ? (
        aiPhotoSent
          ? <ResultScreen token={token} data={data} simulatingMode />
          : <ResultScreen token={token} data={data} aiPhotoMode />
      ) : (
        // Caso raro: admin moveu pra ai_photo sem liberar parcial.
        <div className="bg-gradient-to-br from-violet-500 via-purple-500 to-violet-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-white/20 rounded-xl mb-3 backdrop-blur-sm">
            <Camera className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-xl font-bold">{t('portal.aiPhoto.sendPhotoTitle')}</h2>
          <p className="text-violet-100 text-sm mt-1">
            {t('portal.aiPhoto.sendPhotoBody')}
          </p>
        </div>
      )}

      {/* 2. Card da etapa de foto IA */}
      {aiPhotoSent ? (
        // ── Foto já enviada — aguardando validação da consultora ──────────
        <div className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-violet-50 to-purple-50 px-5 py-4 border-b border-violet-100">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500 text-white flex-shrink-0">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{t('portal.aiPhoto.photoReceivedTitle')}</h3>
                <p className="text-xs text-gray-600 mt-0.5">{t('portal.aiPhoto.photoReceivedBody')}</p>
              </div>
            </div>
          </div>
          <div className="px-5 py-4 flex items-center gap-3 text-sm text-gray-700">
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            <span>{t('portal.aiPhoto.nothingElseToDo')}</span>
          </div>
        </div>
      ) : (
        // ── Tela de upload — banner já está acima, sem card intermediário
        <>
          {/* Reaproveita o CategoryCard com o estado local */}
          <CategoryCard
            cat={aiCat}
            index={0}
            uploads={uploads}
            existingPhotos={[]}
            processing={processing}
            error={error}
            onAdd={addFiles}
            onRemove={removeFile}
            onRemoveExisting={() => {}}
            removingExisting={new Set()}
          />

          <button
            onClick={handleSubmit}
            disabled={uploads.length === 0 || submitting || processing}
            className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold py-3.5 px-6 rounded-2xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('portal.aiPhoto.sending')}
              </>
            ) : (
              <>
                {t('portal.aiPhoto.sendPhotoBtn')}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </>
      )}
    </div>
  )
}

// ── Result screen ────────────────────────────────────────────────────────────

interface RefPhoto {
  type: string
  label: string
  storagePath: string
  url: string
}

// ── Lightbox para fotos do Resultado ─────────────────────────────────────────
//
// Modal fullscreen com zoom + pan + download. Usado quando a cliente clica
// numa miniatura na seção "Fotos" da tela de Resultado.
//
//  • Zoom: botões +/− no canto superior + pinch nativo no mobile (browser
//    cuida do scaling em <img> com touch-action: pinch-zoom no container).
//  • Pan: drag com mouse quando zoom > 1, dedo único no mobile.
//  • Download: usa fetch + blob URL pra forçar download (em vez de window.open).
//    Drive precisa estar com permission anyone:reader (patch da Edge Function).
//  • Navegação: setas ← →, ChevronLeft/Right quando há múltiplas fotos.
function ResultPhotoLightbox({ photos, initialIndex, onClose }: {
  photos: Array<{ id: string; url: string; file_name: string; drive_file_id?: string | null }>
  initialIndex: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const photo = photos[index]
  const [downloading, setDownloading] = useState(false)

  // Reseta zoom/pan ao trocar de foto
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [index])

  // Navegação por teclado
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && photos.length > 1) setIndex(i => (i - 1 + photos.length) % photos.length)
      if (e.key === 'ArrowRight' && photos.length > 1) setIndex(i => (i + 1) % photos.length)
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z * 1.5, 5))
      if (e.key === '-') setZoom(z => Math.max(z / 1.5, 0.5))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [photos.length, onClose])

  const handleDownload = async () => {
    if (!photo) return
    setDownloading(true)
    try {
      const url = photo.drive_file_id
        ? `https://drive.google.com/uc?export=download&id=${photo.drive_file_id}`
        : photo.url
      // Tenta fetch+blob pra forçar download com nome certo. Pode falhar
      // se o Drive servir página de scan antivírus pra arquivos grandes —
      // nesse caso cai pra window.open.
      try {
        const r = await fetch(url)
        if (!r.ok) throw new Error('fetch failed')
        const blob = await r.blob()
        if (blob.size < 1024 && blob.type.startsWith('text/html')) throw new Error('drive html page')
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = photo.file_name
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)
      } catch {
        window.open(url, '_blank')
      }
    } finally {
      setDownloading(false)
    }
  }

  // Drag pra pan quando zoom > 1
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return
    if ((e.target as HTMLElement).closest('button')) return
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    })
  }
  const onPointerUp = () => { dragRef.current = null }

  if (!photo) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center"
      style={{ touchAction: 'pinch-zoom' }}
      onClick={onClose}
    >
      {/* Top bar: download + close */}
      <div className="absolute top-4 right-4 flex gap-2 z-10" onClick={e => e.stopPropagation()}>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-white/10 hover:bg-white/20 disabled:opacity-40 rounded-lg backdrop-blur-sm transition-colors"
          title={t('portal.result.downloadPhoto')}
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span className="hidden sm:inline">{t('portal.common.download')}</span>
        </button>
        <button
          onClick={onClose}
          className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title={t('portal.common.close')}
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Zoom controls (canto inferior) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1 z-10 bg-white/10 backdrop-blur-sm rounded-lg p-1" onClick={e => e.stopPropagation()}>
        <button onClick={() => setZoom(z => Math.max(z / 1.5, 0.5))} className="p-2 text-white hover:bg-white/20 rounded" title={t('portal.common.decrease')}><ZoomOut className="h-4 w-4" /></button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="px-3 py-2 text-xs text-white hover:bg-white/20 rounded font-medium" title={t('portal.common.fitToScreen')}>{Math.round(zoom * 100)}%</button>
        <button onClick={() => setZoom(z => Math.min(z * 1.5, 5))} className="p-2 text-white hover:bg-white/20 rounded" title={t('portal.common.increase')}><ZoomIn className="h-4 w-4" /></button>
      </div>

      {/* Prev/Next quando há mais de uma foto */}
      {photos.length > 1 && (
        <>
          <button
            onClick={e => { e.stopPropagation(); setIndex(i => (i - 1 + photos.length) % photos.length) }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 text-white bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-sm transition-colors"
            title={t('portal.common.previous')}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setIndex(i => (i + 1) % photos.length) }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 text-white bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-sm transition-colors"
            title={t('portal.common.next')}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Container da imagem com pan via pointer events */}
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: zoom > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'default' }}
      >
        <img
          src={photo.url}
          alt={photo.file_name}
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: dragRef.current ? 'none' : 'transform 0.2s',
            touchAction: 'none',
            pointerEvents: 'none', // o drag fica no container
          }}
          draggable={false}
        />
      </div>

      {/* Contador */}
      {photos.length > 1 && (
        <div className="absolute top-4 left-4 z-10 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-lg text-white text-sm">
          {index + 1} / {photos.length}
        </div>
      )}
    </div>
  )
}

function ResultScreen({
  token, data,
  simulatingMode = false,
  aiPhotoMode = false,
}: {
  token: string
  data: ClientPortalData
  simulatingMode?: boolean
  aiPhotoMode?: boolean
}) {
  const { t, language } = useTranslation()
  const result = data.result

  const [aiPrompt, setAiPrompt] = useState<string | null>(null)
  const [aiRefPhotoUrl, setAiRefPhotoUrl] = useState<string | null>(null)
  const [aiRefPhotos, setAiRefPhotos] = useState<RefPhoto[]>([])
  const [aiFolderConfig, setAiFolderConfig] = useState<any>(null)
  const [loadingPrompt, setLoadingPrompt] = useState(true)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // Role do admin dono do cliente. Buscado via RPC `get_client_owner_role` que
  // roda como SECURITY DEFINER (o ClientPortal não tem auth, acesso via token).
  // Começa null e fica hidratado depois — default é "esconder folder_url",
  // garantindo que não pisca a pasta pra cliente de admin comum durante o load.
  const [ownerRole, setOwnerRole] = useState<string | null>(null)
  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const { data: role, error } = await supabase.rpc('get_client_owner_role', { p_token: token })
        if (cancelled) return
        if (error) console.warn('[ClientPortal] get_client_owner_role:', error)
        setOwnerRole(typeof role === 'string' ? role : null)
      } catch (e) {
        if (!cancelled) console.warn('[ClientPortal] owner_role fetch falhou:', e)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleDownload = async (file: any) => {
    if (downloadingId) return
    setDownloadingId(file.id)
    try {
      // Arquivos do Drive: usa o proxy da Edge Function (/file-proxy), que
      // já devolve os bytes com Content-Disposition setado com o nome
      // certo (file.file_name), servido pelo nosso próprio domínio — sem
      // depender do CORS instável do drive.google.com (que às vezes libera
      // fetch() cross-origin e às vezes não, causando o nome errado e a
      // aba que fica só carregando no celular).
      const url = file.drive_file_id
        ? driveStorage.filePortalProxyUrl(file.drive_file_id, token)
        : clientService.getResultFileUrl(file)

      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const rawBlob = await res.blob()

      // Garante content-type correto independente do header devolvido pelo storage
      const blob = (!file.drive_file_id && rawBlob.type !== 'application/pdf')
        ? new Blob([rawBlob], { type: 'application/pdf' })
        : rawBlob

      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = file.file_name
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)

      // ✅ NÃO revogar imediatamente: o browser ainda lê os bytes do blob
      // de forma assíncrona após o click. Revogar na mesma tick trunca
      // PDFs grandes (10–30 MB), resultando em arquivo corrompido no disco.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
    } catch (err) {
      console.error('Erro ao baixar arquivo:', err)
      // fallback: abre na aba mesmo (só chega aqui se o proxy falhar de
      // verdade, ex: admin desconectou o Drive)
      window.open(clientService.getResultFileUrl(file), '_blank')
    } finally {
      setDownloadingId(null)
    }
  }

  useEffect(() => {
    // Usa RPC com SECURITY DEFINER para buscar dados de IA sem necessitar
    // de sessão autenticada. Evita o erro "Invalid Refresh Token" que ocorria
    // ao fazer queries diretas em `clients` e `ai_folders` sem auth no portal.
    ;(async () => {
      try {
        const { data: row, error } = await supabase.rpc('get_client_ai_config', { p_token: token })
        if (error || !row) {
          setLoadingPrompt(false)
          return
        }

        setAiPrompt(row.ai_prompt || null)

        if (row.ai_reference_photos && Array.isArray(row.ai_reference_photos) && row.ai_reference_photos.length > 0) {
          const photos: RefPhoto[] = row.ai_reference_photos.map((p: any) => {
            const driveId = p.driveFileId || p.drive_file_id
            const url = driveId
              ? driveStorage.viewUrl(driveId)
              : supabase.storage.from('client-photos').getPublicUrl(p.storagePath).data.publicUrl
            return {
              type: (p.typeId || p.type || 'geral') as string,
              label: p.typeName || p.label || p.typeId || p.type || 'Geral',
              storagePath: p.storagePath || driveId || '',
              url,
            }
          })
          setAiRefPhotos(photos)
          const geral = photos.find(p => p.type === 'geral')
          if (geral) setAiRefPhotoUrl(geral.url)
          else if (photos.length > 0) setAiRefPhotoUrl(photos[0].url)
        } else if (row.ai_reference_photo_path) {
          // Legado: campo único string (caminho do bucket antigo)
          const { data: urlData } = supabase.storage.from('client-photos').getPublicUrl(row.ai_reference_photo_path)
          setAiRefPhotoUrl(urlData.publicUrl)
          setAiRefPhotos([{
            type: 'geral',
            label: 'Foto Geral/Rosto',
            storagePath: row.ai_reference_photo_path,
            url: urlData.publicUrl,
          }])
        }

        if (row.folder_config) {
          setAiFolderConfig(typeof row.folder_config === 'string' ? JSON.parse(row.folder_config) : row.folder_config)
        }
      } catch {}
      setLoadingPrompt(false)
    })()
  }, [token])

  if (!result) return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
      <Lock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
      <h2 className="font-semibold text-gray-900">{t('portal.result.prepStateTitle')}</h2>
      <p className="text-sm text-gray-500 mt-2">{t('portal.result.prepStateBody')}</p>
    </div>
  )

  const files: typeof result.files = result.files ?? []

  // Separa os arquivos do resultado por tipo pra renderizar em seções
  // distintas (Documentos / Áudios / Fotos). Tipo é detectado pela extensão
  // do nome — não temos coluna mime_type em client_result_files.
  const pdfs   = files.filter((f: any) => getResultFileKind(f.file_name) === 'pdf')
  const audios = files.filter((f: any) => getResultFileKind(f.file_name) === 'audio')
  const images = files.filter((f: any) => getResultFileKind(f.file_name) === 'image')
  const others = files.filter((f: any) => getResultFileKind(f.file_name) === 'other')

  // Lightbox de foto (state local — abre quando a cliente clica numa miniatura)
  const [photoLightbox, setPhotoLightbox] = useState<{ photos: any[]; index: number } | null>(null)

  // Visibilidade do `folder_url` (link da pasta vinda do FoldersManager).
  // Regra de produto: SÓ aparece pra clientes pertencentes a um super_admin.
  // Pra clientes de admin comum o link da pasta nunca é mostrado, mesmo que
  // o campo esteja preenchido no banco.
  const canSeeFolderUrl = ownerRole === 'super_admin'
  const folderUrl = canSeeFolderUrl ? result.folder_url : null

  // Link manual extra colocado pelo admin na aba Resultado. Sempre aparece
  // pra cliente (independente do role do admin dono).
  const customLinkUrl = (result as any).custom_link_url as string | undefined
  const hasContent = folderUrl || customLinkUrl || files.length > 0 || result.observations

  return (
    <div className="space-y-4">
      {/* Banner — muda conforme o modo */}
      {aiPhotoMode ? (
        <>
          <div className="bg-gradient-to-br from-violet-500 via-purple-500 to-violet-600 rounded-2xl p-7 text-white text-center relative overflow-hidden shadow-lg">
            <div
              className="absolute inset-0 opacity-10"
              style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }}
            />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4 backdrop-blur-sm">
                <Camera className="h-9 w-9 text-white" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">{t('portal.aiPhoto.sendPhotoTitle')}</h2>
              <p className="text-violet-100 text-sm mt-1.5">
                {t('portal.result.aiPhotoBannerBody')}
              </p>
            </div>
          </div>
        </>
      ) : simulatingMode ? (
        <>
          <div className="bg-gradient-to-br from-violet-500 via-purple-500 to-violet-600 rounded-2xl p-7 text-white text-center relative overflow-hidden shadow-lg">
            <div
              className="absolute inset-0 opacity-10"
              style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }}
            />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4 backdrop-blur-sm">
                <Sparkles className="h-9 w-9 text-white" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">{t('portal.result.simulatingTitle')}</h2>
              <p className="text-violet-100 text-sm mt-1.5">
                {t('portal.result.simulatingBody')}
              </p>
            </div>
          </div>

          {/* Card de prazo final */}
          {data.deadline?.deadline_date && (() => {
            const daysLeft = businessDaysUntil(data.deadline.deadline_date)
            const formatted = new Date(data.deadline.deadline_date + 'T12:00:00').toLocaleDateString(language, {
              weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            })
            return (
              <div className="bg-white rounded-2xl border border-violet-200 shadow-sm p-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-violet-400 to-purple-500 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <Clock className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 mb-0.5">{t('portal.result.finalDeliveryForecast')}</p>
                    <p className="text-base font-bold text-gray-900">{formatted}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {daysLeft > 0
                        ? t('portal.analysis.daysLeft', { count: daysLeft })
                        : daysLeft === 0
                          ? t('portal.analysis.dueToday')
                          : t('portal.analysis.overdue', { count: Math.abs(daysLeft) })
                      }
                    </p>
                  </div>
                </div>
              </div>
            )
          })()}
        </>
      ) : (
        <div className="bg-gradient-to-br from-rose-500 via-pink-500 to-rose-600 rounded-2xl p-7 text-white text-center relative overflow-hidden shadow-lg">
          <div
            className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }}
          />
          <div className="relative">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4 backdrop-blur-sm">
              <CheckCircle className="h-9 w-9 text-white" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">{t('portal.result.readyTitle')}</h2>
            <p className="text-rose-100 text-sm mt-1.5">{t('portal.result.readySubtitle')}</p>
          </div>
        </div>
      )}

      {!hasContent && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-8 text-center">
          <Clock className="h-12 w-12 text-amber-300 mx-auto mb-4" />
          <h2 className="font-semibold text-gray-900">{t('portal.result.materialsPreparingTitle')}</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            {t('portal.result.materialsPreparingBody')}
          </p>
        </div>
      )}

      {folderUrl && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-rose-400" /> {t('portal.result.folderTitle')}
          </h3>
          <a
            href={folderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-gradient-to-r from-rose-50 to-pink-50 rounded-xl border border-rose-100 hover:from-rose-100 hover:to-pink-100 transition-all group"
          >
            <div className="w-11 h-11 bg-gradient-to-br from-rose-400 to-pink-500 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
              <ExternalLink className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-rose-700">{t('portal.result.folderCta')}</p>
              <p className="text-xs text-rose-400 mt-0.5">{t('portal.result.folderCtaNote')}</p>
            </div>
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-rose-100 group-hover:bg-rose-200 flex items-center justify-center transition-colors">
              <ExternalLink className="h-3.5 w-3.5 text-rose-500" />
            </div>
          </a>
        </div>
      )}

      {/* Link manual da consultora — vem do campo custom_link_url do client_results,
          editado em ClientsManager → aba Resultado → "Link de acesso". Aparece pra
          QUALQUER cliente (independente do role do admin dono), diferente do
          folderUrl acima que é só pra cliente de super_admin. */}
      {customLinkUrl && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-rose-400" /> {t('portal.result.linkTitle')}
          </h3>
          <a
            href={customLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-gradient-to-r from-rose-50 to-pink-50 rounded-xl border border-rose-100 hover:from-rose-100 hover:to-pink-100 transition-all group"
          >
            <div className="w-11 h-11 bg-gradient-to-br from-rose-400 to-pink-500 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
              <ExternalLink className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-rose-700">{t('portal.result.linkCta')}</p>
              <p className="text-xs text-rose-400 mt-0.5">{t('portal.result.linkCtaNote')}</p>
            </div>
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-rose-100 group-hover:bg-rose-200 flex items-center justify-center transition-colors">
              <ExternalLink className="h-3.5 w-3.5 text-rose-500" />
            </div>
          </a>
        </div>
      )}

      {(pdfs.length > 0 || others.length > 0) && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-rose-400" /> {t('portal.result.documentsTitle')}
          </h3>
          <div className="space-y-2">
            {[...pdfs, ...others].map((file: any) => (
              <button
                key={file.id}
                onClick={() => handleDownload(file)}
                disabled={downloadingId === file.id}
                className="w-full flex items-center gap-3 p-3.5 bg-gray-50 hover:bg-rose-50 rounded-xl border border-transparent hover:border-rose-100 transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="w-10 h-10 bg-gradient-to-br from-red-400 to-rose-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <FileText className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-gray-800 truncate">{file.file_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{(file.file_size / 1024).toFixed(0)} KB</p>
                </div>
                {downloadingId === file.id
                  ? <div className="animate-spin h-4 w-4 border-2 border-rose-400 border-t-transparent rounded-full flex-shrink-0" />
                  : <Download className="h-4 w-4 text-gray-300 group-hover:text-rose-400 transition-colors flex-shrink-0" />
                }
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Mensagens em áudio do consultor(a) ──────────────────────────
          Player via /audio-proxy (portal_token) — sem auth JWT, sem CORS.
          Não exibe nome/extensão do arquivo: mostra só "Mensagem do
          consultor(a)" com contador quando há mais de um áudio. */}
      {audios.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Mic className="h-5 w-5 text-rose-400" />
            {t('portal.result.audioMessage', { count: audios.length })}
          </h3>
          <div className="space-y-4">
            {audios.map((file: any, idx: number) => {
              // Usa o proxy da Edge Function pra evitar bloqueio de CORS/auth do Drive
              const supabaseUrl = (supabase as any).supabaseUrl as string ?? ''
              const audioSrc = file.drive_file_id && token
                ? `${supabaseUrl}/functions/v1/drive/audio-proxy?token=${encodeURIComponent(token)}&id=${encodeURIComponent(file.drive_file_id)}`
                : clientService.getResultFileUrl(file)

              return (
                <div
                  key={file.id}
                  className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-50 via-purple-50 to-pink-50 border border-violet-100 p-4"
                >
                  {/* Detalhe decorativo de fundo */}
                  <div className="absolute -top-4 -right-4 w-24 h-24 bg-gradient-to-br from-violet-200/40 to-purple-200/40 rounded-full pointer-events-none" />

                  <div className="relative flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Mic className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-violet-900">
                        {audios.length > 1 ? t('portal.result.audioMessageNumbered', { index: idx + 1 }) : t('portal.result.audioMessage', { count: 1 })}
                      </p>
                      <p className="text-xs text-violet-400 mt-0.5">{t('portal.result.tapToListen')}</p>
                    </div>
                    <button
                      onClick={() => handleDownload(file)}
                      disabled={downloadingId === file.id}
                      className="p-2 text-violet-300 hover:text-violet-600 hover:bg-violet-100 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                      title={t('portal.result.downloadAudio')}
                    >
                      {downloadingId === file.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                    </button>
                  </div>

                  <PortalAudioPlayer
                    audioSrc={audioSrc}
                    fileName={file.file_name}
                    className="w-full rounded-xl"
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Fotos ───────────────────────────────────────────────────────
          Grid de miniaturas. Clica → abre o lightbox com zoom + download. */}
      {images.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-rose-400" /> {t('portal.result.photosTitle')}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
            {images.map((file: any, idx: number) => {
              // Lista pro lightbox precisa ter `url` (high-res) e `file_name`
              const lightboxPhotos = images.map((f: any) => ({
                id: f.id,
                file_name: f.file_name,
                drive_file_id: f.drive_file_id,
                url: f.drive_file_id
                  ? `https://drive.google.com/thumbnail?id=${f.drive_file_id}&sz=w2000`
                  : clientService.getResultFileUrl(f),
              }))
              // Thumbnail menor pra grid
              const thumbUrl = file.drive_file_id
                ? `https://drive.google.com/thumbnail?id=${file.drive_file_id}&sz=w400`
                : clientService.getResultFileUrl(file)
              return (
                <button
                  key={file.id}
                  onClick={() => setPhotoLightbox({ photos: lightboxPhotos, index: idx })}
                  className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group focus:outline-none focus:ring-2 focus:ring-rose-400"
                  title={file.file_name}
                >
                  <img
                    src={thumbUrl}
                    alt={file.file_name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {result.observations && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-rose-400">✦</span> {t('portal.result.observationsTitle')}
          </h3>
          <div className="bg-gradient-to-br from-rose-50 to-pink-50 rounded-xl p-4 border border-rose-100">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{result.observations}</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl px-5 py-3 text-center">
        <p className="text-xs text-gray-400">
          {t('portal.result.releasedOn', {
            date: new Date(result.released_at).toLocaleDateString(language, { day: '2-digit', month: 'long', year: 'numeric' }),
          })}
        </p>
      </div>

      {!loadingPrompt && aiPrompt && result.chat_enabled !== false && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-violet-200" />
            <span className="text-xs font-medium text-violet-500 px-2">{t('portal.result.consultantMessage')}</span>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-violet-200" />
          </div>
          <GeminiChat
            clientName={data.client.full_name}
            systemPrompt={aiPrompt}
            referencePhotoUrl={aiRefPhotoUrl}
            referencePhotos={aiRefPhotos}
            folderConfig={aiFolderConfig}
            clientId={data.client.id}
            portalToken={token}
            resultFileUrls={files.map((f: any) => ({
              url: clientService.getResultFileUrl(f),
              name: f.file_name,
            }))}
            resultObservations={result.observations || ''}
          />
        </div>
      )}

      {/* Lightbox de foto — abre quando a cliente clica numa miniatura na
          seção Fotos acima. Renderiza no fim do JSX pra ficar acima de tudo. */}
      {photoLightbox && (
        <ResultPhotoLightbox
          photos={photoLightbox.photos}
          initialIndex={photoLightbox.index}
          onClose={() => setPhotoLightbox(null)}
        />
      )}
    </div>
  )
}