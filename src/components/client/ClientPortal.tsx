// src/components/client/ClientPortal.tsx
import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  Palette, Check, Lock, Clock, CheckCircle, X, Upload, Send,
  Camera, AlertCircle, FileText, ExternalLink, Download,
  ChevronLeft, ChevronRight, Play, Image as ImageIcon,
  CheckCircle2, ArrowRight, Loader2, ChevronDown, ChevronUp,
  Package,
} from 'lucide-react'
import { clientService, ClientPortalData } from '../../lib/services'
import { formatDeadlineDate, businessDaysUntil } from '../../lib/deadlineCalculator'
import { supabase } from '../../lib/supabase'
import { GeminiChat } from './GeminiChat'

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
    if (!token) { setError('Token inválido'); setLoading(false); return }
    clientService.getPortalData(token).then(d => {
      if (!d) setError('Link de acesso inválido. Verifique com a consultora.')
      else setData(d)
      setLoading(false)
    })
  }, [token])

  const reload = async () => {
    if (!token) return
    const d = await clientService.getPortalData(token)
    if (d) setData(d)
  }

  if (loading) return (
    <div className="min-h-screen bg-rose-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-rose-500 mx-auto mb-3" />
        <p className="text-rose-600 text-sm">Carregando seu portal...</p>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen bg-rose-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-sm w-full text-center">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
        <h2 className="font-semibold text-gray-900 mb-2">Acesso não encontrado</h2>
        <p className="text-sm text-gray-500">{error || 'Link inválido. Entre em contato com a consultora.'}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-rose-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-gradient-to-br from-rose-400 to-pink-500 rounded-lg flex items-center justify-center">
              <Palette className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-gray-800">MS Colors</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-gray-800">{data.client.full_name.split(' ')[0]}</p>
            {data.plan && <p className="text-xs text-gray-400">{data.plan.name}</p>}
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
        {data.client.status === 'preparing_materials' && (
          // Cliente continua vendo "Análise em andamento" + prazo, com aviso
          // discreto de que os materiais estão sendo preparados.
          <AnalysisScreen data={data} materialsBeingPrepared />
        )}
        {data.client.status === 'validating_materials' && (
          // Status interno de validação — pra cliente é idêntico a preparing_materials.
          <AnalysisScreen data={data} materialsBeingPrepared />
        )}
        {data.client.status === 'completed' && (
          <ResultScreen token={token!} data={data} />
        )}
      </div>
    </div>
  )
}

// ── Step Header ──────────────────────────────────────────────────────────────

function StepHeader({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-900">{label}</span>
        <span className="text-xs text-gray-400">Etapa {current} de {total}</span>
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

// ── Step 1: Contract ─────────────────────────────────────────────────────────

function ContractStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const [read, setRead] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [signing, setSigning] = useState(false)
  const [country, setCountry] = useState('Brasil')
  const [clientIp, setClientIp] = useState<string>('Obtendo...')
  const [signTime] = useState(() => new Date())

  // Busca o IP real do cliente ao montar o componente
  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => setClientIp(d.ip || 'Não disponível'))
      .catch(() => setClientIp('Não disponível'))
  }, [])

  const handleSign = async () => {
    if (!agreed) return
    setSigning(true)
    try {
      await clientService.signContract(token, {
        country,
        ip: clientIp,
        signedAt: new Date().toISOString(),
      })
      onDone()
    } catch (e: any) { alert(e.message) } finally { setSigning(false) }
  }

  const contract = data.contract

  const formattedDate = signTime.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
  const formattedTime = signTime.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <div className="space-y-4">
      <StepHeader current={1} total={3} label="Contrato" />

      {/* ── Banner de metadados (IP / Data / Hora) ── */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 space-y-1.5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Registro de acesso
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs text-gray-700">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
            <span><strong>IP:</strong> {clientIp}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
            <span><strong>Data:</strong> {formattedDate}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
            <span><strong>Hora:</strong> {formattedTime}</span>
          </span>
        </div>
        <p className="text-[10px] text-gray-400 pt-0.5">
          Esses dados serão registrados junto à assinatura digital no PDF do contrato.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Leia o contrato</h2>
          <p className="text-sm text-gray-500 mt-0.5">Role até o final antes de assinar</p>
        </div>

        <div
          className="px-4 sm:px-6 py-4 sm:py-5 max-h-72 overflow-y-auto text-sm text-gray-700 space-y-4 leading-relaxed"
          onScroll={e => {
            const el = e.currentTarget
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) setRead(true)
          }}
        >
          <h3 className="font-bold text-base text-gray-800">{contract?.title || 'Contrato'}</h3>
          {contract?.sections?.length === 0 && (
            <p className="text-gray-400 text-center py-8">Nenhuma cláusula configurada</p>
          )}
          {contract?.sections?.map(s => (
            <div key={s.id}>
              <h4 className="font-semibold text-gray-800 mb-1.5">{s.title}</h4>
              <p className="whitespace-pre-wrap">{s.content}</p>
            </div>
          ))}
        </div>

        <div className="px-4 sm:px-6 py-4 sm:py-5 border-t border-gray-100 space-y-4">
          {/* Campo de País */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              País de residência
            </label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent bg-white"
            >
              {COUNTRIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} disabled={!read} className="mt-0.5 w-4 h-4 accent-rose-500" />
            <span className="text-sm text-gray-700">Li e concordo com os termos do contrato</span>
          </label>
          <Btn onClick={handleSign} disabled={!agreed} loading={signing} className="w-full">
            <Check className="h-4 w-4" /> Assinar Contrato
          </Btn>
          {!read && <p className="text-xs text-gray-400 text-center">Role até o final do contrato para continuar</p>}
        </div>
      </div>
    </div>
  )
}

// ── NOVO: Fluxo combinado Form + Photos quando ambos são rejeitados ─────────

function FormAndPhotoFlow({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
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
      <StepHeader current={2} total={3} label={hasFormRejection ? 'Ajustes Solicitados' : 'Formulário'} />

      {(hasFormRejection || hasPhotosRejection) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <div className="flex gap-3 items-start">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Ajustes solicitados</p>
              <p className="text-sm text-amber-700 mt-0.5">
                {hasFormRejection && hasPhotosRejection
                  ? 'A consultora solicitou ajustes no formulário e nas fotos'
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
              Formulário
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
              Fotos
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
  return (
    <div className="space-y-4">
      <StepHeader current={2} total={3} label="Formulário" />

      {data.client.form_rejection_reason && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-3 items-start">
          <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Ajuste solicitado no formulário</p>
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
    if (missing.length > 0) {
      alert(`Preencha os campos obrigatórios:\n• ${missing.join('\n• ')}`)
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
        <h2 className="font-semibold text-gray-900">{form?.title || 'Formulário'}</h2>
        {form?.description && <p className="text-sm text-gray-500 mt-0.5">{form.description}</p>}
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">
        {fields.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Nenhum campo configurado</p>
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
                  <option value="">— Selecione —</option>
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
          <Send className="h-4 w-4" /> Enviar Respostas
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
  clientId,
  value,
  onChange,
}: {
  field: any
  clientId: string
  value: FormImage[]
  onChange: (imgs: FormImage[]) => void
}) {
  const maxImages: number = field.maxImages ?? 1
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const isFull = value.length >= maxImages

  const handleAdd = async (files: FileList | null) => {
    if (!files) return
    const toAdd = Array.from(files).slice(0, maxImages - value.length)
    if (toAdd.length === 0) {
      setError(`Limite de ${maxImages} foto${maxImages !== 1 ? 's' : ''} atingido`)
      return
    }
    setError('')
    setUploading(true)
    try {
      const uploaded: FormImage[] = []
      for (const file of toAdd) {
        const processed = await processImage(file)
        const uniqueName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const path = `${clientId}/form/${field.id}/${uniqueName}`
        const { error: upErr } = await supabase.storage
          .from('client-photos')
          .upload(path, processed, { contentType: processed.type, upsert: false })
        if (upErr) throw upErr
        const { data: urlData } = supabase.storage.from('client-photos').getPublicUrl(path)
        uploaded.push({ storagePath: path, url: urlData.publicUrl })
      }
      onChange([...value, ...uploaded])
    } catch (e: any) {
      setError(`Erro ao enviar: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async (idx: number) => {
    const img = value[idx]
    setRemoving(s => new Set([...s, img.storagePath]))
    try {
      await supabase.storage.from('client-photos').remove([img.storagePath])
    } catch {}
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
                {maxImages - value.length} restante{maxImages - value.length !== 1 ? 's' : ''}
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
                <p className="text-sm font-medium text-gray-700 mb-0.5">Toque para adicionar fotos</p>
                <p className="text-xs text-gray-400">
                  JPG, PNG, HEIC · até {maxImages} foto{maxImages !== 1 ? 's' : ''}
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
            {value.length} foto{value.length !== 1 ? 's' : ''} adicionada{value.length !== 1 ? 's' : ''} ✓
          </p>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Photos ───────────────────────────────────────────────────────────

interface InstructionItem {
  id: string
  type: 'text' | 'video' | 'image'
  content: string
  imageUrl?: string
  storagePath?: string
}

interface PhotoCategory {
  id: string
  title: string
  description?: string
  max_photos: number
  instruction_items?: InstructionItem[]
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

// ── Media item (video or image instruction) ──────────────────────────────────

function MediaItem({ item }: { item: InstructionItem }) {
  const embedUrl = item.type === 'video' ? getYouTubeEmbed(item.content) : null

  if (item.type === 'video' && embedUrl) {
    return (
      <div className="rounded-xl overflow-hidden border border-rose-100 shadow-sm bg-black" style={{ aspectRatio: '16/9' }}>
        <iframe
          src={embedUrl}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Instrução em vídeo"
        />
      </div>
    )
  }

  if (item.type === 'image') {
    const src = item.imageUrl || item.content
    if (!src) return null
    return (
      <div className="rounded-xl overflow-hidden border border-rose-100 shadow-sm">
        <img src={src} alt="Instrução" className="w-full object-contain max-h-80 bg-gray-50" />
      </div>
    )
  }

  return null
}

// ── Instructions panel (collapsible) ────────────────────────────────────────

function InstructionsPanel({ items, defaultOpen = true }: { items: InstructionItem[]; defaultOpen?: boolean }) {
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
          Instruções
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
              {totalCount}/{cat.max_photos} foto{cat.max_photos !== 1 ? 's' : ''}
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
                    NOVA
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
                  {cat.max_photos - totalCount} restante{cat.max_photos - totalCount !== 1 ? 's' : ''}
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
                      Toque para adicionar fotos
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      JPG, PNG, HEIC · até {cat.max_photos} foto{cat.max_photos !== 1 ? 's' : ''}
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
              {totalCount} foto{totalCount !== 1 ? 's' : ''} adicionada{totalCount !== 1 ? 's' : ''} ✓
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── PhotoStep ────────────────────────────────────────────────────────────────

function PhotoStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  return (
    <div className="space-y-4">
      <StepHeader current={3} total={3} label="Fotos" />

      {data.client.photos_rejection_reason && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-3 items-start">
          <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Ajuste solicitado nas fotos</p>
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
  const categories: PhotoCategory[] = data.photo_categories || []
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
      setErrors(e => ({ ...e, [catId]: `Limite de ${maxPhotos} foto${maxPhotos !== 1 ? 's' : ''} atingido` }))
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
      alert(`Erro ao remover foto: ${e.message}`)
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
      alert(`Erro ao enviar fotos: ${e.message}`)
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
        <p className="text-sm text-gray-400">Nenhuma categoria configurada</p>
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
            {doneCount === categories.length ? ' ✓ completo' : ' categorias'}
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
                  <p className="text-xs text-amber-600">Nenhuma foto enviada</p>
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
                <p className="text-sm font-semibold text-green-800">Tudo pronto!</p>
                <p className="text-xs text-green-700 mt-0.5">
                  {totalPhotos} foto{totalPhotos !== 1 ? 's' : ''} em {categories.length} categoria{categories.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          {showBackButton && onBack && (
            <Btn onClick={onBack} variant="outline" className="flex-1">
              <ChevronLeft className="h-4 w-4" /> Voltar
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
                <Loader2 className="h-4 w-4 animate-spin" /> Finalizando...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4" /> Finalizar Envio
              </>
            )}
          </Btn>
        </div>

        {!allFilled && (
          <p className="text-xs text-gray-400 text-center">
            Envie ao menos 1 foto em cada categoria para continuar
          </p>
        )}
      </div>
    </div>
  )
}

// ── Review screen ────────────────────────────────────────────────────────────

function ReviewScreen() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl mb-4">
          <Clock className="h-8 w-8 text-blue-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Em revisão</h2>
        <p className="text-sm text-gray-500 leading-relaxed max-w-md mx-auto">
          Suas fotos e formulário foram enviados com sucesso! A consultora está revisando tudo.
        </p>
      </div>

      {/* Aviso de prazo de revisão */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
            <Clock className="h-5 w-5 text-blue-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Prazo de revisão</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              A revisão é feita em até <strong className="text-gray-900">1 dia útil</strong>. Você receberá um e-mail
              quando suas fotos forem aprovadas — ou, se algum ajuste for necessário, com instruções para reenviar.
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
  const deadline = data.deadline

  if (!deadline?.deadline_date) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
        <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h2 className="font-semibold text-gray-900 mb-2">Análise aprovada</h2>
        <p className="text-sm text-gray-500">Aguardando prazo ser definido...</p>
      </div>
    )
  }

  const daysLeft = businessDaysUntil(deadline.deadline_date)
  const formatted = formatDeadlineDate(deadline.deadline_date)

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
          <h2 className="text-2xl font-bold tracking-tight mb-1">Análise em andamento</h2>
          <p className="text-blue-100 text-sm">Sua consultora está trabalhando na sua análise!</p>
        </div>
      </div>

      {/* Deadline card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Clock className="h-7 w-7 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-gray-500 mb-0.5">Previsão de entrega</p>
            <p className="text-lg font-bold text-gray-900">{formatted}</p>
            <p className="text-xs text-gray-400 mt-1">
              {daysLeft > 0
                ? `${daysLeft} dia${daysLeft !== 1 ? 's' : ''} útei${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}`
                : daysLeft === 0
                  ? 'Prazo vence hoje!'
                  : `Prazo vencido há ${Math.abs(daysLeft)} dia${Math.abs(daysLeft) !== 1 ? 's' : ''}`
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
              <strong className="text-gray-900">Os materiais estão sendo preparados.</strong>{' '}
              Em breve você terá acesso ao seu resultado completo.
            </p>
          </div>
        </div>
      )}

      <div className="text-center py-2">
        <p className="text-xs text-gray-400">
          Você receberá um e-mail assim que o resultado estiver disponível
        </p>
      </div>
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

function ResultScreen({ token, data }: { token: string; data: ClientPortalData }) {
  const result = data.result

  const [aiPrompt, setAiPrompt] = useState<string | null>(null)
  const [aiRefPhotoUrl, setAiRefPhotoUrl] = useState<string | null>(null)
  const [aiRefPhotos, setAiRefPhotos] = useState<RefPhoto[]>([])
  const [aiFolderConfig, setAiFolderConfig] = useState<any>(null)
  const [loadingPrompt, setLoadingPrompt] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const { data: row } = await supabase
          .from('clients')
          .select('ai_prompt, ai_reference_photo_path, ai_reference_photos, ai_folder_id')
          .eq('id', data.client.id)
          .single()

        setAiPrompt(row?.ai_prompt || null)

        if (row?.ai_reference_photos && Array.isArray(row.ai_reference_photos) && row.ai_reference_photos.length > 0) {
          const photos: RefPhoto[] = row.ai_reference_photos.map((p: any) => ({
            type: (p.typeId || p.type || 'geral') as string,
            label: p.typeName || p.label || p.typeId || p.type || 'Geral',
            storagePath: p.storagePath,
            url: supabase.storage.from('client-photos').getPublicUrl(p.storagePath).data.publicUrl,
          }))
          setAiRefPhotos(photos)
          const geral = photos.find(p => p.type === 'geral')
          if (geral) setAiRefPhotoUrl(geral.url)
          else if (photos.length > 0) setAiRefPhotoUrl(photos[0].url)
        } else if (row?.ai_reference_photo_path) {
          const { data: urlData } = supabase.storage.from('client-photos').getPublicUrl(row.ai_reference_photo_path)
          setAiRefPhotoUrl(urlData.publicUrl)
          setAiRefPhotos([{
            type: 'geral',
            label: 'Foto Geral/Rosto',
            storagePath: row.ai_reference_photo_path,
            url: urlData.publicUrl,
          }])
        }

        if (row?.ai_folder_id) {
          const { data: folder } = await supabase.from('ai_folders').select('config').eq('id', row.ai_folder_id).single()
          if (folder?.config) {
            setAiFolderConfig(typeof folder.config === 'string' ? JSON.parse(folder.config) : folder.config)
          }
        }
      } catch {}
      setLoadingPrompt(false)
    })()
  }, [data.client.id])

  if (!result) return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
      <Lock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
      <h2 className="font-semibold text-gray-900">Resultado em preparação</h2>
      <p className="text-sm text-gray-500 mt-2">Seu resultado será disponibilizado em breve.</p>
    </div>
  )

  const files: typeof result.files = result.files ?? []
  const hasContent = result.folder_url || files.length > 0 || result.observations

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="bg-gradient-to-br from-rose-500 via-pink-500 to-rose-600 rounded-2xl p-7 text-white text-center relative overflow-hidden shadow-lg">
        <div
          className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }}
        />
        <div className="relative">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4 backdrop-blur-sm">
            <CheckCircle className="h-9 w-9 text-white" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Sua análise está pronta!</h2>
          <p className="text-rose-100 text-sm mt-1.5">Confira todos os materiais abaixo</p>
        </div>
      </div>

      {!hasContent && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-8 text-center">
          <Clock className="h-12 w-12 text-amber-300 mx-auto mb-4" />
          <h2 className="font-semibold text-gray-900">Materiais sendo preparados</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            Sua análise foi liberada! Os materiais serão adicionados em breve pela consultora.
          </p>
        </div>
      )}

      {result.folder_url && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-rose-400" /> Pasta com Materiais
          </h3>
          <a
            href={result.folder_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-gradient-to-r from-rose-50 to-pink-50 rounded-xl border border-rose-100 hover:from-rose-100 hover:to-pink-100 transition-all group"
          >
            <div className="w-11 h-11 bg-gradient-to-br from-rose-400 to-pink-500 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
              <ExternalLink className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-rose-700">Acessar pasta completa</p>
              <p className="text-xs text-rose-400 mt-0.5">Clique para abrir seus materiais</p>
            </div>
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-rose-100 group-hover:bg-rose-200 flex items-center justify-center transition-colors">
              <ExternalLink className="h-3.5 w-3.5 text-rose-500" />
            </div>
          </a>
        </div>
      )}

      {files.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-rose-400" /> Documentos
          </h3>
          <div className="space-y-2">
            {files.map((file: any) => (
              <a
                key={file.id}
                href={clientService.getResultFileUrl(file.storage_path)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3.5 bg-gray-50 hover:bg-rose-50 rounded-xl border border-transparent hover:border-rose-100 transition-all group"
              >
                <div className="w-10 h-10 bg-gradient-to-br from-red-400 to-rose-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <FileText className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{file.file_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{(file.file_size / 1024).toFixed(0)} KB</p>
                </div>
                <Download className="h-4 w-4 text-gray-300 group-hover:text-rose-400 transition-colors flex-shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}

      {result.observations && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-rose-400">✦</span> Observações da Consultora
          </h3>
          <div className="bg-gradient-to-br from-rose-50 to-pink-50 rounded-xl p-4 border border-rose-100">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{result.observations}</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl px-5 py-3 text-center">
        <p className="text-xs text-gray-400">
          Liberado em {new Date(result.released_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {!loadingPrompt && aiPrompt && result.chat_enabled !== false && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-violet-200" />
            <span className="text-xs font-medium text-violet-500 px-2">Consultora de Estilo IA</span>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-violet-200" />
          </div>
          <GeminiChat
            clientName={data.client.full_name}
            systemPrompt={aiPrompt}
            referencePhotoUrl={aiRefPhotoUrl}
            referencePhotos={aiRefPhotos}
            folderConfig={aiFolderConfig}
            clientId={data.client.id}
            resultFileUrls={files.map((f: any) => ({
              url: clientService.getResultFileUrl(f.storage_path),
              name: f.file_name,
            }))}
            resultObservations={result.observations || ''}
          />
        </div>
      )}
    </div>
  )
}