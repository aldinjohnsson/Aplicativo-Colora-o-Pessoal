// src/components/client/ClientPortal.tsx
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Palette, Check, Lock, Circle, Clock, CheckCircle, ChevronDown, ChevronUp, X, Upload, Send, Camera, Play, AlertCircle, FileText, ExternalLink, Download } from 'lucide-react'
import { clientService, ClientPortalData } from '../../lib/services'
import { formatDeadlineDate, calendarDaysUntil, businessDaysUntil } from '../../lib/deadlineCalculator'
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
        {data.client.status === 'photos_submitted' && (
          <ReviewScreen />
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
          // Campo de imagem com maxImages === 1 (File único)
          const path = `form-attachments/${data.client.id}/${Date.now()}_${value.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
          const { error: uploadError } = await supabase.storage
            .from('client-photos')
            .upload(path, value, { contentType: value.type, upsert: false })

          if (uploadError) throw uploadError

          const { data: urlData } = supabase.storage.from('client-photos').getPublicUrl(path)
          processedValues[key] = urlData.publicUrl
        } else if (Array.isArray(value) && value.length > 0 && value[0] instanceof File) {
          // Campo de imagem com múltiplos arquivos (maxImages > 1)
          const urls: string[] = []
          for (const file of value as File[]) {
            const path = `form-attachments/${data.client.id}/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
            const { error: uploadError } = await supabase.storage
              .from('client-photos')
              .upload(path, file, { contentType: file.type, upsert: false })

            if (uploadError) throw uploadError

            const { data: urlData } = supabase.storage.from('client-photos').getPublicUrl(path)
            urls.push(urlData.publicUrl)
          }
          processedValues[key] = urls
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

    case 'image': {
      const maxImages = field.maxImages && field.maxImages > 1 ? field.maxImages : 1
      const files: File[] = Array.isArray(value) ? value : value instanceof File ? [value] : []
      const remaining = maxImages - files.length
      const isFull = remaining <= 0

      const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return
        const picked = Array.from(e.target.files).slice(0, remaining)
        if (maxImages === 1) {
          onChange(picked[0] ?? null)
        } else {
          onChange([...files, ...picked])
        }
        // reset input so the same file can be re-selected after removal
        e.target.value = ''
      }

      const handleRemove = (idx: number) => {
        if (maxImages === 1) {
          onChange(null)
        } else {
          const next = files.filter((_, i) => i !== idx)
          onChange(next.length > 0 ? next : null)
        }
      }

      return (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700">{label}</label>
            {maxImages > 1 && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                isFull ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {files.length}/{maxImages} fotos
              </span>
            )}
          </div>

          {field.imageInstructions && (
            <p className="text-xs text-gray-500 mb-2">{field.imageInstructions}</p>
          )}

          {/* Preview grid */}
          {files.length > 0 && (
            <div className={`grid gap-2 mb-3 ${maxImages === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {files.map((file, idx) => (
                <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X className="h-3.5 w-3.5 text-white" />
                  </button>
                  {maxImages === 1 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1.5">
                      <p className="text-white text-xs truncate">✓ {file.name}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Upload area — hidden when full */}
          {!isFull && (
            <label className="block border-2 border-dashed border-gray-200 hover:border-rose-300 rounded-xl p-5 text-center cursor-pointer transition-colors">
              <input
                type="file"
                accept="image/*,image/heic,image/heif"
                multiple={maxImages > 1}
                className="hidden"
                onChange={handleAddFiles}
              />
              <div className="space-y-1">
                <div className="text-2xl">🖼️</div>
                {files.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {maxImages > 1
                      ? `Selecionar até ${maxImages} fotos`
                      : 'Clique para selecionar uma imagem'}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">
                    Adicionar mais {remaining} foto{remaining !== 1 ? 's' : ''}
                  </p>
                )}
                <p className="text-xs text-gray-400">JPG, PNG, HEIC</p>
              </div>
            </label>
          )}

          {isFull && (
            <p className="text-xs text-green-600 text-center mt-1">
              ✓ Limite de {maxImages} foto{maxImages !== 1 ? 's' : ''} atingido. Passe o mouse sobre uma foto para remover.
            </p>
          )}
        </div>
      )
    }

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
      await clientService.finalizePhotos(token)
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

// ── In Review (photos_submitted) ─────────────────────────────

function ReviewScreen() {
  // Checklist compartilhado: step 1 ativo (revisão)
  const steps = [
    {
      label: 'Revisão detalhada dos dados',
      description: 'Se necessário, entraremos em contato para ajustes ou complementos em até 1 dia útil.',
      state: 'current' as const,
    },
    {
      label: 'Análise em andamento',
      description: 'Aqui começa a contagem do prazo.',
      state: 'pending' as const,
    },
    {
      label: 'Resultado liberado',
      description: 'Seu resultado completo está pronto. Acesso liberado.',
      state: 'pending' as const,
    },
  ]

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <Clock className="h-8 w-8 text-amber-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Fotos em análise</h2>
        <p className="text-gray-500 text-sm leading-relaxed">
          Suas fotos e informações foram recebidas pela consultora e estão em análise.
          Se necessário, entraremos em contato para ajustes ou complementos em até 1 dia útil.
        </p>
      </div>

      {/* Checklist */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-5">Seu progresso</h3>
        <div className="space-y-0">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1
            const iconEl =
              step.state === 'done' ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : step.state === 'current' ? (
                <div className="w-5 h-5 rounded-full border-2 border-rose-400 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-rose-400" />
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
              )

            return (
              <div key={step.label} className="flex gap-4">
                {/* Icon + connector */}
                <div className="flex flex-col items-center">
                  <div className="mt-0.5">{iconEl}</div>
                  {!isLast && <div className="w-px flex-1 bg-gray-100 my-2" />}
                </div>
                {/* Content */}
                <div className={`pb-${isLast ? '0' : '5'} flex-1 min-w-0`}>
                  <p className={`text-sm font-medium ${step.state === 'current' ? 'text-rose-600' : step.state === 'done' ? 'text-gray-900' : 'text-gray-400'}`}>
                    {step.label}
                    {step.state === 'current' && (
                      <span className="ml-2 text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-medium">Em andamento</span>
                    )}
                  </p>
                  <p className={`text-xs mt-0.5 leading-relaxed ${step.state === 'pending' ? 'text-gray-300' : 'text-gray-400'}`}>
                    {step.description}
                  </p>
                  {!isLast && <div className="mt-4" />}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── In Analysis (in_analysis) ────────────────────────────────

function AnalysisScreen({ data }: { data: ClientPortalData }) {
  const deadline = data.deadline
  const deadlineDate = deadline?.deadline_date ?? null   // string "YYYY-MM-DD" direto
  const daysLeft = deadlineDate ? businessDaysUntil(deadlineDate) : null

  // Checklist: step 2 ativo (análise em andamento)
  const steps = [
    {
      label: 'Revisão detalhada dos dados',
      description: 'Revisão concluída.',
      state: 'done' as const,
    },
    {
      label: 'Análise em andamento',
      description: 'Estamos trabalhando na sua análise pessoal de coloração.',
      state: 'current' as const,
    },
    {
      label: 'Resultado liberado',
      description: 'Seu resultado completo está pronto. Acesso liberado.',
      state: 'pending' as const,
    },
  ]

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Clock className="h-8 w-8 text-orange-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Análise em andamento</h2>
        <p className="text-gray-500 text-sm">Suas fotos foram aprovadas e estamos trabalhando na sua análise!</p>
      </div>

      {/* Prazo */}
      {deadlineDate && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-rose-400" /> Prazo de Entrega
          </h3>
          <div className="bg-rose-50 rounded-xl p-4">
            <p className="text-rose-800 font-semibold capitalize">{formatDeadlineDate(deadlineDate)}</p>
            {daysLeft !== null && daysLeft > 0 && (
              <p className="text-rose-600 text-sm mt-1">{daysLeft} dia{daysLeft !== 1 ? 's' : ''} {daysLeft !== 1 ? 'úteis' : 'útil'} restante{daysLeft !== 1 ? 's' : ''}</p>
            )}
            {daysLeft === 0 && <p className="text-rose-600 text-sm mt-1">Entrega prevista para hoje</p>}
          </div>
          <p className="text-xs text-gray-400 mt-3">Prazo calculado em dias úteis, sem contar feriados nacionais.</p>
        </div>
      )}

      {/* Checklist */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-5">Seu progresso</h3>
        <div className="space-y-0">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1
            const iconEl =
              step.state === 'done' ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : step.state === 'current' ? (
                <div className="w-5 h-5 rounded-full border-2 border-rose-400 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-rose-400" />
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
              )

            return (
              <div key={step.label} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="mt-0.5">{iconEl}</div>
                  {!isLast && <div className="w-px flex-1 bg-gray-100 my-2" />}
                </div>
                <div className={`pb-${isLast ? '0' : '5'} flex-1 min-w-0`}>
                  <p className={`text-sm font-medium ${step.state === 'current' ? 'text-rose-600' : step.state === 'done' ? 'text-gray-900' : 'text-gray-400'}`}>
                    {step.label}
                    {step.state === 'current' && (
                      <span className="ml-2 text-xs bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded-full font-medium">Em andamento</span>
                    )}
                  </p>
                  <p className={`text-xs mt-0.5 leading-relaxed ${step.state === 'pending' ? 'text-gray-300' : 'text-gray-400'}`}>
                    {step.description}
                  </p>
                  {!isLast && <div className="mt-4" />}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Results ──────────────────────────────────────────────────

// Typed reference photo — type is the dynamic typeId string (e.g. 'cabelo', 'roupa', 'maquiagem', 'geral')
interface RefPhoto { type: string; label: string; storagePath: string; url: string }

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
          // Normalise: AIPromptConfig saves {typeId, typeName, storagePath} — map to {type, label, storagePath, url}
          const photos: RefPhoto[] = row.ai_reference_photos.map((p: any) => ({
            type: (p.typeId || p.type || 'geral') as string,
            label: p.typeName || p.label || p.typeId || p.type || 'Geral',
            storagePath: p.storagePath,
            // Always regenerate the public URL — stored url may be stale
            url: supabase.storage.from('client-photos').getPublicUrl(p.storagePath).data.publicUrl,
          }))
          setAiRefPhotos(photos)
          // Use the 'geral' photo as the legacy single ref; if absent use the first available photo
          const geral = photos.find(p => p.type === 'geral')
          if (geral) setAiRefPhotoUrl(geral.url)
          else if (photos.length > 0) setAiRefPhotoUrl(photos[0].url)
          // GeminiChat will pick the correct typed photo per category from refPhotoMap
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
      <div className="bg-gradient-to-br from-rose-500 via-pink-500 to-rose-600 rounded-2xl p-7 text-white text-center relative overflow-hidden shadow-lg">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }} />
        <div className="relative">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4 backdrop-blur-sm">
            <CheckCircle className="h-9 w-9 text-white" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Sua análise está pronta!</h2>
          <p className="text-rose-100 text-sm mt-1.5">Confira todos os materiais abaixo</p>
        </div>
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
            className="flex items-center gap-3 p-4 bg-gradient-to-r from-rose-50 to-pink-50 rounded-xl border border-rose-100 hover:from-rose-100 hover:to-pink-100 transition-all group">
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
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-rose-400" /> Documentos
          </h3>
          <div className="space-y-2">
            {files.map(file => (
              <a key={file.id} href={clientService.getResultFileUrl(file.storage_path)} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-3.5 bg-gray-50 hover:bg-rose-50 rounded-xl border border-transparent hover:border-rose-100 transition-all group">
                <div className="w-10 h-10 bg-gradient-to-br from-red-400 to-rose-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <FileText className="h-4.5 w-4.5 text-white" />
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
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-rose-400">✦</span> Observações da Consultora
          </h3>
          <div className="bg-gradient-to-br from-rose-50 to-pink-50 rounded-xl p-4 border border-rose-100">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{result.observations}</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl px-5 py-3 text-center">
        <p className="text-xs text-gray-400">Liberado em {new Date(result.released_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
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