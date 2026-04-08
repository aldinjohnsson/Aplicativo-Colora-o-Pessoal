import React, { useState, useEffect } from 'react'
import { Save, Eye, Plus, Trash2, GripVertical, Image, Type, List, CheckSquare, Circle, AlertCircle, CheckCircle } from 'lucide-react'

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

// Serviço de storage com fallback para localStorage
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
          if (result && result.value) {
            jsonData = result.value
          }
        } catch (e) {
          jsonData = localStorage.getItem('admin-form')
        }
      } else {
        jsonData = localStorage.getItem('admin-form')
      }
      
      if (jsonData) {
        return JSON.parse(jsonData)
      }
      
      // Retornar formulário padrão
      return {
        title: 'Formulário de Análise de Coloração Pessoal',
        description: 'Preencha suas informações para personalizar sua análise',
        fields: [
          {
            id: '1',
            type: 'text',
            label: 'Nome Completo',
            placeholder: 'Digite seu nome completo',
            required: true,
            order: 1
          },
          {
            id: '2',
            type: 'text',
            label: 'Idade',
            placeholder: 'Digite sua idade',
            required: true,
            order: 2
          },
          {
            id: '3',
            type: 'textarea',
            label: 'Qual seu objetivo com a análise de coloração?',
            placeholder: 'Descreva o que espera alcançar...',
            required: true,
            order: 3
          }
        ],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      console.error('Erro ao carregar formulário:', error)
      return {
        title: 'Formulário de Análise de Coloração Pessoal',
        description: 'Preencha suas informações para personalizar sua análise',
        fields: [],
        lastUpdated: new Date().toISOString()
      }
    }
  }
}

// Componentes UI
const Button = ({ children, onClick, loading, disabled, variant = 'primary', size = 'md', className = '' }: any) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed",
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500",
    ghost: "text-gray-700 hover:bg-gray-100"
  }
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm"
  }
  
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />}
      {children}
    </button>
  )
}

const Card = ({ children }: any) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
    {children}
  </div>
)

const CardHeader = ({ children }: any) => (
  <div className="px-6 py-4 border-b border-gray-200">
    {children}
  </div>
)

const CardContent = ({ children, className = '' }: any) => (
  <div className={`px-6 py-4 ${className}`}>
    {children}
  </div>
)

const Input = ({ value, onChange, placeholder, label, type = 'text', min, max, className = '' }: any) => (
  <div className="space-y-1">
    {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      min={min}
      max={max}
      className={`block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${className}`}
    />
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
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [showAddField, setShowAddField] = useState(false)

  useEffect(() => {
    loadForm()
  }, [])

  const loadForm = async () => {
    setLoading(true)
    try {
      const form = await formStorageService.getForm()
      setFormTitle(form.title)
      setFormDescription(form.description)
      setFields(form.fields.sort((a: any, b: any) => a.order - b.order))
    } catch (error) {
      console.error('Erro ao carregar formulário:', error)
      setMessage({ type: 'error', text: 'Erro ao carregar formulário' })
    } finally {
      setLoading(false)
    }
  }

  const addField = (type: string) => {
    const newField: FormField = {
      id: Date.now().toString(),
      type: type as any,
      label: 'Nova Pergunta',
      placeholder: type === 'text' || type === 'textarea' ? 'Digite aqui...' : undefined,
      options: type === 'select' || type === 'radio' || type === 'checkbox' ? ['Opção 1', 'Opção 2'] : undefined,
      required: false,
      order: fields.length + 1,
      maxImages: type === 'image' ? 1 : undefined,
      imageInstructions: type === 'image' ? 'Instruções para upload da imagem' : undefined
    }
    setFields([...fields, newField])
    setShowAddField(false)
  }

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFields(fields.map(field => 
      field.id === id ? { ...field, ...updates } : field
    ))
  }

  const deleteField = (id: string) => {
    setFields(fields.filter(field => field.id !== id))
  }

  const addOption = (fieldId: string) => {
    const field = fields.find(f => f.id === fieldId)
    if (field && field.options) {
      updateField(fieldId, {
        options: [...field.options, `Opção ${field.options.length + 1}`]
      })
    }
  }

  const updateOption = (fieldId: string, optionIndex: number, value: string) => {
    const field = fields.find(f => f.id === fieldId)
    if (field && field.options) {
      const newOptions = [...field.options]
      newOptions[optionIndex] = value
      updateField(fieldId, { options: newOptions })
    }
  }

  const deleteOption = (fieldId: string, optionIndex: number) => {
    const field = fields.find(f => f.id === fieldId)
    if (field && field.options && field.options.length > 1) {
      updateField(fieldId, {
        options: field.options.filter((_, i) => i !== optionIndex)
      })
    }
  }

  const handleDragStart = (id: string) => {
    setDraggedItem(id)
  }

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    if (draggedItem && draggedItem !== id) {
      const draggedIndex = fields.findIndex(f => f.id === draggedItem)
      const targetIndex = fields.findIndex(f => f.id === id)
      
      const newFields = [...fields]
      const [removed] = newFields.splice(draggedIndex, 1)
      newFields.splice(targetIndex, 0, removed)
      
      setFields(newFields.map((f, i) => ({ ...f, order: i + 1 })))
    }
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
  }

  const saveForm = async () => {
    if (!formTitle.trim()) {
      setMessage({ type: 'error', text: 'O título não pode estar vazio' })
      return
    }

    setSaving(true)
    setMessage(null)
    
    try {
      await formStorageService.saveForm({
        title: formTitle,
        description: formDescription,
        fields: fields
      })
      
      setMessage({ type: 'success', text: 'Formulário salvo com sucesso!' })
      setTimeout(() => setMessage(null), 5000)
    } catch (error) {
      console.error('Erro ao salvar:', error)
      setMessage({ type: 'error', text: 'Erro ao salvar formulário' })
    } finally {
      setSaving(false)
    }
  }

  const renderFieldPreview = (field: FormField) => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            label={field.label + (field.required ? ' *' : '')}
            placeholder={field.placeholder}
            disabled
          />
        )
      case 'textarea':
        return (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            <textarea
              placeholder={field.placeholder}
              disabled
              rows={4}
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>
        )
      case 'select':
        return (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            <select disabled className="block w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50">
              <option>Selecione uma opção</option>
              {field.options?.map((opt, i) => (
                <option key={i}>{opt}</option>
              ))}
            </select>
          </div>
        )
      case 'radio':
      case 'checkbox':
        return (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            <div className="space-y-2">
              {field.options?.map((opt, i) => (
                <label key={i} className="flex items-center">
                  <input type={field.type} disabled className="mr-2" />
                  <span className="text-sm text-gray-700">{opt}</span>
                </label>
              ))}
            </div>
          </div>
        )
      case 'image':
        return (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            {field.imageInstructions && (
              <p className="text-sm text-gray-600">{field.imageInstructions}</p>
            )}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50">
              <Image className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <span className="text-sm text-gray-600">
                Máximo: {field.maxImages} {field.maxImages === 1 ? 'imagem' : 'imagens'}
              </span>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Carregando formulário...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (previewMode) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Visualização do Formulário</h2>
          <Button variant="outline" onClick={() => setPreviewMode(false)}>
            Voltar à Edição
          </Button>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold text-gray-900">{formTitle}</h2>
            <p className="text-gray-600">{formDescription}</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {fields.sort((a, b) => a.order - b.order).map(field => (
                <div key={field.id}>
                  {renderFieldPreview(field)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Editor de Formulário</h2>
          <p className="text-gray-600">Configure os campos do formulário que os clientes preencherão</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => setPreviewMode(true)}>
            <Eye className="h-4 w-4 mr-2" />
            Visualizar
          </Button>
          <Button onClick={saveForm} loading={saving}>
            <Save className="h-4 w-4 mr-2" />
            Salvar Alterações
          </Button>
        </div>
      </div>

      {/* Mensagens */}
      {message && (
        <div className={`rounded-lg p-4 ${
          message.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-center">
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            )}
            <p className={`text-sm ${message.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
              {message.text}
            </p>
          </div>
        </div>
      )}

      {/* Configurações Gerais */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-medium text-gray-900">Configurações Gerais</h3>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Input
              label="Título do Formulário"
              value={formTitle}
              onChange={(e: any) => setFormTitle(e.target.value)}
              placeholder="Digite o título do formulário"
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Descrição</label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Descrição do formulário"
                rows={2}
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campos do Formulário */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Campos do Formulário</h3>
            <Button onClick={() => setShowAddField(!showAddField)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Campo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Menu de Adicionar Campo */}
          {showAddField && (
            <div className="mb-6 bg-blue-50 rounded-lg p-4 border border-blue-200">
              <p className="text-sm font-medium text-blue-900 mb-3">Selecione o tipo de campo:</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {FIELD_TYPES.map(type => {
                  const Icon = type.icon
                  return (
                    <button
                      key={type.value}
                      onClick={() => addField(type.value)}
                      className="flex items-center space-x-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Icon className="h-4 w-4 text-gray-600" />
                      <span className="text-sm text-gray-700">{type.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {fields.sort((a, b) => a.order - b.order).map((field) => (
              <div
                key={field.id}
                draggable
                onDragStart={() => handleDragStart(field.id)}
                onDragOver={(e) => handleDragOver(e, field.id)}
                onDragEnd={handleDragEnd}
                className={`bg-gray-50 rounded-lg p-4 border-2 ${
                  draggedItem === field.id ? 'border-blue-400 opacity-50' : 'border-gray-200'
                } transition-all cursor-move`}
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-2">
                    <GripVertical className="h-5 w-5 text-gray-400" />
                  </div>
                  
                  <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-gray-700">Tipo</label>
                        <span className="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
                          {FIELD_TYPES.find(t => t.value === field.type)?.label}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) => updateField(field.id, { required: e.target.checked })}
                            className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="text-sm text-gray-700">Campo obrigatório</span>
                        </label>
                      </div>
                    </div>

                    <Input
                      value={field.label}
                      onChange={(e: any) => updateField(field.id, { label: e.target.value })}
                      placeholder="Pergunta/Label do campo"
                      label="Pergunta"
                    />

                    {(field.type === 'text' || field.type === 'textarea') && (
                      <Input
                        value={field.placeholder || ''}
                        onChange={(e: any) => updateField(field.id, { placeholder: e.target.value })}
                        placeholder="Texto de ajuda (placeholder)"
                        label="Placeholder"
                      />
                    )}

                    {(field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="block text-sm font-medium text-gray-700">Opções</label>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => addOption(field.id)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Adicionar
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {field.options?.map((option, idx) => (
                            <div key={idx} className="flex items-center space-x-2">
                              <Input
                                value={option}
                                onChange={(e: any) => updateOption(field.id, idx, e.target.value)}
                                placeholder={`Opção ${idx + 1}`}
                              />
                              {field.options && field.options.length > 1 && (
                                <button
                                  onClick={() => deleteOption(field.id, idx)}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {field.type === 'image' && (
                      <div className="space-y-3">
                        <Input
                          type="number"
                          value={field.maxImages || 1}
                          onChange={(e: any) => updateField(field.id, { maxImages: parseInt(e.target.value) || 1 })}
                          label="Número máximo de imagens"
                          min="1"
                          max="10"
                        />
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-gray-700">Instruções</label>
                          <textarea
                            value={field.imageInstructions || ''}
                            onChange={(e) => updateField(field.id, { imageInstructions: e.target.value })}
                            placeholder="Instruções para o upload"
                            rows={2}
                            className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => deleteField(field.id)}
                    className="text-red-500 hover:text-red-700 mt-2"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}

            {fields.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>Nenhum campo adicionado ainda.</p>
                <p className="text-sm mt-2">Clique em "Adicionar Campo" para começar.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dicas */}
      <Card>
        <CardContent className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            <strong>Dicas:</strong>
          </p>
          <ul className="text-sm text-blue-700 mt-2 space-y-1 list-disc list-inside">
            <li>Arraste os campos para reordená-los</li>
            <li>Marque campos importantes como obrigatórios</li>
            <li>Use campos de imagem para coletar fotos específicas</li>
            <li>Visualize antes de salvar para conferir o resultado</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}