// src/components/client/ClientSignup.tsx
import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Palette, User, Mail, Phone, Calendar, CheckCircle,
  AlertCircle, Loader2, ChevronRight, ArrowLeft,
  RefreshCw, Lock, Sparkles, Heart, Globe,
  Check, ChevronDown, ChevronUp, Download,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { clientService } from '../../lib/services'
import { SignatureCanvas } from './SignatureCanvas'
import { downloadContractPDF } from '../../lib/contractPDFGenerator'

// ── Lista de países (Brasil primeiro) ────────────────────────────────────────
const COUNTRIES = [
  'Brasil',
  'Afeganistão', 'África do Sul', 'Albânia', 'Alemanha', 'Andorra', 'Angola',
  'Antígua e Barbuda', 'Arábia Saudita', 'Argélia', 'Argentina', 'Armênia',
  'Austrália', 'Áustria', 'Azerbaijão', 'Bahamas', 'Bangladesh', 'Barbados',
  'Barein', 'Bélgica', 'Belize', 'Benin', 'Bielorrússia', 'Bolívia',
  'Bósnia e Herzegovina', 'Botsuana', 'Brunei', 'Bulgária', 'Burquina Faso',
  'Burundi', 'Butão', 'Cabo Verde', 'Camarões', 'Camboja', 'Canadá', 'Catar',
  'Cazaquistão', 'Chade', 'Chile', 'China', 'Chipre', 'Colômbia', 'Comores',
  'Congo', 'Coreia do Norte', 'Coreia do Sul', 'Costa do Marfim', 'Costa Rica',
  'Croácia', 'Cuba', 'Dinamarca', 'Djibuti', 'Dominica', 'Egito', 'El Salvador',
  'Emirados Árabes Unidos', 'Equador', 'Eritreia', 'Eslováquia', 'Eslovênia',
  'Espanha', 'Eswatini', 'Estado da Palestina', 'Estados Unidos', 'Estônia',
  'Etiópia', 'Fiji', 'Filipinas', 'Finlândia', 'França', 'Gabão', 'Gâmbia',
  'Gana', 'Geórgia', 'Granada', 'Grécia', 'Guatemala', 'Guiana', 'Guiné',
  'Guiné Equatorial', 'Guiné-Bissau', 'Haiti', 'Honduras', 'Hungria', 'Iêmen',
  'Ilhas Marshall', 'Ilhas Salomão', 'Índia', 'Indonésia', 'Irã', 'Iraque',
  'Irlanda', 'Islândia', 'Israel', 'Itália', 'Jamaica', 'Japão', 'Jordânia',
  'Kiribati', 'Kuwait', 'Laos', 'Lesoto', 'Letônia', 'Líbano', 'Libéria',
  'Líbia', 'Liechtenstein', 'Lituânia', 'Luxemburgo', 'Macedônia do Norte',
  'Madagáscar', 'Malásia', 'Malawi', 'Maldivas', 'Mali', 'Malta', 'Marrocos',
  'Maurícia', 'Mauritânia', 'México', 'Micronésia', 'Moçambique', 'Moldávia',
  'Mônaco', 'Mongólia', 'Montenegro', 'Myanmar', 'Namíbia', 'Nauru', 'Nepal',
  'Nicarágua', 'Níger', 'Nigéria', 'Noruega', 'Nova Zelândia', 'Omã',
  'Países Baixos', 'Paquistão', 'Palau', 'Panamá', 'Papua Nova Guiné',
  'Paraguai', 'Peru', 'Polônia', 'Portugal', 'Quênia', 'Quirguistão',
  'República Centro-Africana', 'República Checa', 'República Democrática do Congo',
  'República Dominicana', 'Romênia', 'Ruanda', 'Rússia', 'Samoa', 'San Marino',
  'Santa Lúcia', 'São Cristóvão e Névis', 'São Tomé e Príncipe',
  'São Vicente e Granadinas', 'Senegal', 'Serra Leoa', 'Sérvia', 'Seychelles',
  'Singapura', 'Síria', 'Somália', 'Sri Lanka', 'Sudão', 'Sudão do Sul',
  'Suécia', 'Suíça', 'Suriname', 'Tailândia', 'Tanzânia', 'Timor-Leste',
  'Togo', 'Tonga', 'Trinidad e Tobago', 'Tunísia', 'Turcomenistão', 'Turquia',
  'Tuvalu', 'Ucrânia', 'Uganda', 'Uruguai', 'Uzbequistão', 'Vanuatu',
  'Vaticano', 'Venezuela', 'Vietnã', 'Zâmbia', 'Zimbábue',
]

interface PlanData {
  id: string
  name: string
  description: string
  contract: { title?: string; sections?: { id: string; title: string; content: string; order: number }[] } | null
  form_config: any
  photo_categories: any
}

// Fluxo completo: welcome → info (dados) → contract (assinatura) → done (confirmação)
type Step = 'welcome' | 'info' | 'contract' | 'done'

export function ClientSignup() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const navigate = useNavigate()

  const [plan, setPlan] = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [step, setStep] = useState<Step>('welcome')

  // ── Step: Dados ───────────────────────────────────────────
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [country, setCountry] = useState('Brasil')
  const [clientIp, setClientIp] = useState('Obtendo...')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [resultToken, setResultToken] = useState('')

  // ── Step: Contrato ────────────────────────────────────────
  const [contractRead, setContractRead] = useState(false)
  const [contractAgreed, setContractAgreed] = useState(false)
  const [contractSigning, setContractSigning] = useState(false)
  const [contractScrollProgress, setContractScrollProgress] = useState(0)
  const [contractCountry, setContractCountry] = useState('Brasil')
  const [contractSignTime, setContractSignTime] = useState<Date | null>(null)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [signedAt, setSignedAt] = useState<string>('')
  const contractScrollRef = useRef<HTMLDivElement>(null)

  // ── Step: Done ────────────────────────────────────────────
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  // ── Load plan ──────────────────────────────────────────────
  useEffect(() => {
    if (!shareToken) { setPageError('Link inválido.'); setLoading(false); return }
    loadPlan()
  }, [shareToken])

  // Busca o IP real do cliente
  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => setClientIp(d.ip || 'Não disponível'))
      .catch(() => setClientIp('Não disponível'))
  }, [])

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

  const loadPlan = async () => {
    setLoading(true)
    setPageError('')
    try {
      const { data, error } = await supabase.rpc('get_plan_by_share_token', { p_token: shareToken })
      if (error) throw error
      if (data?.error) { setPageError(data.error); return }
      setPlan(data)
    } catch {
      setPageError('Não foi possível carregar o plano. Verifique o link ou tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  // ── Submit dados (Step 1 → 2) ──────────────────────────────
  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim() || !email.trim() || !birthDate) {
      setFormError('Preencha todos os campos obrigatórios.')
      return
    }

    setSubmitting(true)
    setFormError('')

    try {
      const contractData = {
        clientInfo: { fullName, email, phone, birthDate, country, ip: clientIp },
        registeredAt: new Date().toISOString(),
        planName: plan?.name,
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
      setResultToken(data.token)
      setContractSignTime(new Date())
      setStep('contract')
    } catch (e: any) {
      setFormError(e.message || 'Erro ao criar conta. Tente novamente.')
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
        country: contractCountry,
        ip: clientIp,
        signedAt: signedAtStr,
        // ↓ Campos necessários para a edge gerar o PDF corretamente
        contractTitle: plan?.contract?.title || 'Contrato de Prestação de Serviços',
        sections: plan?.contract?.sections || [],
        signatureDataUrl,                     // PNG base64 da assinatura manuscrita
      })
      setSignedAt(signedAtStr)
      setStep('done')
    } catch (e: any) {
      alert(e.message || 'Erro ao assinar contrato. Tente novamente.')
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
        plan.contract.title || 'Contrato de Prestação de Serviços',
        plan.contract.sections || [],
        {
          fullName,
          email,
          phone: phone || '',
          country: contractCountry,
          ip: clientIp,
          signedAt: signedAt || new Date().toISOString(),
          signatureDataUrl: signatureDataUrl ?? undefined,
        }
      )
    } catch {
      alert('Erro ao gerar o PDF. Tente novamente.')
    } finally {
      setDownloadingPdf(false)
    }
  }

  // ── Loading / Error ────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-purple-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-rose-100 flex items-center justify-center mx-auto mb-4">
          <Loader2 className="h-6 w-6 animate-spin text-rose-400" />
        </div>
        <p className="text-sm text-gray-500">Preparando sua experiência...</p>
      </div>
    </div>
  )

  if (pageError || !plan) return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 text-center max-w-md w-full shadow-sm border border-gray-100">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Link não encontrado</h2>
        <p className="text-sm text-gray-500 mb-5">{pageError || 'O link pode estar incorreto ou expirado.'}</p>
        <button onClick={loadPlan} className="inline-flex items-center gap-2 text-sm text-rose-500 hover:text-rose-600 font-medium">
          <RefreshCw className="h-4 w-4" /> Tentar novamente
        </button>
      </div>
    </div>
  )

  const inp = "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent bg-white transition-all"

  // Etapas do progresso (excluindo 'welcome')
  const steps = [
    { key: 'info',     label: 'Seus Dados' },
    { key: 'contract', label: 'Contrato'   },
    { key: 'done',     label: 'Concluído'  },
  ] as const

  const stepIndex = steps.findIndex(s => s.key === step)

  // Formatação da data/hora de registro do contrato
  const formattedContractDate = contractSignTime?.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }) ?? ''
  const formattedContractTime = contractSignTime?.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) ?? ''

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-purple-50">

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-rose-400 to-pink-500 rounded-xl flex items-center justify-center shadow-sm">
            <Palette className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-tight">MS Colors</p>
            <p className="text-xs text-gray-400 truncate">{plan.name}</p>
          </div>
          <Lock className="h-4 w-4 text-gray-300" />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Welcome ─────────────────────────────────────── */}
        {step === 'welcome' && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="h-2 bg-gradient-to-r from-rose-400 via-pink-400 to-purple-400" />
              <div className="px-8 py-10 text-center space-y-6">
                <div className="relative inline-flex">
                  <div className="w-20 h-20 bg-gradient-to-br from-rose-100 to-pink-100 rounded-full flex items-center justify-center">
                    <Sparkles className="h-9 w-9 text-rose-400" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-gradient-to-br from-pink-400 to-rose-500 rounded-full flex items-center justify-center shadow-sm">
                    <Heart className="h-3 w-3 text-white fill-white" />
                  </div>
                </div>

                <div className="space-y-3">
                  <h1 className="text-2xl font-bold text-gray-900 leading-snug">Bem-vindo(a)!</h1>
                  <p className="text-gray-600 leading-relaxed text-base">
                    Estou muito feliz em ter você aqui para começarmos essa{' '}
                    <span className="text-rose-500 font-semibold">jornada de autoconhecimento</span>{' '}
                    através das cores.
                  </p>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    Preencha seus dados, leia e assine o contrato, tudo aqui mesmo e, em seguida,
                    acesse seu portal para continuar o atendimento.
                  </p>
                </div>

                <div className="bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-100 rounded-xl px-4 py-3 text-left">
                  <p className="text-xs text-rose-400 font-semibold uppercase tracking-wider mb-0.5">Seu plano</p>
                  <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
                  {plan.description && <p className="text-xs text-gray-500 mt-0.5">{plan.description}</p>}
                </div>

                <button
                  onClick={() => setStep('info')}
                  className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-3.5 rounded-xl font-semibold
                    hover:from-rose-500 hover:to-pink-600 transition-all shadow-sm flex items-center justify-center gap-2 text-base"
                >
                  Começar agora <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="bg-white/70 rounded-2xl border border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Como funciona</p>
              <div className="space-y-3">
                {[
                  { icon: User,         label: 'Dados pessoais',    desc: 'Preencha seu nome, e-mail e telefone' },
                  { icon: CheckCircle,  label: 'Contrato',          desc: 'Leia e assine digitalmente' },
                  { icon: Sparkles,     label: 'Portal exclusivo',  desc: 'Acesse para enviar formulário e fotos' },
                ].map(({ icon: Icon, label, desc }, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-rose-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="h-4 w-4 text-rose-400" />
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
                    ${i < stepIndex ? 'bg-green-400 text-white' : i === stepIndex ? 'bg-rose-400 text-white' : 'bg-gray-200 text-gray-400'}`}>
                    {i < stepIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${i === stepIndex ? 'text-rose-500' : 'text-gray-400'}`}>
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
            <div className="h-1.5 bg-gradient-to-r from-rose-400 to-pink-500" />
            <div className="p-6 space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Seus dados</h2>
                <p className="text-sm text-gray-500 mt-0.5">Preencha as informações abaixo para continuar</p>
              </div>

              <form onSubmit={handleInfoSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Nome completo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Seu nome completo"
                    className={inp}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    E-mail <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className={inp}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Telefone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                    className={inp}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Data de nascimento <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={e => setBirthDate(e.target.value)}
                    className={inp}
                    required
                  />
                  <p className="text-xs text-gray-400 mt-1">Será usada como sua senha de acesso ao portal</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">País</label>
                  <select
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    className={inp}
                  >
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {formError && <ErrorBox message={formError} />}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-3.5 rounded-xl font-semibold
                    hover:from-rose-500 hover:to-pink-600 transition-all shadow-sm flex items-center justify-center gap-2
                    disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
                    : <>Continuar para o contrato <ChevronRight className="h-4 w-4" /></>}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── Step 2: Contrato ──────────────────────────────── */}
        {step === 'contract' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-rose-400 to-pink-500" />

            <div className="p-4 sm:p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {plan.contract?.title || 'Contrato de Prestação de Serviços'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Leia com atenção antes de assinar
              </p>
              {(formattedContractDate || formattedContractTime) && (
                <p className="text-xs text-gray-400 mt-1">
                  Iniciado em {formattedContractDate} às {formattedContractTime}
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
                  <p className="text-gray-400 text-center py-8">Nenhuma cláusula configurada</p>
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
                  Continue rolando para ler o contrato completo
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
                  País de residência
                </label>
                <select
                  value={contractCountry}
                  onChange={e => setContractCountry(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent bg-white"
                >
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
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
                  className="mt-0.5 w-4 h-4 accent-rose-500"
                />
                <span className="text-sm text-gray-700">Li e concordo com os termos do contrato</span>
              </label>

              {/* Botão de assinatura */}
              {!contractRead ? (
                <div className="w-full flex flex-col items-center justify-center gap-1 py-3.5 rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-800 cursor-not-allowed select-none">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    <span className="font-semibold text-sm">Assinatura bloqueada</span>
                  </div>
                  <p className="text-xs text-amber-700">
                    Role até o final do contrato ({contractScrollProgress}% lido)
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleContractSign}
                  disabled={!contractAgreed || !signatureDataUrl || contractSigning}
                  className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-rose-400 to-pink-500
                    text-white py-3.5 rounded-xl font-semibold hover:from-rose-500 hover:to-pink-600
                    transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {contractSigning
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Assinando...</>
                    : <><Check className="h-4 w-4" /> Assinar Contrato</>}
                </button>
              )}

              {contractRead && (!contractAgreed || !signatureDataUrl) && (
                <p className="text-xs text-gray-400 text-center">
                  {!signatureDataUrl
                    ? 'Desenhe e confirme sua assinatura acima para continuar'
                    : 'Marque a caixa acima para confirmar que leu e concordou'}
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
                  <h2 className="text-2xl font-bold text-gray-900">Contrato assinado!</h2>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    Uma cópia foi enviada para{' '}
                    <span className="font-semibold text-gray-700">{email}</span>{' '}
                    e para a consultora. Você também pode baixar agora.
                  </p>
                </div>

                {/* Dados de acesso */}
                <div className="bg-gradient-to-br from-gray-50 to-rose-50/30 rounded-2xl p-5 text-left space-y-3 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Seus dados de acesso</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400">Login</p>
                      <p className="font-semibold text-gray-900 text-sm mt-0.5">{email}</p>
                    </div>
                    <Mail className="h-5 w-5 text-rose-300" />
                  </div>
                  <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400">Senha</p>
                      <p className="font-semibold text-gray-900 text-sm mt-0.5">
                        {birthDate.split('-').reverse().join('/')}
                      </p>
                      <p className="text-xs text-gray-400">Sua data de nascimento</p>
                    </div>
                    <Calendar className="h-5 w-5 text-rose-300" />
                  </div>
                </div>

                {/* Baixar PDF */}
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="w-full border border-rose-300 text-rose-500 py-3.5 rounded-xl font-semibold
                    hover:bg-rose-50 transition-all flex items-center justify-center gap-2
                    disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {downloadingPdf
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando PDF...</>
                    : <><Download className="h-4 w-4" /> Baixar contrato em PDF</>}
                </button>

                {/* Prosseguir para o portal */}
                <button
                  onClick={() => navigate(`/c/${resultToken}`)}
                  className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-3.5 rounded-xl font-semibold
                    hover:from-rose-500 hover:to-pink-600 transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  Prosseguir para as próximas etapas <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Próximas etapas */}
            <div className="bg-white/70 rounded-2xl border border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">O que vem a seguir</p>
              <div className="space-y-3">
                {[
                  { label: 'Formulário de análise', desc: 'Responda algumas perguntas sobre você' },
                  { label: 'Envio de fotos', desc: 'Envie as fotos conforme as instruções' },
                  { label: 'Sua análise personalizada', desc: 'Receba sua paleta de cores exclusiva' },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-rose-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-rose-500">{i + 1}</span>
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
          MS Colors · Coloração Pessoal por Marília Santos
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