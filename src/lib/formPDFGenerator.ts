import jsPDF from 'jspdf'

interface FormField {
  id: string
  label: string
  type: string
  value?: any
}

interface FormSection {
  id: string
  title: string
  fields: FormField[]
}

interface FormConfig {
  sections: FormSection[]
}

/**
 * Gera PDF profissional do formulário com TODAS as perguntas e respostas
 * Suporta imagens em miniatura como resposta
 */
export const generateFormPDF = async (
  clientName: string,
  clientEmail: string,
  clientPhone: string,
  formData: any,
  formConfig: FormConfig | null,
  completedDate: string,
  formAttachments: File[] = []
): Promise<Blob> => {
  const pdf = new jsPDF()
  let yPosition = 20
  const pageHeight = pdf.internal.pageSize.height
  const pageWidth = pdf.internal.pageSize.width
  const margin = 20
  const maxWidth = pageWidth - 2 * margin

  // Função auxiliar para adicionar nova página se necessário
  const checkNewPage = (requiredSpace: number = 20) => {
    if (yPosition + requiredSpace > pageHeight - margin) {
      pdf.addPage()
      yPosition = margin
      return true
    }
    return false
  }

  // Função para adicionar linha horizontal
  const addLine = () => {
    pdf.setDrawColor(200, 200, 200)
    pdf.line(margin, yPosition, pageWidth - margin, yPosition)
    yPosition += 5
  }

  // Função para converter File/Blob para base64
  const fileToBase64 = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // Função para adicionar imagem ao PDF
  const addImageToPDF = async (imageData: string, maxImageWidth: number = 80, maxImageHeight: number = 80) => {
    try {
      // Verificar se há espaço suficiente, senão adicionar nova página
      checkNewPage(maxImageHeight + 10)
      
      const imgProps = pdf.getImageProperties(imageData)
      const imgRatio = imgProps.width / imgProps.height
      
      let finalWidth = maxImageWidth
      let finalHeight = maxImageHeight
      
      // Ajustar dimensões mantendo proporção
      if (imgRatio > 1) {
        // Imagem mais larga
        finalHeight = maxImageWidth / imgRatio
      } else {
        // Imagem mais alta
        finalWidth = maxImageHeight * imgRatio
      }
      
      pdf.addImage(imageData, 'JPEG', margin + 5, yPosition, finalWidth, finalHeight)
      yPosition += finalHeight + 5
    } catch (error) {
      console.error('Erro ao adicionar imagem:', error)
      // Se falhar, mostrar texto alternativo
      pdf.setFont('helvetica', 'italic')
      pdf.setTextColor(150, 150, 150)
      pdf.text('[Erro ao carregar imagem]', margin + 5, yPosition)
      yPosition += 8
    }
  }

  // ============ CABEÇALHO ============
  
  // Data no canto superior direito
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(100, 100, 100)
  const dateText = new Date(completedDate).toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  const dateWidth = pdf.getTextWidth(dateText)
  pdf.text(dateText, pageWidth - margin - dateWidth, yPosition)
  yPosition += 10

  // Título do documento
  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0, 0, 0)
  pdf.text('Coloração Pessoal Online', margin, yPosition)
  yPosition += 10

  // Subtítulo
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Formulário Completo', margin, yPosition)
  yPosition += 15

  // ============ DADOS DO CLIENTE ============
  
  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0, 0, 0)
  
  // Nome
  pdf.text('Nome', margin, yPosition)
  yPosition += 6
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientName, margin, yPosition)
  yPosition += 10

  // E-mail
  pdf.setFont('helvetica', 'bold')
  pdf.text('E-mail', margin, yPosition)
  yPosition += 6
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientEmail, margin, yPosition)
  yPosition += 10

  // Telefone
  pdf.setFont('helvetica', 'bold')
  pdf.text('Telefone', margin, yPosition)
  yPosition += 6
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientPhone, margin, yPosition)
  yPosition += 15

  addLine()
  yPosition += 5

  // ============ PERGUNTAS E RESPOSTAS ============
  
  if (formConfig && formConfig.sections) {
    // Usar estrutura do formulário configurado
    for (let sectionIndex = 0; sectionIndex < formConfig.sections.length; sectionIndex++) {
      const section = formConfig.sections[sectionIndex]
      
      // Título da seção (se houver mais de uma seção)
      if (formConfig.sections.length > 1) {
        checkNewPage(15)
        pdf.setFontSize(13)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(50, 50, 150)
        pdf.text(section.title, margin, yPosition)
        yPosition += 10
      }
      
      for (let fieldIndex = 0; fieldIndex < section.fields.length; fieldIndex++) {
        const field = section.fields[fieldIndex]
        checkNewPage(35)
        
        // ============ PERGUNTA ============
        pdf.setFontSize(11)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(0, 0, 0)
        
        const questionText = `${sectionIndex + 1}.${fieldIndex + 1} ${field.label}`
        const questionLines = pdf.splitTextToSize(questionText, maxWidth)
        
        questionLines.forEach((line: string) => {
          checkNewPage()
          pdf.text(line, margin, yPosition)
          yPosition += 6
        })
        
        yPosition += 3

        // ============ RESPOSTA ============
        const value = formData[field.id]
        
        pdf.setFont('helvetica', 'normal')
        pdf.setTextColor(60, 60, 60)
        
        // Verificar tipo de resposta
        if (value === undefined || value === null || value === '') {
          // Sem resposta
          pdf.setFont('helvetica', 'italic')
          pdf.setTextColor(150, 150, 150)
          pdf.text('(Não respondido)', margin + 5, yPosition)
          yPosition += 8
          
        } else if (field.type === 'file' || field.type === 'image') {
          // RESPOSTA COM IMAGEM(NS)
          
          // Procurar imagens nos anexos que correspondem a este campo
          const fieldImages = formAttachments.filter(file => {
            // Verificar se o arquivo pertence a este campo
            // Pode ser por nome ou por algum identificador
            return file.name.includes(field.id) || 
                   (file.type && file.type.startsWith('image/'))
          })
          
          if (fieldImages.length > 0) {
            pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(60, 60, 60)
            pdf.text(`${fieldImages.length} imagem${fieldImages.length > 1 ? 'ns' : ''} enviada${fieldImages.length > 1 ? 's' : ''}:`, margin + 5, yPosition)
            yPosition += 10
            
            // Adicionar miniaturas das imagens em grid
            const thumbnailSize = 70
            const spacing = 5
            const imagesPerRow = Math.floor(maxWidth / (thumbnailSize + spacing))
            let xPosition = margin + 5
            let rowHeight = 0
            
            for (let i = 0; i < fieldImages.length; i++) {
              try {
                const imageBase64 = await fileToBase64(fieldImages[i])
                
                // Verificar se precisa quebrar linha
                if (i > 0 && i % imagesPerRow === 0) {
                  yPosition += rowHeight + spacing
                  xPosition = margin + 5
                  rowHeight = 0
                  checkNewPage(thumbnailSize + 10)
                }
                
                // Adicionar imagem em miniatura
                const imgProps = pdf.getImageProperties(imageBase64)
                const imgRatio = imgProps.width / imgProps.height
                
                let finalWidth = thumbnailSize
                let finalHeight = thumbnailSize
                
                if (imgRatio > 1) {
                  finalHeight = thumbnailSize / imgRatio
                } else {
                  finalWidth = thumbnailSize * imgRatio
                }
                
                pdf.addImage(imageBase64, 'JPEG', xPosition, yPosition, finalWidth, finalHeight)
                
                // Nome da imagem abaixo da miniatura
                pdf.setFontSize(8)
                pdf.setTextColor(100, 100, 100)
                const imageName = fieldImages[i].name.length > 15 
                  ? fieldImages[i].name.substring(0, 12) + '...' 
                  : fieldImages[i].name
                pdf.text(imageName, xPosition, yPosition + finalHeight + 3)
                
                xPosition += thumbnailSize + spacing
                rowHeight = Math.max(rowHeight, finalHeight + 8)
                
              } catch (error) {
                console.error('Erro ao processar imagem:', error)
              }
            }
            
            yPosition += rowHeight + 5
            
          } else {
            pdf.setFont('helvetica', 'italic')
            pdf.setTextColor(150, 150, 150)
            pdf.text('(Nenhuma imagem enviada)', margin + 5, yPosition)
            yPosition += 8
          }
          
        } else if (typeof value === 'boolean') {
          // Resposta Sim/Não
          pdf.text(value ? '✓ Sim' : '✗ Não', margin + 5, yPosition)
          yPosition += 8
          
        } else if (Array.isArray(value)) {
          // Resposta múltipla (array)
          if (value.length === 0) {
            pdf.setFont('helvetica', 'italic')
            pdf.setTextColor(150, 150, 150)
            pdf.text('(Nenhuma opção selecionada)', margin + 5, yPosition)
            yPosition += 8
          } else {
            value.forEach((item, index) => {
              checkNewPage()
              pdf.text(`• ${item}`, margin + 5, yPosition)
              yPosition += 6
            })
            yPosition += 2
          }
          
        } else if (typeof value === 'object' && value !== null) {
          // Objeto complexo
          pdf.text(JSON.stringify(value, null, 2), margin + 5, yPosition)
          yPosition += 8
          
        } else {
          // Resposta de texto simples
          const responseText = String(value)
          const responseLines = pdf.splitTextToSize(responseText, maxWidth - 10)
          
          responseLines.forEach((line: string) => {
            checkNewPage()
            pdf.text(line, margin + 5, yPosition)
            yPosition += 6
          })
          yPosition += 2
        }

        yPosition += 6
        
        // Linha separadora sutil entre perguntas
        if (fieldIndex < section.fields.length - 1) {
          pdf.setDrawColor(230, 230, 230)
          pdf.line(margin + 5, yPosition, pageWidth - margin - 5, yPosition)
          yPosition += 8
        }
      }
      
      // Espaço maior entre seções
      if (sectionIndex < formConfig.sections.length - 1) {
        yPosition += 10
      }
    }
  } else {
    // FALLBACK: Mostrar todas as respostas do formData sem estrutura
    let questionNumber = 1
    
    const entries = Object.entries(formData)
    
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i]
      checkNewPage(30)
      
      // Pergunta
      pdf.setFontSize(11)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(0, 0, 0)
      pdf.text(`${questionNumber}. ${key}`, margin, yPosition)
      yPosition += 7

      // Resposta
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(60, 60, 60)
      
      if (value === undefined || value === null || value === '') {
        pdf.setFont('helvetica', 'italic')
        pdf.setTextColor(150, 150, 150)
        pdf.text('(Não respondido)', margin + 5, yPosition)
        yPosition += 8
      } else if (typeof value === 'boolean') {
        pdf.text(value ? '✓ Sim' : '✗ Não', margin + 5, yPosition)
        yPosition += 8
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          checkNewPage()
          pdf.text(`• ${item}`, margin + 5, yPosition)
          yPosition += 6
        })
        yPosition += 2
      } else {
        const responseText = String(value)
        const responseLines = pdf.splitTextToSize(responseText, maxWidth - 10)
        responseLines.forEach((line: string) => {
          checkNewPage()
          pdf.text(line, margin + 5, yPosition)
          yPosition += 6
        })
        yPosition += 2
      }

      yPosition += 8
      questionNumber++
    }
  }

  // ============ RODAPÉ ============
  
  const totalPages = (pdf as any).internal.pages.length - 1
  
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(150, 150, 150)
    
    const pageText = `Página ${i} de ${totalPages}`
    const pageTextWidth = pdf.getTextWidth(pageText)
    pdf.text(pageText, pageWidth - margin - pageTextWidth, pageHeight - 10)
    
    // Nome do cliente no rodapé
    pdf.text(clientName, margin, pageHeight - 10)
  }

  return pdf.output('blob')
}

/**
 * Gera e baixa PDF do formulário
 */
export const downloadFormPDF = async (
  clientName: string,
  clientEmail: string,
  clientPhone: string,
  formData: any,
  formConfig: FormConfig | null,
  completedDate: string,
  formAttachments: File[] = []
) => {
  const blob = await generateFormPDF(
    clientName,
    clientEmail,
    clientPhone,
    formData,
    formConfig,
    completedDate,
    formAttachments
  )

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${clientName.replace(/\s+/g, '_')}_Formulario_Completo.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}