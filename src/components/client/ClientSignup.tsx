// src/components/client/ClientSignup.tsx
import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Palette, User, Mail, Phone, Calendar, CheckCircle,
  AlertCircle, Loader2, ChevronRight, ArrowLeft,
  RefreshCw, Lock, Sparkles, Heart, Globe,
  Check, ChevronDown, ChevronUp, Download, LogIn,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { clientService } from '../../lib/services'
import { SignatureCanvas } from './SignatureCanvas'
import { downloadContractPDF } from '../../lib/contractPDFGenerator'
import { LanguageProvider, useTranslation, useLanguage, writeStoredLanguage } from '../../lib/i18n'
import { getCountryOptions } from '../../lib/i18n/countries'
import { PhoneInput } from './PhoneInput'
import { LanguageSwitcher } from './LanguageSwitcher'
import { clientThemeVars } from '../../lib/clientTheme'

interface PlanData {
  id: string
  name: string
  description: string
  contract: { title?: string; sections?: { id: string; title: string; content: string; order: number }[] } | null
  form_config: any
  photo_categories: any
  /** Idioma padrão configurado pelo admin em Settings (settings.defaultLanguage).
   *  Precisa vir junto do plano porque, nesta tela, ainda não existe cliente
   *  cadastrada — não há como buscar isso por outro caminho. */
  admin_default_language?: string | null
  /** Tema visual do portal (mesma origem do admin_default_language acima).
   *  NULL/ausente = tema rosa padrão. Ver src/lib/clientTheme.ts. */
  admin_theme?: { accentColor?: string | null; bgColor?: string | null } | null
}

// Fluxo completo: welcome → info (dados) → contract (assinatura) → done (confirmação)
type Step = 'welcome' | 'info' | 'contract' | 'done'

// ── Wrapper: carrega o plano e resolve o idioma ANTES de renderizar o resto ──
//
// O carregamento do plano (via `shareToken`) mora AQUI, não dentro do
// componente filho, porque o `<LanguageProvider>` precisa do
// `admin_default_language` que vem junto da resposta — se o fetch
// acontecesse só depois do Provider já montado, o idioma padrão do admin
// nunca chegaria a tempo de ser considerado (mesmo problema que já foi
// corrigido no ClientPortal.tsx, mas pro link de COMPARTILHAMENTO DO PLANO
// era preciso mover o fetch pra cá em vez de só ajustar o Provider).
//
// Este componente ainda não tem `token` de cliente (ela só existe depois que
// o formulário "Seus Dados" é enviado) — por isso o LanguageProvider aqui usa
// `shareToken` (o token do link do plano, que já existe desde o início) como
// chave de persistência no localStorage. Uma vez que a cliente é criada
// (resultToken), a preferência de idioma passa a ser salva no banco também
// (ver `onLanguageChange` abaixo). Resolve também o crash de tela branca no
// passo "Contrato": o SignatureCanvas usado ali dentro precisa estar sob um
// LanguageProvider.
export function ClientSignup() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const [resultToken, setResultToken] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  const loadPlan = React.useCallback(async () => {
    if (!shareToken) { setPageError('invalid-link'); setLoading(false); return }
    setLoading(true)
    setPageError('')
    try {
      const { data, error } = await supabase.rpc('get_plan_by_share_token', { p_token: shareToken })
      if (error) throw error
      if (data?.error) { setPageError(data.error); return }
      setPlan(data)
    } catch {
      setPageError('load-error')
    } finally {
      setLoading(false)
    }
  }, [shareToken])

  useEffect(() => { loadPlan() }, [loadPlan])

  return (
    <LanguageProvider
      persistKey={resultToken || shareToken}
      fallbackLanguage={plan?.admin_default_language}
      onLanguageChange={lang => resultToken && clientService.updateClientLanguage(resultToken, lang)}
    >
      <ClientSignupInner
        plan={plan}
        loading={loading}
        pageError={pageError}
        onRetry={loadPlan}
        onClientCreated={setResultToken}
      />
    </LanguageProvider>
  )
}

function ClientSignupInner({
  plan,
  loading,
  pageError,
  onRetry,
  onClientCreated,
}: {
  plan: PlanData | null
  loading: boolean
  pageError: string
  onRetry: () => void
  onClientCreated: (token: string) => void
}) {
  const { t, language } = useTranslation()
  const navigate = useNavigate()
  const { shareToken } = useParams<{ shareToken: string }>()

  const [step, setStep] = useState<Step>('welcome')

  const countryOptions = React.useMemo(() => getCountryOptions(language), [language])

  // ── Step: Dados ───────────────────────────────────────────
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneValid, setPhoneValid] = useState(true)
  const [birthDate, setBirthDate] = useState('')
  const [countryCode, setCountryCode] = useState(countryOptions[0]?.code || 'BR')
  const [whatsappOptIn, setWhatsappOptIn] = useState(true)
  const [clientIp, setClientIp] = useState('...')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [resultToken, setResultTokenLocal] = useState('')

  // ── E-mail já cadastrado? ──────────────────────────────────
  // Aviso NÃO bloqueia o cadastro (a cliente pode mesmo querer uma análise
  // nova) — só avisa, com atalho pra login, pro caso comum de ela ter
  // digitado o e-mail achando que ia "entrar" e não "cadastrar de novo".
  const [emailExists, setEmailExists] = useState(false)
  const [emailExistsAdminId, setEmailExistsAdminId] = useState<string | null>(null)
  const emailCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setEmailExists(false)
    setEmailExistsAdminId(null)
    if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current)

    const trimmed = email.trim()
    if (!shareToken || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return

    emailCheckTimer.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('client_email_exists', {
          p_share_token: shareToken,
          p_email: trimmed,
        })
        setEmailExists(data?.exists === true)
        setEmailExistsAdminId(data?.admin_id || null)
      } catch {
        // Falha na checagem não deve travar o cadastro — só não mostra o aviso.
      }
    }, 600)

    return () => { if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current) }
  }, [email, shareToken])

  // ── Análises existentes (mesmo e-mail, plano diferente) ────────────
  // Verificada com email+nascimento que ela já está preenchendo no
  // cadastro — sem sair da tela. Some/reresetada se ela editar qualquer
  // um dos dois campos, pra nunca mostrar resultado desatualizado.
  interface ExistingAnalysis {
    token: string
    name: string
    phone: string | null
    status: string
    plan_name: string | null
    created_at: string
  }
  const [existingAnalyses, setExistingAnalyses] = useState<ExistingAnalysis[] | null>(null)
  const [checkingExisting, setCheckingExisting] = useState(false)
  const [checkExistingError, setCheckExistingError] = useState('')

  useEffect(() => {
    setExistingAnalyses(null)
    setCheckExistingError('')
  }, [email, birthDate])

  const handleCheckExisting = async () => {
    if (!birthDate) {
      setCheckExistingError('Digite sua data de nascimento.')
      return
    }
    setCheckingExisting(true)
    setCheckExistingError('')
    try {
      const { data, error } = await supabase.rpc('get_client_token_by_credentials', {
        p_email: email.trim().toLowerCase(),
        p_birth_date: birthDate,
        p_admin_id: emailExistsAdminId,
      })
      if (error) throw error
      if (data?.error) { setCheckExistingError(data.error); return }
      setExistingAnalyses(data?.clients || [])
    } catch {
      setCheckExistingError('Não foi possível verificar agora. Tente de novo.')
    } finally {
      setCheckingExisting(false)
    }
  }

  // ── Prosseguir com plano novo, reaproveitando nome/telefone do cadastro
  //    anterior mais recente — sem pedir pra digitar tudo de novo. Pula
  //    direto pro contrato, igual o cadastro normal faz no final.
  const handleProceedNewPlan = async () => {
    if (!existingAnalyses || existingAnalyses.length === 0) return
    const reuse = existingAnalyses[0] // mais recente
    setSubmitting(true)
    setFormError('')
    try {
      const reusedFullName = reuse.name
      const reusedPhone = reuse.phone || ''
      const country = countryName(countryCode)
      const contractData = {
        clientInfo: { fullName: reusedFullName, email, phone: reusedPhone, birthDate, country, ip: clientIp },
        registeredAt: new Date().toISOString(),
        planName: plan?.name,
        whatsappOptIn,
        whatsappOptInAt: whatsappOptIn ? new Date().toISOString() : null,
      }

      const { data, error } = await supabase.rpc('register_client_from_plan', {
        p_share_token: shareToken,
        p_full_name: reusedFullName,
        p_email: email.trim().toLowerCase(),
        p_phone: reusedPhone,
        p_birth_date: birthDate,
        p_contract_data: contractData,
      })

      if (error) throw error
      if (data?.error) { setFormError(data.error); return }

      setFullName(reusedFullName)
      setPhone(reusedPhone)
      setResultTokenLocal(data.token)
      onClientCreated(data.token)
      setContractCountryCode(countryCode)
      setContractSignTime(new Date())
      setStep('contract')
    } catch (e: any) {
      setFormError(e.message || t('signup.genericSaveError'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step: Contrato ────────────────────────────────────────
  const [contractRead, setContractRead] = useState(false)
  const [contractAgreed, setContractAgreed] = useState(false)
  const [contractSigning, setContractSigning] = useState(false)
  const [contractScrollProgress, setContractScrollProgress] = useState(0)
  const [contractCountryCode, setContractCountryCode] = useState(countryOptions[0]?.code || 'BR')
  const [contractSignTime, setContractSignTime] = useState<Date | null>(null)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [signedAt, setSignedAt] = useState<string>('')
  const contractScrollRef = useRef<HTMLDivElement>(null)

  // ── Step: Done ────────────────────────────────────────────
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  // Busca o IP real do cliente
  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => setClientIp(d.ip || ''))
      .catch(() => setClientIp(''))
  }, [])

  // ── Sincroniza o idioma assim que a cliente é criada ────────
  //
  // `onLanguageChange` (no LanguageProvider) só grava no banco quando a
  // cliente CLICA no seletor. Se ela nunca clica — mesmo que o portal já
  // esteja mostrando em inglês pra ela por detecção automática do navegador
  // — `clients.language` fica NULL pra sempre, e os e-mails (que leem essa
  // coluna) saem no idioma padrão do admin em vez do idioma que ela está
  // vendo. Este efeito roda uma única vez, assim que `resultToken` existe,
  // e grava o idioma ATUAL (o que já está na tela) — garante que o e-mail
  // de "Contrato Assinado", disparado poucos segundos depois, bata com o
  // que a cliente viu.
  //
  // Também grava no localStorage sob a chave definitiva (`resultToken`):
  // se a cliente trocou de idioma ANTES de preencher "Seus Dados" (quando a
  // chave de persistência ainda era `shareToken`, provisória), essa escolha
  // ficava presa numa chave que o ClientPortal.tsx nunca reconsulta depois
  // — fazendo a tela "voltar" pro português ao navegar pro portal. Gravar
  // aqui também, sob `resultToken`, garante que o ClientPortal já encontre
  // o idioma certo assim que montar, sem depender do fetch assíncrono.
  useEffect(() => {
    if (resultToken) {
      writeStoredLanguage(language, resultToken)
      clientService.updateClientLanguage(resultToken, language)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultToken])

  // Verifica contratos curtos (sem scroll necessário) ao entrar na etapa de contrato
  useEffect(() => {
    if (step !== 'contract') return
    // Aguarda o DOM renderizar antes de checar o scrollHeight
    const timer = setTimeout(() => {
      const el = contractScrollRef.current
      if (!el) return
      if (el.scrollHeight <= el.clientHeight + 10) {
        setContractRead(true)
        setContractScrollProgress(100)
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [step])

  // Resolve o nome do país no idioma atual a partir do código selecionado.
  const countryName = (code: string) => countryOptions.find(c => c.code === code)?.name || code

  // ── Submit dados (Step 1 → 2) ──────────────────────────────
  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim() || !email.trim() || !birthDate) {
      setFormError(t('signup.requiredFieldsError'))
      return
    }
    if (!phoneValid) {
      setFormError(t('signup.phoneInvalid'))
      return
    }

    setSubmitting(true)
    setFormError('')

    try {
      const country = countryName(countryCode)
      const contractData = {
        clientInfo: { fullName, email, phone, birthDate, country, ip: clientIp },
        registeredAt: new Date().toISOString(),
        planName: plan?.name,
        whatsappOptIn,
        whatsappOptInAt: whatsappOptIn ? new Date().toISOString() : null,
      }

      const { data, error } = await supabase.rpc('register_client_from_plan', {
        p_share_token: shareToken,
        p_full_name: fullName.trim(),
        p_email: email.trim().toLowerCase(),
        p_phone: phone.trim(),
        p_birth_date: birthDate,
        p_contract_data: contractData,
      })

      if (error) throw error
      if (data?.error) { setFormError(data.error); return }

      // Salva o token e vai pro contrato (não pra tela de done)
      setResultTokenLocal(data.token)
      onClientCreated(data.token)
      setContractCountryCode(countryCode)
      setContractSignTime(new Date())
      setStep('contract')
    } catch (e: any) {
      setFormError(e.message || t('signup.genericSaveError'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Scroll do contrato ─────────────────────────────────────
  const handleContractScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const total = el.scrollHeight - el.clientHeight
    if (total <= 0) { setContractRead(true); setContractScrollProgress(100); return }
    const pct = Math.round((el.scrollTop / total) * 100)
    setContractScrollProgress(pct)
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) setContractRead(true)
  }

  // ── Assinar contrato (Step 2 → 3) ─────────────────────────
  // FIX: passa contractTitle, sections e signatureDataUrl para que a edge
  // function possa gerar o PDF completo com assinatura manuscrita + IP.
  const handleContractSign = async () => {
    if (!contractAgreed || !signatureDataUrl || !resultToken) return
    setContractSigning(true)
    try {
      const signedAtStr = new Date().toISOString()
      await clientService.signContract(resultToken, {
        country: countryName(contractCountryCode),
        ip: clientIp,
        signedAt: signedAtStr,
        // ↓ Campos necessários para a edge gerar o PDF corretamente
        contractTitle: plan?.contract?.title || t('signup.contractDefaultTitle'),
        sections: plan?.contract?.sections || [],
        signatureDataUrl,                     // PNG base64 da assinatura manuscrita
        portalUrl: `${window.location.origin}/c/${resultToken}`, // Link do portal no e-mail
      })
      setSignedAt(signedAtStr)
      setStep('done')
    } catch (e: any) {
      alert(e.message || t('signup.signError'))
    } finally {
      setContractSigning(false)
    }
  }

  // ── Download do PDF (gerado localmente com IP + assinatura) ──
  const handleDownloadPdf = async () => {
    if (!plan?.contract) return
    setDownloadingPdf(true)
    try {
      await downloadContractPDF(
        plan.contract.title || t('signup.contractDefaultTitle'),
        plan.contract.sections || [],
        {
          fullName,
          email,
          phone: phone || '',
          country: countryName(contractCountryCode),
          ip: clientIp,
          signedAt: signedAt || new Date().toISOString(),
          signatureDataUrl: signatureDataUrl ?? undefined,
        },
        undefined,
        language,
      )
    } catch {
      alert(t('signup.pdfError'))
    } finally {
      setDownloadingPdf(false)
    }
  }

  // ── Loading / Error ────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--client-accent-soft)] via-[var(--client-accent-soft)] to-purple-50 flex items-center justify-center" style={clientThemeVars(plan?.admin_theme) as React.CSSProperties}>
      <div className="text-center">
        <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-[var(--client-accent-soft2)] flex items-center justify-center mx-auto mb-4">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--client-accent-light)]" />
        </div>
        <p className="text-sm text-gray-500">{t('signup.loading')}</p>
      </div>
    </div>
  )

  if (pageError || !plan) return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--client-accent-soft)] to-[var(--client-accent-soft)] flex items-center justify-center p-4" style={clientThemeVars(plan?.admin_theme) as React.CSSProperties}>
      <div className="bg-white rounded-2xl p-8 text-center max-w-md w-full shadow-sm border border-gray-100">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('signup.linkNotFoundTitle')}</h2>
        <p className="text-sm text-gray-500 mb-5">
          {pageError === 'invalid-link' ? t('signup.invalidLinkShort')
            : pageError === 'load-error' ? t('signup.loadPlanError')
            : pageError || t('signup.linkInvalid')}
        </p>
        <button onClick={onRetry} className="inline-flex items-center gap-2 text-sm text-[var(--client-accent)] hover:text-[var(--client-accent-dark)] font-medium">
          <RefreshCw className="h-4 w-4" /> {t('signup.retry')}
        </button>
      </div>
    </div>
  )

  const inp = "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--client-accent-light)] focus:border-transparent bg-white transition-all"

  // Etapas do progresso (excluindo 'welcome')
  const steps = [
    { key: 'info',     label: t('signup.stepInfoLabel') },
    { key: 'contract', label: t('signup.stepContractLabel') },
    { key: 'done',     label: t('signup.stepDoneLabel') },
  ] as const

  const stepIndex = steps.findIndex(s => s.key === step)

  // Formatação da data/hora de registro do contrato — no idioma da cliente
  const formattedContractDate = contractSignTime?.toLocaleDateString(language, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }) ?? ''
  const formattedContractTime = contractSignTime?.toLocaleTimeString(language, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) ?? ''

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--client-accent-soft)] via-[var(--client-accent-soft)] to-purple-50" style={clientThemeVars(plan?.admin_theme) as React.CSSProperties}>

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-[var(--client-accent-light)] to-[var(--client-accent)] rounded-xl flex items-center justify-center shadow-sm">
            <Palette className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-tight">IA Color</p>
            <p className="text-xs text-gray-400 truncate">{plan.name}</p>
          </div>
          <LanguageSwitcher variant="minimal" />
          <Lock className="h-4 w-4 text-gray-300 flex-shrink-0" />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Welcome ─────────────────────────────────────── */}
        {step === 'welcome' && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="h-2 bg-gradient-to-r from-[var(--client-accent-light)] via-[var(--client-accent-light)] to-purple-400" />
              <div className="px-8 py-10 text-center space-y-6">
                <div className="relative inline-flex">
                  <div className="w-20 h-20 bg-gradient-to-br from-[var(--client-accent-soft2)] to-[var(--client-accent-soft2)] rounded-full flex items-center justify-center">
                    <Sparkles className="h-9 w-9 text-[var(--client-accent-light)]" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-gradient-to-br from-[var(--client-accent-light)] to-[var(--client-accent)] rounded-full flex items-center justify-center shadow-sm">
                    <Heart className="h-3 w-3 text-white fill-white" />
                  </div>
                </div>

                <div className="space-y-3">
                  <h1 className="text-2xl font-bold text-gray-900 leading-snug">{t('signup.welcomeTitle')}</h1>
                  <p className="text-gray-600 leading-relaxed text-base">
                    {t('signup.welcomeBodyPre')}{' '}
                    <span className="text-[var(--client-accent)] font-semibold">{t('signup.welcomeBodyHighlight')}</span>{' '}
                    {t('signup.welcomeBodyPost')}
                  </p>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    {t('signup.welcomeInstructions')}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-[var(--client-accent-soft)] to-[var(--client-accent-soft)] border border-[var(--client-accent-soft2)] rounded-xl px-4 py-3 text-left">
                  <p className="text-xs text-[var(--client-accent-light)] font-semibold uppercase tracking-wider mb-0.5">{t('signup.yourPlan')}</p>
                  <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
                  {plan.description && <p className="text-xs text-gray-500 mt-0.5">{plan.description}</p>}
                </div>

                <button
                  onClick={() => setStep('info')}
                  className="w-full bg-gradient-to-r from-[var(--client-accent-light)] to-[var(--client-accent)] text-white py-3.5 rounded-xl font-semibold
                    hover:from-[var(--client-accent)] hover:to-[var(--client-accent-dark)] transition-all shadow-sm flex items-center justify-center gap-2 text-base"
                >
                  {t('signup.startNow')} <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="bg-white/70 rounded-2xl border border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('signup.howItWorks')}</p>
              <div className="space-y-3">
                {[
                  { icon: User,         label: t('signup.personalDataLabel'), desc: t('signup.personalDataDesc') },
                  { icon: CheckCircle,  label: t('signup.stepContractLabel'), desc: t('signup.contractStepDesc') },
                  { icon: Sparkles,     label: t('signup.portalLabel'),       desc: t('signup.portalDesc') },
                ].map(({ icon: Icon, label, desc }, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-[var(--client-accent-soft2)] rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="h-4 w-4 text-[var(--client-accent-light)]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{label}</p>
                      <p className="text-xs text-gray-400">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Progress bar (steps info/contract/done) ─────── */}
        {step !== 'welcome' && (
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <React.Fragment key={s.key}>
                <div className="flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
                    ${i < stepIndex ? 'bg-green-400 text-white' : i === stepIndex ? 'bg-[var(--client-accent-light)] text-white' : 'bg-gray-200 text-gray-400'}`}>
                    {i < stepIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${i === stepIndex ? 'text-[var(--client-accent)]' : 'text-gray-400'}`}>
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 rounded ${i < stepIndex ? 'bg-green-300' : 'bg-gray-200'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ── Step 1: Info ─────────────────────────────────── */}
        {step === 'info' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-[var(--client-accent-light)] to-[var(--client-accent)]" />
            <div className="p-6 space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{t('signup.infoTitle')}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{t('signup.infoSubtitle')}</p>
              </div>

              <form onSubmit={handleInfoSubmit} className="space-y-4">
                {/* E-mail — sempre o primeiro campo. É a partir dele que
                    decidimos se mostramos o cadastro completo (e-mail novo)
                    ou só o campo de senha (e-mail já cadastrado). */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t('login.emailLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    className={inp}
                    required
                    autoFocus
                  />
                </div>

                {emailExists ? (
                  <>
                    {/* ═══ E-mail já cadastrado: só pede a senha ═══════════ */}
                    {!existingAnalyses && (
                      <div>
                        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-3">
                          <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-blue-800">
                            Você já tem cadastro com esse e-mail. Digite sua senha de acesso
                            — <strong>sua data de nascimento</strong> — pra continuar.
                          </p>
                        </div>

                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          Senha (data de nascimento) <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          value={birthDate}
                          onChange={e => setBirthDate(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCheckExisting() } }}
                          className={inp}
                          required
                        />
                        {checkExistingError && (
                          <p className="text-xs text-red-600 mt-1">{checkExistingError}</p>
                        )}

                        <button
                          type="button"
                          onClick={handleCheckExisting}
                          disabled={checkingExisting || !birthDate}
                          className="w-full mt-3 bg-gradient-to-r from-[var(--client-accent-light)] to-[var(--client-accent)] text-white py-3 rounded-xl font-semibold
                            hover:from-[var(--client-accent)] hover:to-[var(--client-accent-dark)] transition-all shadow-sm flex items-center justify-center gap-2
                            disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {checkingExisting
                            ? <><Loader2 className="h-4 w-4 animate-spin" /> Verificando...</>
                            : <><LogIn className="h-4 w-4" /> Entrar</>
                          }
                        </button>
                      </div>
                    )}

                    {/* ═══ Senha confirmada: escolher o que fazer ══════════ */}
                    {existingAnalyses && existingAnalyses.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">
                          Encontramos suas análises. Toque em uma pra acessar:
                        </p>
                        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-3">
                          <div className="divide-y divide-gray-100">
                            {existingAnalyses.map(a => {
                              const isCompleted = a.status === 'completed'
                              return (
                                <button
                                  key={a.token}
                                  type="button"
                                  onClick={() => navigate(`/c/${a.token}`)}
                                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                                >
                                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                    isCompleted ? 'bg-green-100' : 'bg-amber-100'
                                  }`}>
                                    {isCompleted
                                      ? <CheckCircle className="h-4 w-4 text-green-600" />
                                      : <Loader2 className="h-4 w-4 text-amber-600" />
                                    }
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate">
                                      {a.plan_name || 'Análise de coloração'}
                                    </p>
                                    <p className={`text-xs mt-0.5 ${isCompleted ? 'text-green-600' : 'text-amber-600'}`}>
                                      {isCompleted ? 'Concluída — ver resultado' : 'Em andamento — continuar'}
                                    </p>
                                  </div>
                                  <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex-1 h-px bg-gray-200" />
                          <span className="text-xs text-gray-400">ou</span>
                          <div className="flex-1 h-px bg-gray-200" />
                        </div>

                        {formError && <ErrorBox message={formError} />}

                        <button
                          type="button"
                          onClick={handleProceedNewPlan}
                          disabled={submitting}
                          className="w-full border-2 border-[var(--client-accent)] text-[var(--client-accent-dark)] py-3 rounded-xl font-semibold
                            hover:bg-[var(--client-accent-soft)] transition-all flex items-center justify-center gap-2
                            disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {submitting
                            ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('signup.saving')}</>
                            : <>Prosseguir com esta análise nova ({plan.name}) <ChevronRight className="h-4 w-4" /></>
                          }
                        </button>
                        <p className="text-xs text-gray-400 text-center mt-2">
                          Vamos usar seu nome e telefone já cadastrados — só falta assinar o contrato.
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* ═══ E-mail novo: cadastro completo, como sempre foi ═ */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        {t('signup.fullNameLabel')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        placeholder={t('signup.fullNamePlaceholder')}
                        className={inp}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('signup.phoneLabel')}</label>
                      <PhoneInput
                        value={phone}
                        onChange={setPhone}
                        language={language}
                        placeholder={t('signup.phonePlaceholder')}
                        onValidityChange={setPhoneValid}
                      />
                      {!phoneValid && phone && (
                        <p className="text-xs text-red-500 mt-1">{t('signup.phoneInvalid')}</p>
                      )}
                      <label className="flex items-start gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={whatsappOptIn}
                          onChange={e => setWhatsappOptIn(e.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-[var(--client-accent)] flex-shrink-0"
                        />
                        <span className="text-xs text-gray-500 leading-relaxed">
                          {t('signup.whatsappOptIn')}
                        </span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        {t('signup.birthDateLabel')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={birthDate}
                        onChange={e => setBirthDate(e.target.value)}
                        className={inp}
                        required
                      />
                      <p className="text-xs text-gray-400 mt-1">{t('signup.birthDateNote')}</p>
                      {/* O placeholder nativo do <input type="date"> (ex: "dd/mm/aaaa")
                          segue o idioma do SISTEMA OPERACIONAL em alguns navegadores
                          (Chrome/Linux, por exemplo) — não dá pra forçar via código.
                          Esta legenda garante que o formato esperado sempre apareça
                          certo, independente do que o navegador decidir mostrar. */}
                      <p className="text-xs text-gray-400">{t('signup.birthDateFormatHint')}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('signup.countryLabel')}</label>
                      <select
                        value={countryCode}
                        onChange={e => setCountryCode(e.target.value)}
                        className={inp}
                      >
                        {countryOptions.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
                    </div>

                    {formError && <ErrorBox message={formError} />}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-gradient-to-r from-[var(--client-accent-light)] to-[var(--client-accent)] text-white py-3.5 rounded-xl font-semibold
                        hover:from-[var(--client-accent)] hover:to-[var(--client-accent-dark)] transition-all shadow-sm flex items-center justify-center gap-2
                        disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submitting
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('signup.saving')}</>
                        : <>{t('signup.continueToContract')} <ChevronRight className="h-4 w-4" /></>}
                    </button>
                  </>
                )}
              </form>
            </div>
          </div>
        )}

        {/* ── Step 2: Contrato ──────────────────────────────── */}
        {step === 'contract' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-[var(--client-accent-light)] to-[var(--client-accent)]" />

            <div className="p-4 sm:p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {plan.contract?.title || t('portal.contract.defaultTitle')}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {t('signup.contractReadCarefully')}
              </p>
              {(formattedContractDate || formattedContractTime) && (
                <p className="text-xs text-gray-400 mt-1">
                  {t('signup.contractStartedAt', { date: formattedContractDate, time: formattedContractTime })}
                </p>
              )}
            </div>

            {/* Área scrollável do contrato */}
            <div className="relative">
              <div
                ref={contractScrollRef}
                onScroll={handleContractScroll}
                className="px-4 sm:px-6 py-4 max-h-72 overflow-y-auto text-sm text-gray-700 leading-relaxed space-y-4"
                style={{ scrollbarWidth: 'thin' }}
              >
                {(!plan.contract?.sections || plan.contract.sections.length === 0) && (
                  <p className="text-gray-400 text-center py-8">{t('portal.contract.noClauses')}</p>
                )}
                {plan.contract?.sections?.map(s => (
                  <div key={s.id}>
                    <h4 className="font-semibold text-gray-800 mb-1.5">{s.title}</h4>
                    <p className="whitespace-pre-wrap">{s.content}</p>
                  </div>
                ))}
              </div>

              {/* Gradiente inferior — enquanto não terminou de ler */}
              {!contractRead && contractScrollProgress < 80 && (
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
              )}
            </div>

            {/* Indicador "continue rolando" */}
            {!contractRead && (
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

            {/* Ações de assinatura */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-t border-gray-100 space-y-4">

              {/* País de residência */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('portal.contract.countryLabel')}
                </label>
                <select
                  value={contractCountryCode}
                  onChange={e => setContractCountryCode(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--client-accent-light)] focus:border-transparent bg-white"
                >
                  {countryOptions.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </div>

              {/* Assinatura manuscrita */}
              <SignatureCanvas onSignature={setSignatureDataUrl} />

              {/* Checkbox — bloqueado até ler */}
              <label className={`flex items-start gap-2.5 ${contractRead ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                <input
                  type="checkbox"
                  checked={contractAgreed}
                  onChange={e => contractRead && setContractAgreed(e.target.checked)}
                  disabled={!contractRead}
                  className="mt-0.5 w-4 h-4 accent-[var(--client-accent)]"
                />
                <span className="text-sm text-gray-700">{t('portal.contract.agreeLabel')}</span>
              </label>

              {/* Botão de assinatura */}
              {!contractRead ? (
                <div className="w-full flex flex-col items-center justify-center gap-1 py-3.5 rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-800 cursor-not-allowed select-none">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    <span className="font-semibold text-sm">{t('portal.contract.lockedTitle')}</span>
                  </div>
                  <p className="text-xs text-amber-700">
                    {t('portal.contract.lockedNote', { percent: contractScrollProgress })}
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleContractSign}
                  disabled={!contractAgreed || !signatureDataUrl || contractSigning}
                  className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[var(--client-accent-light)] to-[var(--client-accent)]
                    text-white py-3.5 rounded-xl font-semibold hover:from-[var(--client-accent)] hover:to-[var(--client-accent-dark)]
                    transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {contractSigning
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('portal.contract.signing')}</>
                    : <><Check className="h-4 w-4" /> {t('portal.contract.signButton')}</>}
                </button>
              )}

              {contractRead && (!contractAgreed || !signatureDataUrl) && (
                <p className="text-xs text-gray-400 text-center">
                  {!signatureDataUrl
                    ? t('signup.drawSignatureNote')
                    : t('portal.contract.confirmNote')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Concluído ────────────────────────────── */}
        {step === 'done' && (
          <div className="space-y-4">

            {/* Card principal — contrato assinado */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Faixa verde */}
              <div className="h-1.5 bg-gradient-to-r from-green-400 to-emerald-400" />

              <div className="p-8 text-center space-y-5">
                {/* Ícone */}
                <div className="w-20 h-20 bg-gradient-to-br from-green-50 to-emerald-50 rounded-full flex items-center justify-center mx-auto border border-green-100">
                  <CheckCircle className="h-10 w-10 text-green-500" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-gray-900">{t('signup.doneTitle')}</h2>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    {t('signup.doneBodyPre')}{' '}
                    <span className="font-semibold text-gray-700">{email}</span>{' '}
                    {t('signup.doneBodyPost')}
                  </p>
                </div>

                {/* Dados de acesso */}
                <div className="bg-gradient-to-br from-gray-50 to-[var(--client-accent-soft)]/30 rounded-2xl p-5 text-left space-y-3 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('signup.accessDataTitle')}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400">{t('signup.loginLabel')}</p>
                      <p className="font-semibold text-gray-900 text-sm mt-0.5">{email}</p>
                    </div>
                    <Mail className="h-5 w-5 text-[var(--client-accent-light)]" />
                  </div>
                  <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400">{t('signup.passwordLabel')}</p>
                      <p className="font-semibold text-gray-900 text-sm mt-0.5">
                        {birthDate.split('-').reverse().join('/')}
                      </p>
                      <p className="text-xs text-gray-400">{t('signup.passwordNote')}</p>
                    </div>
                    <Calendar className="h-5 w-5 text-[var(--client-accent-light)]" />
                  </div>
                </div>

                {/* Baixar PDF */}
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="w-full border border-[var(--client-accent-light)] text-[var(--client-accent)] py-3.5 rounded-xl font-semibold
                    hover:bg-[var(--client-accent-soft)] transition-all flex items-center justify-center gap-2
                    disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {downloadingPdf
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('signup.generatingPdf')}</>
                    : <><Download className="h-4 w-4" /> {t('signup.downloadPdf')}</>}
                </button>

                {/* Prosseguir para o portal */}
                <button
                  onClick={() => navigate(`/c/${resultToken}`)}
                  className="w-full bg-gradient-to-r from-[var(--client-accent-light)] to-[var(--client-accent)] text-white py-3.5 rounded-xl font-semibold
                    hover:from-[var(--client-accent)] hover:to-[var(--client-accent-dark)] transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  {t('signup.proceedToNextSteps')} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Próximas etapas */}
            <div className="bg-white/70 rounded-2xl border border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('signup.whatsNext')}</p>
              <div className="space-y-3">
                {[
                  { label: t('signup.nextStepFormLabel'),   desc: t('signup.nextStepFormDesc') },
                  { label: t('signup.nextStepPhotosLabel'), desc: t('signup.nextStepPhotosDesc') },
                  { label: t('signup.nextStepResultLabel'), desc: t('signup.nextStepResultDesc') },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-[var(--client-accent-soft2)] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-[var(--client-accent)]">{i + 1}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{item.label}</p>
                      <p className="text-xs text-gray-400">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 pb-4">
          {t('signup.footerTagline')}
        </p>
      </div>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
      <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-red-700">{message}</p>
    </div>
  )
}