// src/components/client/ClientPortal.tsx
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Palette, Check, Lock, Circle, Clock, CheckCircle, ChevronDown, ChevronUp, X, Upload, Send, Camera, Play, AlertCircle, FileText, ExternalLink, Download } from 'lucide-react'
import { clientService, ClientPortalData } from '../../lib/services'
import { formatDeadlineDate, businessDaysUntil } from '../../lib/deadlineCalculator'
import { supabase } from '../../lib/supabase'
import { GeminiChat } from './GeminiChat'

// ── Tiny UI ──────────────────────────────────────────────────

const Btn = ({ children, onClick, variant = 'primary', size = 'md', loading = false, disabled = false, className = '' }: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-5 py-2.5 text-sm', lg: 'px-6 py-3' }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}>
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ── Portal root ──────────────────────────────────────────────

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

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Steps */}
        {data.client.status === 'awaiting_contract' && (
          <ContractStep token={token!} data={data} onDone={reload} />
        )}
        {data.client.status === 'awaiting_form' && (
          <FormStep token={token!} data={data} onDone={reload} />
        )}
        {data.client.status === 'awaiting_photos' && (
          <PhotoStep token={token!} data={data} onDone={reload} />
        )}
        {data.client.status === 'in_analysis' && (
          <AnalysisScreen data={data} />
        )}
        {data.client.status === 'completed' && (
          <ResultScreen token={token!} data={data} />
        )}
      </div>
    </div>
  )
}

// ── Step 1: Contract ─────────────────────────────────────────

function ContractStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const [read, setRead] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [signing, setSigning] = useState(false)

  const handleSign = async () => {
    if (!agreed) return
    setSigning(true)
    try {
      await clientService.signContract(token)
      onDone()
    } catch (e: any) { alert(e.message) } finally { setSigning(false) }
  }

  const contract = data.contract

  return (
    <div className="space-y-4">
      <StepHeader current={1} total={3} label="Contrato" />

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Leia o contrato</h2>
          <p className="text-sm text-gray-500 mt-0.5">Role até o final antes de assinar</p>
        </div>

        <div
          className="px-6 py-5 max-h-72 overflow-y-auto text-sm text-gray-700 space-y-4 leading-relaxed"
          onScroll={e => {
            const el = e.currentTarget
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) setRead(true)
          }}
        >
          {contract ? (
            <>
              <h3 className="font-bold text-center text-gray-900">{contract.title}</h3>
              {contract.sections.sort((a, b) => a.order - b.order).map(s => (
                <div key={s.id}>
                  <h4 className="font-semibold text-gray-800 mb-1">{s.title}</h4>
                  <p className="whitespace-pre-wrap">{s.content}</p>
                </div>
              ))}
            </>
          ) : (
            <p className="text-gray-400 text-center py-8">Contrato não configurado pelo administrador.</p>
          )}
          <div className="h-4" />
        </div>

        <div className="px-6 py-5 border-t border-gray-100 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 text-rose-500 rounded focus:ring-rose-400" />
            <span className="text-sm text-gray-700">Li e concordo com todos os termos do contrato</span>
          </label>

          {!read && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> Role o contrato até o final para continuar
            </p>
          )}

          <Btn onClick={handleSign} disabled={!agreed || !read} loading={signing} className="w-full justify-center">
            <Check className="h-4 w-4" /> Assinar Contrato
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Step 2: Form ─────────────────────────────────────────────

function FormStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const form = data.form
  const [values, setValues] = useState<Record<string, any>>({})
  const [submitting, setSubmitting] = useState(false)

  const setValue = (id: string, value: any) => setValues(v => ({ ...v, [id]: value }))

  const handleSubmit = async () => {
    if (!form) return

    for (const field of form.fields.filter((f: any) => f.required)) {
      const val = values[field.id]
      const empty = !val || (Array.isArray(val) && val.length === 0)
      if (empty) { alert(`Por favor, preencha: ${field.label}`); return }
    }

    setSubmitting(true)
    try {
      const processedValues: Record<string, any> = {}

      for (const [key, value] of Object.entries(values)) {
        if (value instanceof File) {
          const path = `form-attachments/${data.client.id}/${Date.now()}_${value.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
          const { error: uploadError } = await supabase.storage
            .from('client-photos')
            .upload(path, value, { contentType: value.type, upsert: false })

          if (uploadError) throw uploadError

          const { data: urlData } = supabase.storage.from('client-photos').getPublicUrl(path)
          processedValues[key] = urlData.publicUrl
        } else {
          processedValues[key] = value
        }
      }

      await clientService.submitForm(token, processedValues)
      onDone()
    } catch (e: any) { alert(e.message) } finally { setSubmitting(false) }
  }

  return (
    <div className="space-y-4">
      <StepHeader current={2} total={3} label="Formulário" />

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{form?.title || 'Formulário'}</h2>
          {form?.description && <p className="text-sm text-gray-500 mt-0.5">{form.description}</p>}
        </div>

        <div className="px-6 py-5 space-y-5">
          {form?.fields.sort((a, b) => a.order - b.order).map(field => (
            <FormField key={field.id} field={field} value={values[field.id]} onChange={v => setValue(field.id, v)} />
          ))}

          {(!form || form.fields.length === 0) && (
            <p className="text-sm text-gray-400 text-center py-8">Formulário não configurado.</p>
          )}
        </div>

        <div className="px-6 py-5 border-t border-gray-100">
          <Btn onClick={handleSubmit} loading={submitting} disabled={!form || form.fields.length === 0} className="w-full justify-center">
            <Send className="h-4 w-4" /> Enviar Formulário
          </Btn>
        </div>
      </div>
    </div>
  )
}


function FormField({ field, value, onChange }: { field: any; value: any; onChange: (v: any) => void }) {
  const label = field.label + (field.required ? ' *' : '')
  const inputClass = "w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"

  const formatPhone = (val: string) => {
    const n = val.replace(/\D/g, '')
    if (n.length <= 2) return n
    if (n.length <= 6) return `(${n.slice(0,2)}) ${n.slice(2)}`
    if (n.length <= 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`
    return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7,11)}`
  }

  switch (field.type) {
    case 'full_name':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
          <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
            placeholder="Seu nome completo" className={inputClass} />
        </div>
      )

    case 'email':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
          <input type="email" value={value || ''} onChange={e => onChange(e.target.value)}
            placeholder="seu@email.com" className={inputClass} />
        </div>
      )

    case 'phone':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
          <input type="tel" value={value || ''} onChange={e => onChange(formatPhone(e.target.value))}
            placeholder="(11) 99999-9999" className={inputClass} />
        </div>
      )

    case 'text':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
          <input value={value || ''} onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder} className={inputClass} />
        </div>
      )

    case 'textarea':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
          <textarea value={value || ''} onChange={e => onChange(e.target.value)}
            rows={4} placeholder={field.placeholder} className={`${inputClass} resize-none`} />
        </div>
      )

    case 'select':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
          <select value={value || ''} onChange={e => onChange(e.target.value)} className={inputClass}>
            <option value="">Selecione...</option>
            {field.options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      )

    case 'radio':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
          <div className="space-y-2">
            {field.options?.map((o: string) => (
              <label key={o} className="flex items-center gap-2.5 cursor-pointer">
                <input type="radio" name={field.id} value={o} checked={value === o} onChange={() => onChange(o)}
                  className="h-4 w-4 text-rose-500 focus:ring-rose-400" />
                <span className="text-sm text-gray-700">{o}</span>
              </label>
            ))}
          </div>
        </div>
      )

    case 'checkbox':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
          <div className="space-y-2">
            {field.options?.map((o: string) => {
              const vals = value || []
              return (
                <label key={o} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={vals.includes(o)}
                    onChange={e => onChange(e.target.checked ? [...vals, o] : vals.filter((v: string) => v !== o))}
                    className="h-4 w-4 text-rose-500 rounded focus:ring-rose-400" />
                  <span className="text-sm text-gray-700">{o}</span>
                </label>
              )
            })}
          </div>
        </div>
      )

    case 'image':
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
          {field.imageInstructions && (
            <p className="text-xs text-gray-500 mb-2">{field.imageInstructions}</p>
          )}
          <label className="block border-2 border-dashed border-gray-200 hover:border-rose-300 rounded-xl p-5 text-center cursor-pointer transition-colors">
            <input type="file" accept="image/*,image/heic,image/heif" className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) onChange(file)
              }} />
            {value ? (
              <div className="space-y-2">
                <img
                  src={URL.createObjectURL(value)}
                  alt="preview"
                  className="max-h-40 mx-auto rounded-lg object-contain"
                />
                <p className="text-xs text-green-600 font-medium">✓ {value.name}</p>
                <p className="text-xs text-gray-400">Clique para trocar</p>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-2xl">🖼️</div>
                <p className="text-sm text-gray-500">Clique para selecionar uma imagem</p>
                <p className="text-xs text-gray-400">JPG, PNG, HEIC</p>
              </div>
            )}
          </label>
        </div>
      )

    default: return null
  }
}

// ── Step 3: Photos ───────────────────────────────────────────

function PhotoStep({ token, data, onDone }: { token: string; data: ClientPortalData; onDone: () => void }) {
  const categories = data.photo_categories || []
  const [uploads, setUploads] = useState<Record<string, File[]>>({})
  const [processing, setProcessing] = useState<Record<string, boolean>>({})
  const [finalizing, setFinalizing] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const addFiles = async (catId: string, files: File[], maxPhotos: number) => {
    const current = uploads[catId] || []
    const remaining = maxPhotos - current.length
    const toAdd = Array.from(files).slice(0, remaining)
    if (toAdd.length === 0) {
      setErrors(e => ({ ...e, [catId]: `Limite de ${maxPhotos} fotos atingido` }))
      return
    }
    setErrors(e => ({ ...e, [catId]: '' }))
    setProcessing(p => ({ ...p, [catId]: true }))
    const processed = await Promise.all(toAdd.map(f => processImage(f)))
    setUploads(u => ({ ...u, [catId]: [...(u[catId] || []), ...processed.filter(Boolean) as File[]] }))
    setProcessing(p => ({ ...p, [catId]: false }))
  }

  const removeFile = (catId: string, idx: number) => {
    setUploads(u => ({ ...u, [catId]: (u[catId] || []).filter((_, i) => i !== idx) }))
  }

  const allFilled = categories.every(c => (uploads[c.id] || []).length > 0)
  const totalPhotos = Object.values(uploads).reduce((s, arr) => s + arr.length, 0)

  const handleFinalize = async () => {
    if (!allFilled) return
    setFinalizing(true)
    try {
      for (const cat of categories) {
        for (const file of (uploads[cat.id] || [])) {
          await clientService.uploadPhoto(token, data.client.id, file, cat.id)
        }
      }
      await clientService.finalizePhotos(token, data.plan?.deadline_days || 5)
      onDone()
    } catch (e: any) { alert(`Erro ao enviar fotos: ${e.message}`) }
    finally { setFinalizing(false) }
  }

  return (
    <div className="space-y-4">
      <StepHeader current={3} total={3} label="Fotos" />

      {categories.map(cat => {
        const catUploads = uploads[cat.id] || []
        const embedUrl = cat.video_url ? getYouTubeEmbed(cat.video_url) : null

        return (
          <div key={cat.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{cat.title}</h3>
                {cat.description && <p className="text-sm text-gray-500">{cat.description}</p>}
              </div>
              {catUploads.length > 0 && (
                <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">
                  {catUploads.length}/{cat.max_photos}
                </span>
              )}
            </div>

            <div className="px-6 py-5 space-y-4">
              {embedUrl && (
                <div className="aspect-video rounded-xl overflow-hidden bg-black">
                  <iframe src={embedUrl} title={cat.title} className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                </div>
              )}

              {cat.instructions.length > 0 && (
                <ul className="space-y-1.5">
                  {cat.instructions.map((inst: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-300 mt-2 flex-shrink-0" />
                      {inst}
                    </li>
                  ))}
                </ul>
              )}

              {errors[cat.id] && (
                <p className="text-sm text-red-600 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4" />{errors[cat.id]}
                </p>
              )}

              <label className="block border-2 border-dashed border-gray-200 hover:border-rose-300 rounded-xl p-6 text-center cursor-pointer transition-colors">
                <input type="file" multiple accept="image/*,image/heic,image/heif" className="hidden"
                  disabled={processing[cat.id] || catUploads.length >= cat.max_photos}
                  onChange={e => e.target.files && addFiles(cat.id, Array.from(e.target.files), cat.max_photos)} />
                {processing[cat.id] ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin h-6 w-6 border-2 border-rose-400 border-t-transparent rounded-full" />
                    <span className="text-sm text-gray-500">Processando...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Camera className="h-8 w-8 text-gray-300" />
                    <span className="text-sm text-gray-500">Clique para selecionar fotos</span>
                    <span className="text-xs text-gray-400">JPG, PNG, HEIC · Máx. {cat.max_photos} fotos</span>
                  </div>
                )}
              </label>

              {catUploads.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {catUploads.map((file, idx) => {
                    const url = URL.createObjectURL(file)
                    return (
                      <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group">
                        <img src={url} alt={file.name} className="w-full h-full object-cover" onLoad={() => URL.revokeObjectURL(url)} />
                        <button onClick={() => removeFile(cat.id, idx)}
                          className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-600">{totalPhotos} foto{totalPhotos !== 1 ? 's' : ''} selecionada{totalPhotos !== 1 ? 's' : ''}</p>
          {!allFilled && <p className="text-xs text-amber-600">Envie fotos em todas as categorias</p>}
        </div>
        <Btn onClick={handleFinalize} disabled={!allFilled} loading={finalizing} className="w-full justify-center" size="lg">
          <Upload className="h-4 w-4" /> Enviar Fotos e Finalizar
        </Btn>
      </div>
    </div>
  )
}

// ── In Analysis ──────────────────────────────────────────────

function AnalysisScreen({ data }: { data: ClientPortalData }) {
  const deadline = data.deadline
  const deadlineDate = deadline ? new Date(deadline.deadline_date) : null
  const daysLeft = deadlineDate ? businessDaysUntil(deadlineDate) : null

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Clock className="h-8 w-8 text-orange-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Análise em andamento</h2>
        <p className="text-gray-500 text-sm">Suas informações e fotos foram recebidas. Estamos trabalhando na sua análise!</p>
      </div>

      {deadlineDate && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-rose-400" /> Prazo de Entrega
          </h3>
          <div className="bg-rose-50 rounded-xl p-4">
            <p className="text-rose-800 font-semibold capitalize">{formatDeadlineDate(deadlineDate)}</p>
            {daysLeft !== null && daysLeft > 0 && (
              <p className="text-rose-600 text-sm mt-1">{daysLeft} dia{daysLeft !== 1 ? 's' : ''} útil{daysLeft !== 1 ? 'eis' : ''} restante{daysLeft !== 1 ? 's' : ''}</p>
            )}
            {daysLeft === 0 && <p className="text-rose-600 text-sm mt-1">Entrega prevista para hoje</p>}
          </div>
          <p className="text-xs text-gray-400 mt-3">Prazo calculado em dias úteis, sem contar feriados nacionais.</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-3">O que acontece agora?</h3>
        <div className="space-y-3">
          {[
            { icon: CheckCircle, text: 'Suas fotos e informações foram recebidas', done: true },
            { icon: Clock, text: 'Realizamos a análise de coloração pessoal', done: false },
            { icon: Lock, text: 'Você recebe acesso ao resultado completo', done: false },
          ].map(({ icon: Icon, text, done }) => (
            <div key={text} className="flex items-center gap-3">
              <Icon className={`h-5 w-5 flex-shrink-0 ${done ? 'text-green-500' : 'text-gray-300'}`} />
              <span className={`text-sm ${done ? 'text-gray-800' : 'text-gray-400'}`}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Results ──────────────────────────────────────────────────

// Typed reference photo (mirrors AIPromptConfig)
interface RefPhoto { type: 'cabelo' | 'roupa' | 'geral'; label: string; storagePath: string; url: string }

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

        // Prefer the new typed photos array; fall back to legacy single path
        if (row?.ai_reference_photos && Array.isArray(row.ai_reference_photos) && row.ai_reference_photos.length > 0) {
          // Resolve public URLs (storagePath already stored, but url field may be stale — regenerate)
          const photos: RefPhoto[] = row.ai_reference_photos.map((p: any) => ({
            ...p,
            url: supabase.storage.from('client-photos').getPublicUrl(p.storagePath).data.publicUrl,
          }))
          setAiRefPhotos(photos)
          // Only use the geral photo as the legacy single reference — never use cabelo/roupa as fallback
          const geral = photos.find(p => p.type === 'geral')
          if (geral) setAiRefPhotoUrl(geral.url)
          // If no geral photo, leave aiRefPhotoUrl null — GeminiChat will pick the right typed photo per category
        } else if (row?.ai_reference_photo_path) {
          const { data: urlData } = supabase.storage.from('client-photos').getPublicUrl(row.ai_reference_photo_path)
          setAiRefPhotoUrl(urlData.publicUrl)
          // Wrap legacy path as a "geral" photo so GeminiChat can use it
          setAiRefPhotos([{ type: 'geral', label: 'Foto Geral/Rosto', storagePath: row.ai_reference_photo_path, url: urlData.publicUrl }])
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
      {/* Banner de conclusão */}
      <div className="bg-gradient-to-br from-rose-500 to-pink-500 rounded-2xl p-6 text-white text-center">
        <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-90" />
        <h2 className="text-xl font-bold">Sua análise está pronta!</h2>
        <p className="text-rose-100 text-sm mt-1">Confira todos os materiais abaixo</p>
      </div>

      {/* Aviso quando resultado foi liberado mas sem conteúdo ainda */}
      {!hasContent && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-8 text-center">
          <Clock className="h-12 w-12 text-amber-300 mx-auto mb-4" />
          <h2 className="font-semibold text-gray-900">Materiais sendo preparados</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            Sua análise foi liberada! Os materiais (pasta, PDFs e observações) serão
            adicionados em breve pela consultora. Entre em contato caso precise de ajuda.
          </p>
        </div>
      )}

      {result.folder_url && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-rose-400" /> Pasta com Materiais
          </h3>
          <a href={result.folder_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-rose-50 rounded-xl border border-rose-100 hover:bg-rose-100 transition-colors group">
            <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
              <ExternalLink className="h-5 w-5 text-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-rose-700">Acessar pasta completa</p>
              <p className="text-xs text-rose-400 truncate">{result.folder_url}</p>
            </div>
          </a>
        </div>
      )}

      {files.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-rose-400" /> Documentos
          </h3>
          <div className="space-y-2">
            {files.map(file => (
              <a key={file.id} href={clientService.getResultFileUrl(file.storage_path)} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <div className="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center">
                  <FileText className="h-4 w-4 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{file.file_name}</p>
                  <p className="text-xs text-gray-400">{(file.file_size / 1024).toFixed(0)} KB</p>
                </div>
                <Download className="h-4 w-4 text-gray-400" />
              </a>
            ))}
          </div>
        </div>
      )}

      {result.observations && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Observações da Consultora</h3>
          <div className="bg-rose-50 rounded-xl p-4">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{result.observations}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-center">
        <p className="text-sm text-gray-500">Liberado em {new Date(result.released_at).toLocaleDateString('pt-BR')}</p>
      </div>

      {/* Chat com IA — aparece somente se o prompt foi configurado para esta cliente */}
      {!loadingPrompt && aiPrompt && (
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
            resultFileUrls={files.map(f => ({ url: clientService.getResultFileUrl(f.storage_path), name: f.file_name }))}
            resultObservations={result.observations || ''}
          />
        </div>
      )}
    </div>
  )
}

// ── Step Header ──────────────────────────────────────────────

function StepHeader({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-900">{label}</span>
        <span className="text-xs text-gray-400">Etapa {current} de {total}</span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < current ? 'bg-rose-400' : i === current - 1 ? 'bg-rose-300' : 'bg-gray-200'}`} />
        ))}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

function getYouTubeEmbed(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|watch\?v=|embed\/)([^#&?]{11})/)
  return match ? `https://www.youtube.com/embed/${match[1]}` : null
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
        canvas.toBlob(blob => {
          if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }))
          else reject(new Error('Erro ao processar imagem'))
        }, 'image/jpeg', 0.85)
      }
      img.onerror = reject
      img.src = e.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}