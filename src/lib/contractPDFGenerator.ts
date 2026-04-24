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
  country?: string
  ip?: string
  signedAt?: string
  /** Data URL (PNG) gerada pelo SignatureCanvas */
  signatureDataUrl?: string
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
  yPosition += 10

  // ── Bloco de metadados de assinatura (IP / Data / Hora) ─────────────────
  const signTimestamp = clientInfo.signedAt || timestamp || new Date().toISOString()
  const signDate = new Date(signTimestamp)
  const signDateStr = signDate.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })
  const signTimeStr = signDate.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })

  pdf.setFontSize(8.5)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(70, 70, 70)

  const metaLines: string[] = [
    `IP do signatário: ${clientInfo.ip || 'Não registrado'}`,
    `Data de assinatura: ${signDateStr}   Horário: ${signTimeStr}`,
    `País: ${clientInfo.country || 'Brasil'}`,
  ]

  const metaLineH = 5
  const metaPadV = 5
  const metaBoxH = metaPadV * 2 + metaLines.length * metaLineH + 2

  checkNewPage(metaBoxH + 5)

  pdf.setDrawColor(180, 180, 180)
  pdf.setFillColor(245, 245, 245)
  pdf.roundedRect(margin, yPosition, maxWidth, metaBoxH, 2, 2, 'FD')

  let metaY = yPosition + metaPadV + 3
  metaLines.forEach(line => {
    pdf.text(line, margin + 6, metaY)
    metaY += metaLineH
  })

  yPosition += metaBoxH + 10

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

  pdf.setFont('helvetica', 'bold')
  pdf.text('Nome Completo:', margin, yPosition)
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientInfo.fullName, margin + 38, yPosition)
  yPosition += 7

  pdf.setFont('helvetica', 'bold')
  pdf.text('E-mail:', margin, yPosition)
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientInfo.email, margin + 38, yPosition)
  yPosition += 7

  pdf.setFont('helvetica', 'bold')
  pdf.text('Telefone:', margin, yPosition)
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientInfo.phone, margin + 38, yPosition)
  yPosition += 7

  if (clientInfo.country) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('País:', margin, yPosition)
    pdf.setFont('helvetica', 'normal')
    pdf.text(clientInfo.country, margin + 38, yPosition)
    yPosition += 7
  }

  yPosition += 5
  addLine()
  yPosition += 10

  // ============ CLÁUSULAS DO CONTRATO ============

  const sortedSections = [...sections].sort((a, b) => a.order - b.order)

  for (const section of sortedSections) {
    checkNewPage(30)

    pdf.setFontSize(11)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(0, 0, 0)
    pdf.text(section.title, margin, yPosition)
    yPosition += 8

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

  checkNewPage(60)
  yPosition += 10
  addLine()
  yPosition += 10

  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0, 0, 0)
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
  pdf.text(`Data e hora de aceite: ${signDateStr} às ${signTimeStr}`, margin, yPosition)
  yPosition += 7

  pdf.text(`E-mail: ${clientInfo.email}`, margin, yPosition)
  yPosition += 7

  pdf.text(`Telefone: ${clientInfo.phone}`, margin, yPosition)
  yPosition += 7

  if (clientInfo.country) {
    pdf.text(`País: ${clientInfo.country}`, margin, yPosition)
    yPosition += 7
  }

  if (clientInfo.ip) {
    pdf.text(`Endereço IP: ${clientInfo.ip}`, margin, yPosition)
    yPosition += 7
  }

  yPosition += 6

  // ── Desenho da assinatura manuscrita ────────────────────────────────────────
  if (clientInfo.signatureDataUrl) {
    // Dimensões da caixa de assinatura no PDF
    const sigBoxWidth = 120
    const sigBoxHeight = 45
    const sigPad = 3

    checkNewPage(sigBoxHeight + 20)

    // Rótulo
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(80, 80, 80)
    pdf.text('Assinatura manuscrita digital:', margin, yPosition)
    yPosition += 5

    // Caixa com borda
    pdf.setDrawColor(160, 160, 160)
    pdf.setFillColor(255, 255, 255)
    pdf.roundedRect(margin, yPosition, sigBoxWidth, sigBoxHeight, 2, 2, 'FD')

    // Linha de base dentro da caixa
    pdf.setDrawColor(210, 210, 210)
    pdf.line(
      margin + sigPad,
      yPosition + sigBoxHeight - 10,
      margin + sigBoxWidth - sigPad,
      yPosition + sigBoxHeight - 10
    )

    // Inserir imagem da assinatura centralizada na caixa
    try {
      pdf.addImage(
        clientInfo.signatureDataUrl,
        'PNG',
        margin + sigPad,
        yPosition + sigPad,
        sigBoxWidth - sigPad * 2,
        sigBoxHeight - sigPad * 2 - 8 // deixar espaço acima da linha de base
      )
    } catch (imgErr) {
      // Se falhar (e.g. canvas vazio), apenas mostrar a caixa vazia
      console.warn('Não foi possível inserir a imagem da assinatura:', imgErr)
    }

    yPosition += sigBoxHeight + 8
  } else {
    // Sem desenho: linha de assinatura clássica
    checkNewPage(25)
    pdf.setDrawColor(0, 0, 0)
    pdf.line(margin, yPosition + 12, margin + 100, yPosition + 12)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(100, 100, 100)
    pdf.text('Assinatura', margin, yPosition + 18)
    yPosition += 28
  }

  // ── Caixa de confirmação legal ───────────────────────────────────────────────
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'italic')
  pdf.setTextColor(80, 80, 80)
  const confirmationText =
    'O contratante declara ter lido, compreendido e aceito todos os termos e condicoes deste contrato.'
  const confirmationLines = pdf.splitTextToSize(confirmationText, maxWidth - 16)
  const lineHeight = 5
  const boxPaddingV = 8
  const boxHeight = boxPaddingV * 2 + confirmationLines.length * lineHeight

  checkNewPage(boxHeight + 5)

  pdf.setDrawColor(100, 100, 100)
  pdf.setFillColor(240, 240, 240)
  pdf.roundedRect(margin, yPosition, maxWidth, boxHeight, 3, 3, 'FD')

  let confirmYPos = yPosition + boxPaddingV + 2
  confirmationLines.forEach((line: string) => {
    pdf.text(line, margin + 8, confirmYPos)
    confirmYPos += lineHeight
  })
  yPosition += boxHeight

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
    pdf.text(clientInfo.fullName, margin, pageHeight - 10)

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