import React, { useState, useEffect } from 'react'
import { Save, Eye, Plus, Trash2, GripVertical, Camera, AlertCircle, CheckCircle } from 'lucide-react'
import { PhotoCategoryInstructionsEditor, migrateToInstructionItems } from './PhotoCategoryInstructionsEditor'
import { supabase } from '@/lib/supabase' // ajuste o path para o seu cliente Supabase

// ─── Types ───────────────────────────────────────────────────────────────────

interface InstructionItem {
  id: string
  type: 'text' | 'video' | 'image'
  content: string
}

interface PhotoCategory {
  id: string
  title: string
  description: string
  instruction_items: InstructionItem[]
  maxPhotos: number
  order: number
}

// ─── Storage service ──────────────────────────────────────────────────────────

const photoStorageService = {
  async savePhotoConfig(data: { categories: PhotoCategory[] }) {
    try {
      const photoData = {
        categories: data.categories,
        lastUpdated: new Date().toISOString()
      }

      const jsonData = JSON.stringify(photoData)

      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          await (window as any).storage.set('admin-photo-config', jsonData, true)
        } catch (e) {
          localStorage.setItem('admin-photo-config', jsonData)
        }
      } else {
        localStorage.setItem('admin-photo-config', jsonData)
      }

      return { success: true }
    } catch (error) {
      console.error('Erro ao salvar configuração de fotos:', error)
      throw error
    }
  },

  async getPhotoConfig() {
    try {
      let jsonData: string | null = null

      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          const result = await (window as any).storage.get('admin-photo-config', true)
          if (result && result.value) {
            jsonData = result.value
          }
        } catch (e) {
          jsonData = localStorage.getItem('admin-photo-config')
        }
      } else {
        jsonData = localStorage.getItem('admin-photo-config')
      }

      if (jsonData) {
        const parsed = JSON.parse(jsonData)
        // Migrate any saved categories still using the legacy format (videoUrl + instructions[])
        parsed.categories = parsed.categories.map((cat: any) => ({
          ...cat,
          instruction_items: migrateToInstructionItems(
            cat.videoUrl,
            cat.instructions,
            cat.instruction_items
          )
        }))
        return parsed
      }

      // Default config
      return {
        categories: [
          {
            id: '1',
            title: 'Foto sem Maquiagem',
            description: 'Foto natural com cabelo solto de frente para janela',
            instruction_items: [
              { id: '1-1', type: 'text', content: 'Retire toda maquiagem do rosto' },
              { id: '1-2', type: 'text', content: 'Solte o cabelo naturalmente' },
              { id: '1-3', type: 'text', content: 'Posicione-se de frente para uma janela com luz natural' },
              { id: '1-4', type: 'text', content: 'Olhe diretamente para a câmera' },
              { id: '1-5', type: 'text', content: 'Mantenha expressão neutra' }
            ],
            maxPhotos: 3,
            order: 1
          },
          {
            id: '2',
            title: 'Foto da Íris',
            description: 'Close-up dos olhos para análise da cor',
            instruction_items: [
              { id: '2-1', type: 'text', content: 'Use boa iluminação natural' },
              { id: '2-2', type: 'text', content: 'Foto bem próxima dos olhos' },
              { id: '2-3', type: 'text', content: 'Certifique-se que a íris está bem visível' }
            ],
            maxPhotos: 2,
            order: 2
          }
        ]
      }
    } catch (error) {
      console.error('Erro ao carregar configuração de fotos:', error)
      return { categories: [] }
    }
  }
}

// ─── UI primitives ────────────────────────────────────────────────────────────

const Button = ({ children, onClick, loading, disabled, variant = 'primary', size = 'md', className = '' }: any) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
  const variants: any = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed",
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500",
    ghost: "text-gray-700 hover:bg-gray-100"
  }
  const sizes: any = {
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
  <div className="bg-white rounded-lg shadow-sm border border-gray-200">{children}</div>
)

const CardHeader = ({ children }: any) => (
  <div className="px-6 py-4 border-b border-gray-200">{children}</div>
)

const CardContent = ({ children, className = '' }: any) => (
  <div className={`px-6 py-4 ${className}`}>{children}</div>
)

const Input = ({ value, onChange, placeholder, label, type = 'text', min, max }: any) => (
  <div className="space-y-1">
    {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      min={min}
      max={max}
      className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    />
  </div>
)

// ─── Main component ───────────────────────────────────────────────────────────

export function PhotoEditor() {
  const [categories, setCategories] = useState<PhotoCategory[]>([])
  const [previewMode, setPreviewMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [draggedItem, setDraggedItem] = useState<string | null>(null)

  useEffect(() => {
    loadPhotoConfig()
  }, [])

  const loadPhotoConfig = async () => {
    setLoading(true)
    try {
      const config = await photoStorageService.getPhotoConfig()
      setCategories(config.categories.sort((a: any, b: any) => a.order - b.order))
    } catch (error) {
      console.error('Erro ao carregar configuração:', error)
      setMessage({ type: 'error', text: 'Erro ao carregar configuração' })
    } finally {
      setLoading(false)
    }
  }

  const addCategory = () => {
    const newCategory: PhotoCategory = {
      id: Date.now().toString(),
      title: 'Nova Categoria',
      description: 'Descrição da categoria',
      instruction_items: [
        { id: `${Date.now()}-1`, type: 'text', content: 'Instrução 1' },
        { id: `${Date.now()}-2`, type: 'text', content: 'Instrução 2' }
      ],
      maxPhotos: 3,
      order: categories.length + 1
    }
    setCategories([...categories, newCategory])
  }

  const updateCategory = (id: string, updates: Partial<PhotoCategory>) => {
    setCategories(categories.map(cat => (cat.id === id ? { ...cat, ...updates } : cat)))
  }

  const deleteCategory = (id: string) => {
    setCategories(categories.filter(cat => cat.id !== id))
  }

  const handleDragStart = (id: string) => {
    setDraggedItem(id)
  }

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    if (draggedItem && draggedItem !== id) {
      const draggedIndex = categories.findIndex(c => c.id === draggedItem)
      const targetIndex = categories.findIndex(c => c.id === id)
      const newCategories = [...categories]
      const [removed] = newCategories.splice(draggedIndex, 1)
      newCategories.splice(targetIndex, 0, removed)
      setCategories(newCategories.map((c, i) => ({ ...c, order: i + 1 })))
    }
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
  }

  // ── Image upload → Supabase Storage ──────────────────────────────────────────
  // Faz upload para o bucket "category-instructions" e retorna { storagePath, url }.
  // O bucket precisa existir e ter política pública de leitura (ou usar signed URLs).
  //
  // Se ainda não tiver a coluna instruction_items no banco, rode:
  //   ALTER TABLE photo_categories
  //     ADD COLUMN IF NOT EXISTS instruction_items jsonb NOT NULL DEFAULT '[]'::jsonb;
  const uploadFile = async (file: File): Promise<{ storagePath: string; url: string }> => {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const storagePath = `instructions/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('category-instructions')   // ← nome do bucket; mude se necessário
      .upload(storagePath, file, { upsert: false, contentType: file.type })

    if (uploadError) throw uploadError

    const { data } = supabase.storage
      .from('category-instructions')
      .getPublicUrl(storagePath)

    return { storagePath, url: data.publicUrl }
  }

  const savePhotoConfig = async () => {
    if (categories.length === 0) {
      setMessage({ type: 'error', text: 'Adicione pelo menos uma categoria' })
      return
    }

    setSaving(true)
    setMessage(null)

    try {
      await photoStorageService.savePhotoConfig({ categories })
      setMessage({ type: 'success', text: 'Configuração de fotos salva com sucesso!' })
      setTimeout(() => setMessage(null), 5000)
    } catch (error) {
      console.error('Erro ao salvar:', error)
      setMessage({ type: 'error', text: 'Erro ao salvar configuração' })
    } finally {
      setSaving(false)
    }
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  const renderPreview = () => (
    <div className="space-y-6">
      {categories.sort((a, b) => a.order - b.order).map(category => (
        <Card key={category.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">{category.title}</h3>
                <p className="text-gray-600">{category.description}</p>
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                Máx: {category.maxPhotos} {category.maxPhotos === 1 ? 'foto' : 'fotos'}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {category.instruction_items.map(item => {
                if (item.type === 'video') {
                  return (
                    <div key={item.id} className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
                      <p className="text-sm text-gray-500 break-all px-4">{item.content}</p>
                    </div>
                  )
                }
                if (item.type === 'image') {
                  return (
                    <img
                      key={item.id}
                      src={item.content}
                      alt="Instrução"
                      className="rounded-lg max-h-48 object-contain border border-gray-200"
                    />
                  )
                }
                // type === 'text'
                return (
                  <li key={item.id} className="text-sm text-gray-600 flex items-start list-none">
                    <span className="inline-block w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 mr-2 flex-shrink-0" />
                    {item.content}
                  </li>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )

  // ─── Loading / preview guards ─────────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Carregando configuração...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (previewMode) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Visualização – Etapa de Fotos</h2>
          <Button variant="outline" onClick={() => setPreviewMode(false)}>
            Voltar à Edição
          </Button>
        </div>
        {renderPreview()}
      </div>
    )
  }

  // ─── Editor ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Editor de Etapa de Fotos</h2>
          <p className="text-gray-600">Configure as categorias de fotos que os clientes enviarão</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => setPreviewMode(true)}>
            <Eye className="h-4 w-4 mr-2" />
            Visualizar
          </Button>
          <Button onClick={savePhotoConfig} loading={saving}>
            <Save className="h-4 w-4 mr-2" />
            Salvar Alterações
          </Button>
        </div>
      </div>

      {/* Messages */}
      {message && (
        <div
          className={`rounded-lg p-4 ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}
        >
          <div className="flex items-center">
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            )}
            <p
              className={`text-sm ${
                message.type === 'success' ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {message.text}
            </p>
          </div>
        </div>
      )}

      {/* Categories */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Categorias de Fotos</h3>
            <Button onClick={addCategory} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Categoria
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {categories.sort((a, b) => a.order - b.order).map(category => (
              <div
                key={category.id}
                draggable
                onDragStart={() => handleDragStart(category.id)}
                onDragOver={e => handleDragOver(e, category.id)}
                onDragEnd={handleDragEnd}
                className={`bg-gray-50 rounded-lg p-4 border-2 ${
                  draggedItem === category.id ? 'border-blue-400 opacity-50' : 'border-gray-200'
                } transition-all cursor-move`}
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-2">
                    <GripVertical className="h-5 w-5 text-gray-400" />
                  </div>

                  <div className="flex-1 space-y-4">
                    {/* Title + max photos */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Input
                        value={category.title}
                        onChange={(e: any) => updateCategory(category.id, { title: e.target.value })}
                        placeholder="Título da categoria"
                        label="Título"
                      />
                      <Input
                        type="number"
                        value={category.maxPhotos}
                        onChange={(e: any) =>
                          updateCategory(category.id, { maxPhotos: parseInt(e.target.value) || 1 })
                        }
                        label="Número máximo de fotos"
                        min="1"
                        max="999"
                      />
                    </div>

                    <Input
                      value={category.description}
                      onChange={(e: any) =>
                        updateCategory(category.id, { description: e.target.value })
                      }
                      placeholder="Descrição da categoria"
                      label="Descrição"
                    />

                    {/* ── Unified instructions editor ── */}
                    <PhotoCategoryInstructionsEditor
                      items={category.instruction_items}
                      onChange={items => updateCategory(category.id, { instruction_items: items })}
                      onUpload={uploadFile}
                    />
                  </div>

                  <button
                    onClick={() => deleteCategory(category.id)}
                    className="text-red-500 hover:text-red-700 mt-2"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}

            {categories.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <Camera className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p>Nenhuma categoria adicionada ainda.</p>
                <p className="text-sm mt-2">Clique em "Adicionar Categoria" para começar.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tips */}
      <Card>
        <CardContent className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            <strong>Dicas:</strong>
          </p>
          <ul className="text-sm text-blue-700 mt-2 space-y-1 list-disc list-inside">
            <li>Arraste as categorias para reordená-las</li>
            <li>Defina 999 como máximo de fotos para uploads ilimitados</li>
            <li>Adicione itens do tipo <strong>vídeo</strong>, <strong>imagem</strong> ou <strong>texto</strong> nas instruções</li>
            <li>Instruções legadas (texto + YouTube) são migradas automaticamente ao carregar</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}