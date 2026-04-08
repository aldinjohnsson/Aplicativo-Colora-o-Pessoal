import jsPDF from 'jspdf'

interface ContractSection {
  id: string
  title: string
  content: string
  order: number
}

interface ClientInfo {
  fullName: string
  email: string
  phone: string
}

/**
 * Gera PDF profissional do contrato assinado
 */
export const generateContractPDF = async (
  title: string,
  sections: ContractSection[],
  clientInfo: ClientInfo,
  timestamp?: string
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

  // ============ CABEÇALHO ============
  
  // Data no canto superior direito
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(100, 100, 100)
  const dateText = timestamp 
    ? new Date(timestamp).toLocaleDateString('pt-BR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
  const dateWidth = pdf.getTextWidth(dateText)
  pdf.text(dateText, pageWidth - margin - dateWidth, yPosition)
  yPosition += 15

  // Título do documento
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0, 0, 0)
  const titleLines = pdf.splitTextToSize(title, maxWidth)
  titleLines.forEach((line: string) => {
    checkNewPage()
    pdf.text(line, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 8
  })
  yPosition += 10

  addLine()
  yPosition += 5

  // ============ DADOS DO CLIENTE ============
  
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'bold')
  pdf.text('CONTRATANTE', margin, yPosition)
  yPosition += 8

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  
  // Nome
  pdf.setFont('helvetica', 'bold')
  pdf.text('Nome Completo:', margin, yPosition)
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientInfo.fullName, margin + 35, yPosition)
  yPosition += 7

  // E-mail
  pdf.setFont('helvetica', 'bold')
  pdf.text('E-mail:', margin, yPosition)
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientInfo.email, margin + 35, yPosition)
  yPosition += 7

  // Telefone
  pdf.setFont('helvetica', 'bold')
  pdf.text('Telefone:', margin, yPosition)
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientInfo.phone, margin + 35, yPosition)
  yPosition += 12

  addLine()
  yPosition += 10

  // ============ CLÁUSULAS DO CONTRATO ============
  
  const sortedSections = [...sections].sort((a, b) => a.order - b.order)

  for (const section of sortedSections) {
    checkNewPage(30)

    // Título da seção
    pdf.setFontSize(11)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(0, 0, 0)
    pdf.text(section.title, margin, yPosition)
    yPosition += 8

    // Conteúdo da seção
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(60, 60, 60)
    
    const contentLines = pdf.splitTextToSize(section.content, maxWidth)
    contentLines.forEach((line: string) => {
      checkNewPage()
      pdf.text(line, margin, yPosition)
      yPosition += 6
    })
    
    yPosition += 10
  }

  // ============ ASSINATURA DIGITAL ============
  
  checkNewPage(40)
  yPosition += 10
  addLine()
  yPosition += 10

  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'bold')
  pdf.text('ASSINATURA DIGITAL', margin, yPosition)
  yPosition += 10

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(60, 60, 60)
  
  pdf.text('Este contrato foi aceito digitalmente por:', margin, yPosition)
  yPosition += 7
  
  pdf.setFont('helvetica', 'bold')
  pdf.text(clientInfo.fullName, margin, yPosition)
  yPosition += 7
  
  pdf.setFont('helvetica', 'normal')
  if (timestamp) {
    const acceptDate = new Date(timestamp)
    pdf.text(`Data e hora de aceite: ${acceptDate.toLocaleString('pt-BR')}`, margin, yPosition)
    yPosition += 7
  }
  
  pdf.text(`E-mail: ${clientInfo.email}`, margin, yPosition)
  yPosition += 7
  
  pdf.text(`Telefone: ${clientInfo.phone}`, margin, yPosition)
  yPosition += 15

  // Caixa de confirmação
  pdf.setDrawColor(100, 100, 100)
  pdf.setFillColor(240, 240, 240)
  pdf.roundedRect(margin, yPosition, maxWidth, 20, 3, 3, 'FD')
  
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'italic')
  pdf.setTextColor(80, 80, 80)
  const confirmationText = '✓ O contratante declara ter lido, compreendido e aceito todos os termos e condições deste contrato.'
  const confirmationLines = pdf.splitTextToSize(confirmationText, maxWidth - 10)
  let confirmYPos = yPosition + 6
  confirmationLines.forEach((line: string) => {
    pdf.text(line, margin + 5, confirmYPos)
    confirmYPos += 4
  })

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
    pdf.text(clientInfo.fullName, margin, pageHeight - 10)
    
    // Linha no topo do rodapé
    pdf.setDrawColor(220, 220, 220)
    pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)
  }

  return pdf.output('blob')
}

/**
 * Gera e baixa PDF do contrato
 */
export const downloadContractPDF = async (
  title: string,
  sections: ContractSection[],
  clientInfo: ClientInfo,
  timestamp?: string
) => {
  const blob = await generateContractPDF(title, sections, clientInfo, timestamp)

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${clientInfo.fullName.replace(/\s+/g, '_')}_Contrato.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}