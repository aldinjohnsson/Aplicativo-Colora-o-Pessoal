import React, { useState, useEffect, useRef } from 'react'
import { Save, Eye, Plus, Trash2, GripVertical, Image, Type, List, CheckSquare, Circle, AlertCircle, CheckCircle, ChevronUp, ChevronDown } from 'lucide-react'

interface FormField {
  id: string
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'image'
  label: string
  placeholder?: string
  options?: string[]
  required: boolean
  order: number
  maxImages?: number
  imageInstructions?: string
}

const FIELD_TYPES = [
  { value: 'text', label: 'Texto Curto', icon: Type },
  { value: 'textarea', label: 'Texto Longo', icon: Type },
  { value: 'select', label: 'Lista Suspensa', icon: List },
  { value: 'radio', label: 'Múltipla Escolha', icon: Circle },
  { value: 'checkbox', label: 'Caixas de Seleção', icon: CheckSquare },
  { value: 'image', label: 'Upload de Imagem', icon: Image }
]

const formStorageService = {
  async saveForm(data: { title: string; description: string; fields: FormField[] }) {
    try {
      const formData = {
        title: data.title,
        description: data.description,
        fields: data.fields,
        lastUpdated: new Date().toISOString()
      }
      const jsonData = JSON.stringify(formData)
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          await (window as any).storage.set('admin-form', jsonData, true)
        } catch (e) {
          localStorage.setItem('admin-form', jsonData)
        }
      } else {
        localStorage.setItem('admin-form', jsonData)
      }
      return { success: true }
    } catch (error) {
      console.error('Erro ao salvar formulário:', error)
      throw error
    }
  },

  async getForm() {
    try {
      let jsonData: string | null = null
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          const result = await (window as any).storage.get('admin-form', true)
          if (result && result.value) jsonData = result.value
        } catch (e) {
          jsonData = localStorage.getItem('admin-form')
        }
      } else {
        jsonData = localStorage.getItem('admin-form')
      }
      if (jsonData) return JSON.parse(jsonData)
      return {
        title: 'Formulário de Análise de Coloração Pessoal',
        description: 'Preencha suas informações para personalizar sua análise',
        fields: [
          { id: '1', type: 'text', label: 'Nome Completo', placeholder: 'Digite seu nome completo', required: true, order: 1 },
          { id: '2', type: 'text', label: 'Idade', placeholder: 'Digite sua idade', required: true, order: 2 },
          { id: '3', type: 'textarea', label: 'Qual seu objetivo com a análise de coloração?', placeholder: 'Descreva o que espera alcançar...', required: true, order: 3 }
        ],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      return { title: 'Formulário', description: '', fields: [], lastUpdated: new Date().toISOString() }
    }
  }
}

// UI Components
const Button = ({ children, onClick, loading, disabled, variant = 'primary', size = 'md', className = '' }: any) => {
  const base = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
  const variants: any = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed",
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500",
    ghost: "text-gray-700 hover:bg-gray-100"
  }
  const sizes: any = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm" }
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />}
      {children}
    </button>
  )
}

const Card = ({ children }: any) => <div className="bg-white rounded-lg shadow-sm border border-gray-200">{children}</div>
const CardHeader = ({ children }: any) => <div className="px-6 py-4 border-b border-gray-200">{children}</div>
const CardContent = ({ children, className = '' }: any) => <div className={`px-6 py-4 ${className}`}>{children}</div>
const Input = ({ value, onChange, placeholder, label, type = 'text', min, max, className = '' }: any) => (
  <div className="space-y-1">
    {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} min={min} max={max}
      className={`block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${className}`} />
  </div>
)

export function FormEditor() {
  const [formTitle, setFormTitle] = useState('Formulário de Análise de Coloração Pessoal')
  const [formDescription, setFormDescription] = useState('Preencha suas informações para personalizar sua análise')
  const [fields, setFields] = useState<FormField[]>([])
  const [previewMode, setPreviewMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [showAddField, setShowAddField] = useState(false)

  // ── Drag state via refs (avoids stale closure issues in event handlers)
  const dragIndexRef = useRef<number | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  useEffect(() => { loadForm() }, [])

  const loadForm = async () => {
    setLoading(true)
    try {
      const form = await formStorageService.getForm()
      setFormTitle(form.title)
      setFormDescription(form.description)
      setFields(form.fields.sort((a: any, b: any) => a.order - b.order))
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao carregar formulário' })
    } finally {
      setLoading(false)
    }
  }

  const saveForm = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const reorderedFields = fields.map((field, index) => ({ ...field, order: index + 1 }))
      await formStorageService.saveForm({ title: formTitle, description: formDescription, fields: reorderedFields })
      setMessage({ type: 'success', text: 'Formulário salvo com sucesso!' })
      setTimeout(() => setMessage(null), 3000)
    } catch {
      setMessage({ type: 'error', text: 'Erro ao salvar formulário' })
    } finally {
      setSaving(false)
    }
  }

  const addField = (type: string) => {
    const newField: FormField = {
      id: Date.now().toString(),
      type: type as any,
      label: '',
      required: false,
      order: fields.length + 1,
      ...(type === 'select' || type === 'radio' || type === 'checkbox' ? { options: ['Opção 1'] } : {}),
      ...(type === 'image' ? { maxImages: 1, imageInstructions: '' } : {})
    }
    setFields(prev => [...prev, newField])
    setShowAddField(false)
  }

  const updateField = (id: string, updates: Partial<FormField>) =>
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))

  const deleteField = (id: string) => {
    if (confirm('Tem certeza que deseja remover este campo?'))
      setFields(prev => prev.filter(f => f.id !== id))
  }

  // ── Setas ▲▼ — troca posição entre campos adjacentes
  const moveField = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= fields.length) return
    setFields(prev => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((f, i) => ({ ...f, order: i + 1 }))
    })
  }

  const addOption = (fieldId: string) =>
    setFields(prev => prev.map(f => f.id === fieldId && f.options
      ? { ...f, options: [...f.options, `Opção ${f.options.length + 1}`] } : f))

  const updateOption = (fieldId: string, optionIndex: number, value: string) =>
    setFields(prev => prev.map(f => {
      if (f.id !== fieldId || !f.options) return f
      const opts = [...f.options]; opts[optionIndex] = value
      return { ...f, options: opts }
    }))

  const deleteOption = (fieldId: string, optionIndex: number) =>
    setFields(prev => prev.map(f => f.id === fieldId && f.options
      ? { ...f, options: f.options.filter((_, i) => i !== optionIndex) } : f))

  // ── Drag & Drop — usando pointer events para máxima compatibilidade
  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index
    setDraggedIndex(index)
    // Necessário para Firefox
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragIndexRef.current !== index) setDragOverIndex(index)
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    const fromIndex = dragIndexRef.current
    if (fromIndex === null || fromIndex === dropIndex) {
      setDraggedIndex(null); setDragOverIndex(null); dragIndexRef.current = null
      return
    }
    setFields(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(dropIndex, 0, moved)
      return next.map((f, i) => ({ ...f, order: i + 1 }))
    })
    setDraggedIndex(null); setDragOverIndex(null); dragIndexRef.current = null
  }

  const handleDragEnd = () => {
    setDraggedIndex(null); setDragOverIndex(null); dragIndexRef.current = null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (previewMode) {
    return (
      <div className="max-w-2xl mx-auto py-8 space-y-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Pré-visualização</h2>
          <Button onClick={() => setPreviewMode(false)} variant="outline">
            <Eye className="h-4 w-4 mr-2" />Voltar à Edição
          </Button>
        </div>
        <Card>
          <CardHeader>
            <h2 className="text-2xl font-bold text-gray-900">{formTitle}</h2>
            <p className="text-gray-600 mt-2">{formDescription}</p>
          </CardHeader>
          <CardContent className="space-y-6">
            {fields.sort((a, b) => a.order - b.order).map(field => (
              <div key={field.id} className="space-y-2">
                <label className="block text-sm font-medium text-gray-900">
                  {field.label}{field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {field.type === 'text' && <input type="text" placeholder={field.placeholder} className="w-full px-3 py-2 border border-gray-300 rounded-lg" disabled />}
                {field.type === 'textarea' && <textarea placeholder={field.placeholder} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg" disabled />}
                {field.type === 'select' && (
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg" disabled>
                    <option>Selecione uma opção</option>
                    {field.options?.map((o, i) => <option key={i}>{o}</option>)}
                  </select>
                )}
                {field.type === 'radio' && <div className="space-y-2">{field.options?.map((o, i) => <label key={i} className="flex items-center space-x-2"><input type="radio" disabled className="h-4 w-4" /><span className="text-sm text-gray-700">{o}</span></label>)}</div>}
                {field.type === 'checkbox' && <div className="space-y-2">{field.options?.map((o, i) => <label key={i} className="flex items-center space-x-2"><input type="checkbox" disabled className="h-4 w-4 rounded" /><span className="text-sm text-gray-700">{o}</span></label>)}</div>}
                {field.type === 'image' && (
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                    <Image className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-gray-700">
                      Até {field.maxImages || 1} foto{(field.maxImages || 1) !== 1 ? 's' : ''}
                    </p>
                    {field.imageInstructions && (
                      <p className="text-xs text-gray-500 mt-1">{field.imageInstructions}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-6">
      {message && (
        <div className={`rounded-lg p-4 flex items-center space-x-2 ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <span className="font-medium">{message.text}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Editor de Formulário</h1>
          <p className="text-gray-600 mt-1">Crie e personalize o formulário que seus clientes preencherão</p>
        </div>
        <div className="flex space-x-3">
          <Button onClick={() => setPreviewMode(true)} variant="outline">
            <Eye className="h-4 w-4 mr-2" />Visualizar
          </Button>
          <Button onClick={saveForm} loading={saving}>
            <Save className="h-4 w-4 mr-2" />Salvar Formulário
          </Button>
        </div>
      </div>

      {/* Informações Básicas */}
      <Card>
        <CardHeader><h3 className="text-lg font-medium text-gray-900">Informações Básicas</h3></CardHeader>
        <CardContent className="space-y-4">
          <Input value={formTitle} onChange={(e: any) => setFormTitle(e.target.value)} placeholder="Título do formulário" label="Título do Formulário" />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Descrição</label>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={2}
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </CardContent>
      </Card>

      {/* Campos */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Campos do Formulário</h3>
            <Button onClick={() => setShowAddField(!showAddField)} size="sm">
              <Plus className="h-4 w-4 mr-2" />Adicionar Campo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showAddField && (
            <div className="mb-6 bg-blue-50 rounded-lg p-4 border border-blue-200">
              <p className="text-sm font-medium text-blue-900 mb-3">Selecione o tipo de campo:</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {FIELD_TYPES.map(type => {
                  const Icon = type.icon
                  return (
                    <button key={type.value} onClick={() => addField(type.value)}
                      className="flex items-center space-x-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                      <Icon className="h-4 w-4 text-gray-600" />
                      <span className="text-sm text-gray-700">{type.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Lista de campos */}
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={field.id}
                draggable
                onDragStart={e => handleDragStart(e, index)}
                onDragOver={e => handleDragOver(e, index)}
                onDragLeave={() => setDragOverIndex(null)}
                onDrop={e => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={[
                  'bg-white rounded-lg p-4 border-2 transition-all select-none',
                  draggedIndex === index
                    ? 'opacity-40 border-blue-400 shadow-lg'
                    : dragOverIndex === index
                    ? 'border-blue-500 border-dashed bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                ].join(' ')}
              >
                <div className="flex items-start gap-3">

                  {/* Handle de arrastar */}
                  <div className="mt-1 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-100 transition-colors flex-shrink-0" title="Arraste para reordenar">
                    <GripVertical className="h-5 w-5 text-gray-400" />
                  </div>

                  <div className="flex-1 min-w-0 space-y-3">

                    {/* Topo: número + setas + badge tipo */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                          #{index + 1}
                        </span>
                        {/* Setas ▲▼ */}
                        <div className="flex flex-col">
                          <button
                            type="button"
                            onClick={() => moveField(index, 'up')}
                            disabled={index === 0}
                            title="Mover para cima"
                            className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronUp className="h-4 w-4 text-gray-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveField(index, 'down')}
                            disabled={index === fields.length - 1}
                            title="Mover para baixo"
                            className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronDown className="h-4 w-4 text-gray-600" />
                          </button>
                        </div>
                      </div>
                      <span className="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
                        {FIELD_TYPES.find(t => t.value === field.type)?.label}
                      </span>
                    </div>

                    {/* Obrigatório */}
                    <label className="flex items-center cursor-pointer">
                      <input type="checkbox" checked={field.required}
                        onChange={e => updateField(field.id, { required: e.target.checked })}
                        className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
                      <span className="text-sm text-gray-700">Campo obrigatório</span>
                    </label>

                    <Input value={field.label} onChange={(e: any) => updateField(field.id, { label: e.target.value })}
                      placeholder="Pergunta/Label do campo" label="Pergunta" />

                    {(field.type === 'text' || field.type === 'textarea') && (
                      <Input value={field.placeholder || ''} onChange={(e: any) => updateField(field.id, { placeholder: e.target.value })}
                        placeholder="Texto de ajuda (placeholder)" label="Placeholder" />
                    )}

                    {field.type === 'image' && (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-gray-700">
                            Quantidade máxima de fotos
                          </label>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              value={field.maxImages || 1}
                              min={1}
                              max={20}
                              onChange={(e: any) => {
                                const val = parseInt(e.target.value)
                                updateField(field.id, { maxImages: isNaN(val) || val < 1 ? 1 : val })
                              }}
                              className="w-24 px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-semibold text-gray-800"
                            />
                            <span className="text-sm text-gray-500">
                              {(field.maxImages || 1) === 1 ? 'foto por resposta' : 'fotos por resposta'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">
                            O cliente poderá enviar até {field.maxImages || 1} foto{(field.maxImages || 1) !== 1 ? 's' : ''} neste campo.
                          </p>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-gray-700">Instruções adicionais (opcional)</label>
                          <textarea
                            value={field.imageInstructions || ''}
                            onChange={e => updateField(field.id, { imageInstructions: e.target.value })}
                            placeholder="Ex: A foto deve estar em boa iluminação, sem filtros..."
                            rows={2}
                            className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                    )}

                    {(field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="block text-sm font-medium text-gray-700">Opções</label>
                          <Button size="sm" variant="ghost" onClick={() => addOption(field.id)}>
                            <Plus className="h-3 w-3 mr-1" />Adicionar
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {field.options?.map((option, idx) => (
                            <div key={idx} className="flex items-center space-x-2">
                              <Input value={option} onChange={(e: any) => updateOption(field.id, idx, e.target.value)} placeholder={`Opção ${idx + 1}`} />
                              {field.options && field.options.length > 1 && (
                                <button onClick={() => deleteOption(field.id, idx)} className="text-red-500 hover:text-red-700">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}


                  </div>

                  {/* Botão excluir */}
                  <button onClick={() => deleteField(field.id)} className="text-red-500 hover:text-red-700 mt-1 flex-shrink-0" title="Remover campo">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}

            {fields.length === 0 && (
              <div className="text-center py-12 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
                <p className="font-medium">Nenhum campo adicionado ainda.</p>
                <p className="text-sm mt-2">Clique em "Adicionar Campo" para começar.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dicas */}
      <Card>
        <CardContent className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-900 mb-2">💡 Dicas de Uso:</p>
          <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
            <li><strong>Reordenar:</strong> Use as setas ▲▼ ao lado do número, ou arraste pelo ícone ⋮⋮</li>
            <li><strong>Campos Obrigatórios:</strong> Marque a caixa para tornar o campo obrigatório</li>
            <li><strong>Upload de Imagens:</strong> Use campos de imagem para coletar fotos específicas</li>
            <li><strong>Pré-visualização:</strong> Clique em "Visualizar" para ver como ficará para o cliente</li>
            <li><strong>Salvar:</strong> Não esqueça de salvar após fazer alterações!</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}