import React, { useState, useEffect } from 'react'
import { ClipboardList, Send, Upload, X } from 'lucide-react'

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

// Serviço de storage para carregar o formulário
const formStorageService = {
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
          },
          {
            id: '4',
            type: 'radio',
            label: 'Você já fez análise de coloração antes?',
            options: ['Sim', 'Não'],
            required: true,
            order: 4
          }
        ]
      }
    } catch (error) {
      console.error('Erro ao carregar formulário:', error)
      return {
        title: 'Formulário de Análise de Coloração Pessoal',
        description: 'Preencha suas informações',
        fields: []
      }
    }
  }
}

// Componentes UI
const Button = ({ children, onClick, loading, disabled, className = '' }: any) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
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

const CardContent = ({ children }: any) => (
  <div className="px-6 py-4">
    {children}
  </div>
)

const Input = ({ value, onChange, placeholder, label, required, type = 'text' }: any) => (
  <div className="space-y-1">
    {label && (
      <label className="block text-sm font-medium text-gray-700">
        {label}
      </label>
    )}
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    />
  </div>
)

export function FormStep({ onComplete }: { onComplete: (data: any) => void }) {
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formFields, setFormFields] = useState<FormField[]>([])
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [imageUploads, setImageUploads] = useState<Record<string, File[]>>({})
  const [loading, setLoading] = useState(false)
  const [loadingForm, setLoadingForm] = useState(true)

  useEffect(() => {
    fetchFormStructure()
  }, [])

  const fetchFormStructure = async () => {
    setLoadingForm(true)
    try {
      const form = await formStorageService.getForm()
      setFormTitle(form.title)
      setFormDescription(form.description)
      setFormFields(form.fields.sort((a: any, b: any) => a.order - b.order))
    } catch (error) {
      console.error('Erro ao carregar formulário:', error)
    } finally {
      setLoadingForm(false)
    }
  }

  const handleInputChange = (fieldId: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [fieldId]: value
    }))
  }

  const handleImageSelect = (fieldId: string, files: FileList) => {
    const field = formFields.find(f => f.id === fieldId)
    if (!field) return

    const maxImages = field.maxImages || 1
    const fileArray = Array.from(files).slice(0, maxImages)
    
    setImageUploads(prev => ({
      ...prev,
      [fieldId]: [...(prev[fieldId] || []), ...fileArray].slice(0, maxImages)
    }))
  }

  const removeImage = (fieldId: string, index: number) => {
    setImageUploads(prev => ({
      ...prev,
      [fieldId]: prev[fieldId]?.filter((_, i) => i !== index) || []
    }))
  }

  const handleSubmit = async () => {
    setLoading(true)

    try {
      // Validar campos obrigatórios
      const requiredFields = formFields.filter(f => f.required)
      for (const field of requiredFields) {
        if (field.type === 'image') {
          if (!imageUploads[field.id] || imageUploads[field.id].length === 0) {
            alert(`Por favor, envie a imagem para: ${field.label}`)
            setLoading(false)
            return
          }
        } else if (field.type === 'checkbox') {
          if (!formData[field.id] || formData[field.id].length === 0) {
            alert(`Por favor, preencha o campo: ${field.label}`)
            setLoading(false)
            return
          }
        } else {
          if (!formData[field.id]) {
            alert(`Por favor, preencha o campo: ${field.label}`)
            setLoading(false)
            return
          }
        }
      }

      // Coletar todas as imagens
      const allImages: File[] = []
      Object.values(imageUploads).forEach(files => {
        allImages.push(...files)
      })

      // Simular delay
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      onComplete({
        formData,
        imageUploads,
        attachments: allImages
      })
    } catch (error) {
      console.error('Error submitting form:', error)
    } finally {
      setLoading(false)
    }
  }

  const renderField = (field: FormField) => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            key={field.id}
            label={field.label + (field.required ? ' *' : '')}
            placeholder={field.placeholder}
            value={formData[field.id] || ''}
            onChange={(e: any) => handleInputChange(field.id, e.target.value)}
            required={field.required}
          />
        )
      
      case 'textarea':
        return (
          <div key={field.id} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            <textarea
              placeholder={field.placeholder}
              value={formData[field.id] || ''}
              onChange={(e) => handleInputChange(field.id, e.target.value)}
              required={field.required}
              rows={4}
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )
      
      case 'select':
        return (
          <div key={field.id} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            <select
              value={formData[field.id] || ''}
              onChange={(e) => handleInputChange(field.id, e.target.value)}
              required={field.required}
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Selecione uma opção</option>
              {field.options?.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        )
      
      case 'radio':
        return (
          <div key={field.id} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            <div className="space-y-2">
              {field.options?.map(option => (
                <label key={option} className="flex items-center">
                  <input
                    type="radio"
                    name={field.id}
                    value={option}
                    checked={formData[field.id] === option}
                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                    required={field.required}
                    className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <span className="text-sm text-gray-700">{option}</span>
                </label>
              ))}
            </div>
          </div>
        )
      
      case 'checkbox':
        return (
          <div key={field.id} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            <div className="space-y-2">
              {field.options?.map(option => {
                const currentValues = formData[field.id] || []
                return (
                  <label key={option} className="flex items-center">
                    <input
                      type="checkbox"
                      value={option}
                      checked={currentValues.includes(option)}
                      onChange={(e) => {
                        const newValues = e.target.checked
                          ? [...currentValues, option]
                          : currentValues.filter((v: string) => v !== option)
                        handleInputChange(field.id, newValues)
                      }}
                      className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">{option}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      
      case 'image':
        return (
          <div key={field.id} className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              {field.label + (field.required ? ' *' : '')}
            </label>
            
            {field.imageInstructions && (
              <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-200">
                {field.imageInstructions}
              </p>
            )}
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
              <input
                type="file"
                id={`image-${field.id}`}
                multiple
                accept="image/*"
                onChange={(e) => e.target.files && handleImageSelect(field.id, e.target.files)}
                className="hidden"
              />
              <label
                htmlFor={`image-${field.id}`}
                className="cursor-pointer flex flex-col items-center"
              >
                <Upload className="h-8 w-8 text-gray-400 mb-2" />
                <span className="text-sm text-gray-600">
                  Clique para selecionar {field.maxImages === 1 ? 'imagem' : 'imagens'}
                </span>
                <span className="text-xs text-gray-500 mt-1">
                  Máximo: {field.maxImages || 1} {field.maxImages === 1 ? 'imagem' : 'imagens'}
                </span>
              </label>
            </div>

            {imageUploads[field.id] && imageUploads[field.id].length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {imageUploads[field.id].map((file, index) => (
                  <div key={index} className="relative bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 truncate flex-1">
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeImage(field.id, index)}
                        className="text-red-500 hover:text-red-700 ml-2"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <span className="text-xs text-gray-500">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      
      default:
        return null
    }
  }

  if (loadingForm) {
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
              <ClipboardList className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{formTitle}</h2>
              <p className="text-gray-600">{formDescription}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {formFields.map(renderField)}
            
            {formFields.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>Nenhum campo disponível no formulário.</p>
                <p className="text-sm mt-2">Aguarde enquanto o administrador configura os campos.</p>
              </div>
            )}

            {formFields.length > 0 && (
              <Button onClick={handleSubmit} loading={loading} className="w-full">
                <Send className="h-4 w-4 mr-2" />
                Enviar Formulário
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}