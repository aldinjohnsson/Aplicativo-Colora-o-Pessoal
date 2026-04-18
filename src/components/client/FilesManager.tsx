import React, { useState, useEffect } from 'react'
import { Button } from '../ui/Button'
import { Card, CardContent, CardHeader } from '../ui/Card'
import {
  FileText, Image as ImageIcon, Paperclip, Download, Eye,
  Folder, FolderOpen, CheckCircle, Package, Calendar, User, X
} from 'lucide-react'
import jsPDF from 'jspdf'
import { PhotoGallery } from './PhotoGallery'

interface FileItem {
  id: string; name: string; type: 'pdf' | 'image' | 'attachment'
  size: number; blob: Blob; category?: string; url?: string
}

interface FilesManagerProps {
  clientName: string; contractData: any; formData: any
  formAttachments: File[]; photos: File[]; onDownloadAll: () => void
}

const generateContractPDF = (contractData: any, clientName: string): Blob => {
  const pdf = new jsPDF(); let y = 20; const ph = pdf.internal.pageSize.height; const m = 20; const mw = pdf.internal.pageSize.width - 2 * m
  pdf.setFontSize(16); pdf.setFont('helvetica', 'bold')
  pdf.splitTextToSize(contractData.title || 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS', mw).forEach((line: string) => { if (y > ph - m) { pdf.addPage(); y = m }; pdf.text(line, m, y); y += 8 })
  y += 10; pdf.setFontSize(12)
  if (contractData.sections) {
    contractData.sections.forEach((s: any) => {
      if (y > ph - m) { pdf.addPage(); y = m }
      pdf.setFont('helvetica', 'bold'); pdf.text(s.title, m, y); y += 7
      pdf.setFont('helvetica', 'normal'); pdf.splitTextToSize(s.content, mw).forEach((line: string) => { if (y > ph - m) { pdf.addPage(); y = m }; pdf.text(line, m, y); y += 6 }); y += 10
    })
  }
  if (y > ph - 60) { pdf.addPage(); y = m }
  y += 20; pdf.setFont('helvetica', 'bold'); pdf.text('ACEITE DO CONTRATO', m, y); y += 10
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
  pdf.text(`Cliente: ${clientName}`, m, y); y += 7
  pdf.text(`Data de aceite: ${new Date(contractData.timestamp).toLocaleString('pt-BR')}`, m, y); y += 7
  pdf.text('Assinatura digital: ✓ Aceito eletronicamente', m, y)
  return pdf.output('blob')
}

const generateFormPDF = (formData: any, clientName: string, formConfig: any): Blob => {
  const pdf = new jsPDF(); let y = 20; const ph = pdf.internal.pageSize.height; const m = 20; const mw = pdf.internal.pageSize.width - 2 * m
  pdf.setFontSize(14); pdf.setFont('helvetica', 'bold'); pdf.text('FORMULÁRIO DE ANÁLISE DE COLORAÇÃO PESSOAL', m, y); y += 12
  pdf.setFontSize(11); pdf.text(`Cliente: ${clientName}`, m, y); y += 7; pdf.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, m, y); y += 12
  pdf.setFontSize(10)
  if (formConfig?.sections) {
    formConfig.sections.forEach((section: any) => {
      if (y > ph - m) { pdf.addPage(); y = m }
      pdf.setFont('helvetica', 'bold'); pdf.text(section.title, m, y); y += 8
      section.fields.forEach((field: any) => {
        if (y > ph - m - 20) { pdf.addPage(); y = m }
        pdf.setFont('helvetica', 'bold'); pdf.text(`${field.label}:`, m, y); y += 6
        pdf.setFont('helvetica', 'normal')
        pdf.splitTextToSize(String(formData[field.id] || 'Não informado'), mw - 10).forEach((line: string) => { if (y > ph - m) { pdf.addPage(); y = m }; pdf.text(line, m + 5, y); y += 5 }); y += 5
      }); y += 5
    })
  } else {
    Object.entries(formData).forEach(([key, value]) => {
      if (y > ph - m - 20) { pdf.addPage(); y = m }
      pdf.setFont('helvetica', 'bold'); pdf.text(`${key}:`, m, y); y += 6
      pdf.setFont('helvetica', 'normal')
      pdf.splitTextToSize(String(value), mw - 10).forEach((line: string) => { if (y > ph - m) { pdf.addPage(); y = m }; pdf.text(line, m + 5, y); y += 5 }); y += 8
    })
  }
  return pdf.output('blob')
}

export function FilesManager({ clientName, contractData, formData, formAttachments, photos, onDownloadAll }: FilesManagerProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['pdfs', 'photos']))
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)

  useEffect(() => { generateFiles() }, [])

  const generateFiles = async () => {
    setLoading(true)
    const generatedFiles: FileItem[] = []
    try {
      const contractPDF = generateContractPDF(contractData, clientName)
      generatedFiles.push({ id: 'contract-pdf', name: '1_Contrato.pdf', type: 'pdf', size: contractPDF.size, blob: contractPDF, category: 'pdfs' })
      const formConfig = await getFormConfig()
      const formPDF = generateFormPDF(formData, clientName, formConfig)
      generatedFiles.push({ id: 'form-pdf', name: '2_Formulario.pdf', type: 'pdf', size: formPDF.size, blob: formPDF, category: 'pdfs' })
      photos.forEach((photo, index) => {
        const ext = photo.name.split('.').pop() || 'jpg'; const url = URL.createObjectURL(photo)
        generatedFiles.push({ id: `photo-${index}`, name: `Foto_${index + 1}.${ext}`, type: 'image', size: photo.size, blob: photo, category: 'photos', url })
      })
      formAttachments.forEach((att, index) => {
        generatedFiles.push({ id: `attachment-${index}`, name: att.name, type: 'attachment', size: att.size, blob: att, category: 'attachments' })
      })
      setFiles(generatedFiles)
    } catch (error) { console.error('Erro ao gerar arquivos:', error) } finally { setLoading(false) }
  }

  const getFormConfig = async () => {
    try {
      const stored = localStorage.getItem('admin-form-config')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  }

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => { const n = new Set(prev); n.has(folder) ? n.delete(folder) : n.add(folder); return n })
  }

  const downloadFile = (file: FileItem) => {
    const url = URL.createObjectURL(file.blob); const a = document.createElement('a')
    a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'; const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  const handleDownloadAllPhotos = async () => {
    const photoFiles = files.filter(f => f.type === 'image')
    if (photoFiles.length === 0) return
    if (photoFiles.length === 1) { downloadFile(photoFiles[0]); return }
    try {
      const JSZip = (await import('jszip')).default; const zip = new JSZip(); const folder = zip.folder('Fotos_Analise')
      if (folder) { for (const photo of photoFiles) folder.file(photo.name, photo.blob) }
      const blob = await zip.generateAsync({ type: 'blob' }); const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_Fotos.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    } catch (error) { console.error('Erro ao criar ZIP:', error) }
  }

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'pdf': return <FileText className="h-5 w-5 text-red-600" />
      case 'image': return <ImageIcon className="h-5 w-5 text-blue-600" />
      case 'attachment': return <Paperclip className="h-5 w-5 text-purple-600" />
      default: return <FileText className="h-5 w-5 text-gray-600" />
    }
  }

  const folders = [
    { id: 'pdfs', name: 'Documentos PDF', icon: FileText, colorClass: 'text-red-600', files: files.filter(f => f.category === 'pdfs') },
    { id: 'photos', name: 'Fotos para Análise', icon: ImageIcon, colorClass: 'text-blue-600', files: files.filter(f => f.category === 'photos') },
    { id: 'attachments', name: 'Anexos do Formulário', icon: Paperclip, colorClass: 'text-purple-600', files: files.filter(f => f.category === 'attachments') },
  ].filter(folder => folder.files.length > 0)

  const totalSize = files.reduce((acc, f) => acc + f.size, 0)
  const totalFiles = files.length

  if (loading) return (
    <Card><CardContent className="text-center py-10 sm:py-12">
      <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-b-2 border-blue-600 mx-auto mb-4" />
      <p className="text-gray-600 text-sm">Preparando seus arquivos...</p>
    </CardContent></Card>
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <Card>
        <CardContent className="py-4 sm:py-6 px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-0.5">Processo Concluído</h2>
                <p className="text-sm text-gray-600 mb-2">Todos os seus documentos estão prontos</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-gray-500">
                  <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{clientName}</span>
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{new Date().toLocaleDateString('pt-BR')}</span>
                  <span className="flex items-center gap-1"><Package className="h-3.5 w-3.5" />{totalFiles} arquivo{totalFiles !== 1 ? 's' : ''} ({formatFileSize(totalSize)})</span>
                </div>
              </div>
            </div>
            <Button onClick={onDownloadAll} size="lg" className="w-full sm:w-auto flex-shrink-0 text-sm">
              <Download className="h-4 w-4 mr-2" /> Baixar Tudo (.zip)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Photo Gallery */}
      {files.filter(f => f.type === 'image' && f.url).length > 0 && (
        <PhotoGallery
          photos={files.filter(f => f.type === 'image' && f.url).map(f => ({ id: f.id, name: f.name, blob: f.blob, size: f.size, url: f.url! }))}
          onDownloadAll={handleDownloadAllPhotos}
        />
      )}

      {/* File Manager */}
      <Card>
        <CardHeader className="px-4 sm:px-6">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">Seus Arquivos</h3>
          <p className="text-xs sm:text-sm text-gray-600 mt-0.5">Toque em um arquivo para visualizar ou baixar</p>
        </CardHeader>
        <CardContent className="px-3 sm:px-6 pb-4 sm:pb-6">
          <div className="space-y-2 sm:space-y-3">
            {folders.map((folder) => {
              const FolderIcon = folder.icon
              const isExpanded = expandedFolders.has(folder.id)
              const folderSize = folder.files.reduce((acc, f) => acc + f.size, 0)
              return (
                <div key={folder.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button onClick={() => toggleFolder(folder.id)} className="w-full flex items-center justify-between p-3 sm:p-4 bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      {isExpanded ? <FolderOpen className={`h-4 w-4 sm:h-5 sm:w-5 ${folder.colorClass} flex-shrink-0`} /> : <Folder className={`h-4 w-4 sm:h-5 sm:w-5 ${folder.colorClass} flex-shrink-0`} />}
                      <div className="text-left min-w-0">
                        <h4 className="font-medium text-gray-900 text-sm truncate">{folder.name}</h4>
                        <p className="text-xs text-gray-500">{folder.files.length} arquivo{folder.files.length !== 1 ? 's' : ''} · {formatFileSize(folderSize)}</p>
                      </div>
                    </div>
                    <svg className={`h-4 w-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>

                  {isExpanded && (
                    <div className="divide-y divide-gray-200">
                      {folder.files.map((file) => (
                        <div key={file.id} className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 hover:bg-gray-50 transition-colors">
                          <div className="flex-shrink-0">{getFileIcon(file.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                          </div>
                          {/* Action buttons — icon only on mobile, icon+text on sm+ */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {(file.type === 'pdf' || file.type === 'image') && (
                              <button onClick={() => setPreviewFile(file)} className="flex items-center gap-1 px-2 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-xs">
                                <Eye className="h-4 w-4" /><span className="hidden sm:inline">Ver</span>
                              </button>
                            )}
                            <button onClick={() => downloadFile(file)} className="flex items-center gap-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                              <Download className="h-4 w-4" /><span className="hidden sm:inline">Baixar</span>
                            </button>
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

      {/* Preview Modal — fullscreen on mobile */}
      {previewFile && (
        <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-end sm:items-center justify-center" onClick={() => setPreviewFile(null)}>
          <div
            className="bg-white w-full sm:max-w-4xl sm:rounded-lg sm:mx-4 rounded-t-2xl overflow-hidden flex flex-col"
            style={{ maxHeight: '95dvh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                {getFileIcon(previewFile.type)}
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-gray-900 truncate text-sm">{previewFile.name}</h3>
                  <p className="text-xs text-gray-500">{formatFileSize(previewFile.size)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <button onClick={() => downloadFile(previewFile)} className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  <Download className="h-4 w-4" /><span className="hidden sm:inline">Baixar</span>
                </button>
                <button onClick={() => setPreviewFile(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
            </div>
            {/* Modal body */}
            <div className="overflow-auto flex-1 p-3 sm:p-4">
              {previewFile.type === 'pdf' && (
                <iframe src={URL.createObjectURL(previewFile.blob)} className="w-full border-0 rounded" style={{ minHeight: '60dvh' }} title={previewFile.name} />
              )}
              {previewFile.type === 'image' && (
                <img src={URL.createObjectURL(previewFile.blob)} alt={previewFile.name} className="w-full h-auto max-w-full rounded-lg" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Next steps */}
      <Card>
        <CardHeader className="px-4 sm:px-6"><h3 className="text-base sm:text-lg font-medium text-gray-900">Próximos Passos</h3></CardHeader>
        <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-sm text-blue-900 mb-2"><strong>✓ Documentos Salvos com Sucesso</strong></p>
            <p className="text-sm text-blue-700">Todos os seus documentos foram processados e salvos. Nossa equipe irá analisar suas informações e fotos, e em breve entraremos em contato com os resultados.</p>
            <p className="text-sm text-blue-700 mt-2"><strong>Prazo de análise:</strong> Até 5 dias úteis</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}