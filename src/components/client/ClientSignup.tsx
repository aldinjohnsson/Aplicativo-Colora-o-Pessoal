// src/components/client/ClientSignup.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Palette, User, Mail, Phone, Calendar, CheckCircle,
  AlertCircle, Loader2, ChevronRight, PenTool, ArrowLeft,
  RefreshCw, Lock, Download, Sparkles, Heart
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { generateContractPDF } from '../../lib/contractPDFGenerator'

interface PlanData {
  id: string
  name: string
  description: string
  contract: { title?: string; sections?: { id: string; title: string; content: string; order: number }[] } | null
  form_config: any
  photo_categories: any
}

type Step = 'welcome' | 'info' | 'contract' | 'done'

export function ClientSignup() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const navigate = useNavigate()

  const [plan, setPlan] = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [step, setStep] = useState<Step>('welcome')

  // Step 2 fields
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [resultToken, setResultToken] = useState('')
  const [downloadingPDF, setDownloadingPDF] = useState(false)

  // Contract
  const [agreed, setAgreed] = useState(false)
  const [hasScrolled, setHasScrolled] = useState(false)
  const contractRef = useRef<HTMLDivElement>(null)

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSigned, setHasSigned] = useState(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  // ── Load plan ──────────────────────────────────────────────

  useEffect(() => {
    if (!shareToken) { setPageError('Link inválido.'); setLoading(false); return }
    loadPlan()
  }, [shareToken])

  const loadPlan = async () => {
    setLoading(true)
    setPageError('')
    try {
      const { data, error } = await supabase.rpc('get_plan_by_share_token', { p_token: shareToken })
      if (error) throw error
      if (data?.error) { setPageError(data.error); return }
      setPlan(data)
    } catch (e: any) {
      setPageError('Não foi possível carregar o plano. Verifique o link ou tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  // ── Canvas setup ───────────────────────────────────────────

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    canvas.width = rect.width * window.devicePixelRatio
    canvas.height = rect.height * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    ctx.strokeStyle = '#be185d'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.putImageData(imageData, 0, 0)
  }, [])

  useEffect(() => {
    if (step !== 'contract') return
    const timer = setTimeout(setupCanvas, 150)
    return () => clearTimeout(timer)
  }, [step, setupCanvas])

  // ── Signature drawing ──────────────────────────────────────

  const getCanvasPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    setIsDrawing(true)
    const pos = getCanvasPos(e)
    lastPos.current = pos
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    if (!isDrawing) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !lastPos.current) return
    const pos = getCanvasPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
    if (!hasSigned) setHasSigned(true)
  }

  const stopDraw = () => { setIsDrawing(false); lastPos.current = null }

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSigned(false)
  }

  // ── Scroll detection ───────────────────────────────────────

  const handleContractScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) setHasScrolled(true)
  }

  useEffect(() => {
    if (step === 'contract') {
      const el = contractRef.current
      if (!el) return
      if (el.scrollHeight <= el.clientHeight + 60) setHasScrolled(true)
    }
  }, [step])

  // ── Submit info ────────────────────────────────────────────

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim() || !email.trim() || !birthDate) {
      setFormError('Preencha todos os campos obrigatórios.')
      return
    }
    setFormError('')
    setStep('contract')
  }

  // ── Submit contract ────────────────────────────────────────

  const hasContract = !!(plan?.contract?.sections && plan.contract.sections.length > 0)
  const canSign = agreed && (hasSigned || !hasContract) && (hasScrolled || !hasContract)

  const handleSign = async () => {
    if (!agreed) { setFormError('Aceite os termos para continuar.'); return }
    if (hasContract && !hasSigned) { setFormError('Por favor, assine no campo de assinatura.'); return }
    if (hasContract && !hasScrolled) { setFormError('Role o contrato até o final antes de assinar.'); return }

    setSubmitting(true)
    setFormError('')

    try {
      const signedAt = new Date().toISOString()
      const signatureDataUrl = hasContract ? (canvasRef.current?.toDataURL('image/png') || '') : ''
      const contractData = {
        clientInfo: { fullName, email, phone, birthDate },
        signature: signatureDataUrl,
        signedAt,
        agreed: true,
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

      setResultToken(data.token)

      // Enviar e-mail com o token diretamente (não depender do state)
      try {
        const portalUrl = `${window.location.origin}/c/${data.token}`
        await supabase.functions.invoke('send-contract-email', {
          body: {
            type: 'contract_signed',
            clientName: fullName.trim(),
            clientEmail: email.trim().toLowerCase(),
            planName: plan?.name,
            signedAt,
            contractTitle: plan?.contract?.title,
            sections: plan?.contract?.sections,
            portalUrl,
          }
        })
      } catch (e) {
        console.warn('Erro ao enviar e-mail do contrato:', e)
      }

      setStep('done')
    } catch (e: any) {
      setFormError(e.message || 'Erro ao criar conta. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Download PDF ───────────────────────────────────────────

  const handleDownloadPDF = async () => {
    if (!plan?.contract) return
    setDownloadingPDF(true)
    try {
      const { downloadContractPDF } = await import('../../lib/contractPDFGenerator')
      await downloadContractPDF(
        plan.contract.title || 'Contrato',
        plan.contract.sections || [],
        { fullName, email, phone: phone || '' },
        new Date().toISOString()
      )
    } catch (e) {
      console.error('Erro ao gerar PDF:', e)
    } finally {
      setDownloadingPDF(false)
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

  const steps = [
    { key: 'info', label: 'Seus Dados' },
    { key: 'contract', label: 'Contrato' },
    { key: 'done', label: 'Concluído' },
  ] as const

  const stepIndex = steps.findIndex(s => s.key === step)

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
            {/* Card de boas-vindas */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Faixa decorativa */}
              <div className="h-2 bg-gradient-to-r from-rose-400 via-pink-400 to-purple-400" />

              <div className="px-8 py-10 text-center space-y-6">
                {/* Ícone */}
                <div className="relative inline-flex">
                  <div className="w-20 h-20 bg-gradient-to-br from-rose-100 to-pink-100 rounded-full flex items-center justify-center">
                    <Sparkles className="h-9 w-9 text-rose-400" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-gradient-to-br from-pink-400 to-rose-500 rounded-full flex items-center justify-center shadow-sm">
                    <Heart className="h-3 w-3 text-white fill-white" />
                  </div>
                </div>

                {/* Mensagem de boas-vindas */}
                <div className="space-y-3">
                  <h1 className="text-2xl font-bold text-gray-900 leading-snug">
                    Bem-vinda!
                  </h1>
                  <p className="text-gray-600 leading-relaxed text-base">
                    Estou muito feliz em ter você aqui para começarmos essa{' '}
                    <span className="text-rose-500 font-semibold">jornada de autoconhecimento</span>{' '}
                    através das cores.
                  </p>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    Para prosseguir, preencha seus dados abaixo e, em seguida, realize a assinatura do contrato.
                  </p>
                </div>

                {/* Plano */}
                <div className="bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-100 rounded-xl px-4 py-3 text-left">
                  <p className="text-xs text-rose-400 font-semibold uppercase tracking-wider mb-0.5">Seu plano</p>
                  <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
                  {plan.description && <p className="text-xs text-gray-500 mt-0.5">{plan.description}</p>}
                </div>

                {/* Botão */}
                <button
                  onClick={() => setStep('info')}
                  className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-3.5 rounded-xl font-semibold
                    hover:from-rose-500 hover:to-pink-600 transition-all shadow-sm flex items-center justify-center gap-2 text-base"
                >
                  Começar agora <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Etapas do processo */}
            <div className="bg-white/70 rounded-2xl border border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Como funciona</p>
              <div className="space-y-3">
                {[
                  { n: '1', label: 'Preencha seus dados', desc: 'Nome, e-mail e informações básicas' },
                  { n: '2', label: 'Assine o contrato', desc: 'Leia e assine digitalmente' },
                  { n: '3', label: 'Acesse seu portal', desc: 'Formulário e envio de fotos' },
                ].map(item => (
                  <div key={item.n} className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-rose-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-rose-500">{item.n}</span>
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

        {/* ── Steps info/contract/done ─────────────────────── */}
        {step !== 'welcome' && (
          <div className="flex items-center gap-0">
            {steps.map(({ key, label }, i) => {
              const done = i < stepIndex
              const active = i === stepIndex
              return (
                <React.Fragment key={key}>
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      done ? 'bg-rose-400 text-white shadow-sm' :
                      active ? 'bg-white text-rose-500 ring-2 ring-rose-400 shadow-sm' :
                      'bg-gray-100 text-gray-400'
                    }`}>
                      {done ? <CheckCircle className="h-4 w-4" /> : i + 1}
                    </div>
                    <span className={`text-xs font-medium ${active ? 'text-rose-500' : done ? 'text-gray-500' : 'text-gray-300'}`}>
                      {label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${done ? 'bg-rose-300' : 'bg-gray-200'}`} />
                  )}
                </React.Fragment>
              )
            })}
          </div>
        )}

        {/* ── Step 1: Dados ───────────────────────────────── */}
        {step === 'info' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-5 bg-gradient-to-r from-rose-50 to-pink-50 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <button onClick={() => setStep('welcome')} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Seus dados</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Preencha as informações abaixo para continuar.</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleInfoSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Nome completo <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input value={fullName} onChange={e => setFullName(e.target.value)} required autoFocus
                    placeholder="Seu nome completo" className={`${inp} pl-10`} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  E-mail <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                    placeholder="seu@email.com" className={`${inp} pl-10`} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Telefone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="(41) 99999-9999" className={`${inp} pl-10`} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Data de nascimento <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} required
                    className={`${inp} pl-10`} />
                </div>
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Será usada como senha para acessar seu portal
                </p>
              </div>

              {formError && <ErrorBox message={formError} />}

              <button type="submit"
                className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-3.5 rounded-xl font-semibold
                  hover:from-rose-500 hover:to-pink-600 transition-all shadow-sm flex items-center justify-center gap-2">
                Continuar para o Contrato <ChevronRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}

        {/* ── Step 2: Contrato ────────────────────────────── */}
        {step === 'contract' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-5 bg-gradient-to-r from-rose-50 to-pink-50 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <button onClick={() => { setStep('info'); setFormError('') }}
                  className="text-gray-400 hover:text-gray-600 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Contrato de Serviço</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {hasContract ? 'Leia, assine e aceite os termos' : 'Confirme para criar sua conta'}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Contratante */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3.5">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1.5">Contratante</p>
                <p className="text-sm font-medium text-blue-900">{fullName}</p>
                <p className="text-sm text-blue-600">{email}</p>
                {phone && <p className="text-sm text-blue-600">{phone}</p>}
              </div>

              {/* Texto do contrato */}
              {hasContract ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Role até o final para continuar
                    {!hasScrolled && <span className="ml-1 text-amber-500">▼</span>}
                  </p>
                  <div
                    ref={contractRef}
                    onScroll={handleContractScroll}
                    className={`bg-gray-50 border rounded-xl p-5 max-h-56 overflow-y-auto text-sm text-gray-700 leading-relaxed space-y-3 transition-colors ${
                      hasScrolled ? 'border-green-200' : 'border-gray-200'
                    }`}
                  >
                    {plan.contract!.title && (
                      <p className="font-bold text-center text-gray-900 text-base">{plan.contract!.title}</p>
                    )}
                    {plan.contract!.sections!
                      .sort((a, b) => a.order - b.order)
                      .map((s, i) => (
                        <div key={s.id || i}>
                          {s.title && <p className="font-semibold text-gray-900">{s.title}</p>}
                          <p className="whitespace-pre-wrap">{s.content}</p>
                        </div>
                      ))}
                    <div className="h-2" />
                  </div>
                  {hasScrolled && (
                    <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Contrato lido
                    </p>
                  )}
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-4 text-center">
                  <p className="text-sm text-amber-700">
                    Nenhum contrato foi configurado para este plano. Prossiga para confirmar seu cadastro.
                  </p>
                </div>
              )}

              {/* Assinatura */}
              {hasContract && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                    <PenTool className="h-4 w-4 text-gray-400" />
                    Assinatura <span className="text-rose-400">*</span>
                  </label>
                  <div className={`border-2 rounded-xl overflow-hidden bg-white relative transition-colors ${
                    hasSigned ? 'border-rose-300' : 'border-dashed border-gray-200'
                  }`}>
                    <canvas
                      ref={canvasRef}
                      className="w-full touch-none cursor-crosshair block"
                      style={{ height: '130px' }}
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={stopDraw}
                      onMouseLeave={stopDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={stopDraw}
                    />
                    {!hasSigned && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <PenTool className="h-6 w-6 text-gray-200 mb-1" />
                        <p className="text-gray-300 text-sm">Assine aqui com o dedo ou mouse</p>
                      </div>
                    )}
                  </div>
                  {hasSigned && (
                    <button onClick={clearSignature}
                      className="text-xs text-gray-400 hover:text-red-500 mt-1.5 transition-colors">
                      Limpar e assinar novamente
                    </button>
                  )}
                </div>
              )}

              {/* Checkbox */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5">
                  <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="sr-only" />
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                    agreed ? 'bg-rose-400 border-rose-400' : 'border-gray-300 group-hover:border-rose-300'
                  }`}>
                    {agreed && <CheckCircle className="h-3.5 w-3.5 text-white" />}
                  </div>
                </div>
                <span className="text-sm text-gray-700 leading-relaxed">
                  {hasContract
                    ? 'Li e concordo com todos os termos do contrato de prestação de serviços.'
                    : 'Confirmo que desejo criar minha conta e prosseguir com a análise de coloração pessoal.'}
                </span>
              </label>

              {hasContract && !hasScrolled && agreed && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-700">Role o contrato até o final antes de assinar.</p>
                </div>
              )}

              {formError && <ErrorBox message={formError} />}

              <button
                onClick={handleSign}
                disabled={submitting || !canSign}
                className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-3.5 rounded-xl font-semibold
                  hover:from-rose-500 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2 shadow-sm"
              >
                {submitting
                  ? <><Loader2 className="h-5 w-5 animate-spin" /> Enviando contrato...</>
                  : <><CheckCircle className="h-4 w-4" /> Assinar e enviar</>}
              </button>

              <p className="text-center text-xs text-gray-400">
                Uma cópia do contrato será enviada para o seu e-mail.
              </p>
            </div>
          </div>
        )}

        {/* ── Step 3: Concluído ───────────────────────────── */}
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
                    Uma cópia foi enviada para <span className="font-medium text-gray-700">{email}</span>
                    {' '}e para a consultora. Você também pode baixar agora.
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

                {/* Botão download */}
                {hasContract && (
                  <button
                    onClick={handleDownloadPDF}
                    disabled={downloadingPDF}
                    className="w-full border-2 border-rose-200 text-rose-500 hover:bg-rose-50 py-3 rounded-xl font-semibold
                      transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {downloadingPDF
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando PDF...</>
                      : <><Download className="h-4 w-4" /> Baixar contrato em PDF</>}
                  </button>
                )}

                {/* Botão prosseguir */}
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