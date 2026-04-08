import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

export interface DocumentFolder {
  id: string
  clientName: string
  createdAt: string
  expiresAt: string
  accessToken: string
  accessPassword: string
}

export interface UploadProgress {
  step: string
  progress: number
  message: string
  status: 'pending' | 'uploading' | 'completed' | 'error'
}

class DocumentStorageService {
  // Gerar PDF do contrato
  async generateContractPDF(contractData: any, clientName: string): Promise<Blob> {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 20
    const maxWidth = pageWidth - 2 * margin
    let yPosition = 20

    // Título
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    const titleLines = doc.splitTextToSize(contractData.title || 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS', maxWidth)
    titleLines.forEach((line: string) => {
      doc.text(line, pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 8
    })

    yPosition += 10

    // Informações do cliente
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Cliente: ${clientName}`, margin, yPosition)
    yPosition += 6
    doc.text(`Data: ${new Date(contractData.timestamp).toLocaleDateString('pt-BR')}`, margin, yPosition)
    yPosition += 10

    // Seções do contrato
    if (contractData.sections && Array.isArray(contractData.sections)) {
      contractData.sections.forEach((section: any) => {
        // Verificar se precisa de nova página
        if (yPosition > 250) {
          doc.addPage()
          yPosition = 20
        }

        // Título da seção
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        const sectionTitleLines = doc.splitTextToSize(section.title, maxWidth)
        sectionTitleLines.forEach((line: string) => {
          doc.text(line, margin, yPosition)
          yPosition += 6
        })
        yPosition += 3

        // Conteúdo da seção
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        const contentLines = doc.splitTextToSize(section.content, maxWidth)
        contentLines.forEach((line: string) => {
          if (yPosition > 270) {
            doc.addPage()
            yPosition = 20
          }
          doc.text(line, margin, yPosition)
          yPosition += 5
        })
        yPosition += 8
      })
    }

    // Assinatura digital
    if (yPosition > 240) {
      doc.addPage()
      yPosition = 20
    }

    yPosition += 20
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.text('Aceito e concordo com os termos acima.', margin, yPosition)
    yPosition += 8
    doc.text(`Assinatura Digital: ${clientName}`, margin, yPosition)
    yPosition += 6
    doc.text(`Data e Hora: ${new Date(contractData.timestamp).toLocaleString('pt-BR')}`, margin, yPosition)

    return doc.output('blob')
  }

  // Gerar PDF do formulário
  async generateFormPDF(formData: any, clientName: string): Promise<Blob> {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 20
    const maxWidth = pageWidth - 2 * margin
    let yPosition = 20

    // Título
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('FORMULÁRIO DE ANÁLISE DE COLORAÇÃO PESSOAL', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 15

    // Informações do cliente
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Cliente: ${clientName}`, margin, yPosition)
    yPosition += 6
    doc.text(`Data de Preenchimento: ${new Date().toLocaleDateString('pt-BR')}`, margin, yPosition)
    yPosition += 15

    // Campos do formulário
    if (formData.formData) {
      Object.entries(formData.formData).forEach(([fieldId, value]: [string, any]) => {
        // Verificar se precisa de nova página
        if (yPosition > 250) {
          doc.addPage()
          yPosition = 20
        }

        // Label do campo
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        const label = this.getFieldLabel(fieldId)
        doc.text(`${label}:`, margin, yPosition)
        yPosition += 6

        // Valor do campo
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        let valueText = ''
        
        if (Array.isArray(value)) {
          valueText = value.join(', ')
        } else if (typeof value === 'object') {
          valueText = JSON.stringify(value)
        } else {
          valueText = String(value)
        }

        const valueLines = doc.splitTextToSize(valueText, maxWidth)
        valueLines.forEach((line: string) => {
          if (yPosition > 270) {
            doc.addPage()
            yPosition = 20
          }
          doc.text(line, margin + 5, yPosition)
          yPosition += 5
        })
        yPosition += 8
      })
    }

    return doc.output('blob')
  }

  // Helper para obter labels legíveis dos campos
  private getFieldLabel(fieldId: string): string {
    const labels: Record<string, string> = {
      '1': 'Nome Completo',
      '2': 'Idade',
      '3': 'Objetivo com a Análise',
      '4': 'Já fez análise antes?',
      '5': 'Observações',
    }
    return labels[fieldId] || `Campo ${fieldId}`
  }

  // Criar pasta de documentos e gerar ZIP para download
  async createDocumentPackage(
    clientName: string,
    contractData: any,
    formData: any,
    formAttachments: File[],
    photos: File[],
    onProgress?: (progress: UploadProgress) => void
  ): Promise<Blob> {
    const zip = new JSZip()
    
    // Criar pasta principal com nome do cliente
    const sanitizedName = clientName.replace(/[^a-zA-Z0-9]/g, '_')
    const clientFolder = zip.folder(sanitizedName)!

    try {
      // 1. Gerar e adicionar PDF do contrato
      onProgress?.({
        step: 'contract',
        progress: 10,
        message: 'Gerando PDF do contrato...',
        status: 'uploading'
      })

      const contractPDF = await this.generateContractPDF(contractData, clientName)
      clientFolder.file('1_Contrato.pdf', contractPDF)

      onProgress?.({
        step: 'contract',
        progress: 100,
        message: 'Contrato gerado com sucesso',
        status: 'completed'
      })

      // 2. Gerar e adicionar PDF do formulário
      onProgress?.({
        step: 'form',
        progress: 10,
        message: 'Gerando PDF do formulário...',
        status: 'uploading'
      })

      const formPDF = await this.generateFormPDF(formData, clientName)
      clientFolder.file('2_Formulario.pdf', formPDF)

      // Adicionar anexos do formulário (se houver)
      if (formAttachments && formAttachments.length > 0) {
        const attachmentsFolder = clientFolder.folder('Anexos_Formulario')!
        formAttachments.forEach((file, index) => {
          attachmentsFolder.file(`anexo_${index + 1}_${file.name}`, file)
        })
      }

      onProgress?.({
        step: 'form',
        progress: 100,
        message: 'Formulário gerado com sucesso',
        status: 'completed'
      })

      // 3. Adicionar fotos
      onProgress?.({
        step: 'photos',
        progress: 10,
        message: 'Adicionando fotos...',
        status: 'uploading'
      })

      if (photos && photos.length > 0) {
        const photosFolder = clientFolder.folder('Fotos_Analise')!
        
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i]
          photosFolder.file(`foto_${i + 1}_${photo.name}`, photo)
          
          const progress = Math.round(((i + 1) / photos.length) * 100)
          onProgress?.({
            step: 'photos',
            progress,
            message: `Adicionando foto ${i + 1} de ${photos.length}...`,
            status: 'uploading'
          })
        }
      }

      onProgress?.({
        step: 'photos',
        progress: 100,
        message: `${photos.length} fotos adicionadas com sucesso`,
        status: 'completed'
      })

      // Gerar o arquivo ZIP
      onProgress?.({
        step: 'complete',
        progress: 50,
        message: 'Preparando arquivo para download...',
        status: 'uploading'
      })

      const zipBlob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      })

      onProgress?.({
        step: 'complete',
        progress: 100,
        message: 'Pacote de documentos pronto!',
        status: 'completed'
      })

      return zipBlob

    } catch (error) {
      console.error('Erro ao criar pacote de documentos:', error)
      throw error
    }
  }

  // Fazer download do ZIP
  async downloadDocumentPackage(zipBlob: Blob, clientName: string) {
    const sanitizedName = clientName.replace(/[^a-zA-Z0-9]/g, '_')
    const fileName = `${sanitizedName}_Documentos_${new Date().toISOString().split('T')[0]}.zip`
    saveAs(zipBlob, fileName)
  }

  // Gerar informações de acesso (para compartilhamento futuro)
  generateAccessInfo(clientName: string): DocumentFolder {
    const id = this.generateId()
    const accessToken = this.generateAccessToken()
    const accessPassword = this.generatePassword()
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 dias

    return {
      id,
      clientName,
      createdAt,
      expiresAt,
      accessToken,
      accessPassword
    }
  }

  private generateId(): string {
    return `DOC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateAccessToken(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }

  private generatePassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let password = ''
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return password
  }
}

export const documentStorage = new DocumentStorageService()