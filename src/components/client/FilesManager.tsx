import React, { useState, useEffect } from 'react'
import { Button } from '../ui/Button'
import { Card, CardContent, CardHeader } from '../ui/Card'
import { 
  FileText, 
  Image as ImageIcon, 
  Paperclip,
  Download,
  Eye,
  Folder,
  FolderOpen,
  CheckCircle,
  Package,
  Calendar,
  User
} from 'lucide-react'
import jsPDF from 'jspdf'
import { PhotoGallery } from './PhotoGallery'

interface FileItem {
  id: string
  name: string
  type: 'pdf' | 'image' | 'attachment'
  size: number
  blob: Blob
  category?: string
  url?: string
}

interface FilesManagerProps {
  clientName: string
  contractData: any
  formData: any
  formAttachments: File[]
  photos: File[]
  onDownloadAll: () => void
}

// Função para gerar PDF do Contrato (inline - não precisa de import)
const generateContractPDF = (contractData: any, clientName: string): Blob => {
  const pdf = new jsPDF()
  let yPosition = 20
  const pageHeight = pdf.internal.pageSize.height
  const margin = 20
  const maxWidth = pdf.internal.pageSize.width - 2 * margin

  // Título
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  const titleLines = pdf.splitTextToSize(contractData.title || 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS', maxWidth)
  titleLines.forEach((line: string) => {
    if (yPosition > pageHeight - margin) {
      pdf.addPage()
      yPosition = margin
    }
    pdf.text(line, margin, yPosition)
    yPosition += 8
  })

  yPosition += 10

  // Seções
  pdf.setFontSize(12)
  if (contractData.sections) {
    contractData.sections.forEach((section: any) => {
      if (yPosition > pageHeight - margin) {
        pdf.addPage()
        yPosition = margin
      }
      
      pdf.setFont('helvetica', 'bold')
      pdf.text(section.title, margin, yPosition)
      yPosition += 7

      pdf.setFont('helvetica', 'normal')
      const contentLines = pdf.splitTextToSize(section.content, maxWidth)
      contentLines.forEach((line: string) => {
        if (yPosition > pageHeight - margin) {
          pdf.addPage()
          yPosition = margin
        }
        pdf.text(line, margin, yPosition)
        yPosition += 6
      })

      yPosition += 10
    })
  }

  // Assinatura
  if (yPosition > pageHeight - 60) {
    pdf.addPage()
    yPosition = margin
  }

  yPosition += 20
  pdf.setFont('helvetica', 'bold')
  pdf.text('ACEITE DO CONTRATO', margin, yPosition)
  yPosition += 10

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`Cliente: ${clientName}`, margin, yPosition)
  yPosition += 7
  pdf.text(`Data de aceite: ${new Date(contractData.timestamp).toLocaleString('pt-BR')}`, margin, yPosition)
  yPosition += 7
  pdf.text('Assinatura digital: ✓ Aceito eletronicamente', margin, yPosition)

  return pdf.output('blob')
}

// Função para gerar PDF do Formulário (inline - não precisa de import)
const generateFormPDF = (formData: any, clientName: string, formConfig: any): Blob => {
  const pdf = new jsPDF()
  let yPosition = 20
  const pageHeight = pdf.internal.pageSize.height
  const margin = 20
  const maxWidth = pdf.internal.pageSize.width - 2 * margin

  // Título
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.text('FORMULÁRIO DE ANÁLISE DE COLORAÇÃO PESSOAL', margin, yPosition)
  yPosition += 15

  // Nome do cliente
  pdf.setFontSize(12)
  pdf.text(`Cliente: ${clientName}`, margin, yPosition)
  yPosition += 7
  pdf.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, margin, yPosition)
  yPosition += 15

  // Campos do formulário
  pdf.setFontSize(11)
  
  if (formConfig && formConfig.sections) {
    formConfig.sections.forEach((section: any) => {
      if (yPosition > pageHeight - margin) {
        pdf.addPage()
        yPosition = margin
      }

      pdf.setFont('helvetica', 'bold')
      pdf.text(section.title, margin, yPosition)
      yPosition += 8

      section.fields.forEach((field: any) => {
        if (yPosition > pageHeight - margin - 20) {
          pdf.addPage()
          yPosition = margin
        }

        pdf.setFont('helvetica', 'bold')
        pdf.text(`${field.label}:`, margin, yPosition)
        yPosition += 6

        pdf.setFont('helvetica', 'normal')
        const value = formData[field.id] || 'Não informado'
        const valueLines = pdf.splitTextToSize(String(value), maxWidth - 10)
        
        valueLines.forEach((line: string) => {
          if (yPosition > pageHeight - margin) {
            pdf.addPage()
            yPosition = margin
          }
          pdf.text(line, margin + 5, yPosition)
          yPosition += 5
        })

        yPosition += 5
      })

      yPosition += 5
    })
  } else {
    // Fallback: mostrar todos os dados
    Object.entries(formData).forEach(([key, value]) => {
      if (yPosition > pageHeight - margin - 20) {
        pdf.addPage()
        yPosition = margin
      }

      pdf.setFont('helvetica', 'bold')
      pdf.text(`${key}:`, margin, yPosition)
      yPosition += 6

      pdf.setFont('helvetica', 'normal')
      const valueLines = pdf.splitTextToSize(String(value), maxWidth - 10)
      valueLines.forEach((line: string) => {
        if (yPosition > pageHeight - margin) {
          pdf.addPage()
          yPosition = margin
        }
        pdf.text(line, margin + 5, yPosition)
        yPosition += 5
      })

      yPosition += 8
    })
  }

  return pdf.output('blob')
}

export function FilesManager({
  clientName,
  contractData,
  formData,
  formAttachments,
  photos,
  onDownloadAll
}: FilesManagerProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['pdfs', 'photos']))
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)

  useEffect(() => {
    generateFiles()
  }, [])

  const generateFiles = async () => {
    setLoading(true)
    const generatedFiles: FileItem[] = []

    try {
      // 1. Gerar PDF do Contrato
      const contractPDF = generateContractPDF(contractData, clientName)
      generatedFiles.push({
        id: 'contract-pdf',
        name: '1_Contrato.pdf',
        type: 'pdf',
        size: contractPDF.size,
        blob: contractPDF,
        category: 'pdfs'
      })

      // 2. Gerar PDF do Formulário
      const formConfig = await getFormConfig()
      const formPDF = generateFormPDF(formData, clientName, formConfig)
      generatedFiles.push({
        id: 'form-pdf',
        name: '2_Formulario.pdf',
        type: 'pdf',
        size: formPDF.size,
        blob: formPDF,
        category: 'pdfs'
      })

      // 3. Adicionar Fotos
      photos.forEach((photo, index) => {
        const extension = photo.name.split('.').pop() || 'jpg'
        const url = URL.createObjectURL(photo)
        generatedFiles.push({
          id: `photo-${index}`,
          name: `Foto_${index + 1}.${extension}`,
          type: 'image',
          size: photo.size,
          blob: photo,
          category: 'photos',
          url: url
        })
      })

      // 4. Adicionar Anexos do Formulário
      formAttachments.forEach((attachment, index) => {
        generatedFiles.push({
          id: `attachment-${index}`,
          name: attachment.name,
          type: 'attachment',
          size: attachment.size,
          blob: attachment,
          category: 'attachments'
        })
      })

      setFiles(generatedFiles)
    } catch (error) {
      console.error('Erro ao gerar arquivos:', error)
    } finally {
      setLoading(false)
    }
  }

  const getFormConfig = async () => {
    try {
      let jsonData: string | null = null
      
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          const result = await (window as any).storage.get('admin-form-config', true)
          if (result && result.value) {
            jsonData = result.value
          }
        } catch (e) {
          jsonData = localStorage.getItem('admin-form-config')
        }
      } else {
        jsonData = localStorage.getItem('admin-form-config')
      }
      
      if (jsonData) {
        return JSON.parse(jsonData)
      }
      
      return null
    } catch (error) {
      console.error('Erro ao carregar configuração:', error)
      return null
    }
  }

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev)
      if (newSet.has(folder)) {
        newSet.delete(folder)
      } else {
        newSet.add(folder)
      }
      return newSet
    })
  }

  const downloadFile = (file: FileItem) => {
    const url = URL.createObjectURL(file.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const previewFileHandler = (file: FileItem) => {
    setPreviewFile(file)
  }

  const closePreview = () => {
    setPreviewFile(null)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  const handleDownloadAllPhotos = async () => {
    const photoFiles = files.filter(f => f.type === 'image')
    
    if (photoFiles.length === 0) return

    // Se houver apenas uma foto, baixar diretamente
    if (photoFiles.length === 1) {
      downloadFile(photoFiles[0])
      return
    }

    // Para múltiplas fotos, criar um ZIP
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const photosFolder = zip.folder('Fotos_Analise')

      if (photosFolder) {
        for (const photo of photoFiles) {
          photosFolder.file(photo.name, photo.blob)
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_Fotos.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao criar ZIP das fotos:', error)
    }
  }

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'pdf':
        return <FileText className="h-5 w-5 text-red-600" />
      case 'image':
        return <ImageIcon className="h-5 w-5 text-blue-600" />
      case 'attachment':
        return <Paperclip className="h-5 w-5 text-purple-600" />
      default:
        return <FileText className="h-5 w-5 text-gray-600" />
    }
  }

  const folders = [
    {
      id: 'pdfs',
      name: 'Documentos PDF',
      icon: FileText,
      color: 'red',
      files: files.filter(f => f.category === 'pdfs')
    },
    {
      id: 'photos',
      name: 'Fotos para Análise',
      icon: ImageIcon,
      color: 'blue',
      files: files.filter(f => f.category === 'photos')
    },
    {
      id: 'attachments',
      name: 'Anexos do Formulário',
      icon: Paperclip,
      color: 'purple',
      files: files.filter(f => f.category === 'attachments')
    }
  ].filter(folder => folder.files.length > 0)

  const totalSize = files.reduce((acc, file) => acc + file.size, 0)
  const totalFiles = files.length

  if (loading) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Preparando seus arquivos...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header com Informações do Cliente */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Processo Concluído</h2>
                <p className="text-gray-600 mb-3">Todos os seus documentos estão prontos</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500">
                  <div className="flex items-center">
                    <User className="h-4 w-4 mr-1" />
                    {clientName}
                  </div>
                  <div className="flex items-center">
                    <Calendar className="h-4 w-4 mr-1" />
                    {new Date().toLocaleDateString('pt-BR')}
                  </div>
                  <div className="flex items-center">
                    <Package className="h-4 w-4 mr-1" />
                    {totalFiles} arquivo{totalFiles !== 1 ? 's' : ''} ({formatFileSize(totalSize)})
                  </div>
                </div>
              </div>
            </div>
            <Button onClick={onDownloadAll} size="lg" className="w-full lg:w-auto">
              <Download className="h-5 w-5 mr-2" />
              Baixar Tudo (.zip)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Galeria de Fotos */}
      {files.filter(f => f.type === 'image' && f.url).length > 0 && (
        <PhotoGallery
          photos={files
            .filter(f => f.type === 'image' && f.url)
            .map(f => ({
              id: f.id,
              name: f.name,
              blob: f.blob,
              size: f.size,
              url: f.url!
            }))
          }
          onDownloadAll={handleDownloadAllPhotos}
        />
      )}

      {/* Gerenciador de Arquivos */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Seus Arquivos</h3>
              <p className="text-sm text-gray-600 mt-1">
                Clique em cada arquivo para visualizar ou baixar individualmente
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {folders.map((folder) => {
              const FolderIcon = folder.icon
              const isExpanded = expandedFolders.has(folder.id)
              const folderSize = folder.files.reduce((acc, f) => acc + f.size, 0)

              return (
                <div key={folder.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Cabeçalho da Pasta */}
                  <button
                    onClick={() => toggleFolder(folder.id)}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      {isExpanded ? (
                        <FolderOpen className={`h-5 w-5 text-${folder.color}-600`} />
                      ) : (
                        <Folder className={`h-5 w-5 text-${folder.color}-600`} />
                      )}
                      <div className="text-left">
                        <h4 className="font-medium text-gray-900">{folder.name}</h4>
                        <p className="text-xs text-gray-500">
                          {folder.files.length} arquivo{folder.files.length !== 1 ? 's' : ''} · {formatFileSize(folderSize)}
                        </p>
                      </div>
                    </div>
                    <div className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Lista de Arquivos */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-200">
                      {folder.files.map((file) => (
                        <div
                          key={file.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 hover:bg-gray-50 transition-colors gap-3"
                        >
                          <div className="flex items-center space-x-3 flex-1 min-w-0">
                            {getFileIcon(file.type)}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {file.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatFileSize(file.size)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 sm:ml-4">
                            {(file.type === 'pdf' || file.type === 'image') && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => previewFileHandler(file)}
                              >
                                <Eye className="h-4 w-4 sm:mr-1" />
                                <span className="hidden sm:inline">Visualizar</span>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => downloadFile(file)}
                            >
                              <Download className="h-4 w-4 sm:mr-1" />
                              <span className="hidden sm:inline">Baixar</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Modal de Preview */}
      {previewFile && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
          onClick={closePreview}
        >
          <div 
            className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                {getFileIcon(previewFile.type)}
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-gray-900 truncate">{previewFile.name}</h3>
                  <p className="text-xs text-gray-500">{formatFileSize(previewFile.size)}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2 ml-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadFile(previewFile)}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Baixar
                </Button>
                <button
                  onClick={closePreview}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-4 overflow-auto flex-1">
              {previewFile.type === 'pdf' && (
                <iframe
                  src={URL.createObjectURL(previewFile.blob)}
                  className="w-full h-full min-h-[600px] border-0"
                  title={previewFile.name}
                />
              )}
              {previewFile.type === 'image' && (
                <img
                  src={URL.createObjectURL(previewFile.blob)}
                  alt={previewFile.name}
                  className="w-full h-auto max-w-full"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Informações Adicionais */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-medium text-gray-900">Próximos Passos</h3>
        </CardHeader>
        <CardContent>
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-sm text-blue-900 mb-2">
              <strong>✓ Documentos Salvos com Sucesso</strong>
            </p>
            <p className="text-sm text-blue-700">
              Todos os seus documentos foram processados e salvos. Nossa equipe irá analisar suas 
              informações e fotos, e em breve entraremos em contato com os resultados.
            </p>
            <p className="text-sm text-blue-700 mt-2">
              <strong>Prazo de análise:</strong> Até 5 dias úteis
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}