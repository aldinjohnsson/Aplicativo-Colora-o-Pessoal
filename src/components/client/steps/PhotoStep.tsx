import React, { useState, useEffect } from 'react'
import { Camera, Upload, Check, Play, X, AlertCircle } from 'lucide-react'

interface PhotoCategory {
  id: string
  title: string
  description: string
  instructions: string[]
  videoUrl?: string
  maxPhotos: number
  order: number
}

interface PhotoStepProps {
  onComplete: (photos: File[]) => void
  clientInfo: {
    fullName: string
    email: string
    phone: string
  }
}

// Serviço de storage
const photoStorageService = {
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
        return JSON.parse(jsonData)
      }
      
      // Configuração padrão com limite de 50 fotos
      return {
        categories: [
          {
            id: '1',
            title: 'Foto sem Maquiagem',
            description: 'Foto natural com cabelo solto de frente para janela',
            instructions: [
              'Retire toda maquiagem do rosto',
              'Solte o cabelo naturalmente',
              'Posicione-se de frente para uma janela com luz natural',
              'Olhe diretamente para a câmera',
              'Mantenha expressão neutra'
            ],
            maxPhotos: 50,
            order: 1
          }
        ]
      }
    } catch (error) {
      console.error('Erro ao carregar configuração:', error)
      return {
        categories: []
      }
    }
  }
}

// Extrair ID do vídeo do YouTube
const getYouTubeEmbedUrl = (url: string) => {
  if (!url) return null
  
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
  const match = url.match(regExp)
  
  if (match && match[2].length === 11) {
    return `https://www.youtube.com/embed/${match[2]}`
  }
  
  return null
}

// Validar e processar imagem com melhor gestão de memória
const processImage = async (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    // Validar tipo
    if (!file.type.startsWith('image/')) {
      reject(new Error('Arquivo não é uma imagem válida'))
      return
    }

    // Limite de tamanho mais generoso (10MB)
    const MAX_SIZE = 10 * 1024 * 1024 // 10MB
    
    // Se for menor que 10MB, retornar como está
    if (file.size < MAX_SIZE) {
      resolve(file)
      return
    }

    // Se for maior, comprimir
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        // Redimensionar mantendo qualidade razoável (max 3000px)
        const maxDimension = 3000
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension
            width = maxDimension
          } else {
            width = (width / height) * maxDimension
            height = maxDimension
          }
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Erro ao criar contexto do canvas'))
          return
        }
        
        ctx.drawImage(img, 0, 0, width, height)

        // Qualidade ajustada para balancear tamanho e qualidade
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const processedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              })
              
              // Limpar memória
              URL.revokeObjectURL(img.src)
              
              resolve(processedFile)
            } else {
              reject(new Error('Erro ao processar imagem'))
            }
          },
          'image/jpeg',
          0.85 // 85% de qualidade
        )
      }
      img.onerror = () => {
        reject(new Error('Erro ao carregar imagem'))
      }
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'))
    reader.readAsDataURL(file)
  })
}

// Processar fotos em lotes para evitar travar o navegador
const processBatch = async (files: File[], batchSize: number = 3): Promise<File[]> => {
  const results: File[] = []
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize)
    
    // Processar lote em paralelo
    const batchResults = await Promise.allSettled(
      batch.map(file => processImage(file))
    )
    
    // Coletar sucessos
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value)
      } else {
        console.error('Erro ao processar imagem:', result.reason)
      }
    }
    
    // Pequena pausa entre lotes para não travar a UI
    if (i + batchSize < files.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  
  return results
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

const Card = ({ children, className = '' }: any) => (
  <div className={`bg-white rounded-lg shadow-sm border border-gray-200 ${className}`}>
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

export function PhotoStep({ onComplete, clientInfo }: PhotoStepProps) {
  const [categories, setCategories] = useState<PhotoCategory[]>([])
  const [uploads, setUploads] = useState<Record<string, File[]>>({})
  const [processing, setProcessing] = useState<Record<string, boolean>>({})
  const [processingProgress, setProcessingProgress] = useState<Record<string, { current: number; total: number }>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    loadPhotoConfig()
  }, [])

  const loadPhotoConfig = async () => {
    const config = await photoStorageService.getPhotoConfig()
    if (config.categories) {
      const sortedCategories = [...config.categories].sort((a, b) => a.order - b.order)
      setCategories(sortedCategories)
      
      // Inicializar uploads
      const initialUploads: Record<string, File[]> = {}
      sortedCategories.forEach(cat => {
        initialUploads[cat.id] = []
      })
      setUploads(initialUploads)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const handleFileSelect = async (categoryId: string, fileList: FileList) => {
    const category = categories.find(c => c.id === categoryId)
    if (!category) return

    const files = Array.from(fileList)
    const currentFiles = uploads[categoryId] || []
    const isUnlimited = category.maxPhotos === 999
    
    // Verificar limite de fotos
    if (!isUnlimited && currentFiles.length + files.length > category.maxPhotos) {
      setErrors({
        ...errors,
        [categoryId]: `Você pode enviar no máximo ${category.maxPhotos} fotos nesta categoria. Já foram enviadas ${currentFiles.length} fotos.`
      })
      return
    }

    // Limpar erro anterior
    setErrors({ ...errors, [categoryId]: '' })
    
    // Processar imagens
    setProcessing({ ...processing, [categoryId]: true })
    setProcessingProgress({ 
      ...processingProgress, 
      [categoryId]: { current: 0, total: files.length } 
    })

    try {
      console.log(`📸 Processando ${files.length} fotos para categoria ${categoryId}...`)
      
      const processedFiles: File[] = []
      for (let i = 0; i < files.length; i++) {
        try {
          const processed = await processImage(files[i])
          processedFiles.push(processed)
          
          setProcessingProgress({ 
            ...processingProgress, 
            [categoryId]: { current: i + 1, total: files.length } 
          })
        } catch (error) {
          console.error(`❌ Erro ao processar ${files[i].name}:`, error)
        }
      }
      
      console.log(`✅ ${processedFiles.length} fotos processadas com sucesso`)
      
      // Adicionar aos uploads
      setUploads({
        ...uploads,
        [categoryId]: [...currentFiles, ...processedFiles]
      })
    } catch (error) {
      console.error('Erro ao processar fotos:', error)
      setErrors({
        ...errors,
        [categoryId]: 'Erro ao processar algumas fotos. Tente novamente.'
      })
    } finally {
      setProcessing({ ...processing, [categoryId]: false })
      setProcessingProgress({ ...processingProgress, [categoryId]: { current: 0, total: 0 } })
    }
  }

  const removeFile = (categoryId: string, index: number) => {
    const newUploads = { ...uploads }
    newUploads[categoryId] = newUploads[categoryId].filter((_, i) => i !== index)
    setUploads(newUploads)
  }

  const handleSubmit = async () => {
    console.log('🚀 Iniciando envio de fotos...')
    
    // Coletar todas as fotos de todas as categorias
    const allPhotos: File[] = []
    Object.values(uploads).forEach(categoryFiles => {
      allPhotos.push(...categoryFiles)
    })

    console.log(`📸 Total de fotos a enviar: ${allPhotos.length}`)
    
    if (allPhotos.length === 0) {
      alert('Por favor, envie pelo menos uma foto.')
      return
    }

    setUploading(true)
    
    try {
      // Passar fotos para o próximo passo
      // O salvamento no Supabase será feito no FinalStep
      console.log('✅ Fotos prontas para processamento final')
      onComplete(allPhotos)
    } catch (error) {
      console.error('❌ Erro ao processar fotos:', error)
      alert('Erro ao processar fotos. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  // Verificar se todas as categorias obrigatórias foram preenchidas
  const isComplete = categories.every(category => {
    const files = uploads[category.id] || []
    return files.length > 0
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <Camera className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Envio de Fotos</h2>
              <p className="text-gray-600">Faça upload das fotos seguindo as instruções</p>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Aviso sobre múltiplas fotos */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent>
          <div className="flex items-start space-x-3">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">💡 Dica para enviar muitas fotos:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Envie até 10-15 fotos por vez para melhor performance</li>
                <li>Aguarde o processamento antes de adicionar mais</li>
                <li>Fotos muito grandes serão automaticamente redimensionadas</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {categories.map((category) => {
        const embedUrl = category.videoUrl ? getYouTubeEmbedUrl(category.videoUrl) : null
        const currentCount = uploads[category.id]?.length || 0
        const isUnlimited = category.maxPhotos === 999
        const maxPhotos = category.maxPhotos
        const progress = processingProgress[category.id]
        
        return (
          <Card key={category.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{category.title}</h3>
                  <p className="text-gray-600">{category.description}</p>
                </div>
                {uploads[category.id] && uploads[category.id].length > 0 && (
                  <div className="flex-shrink-0">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      <Check className="h-3 w-3 mr-1" />
                      {currentCount}{isUnlimited ? '' : `/${maxPhotos}`}
                    </span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Vídeo Tutorial */}
              {embedUrl && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                    <Play className="h-4 w-4 mr-2 text-red-600" />
                    Vídeo Tutorial
                  </h4>
                  <div className="aspect-video rounded-lg overflow-hidden bg-black">
                    <iframe
                      src={embedUrl}
                      title={category.title}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>
              )}

              {/* Instruções */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-900 mb-2">Instruções:</h4>
                <ul className="space-y-1">
                  {category.instructions.map((instruction, index) => (
                    <li key={index} className="text-sm text-gray-600 flex items-start">
                      <span className="inline-block w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 mr-2 flex-shrink-0" />
                      {instruction}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Mensagem de erro */}
              {errors[category.id] && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start">
                  <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 mr-2 flex-shrink-0" />
                  <p className="text-sm text-red-700">{errors[category.id]}</p>
                </div>
              )}

              {/* Upload de Arquivos */}
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-400 transition-colors">
                  <input
                    type="file"
                    id={`file-${category.id}`}
                    multiple
                    accept="image/*,image/heic,image/heif"
                    onChange={(e) => e.target.files && handleFileSelect(category.id, e.target.files)}
                    className="hidden"
                    disabled={processing[category.id]}
                  />
                  <label
                    htmlFor={`file-${category.id}`}
                    className="cursor-pointer flex flex-col items-center"
                  >
                    {processing[category.id] ? (
                      <>
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2" />
                        <span className="text-sm text-gray-600 text-center">
                          Processando imagens...
                        </span>
                        {progress && (
                          <span className="text-xs text-gray-500 mt-1">
                            {progress.current} de {progress.total}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-gray-400 mb-2" />
                        <span className="text-sm text-gray-600 text-center">
                          Clique para selecionar fotos
                        </span>
                        <span className="text-xs text-gray-500 mt-1">
                          {isUnlimited ? 'Upload ilimitado de fotos' : `Máximo: ${maxPhotos} fotos`}
                        </span>
                        <span className="text-xs text-gray-500 mt-1">
                          Formatos aceitos: JPG, PNG, HEIC, HEIF
                        </span>
                        <span className="text-xs text-blue-600 font-medium mt-2">
                          💡 Recomendado: envie até 15 fotos por vez
                        </span>
                      </>
                    )}
                  </label>
                </div>

                {/* Preview das fotos selecionadas */}
                {uploads[category.id] && uploads[category.id].length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium text-gray-700">
                      Fotos selecionadas ({currentCount}{isUnlimited ? '' : `/${maxPhotos}`}):
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {uploads[category.id].map((file, index) => {
                        const imageUrl = URL.createObjectURL(file)
                        return (
                          <div key={index} className="relative group">
                            <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                              <img
                                src={imageUrl}
                                alt={file.name}
                                className="w-full h-full object-cover"
                                onLoad={() => URL.revokeObjectURL(imageUrl)}
                              />
                            </div>
                            <button
                              onClick={() => removeFile(category.id, index)}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 transition-colors shadow-lg opacity-0 group-hover:opacity-100"
                              title="Remover foto"
                            >
                              <X className="h-3 w-3" />
                            </button>
                            <div className="mt-1">
                              <p className="text-xs text-gray-600 truncate">{file.name}</p>
                              <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}

      {categories.length === 0 && (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            <Camera className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p>Nenhuma categoria de foto configurada ainda.</p>
            <p className="text-sm mt-2">Aguarde enquanto o administrador configura as categorias.</p>
          </CardContent>
        </Card>
      )}

      {categories.length > 0 && (
        <Card>
          <CardContent>
            <Button
              onClick={handleSubmit}
              disabled={!isComplete}
              loading={uploading}
              className="w-full"
            >
              <Check className="h-4 w-4 mr-2" />
              Finalizar Envio de Fotos
            </Button>
            
            {!isComplete && (
              <p className="text-sm text-gray-500 text-center mt-2">
                Complete o envio de todas as categorias de fotos para continuar
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}