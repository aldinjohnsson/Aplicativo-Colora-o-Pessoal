import jsPDF from 'jspdf'
import { translations, Language } from './i18n/translations'

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
 * Gera PDF profissional do contrato assinado.
 *
 * Garantias desta versão:
 * - Bloco de assinatura (manuscrita + dados legais) nunca quebra de página.
 * - Data, hora e minutos/segundos exatos da assinatura em todos os blocos.
 * - IP do signatário exibido no cabeçalho de metadados e no bloco de assinatura.
 * - Suporte a múltiplos idiomas: rótulos, texto de confirmação e formatação de
 *   data/hora seguem o idioma passado em `language` (o mesmo que o cliente
 *   escolheu no portal — normalmente vindo de `portalData.client.language`).
 *   `sections` (as cláusulas do contrato) continuam vindo como texto livre —
 *   o conteúdo jurídico em si deve ser cadastrado por idioma no ContractEditor,
 *   este gerador só traduz os rótulos fixos ao redor.
 */
export const generateContractPDF = async (
  title: string,
  sections: ContractSection[],
  clientInfo: ClientInfo,
  timestamp?: string,
  language: Language = 'pt-BR'
): Promise<Blob> => {
  const L = translations[language]?.contractPdf ?? translations['pt-BR'].contractPdf

  const pdf = new jsPDF()
  let yPosition = 20
  const pageHeight = pdf.internal.pageSize.height
  const pageWidth  = pdf.internal.pageSize.width
  const margin   = 20
  const maxWidth = pageWidth - 2 * margin

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Força nova página se o espaço restante for menor que `needed`. */
  const checkNewPage = (needed: number = 20) => {
    if (yPosition + needed > pageHeight - margin) {
      pdf.addPage()
      yPosition = margin
      return true
    }
    return false
  }

  const addLine = () => {
    pdf.setDrawColor(200, 200, 200)
    pdf.line(margin, yPosition, pageWidth - margin, yPosition)
    yPosition += 5
  }

  // ── Timestamp da assinatura ───────────────────────────────────────────────

  const signTimestamp = clientInfo.signedAt || timestamp || new Date().toISOString()
  const signDate      = new Date(signTimestamp)

  const signDateStr = signDate.toLocaleDateString(L.dateLocale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
  const signTimeStr = signDate.toLocaleTimeString(L.dateLocale, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const signDatetimeStr = `${signDateStr} ${language === 'pt-BR' ? 'às' : 'at'} ${signTimeStr}`

  // ── CABEÇALHO ─────────────────────────────────────────────────────────────

  // Data por extenso no canto superior direito
  const dateTextLong = signDate.toLocaleDateString(L.dateLocale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(100, 100, 100)
  const dateWidth = pdf.getTextWidth(dateTextLong)
  pdf.text(dateTextLong, pageWidth - margin - dateWidth, yPosition)
  yPosition += 10

  // ── Bloco de metadados (IP / Data / Hora / País) ──────────────────────────
  const metaLines: string[] = [
    `${L.signatoryIp} : ${clientInfo.ip || L.notRegistered}`,
    `${L.signDate}: ${signDateStr}   ${L.signTime}: ${signTimeStr}`,
    `${L.country}              : ${clientInfo.country || L.defaultCountry}`,
  ]
  const metaLineH  = 5
  const metaPadV   = 5
  const metaBoxH   = metaPadV * 2 + metaLines.length * metaLineH + 2

  checkNewPage(metaBoxH + 5)
  pdf.setDrawColor(180, 180, 180)
  pdf.setFillColor(245, 245, 245)
  pdf.roundedRect(margin, yPosition, maxWidth, metaBoxH, 2, 2, 'FD')

  pdf.setFontSize(8.5)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(70, 70, 70)
  let metaY = yPosition + metaPadV + 3
  metaLines.forEach(line => { pdf.text(line, margin + 6, metaY); metaY += metaLineH })

  yPosition += metaBoxH + 10

  // ── Título do documento ───────────────────────────────────────────────────
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

  // ── DADOS DO CLIENTE ──────────────────────────────────────────────────────
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'bold')
  pdf.text(L.contractorSection, margin, yPosition)
  yPosition += 8

  pdf.setFontSize(10)
  const row = (label: string, value: string) => {
    pdf.setFont('helvetica', 'bold')
    pdf.text(`${label}:`, margin, yPosition)
    pdf.setFont('helvetica', 'normal')
    pdf.text(value, margin + 38, yPosition)
    yPosition += 7
  }

  row(L.fullName, clientInfo.fullName)
  row(L.email, clientInfo.email)
  row(L.phone, clientInfo.phone || '—')
  if (clientInfo.country) row(L.country, clientInfo.country)

  yPosition += 5
  addLine()
  yPosition += 10

  // ── CLÁUSULAS ─────────────────────────────────────────────────────────────
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

  // ── BLOCO DE ASSINATURA DIGITAL ───────────────────────────────────────────
  //
  // Calculamos o espaço total necessário para o bloco inteiro ANTES de começar
  // a desenhá-lo. Se não couber na página atual, forçamos nova página,
  // garantindo que assinatura + dados legais fiquem sempre juntos.
  //
  const sigBoxHeight       = 48   // caixa da assinatura manuscrita
  const infoLinesCount     = clientInfo.country && clientInfo.ip ? 7
                           : clientInfo.country || clientInfo.ip ? 6
                           : 5
  const infoBlockH         = infoLinesCount * 7      // linhas de dados
  const confirmBoxH        = 30                       // caixa de confirmação legal
  const sigSectionTotal    = 15                       // título "ASSINATURA DIGITAL"
                           + infoBlockH
                           + (clientInfo.signatureDataUrl ? sigBoxHeight + 16 : 30)
                           + confirmBoxH
                           + 40                       // margens internas

  // Força nova página se o bloco inteiro não couber
  if (yPosition + sigSectionTotal > pageHeight - margin) {
    pdf.addPage()
    yPosition = margin
  }

  yPosition += 10
  addLine()
  yPosition += 10

  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0, 0, 0)
  pdf.text(L.digitalSignatureSection, margin, yPosition)
  yPosition += 10

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(60, 60, 60)

  pdf.text(L.acceptedDigitallyBy, margin, yPosition)
  yPosition += 7

  pdf.setFont('helvetica', 'bold')
  pdf.text(clientInfo.fullName, margin, yPosition)
  yPosition += 7

  pdf.setFont('helvetica', 'normal')
  pdf.text(`${L.acceptedAt}: ${signDatetimeStr}`, margin, yPosition)
  yPosition += 7

  pdf.text(`${L.email}: ${clientInfo.email}`, margin, yPosition)
  yPosition += 7

  pdf.text(`${L.phoneLabel}: ${clientInfo.phone || '—'}`, margin, yPosition)
  yPosition += 7

  if (clientInfo.country) {
    pdf.text(`${L.countryLabel}: ${clientInfo.country}`, margin, yPosition)
    yPosition += 7
  }

  if (clientInfo.ip) {
    pdf.text(`${L.ipLabel}: ${clientInfo.ip}`, margin, yPosition)
    yPosition += 7
  }

  yPosition += 6

  // ── Assinatura manuscrita ─────────────────────────────────────────────────
  if (clientInfo.signatureDataUrl) {
    const sigPad      = 3
    const sigBoxWidth = 120

    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(80, 80, 80)
    pdf.text(L.handwrittenSignature, margin, yPosition)
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

    // Imagem da assinatura
    try {
      pdf.addImage(
        clientInfo.signatureDataUrl,
        'PNG',
        margin + sigPad,
        yPosition + sigPad,
        sigBoxWidth - sigPad * 2,
        sigBoxHeight - sigPad * 2 - 8
      )
    } catch (imgErr) {
      console.warn('Não foi possível inserir a imagem da assinatura:', imgErr)
    }

    yPosition += sigBoxHeight + 8
  } else {
    // Fallback: linha clássica
    pdf.setDrawColor(0, 0, 0)
    pdf.line(margin, yPosition + 12, margin + 100, yPosition + 12)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(100, 100, 100)
    pdf.text(L.signatureFallback, margin, yPosition + 18)
    yPosition += 28
  }

  // ── Caixa de confirmação legal ────────────────────────────────────────────
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'italic')
  pdf.setTextColor(80, 80, 80)
  const confirmationLines = pdf.splitTextToSize(L.confirmationText, maxWidth - 16)
  const lineHeight  = 5
  const boxPaddingV = 8
  const boxHeight   = boxPaddingV * 2 + confirmationLines.length * lineHeight

  pdf.setDrawColor(100, 100, 100)
  pdf.setFillColor(240, 240, 240)
  pdf.roundedRect(margin, yPosition, maxWidth, boxHeight, 3, 3, 'FD')

  let confirmYPos = yPosition + boxPaddingV + 2
  confirmationLines.forEach((line: string) => {
    pdf.text(line, margin + 8, confirmYPos)
    confirmYPos += lineHeight
  })
  yPosition += boxHeight

  // ── RODAPÉ em todas as páginas ────────────────────────────────────────────
  const totalPages = (pdf as any).internal.pages.length - 1

  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(150, 150, 150)

    const pageText      = L.pageOf.replace('{current}', String(i)).replace('{total}', String(totalPages))
    const pageTextWidth = pdf.getTextWidth(pageText)
    pdf.text(pageText, pageWidth - margin - pageTextWidth, pageHeight - 10)
    pdf.text(clientInfo.fullName, margin, pageHeight - 10)

    pdf.setDrawColor(220, 220, 220)
    pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)
  }

  return pdf.output('blob')
}

/**
 * Gera e faz download do PDF do contrato no navegador.
 */
export const downloadContractPDF = async (
  title: string,
  sections: ContractSection[],
  clientInfo: ClientInfo,
  timestamp?: string,
  language: Language = 'pt-BR'
) => {
  const L = translations[language]?.contractPdf ?? translations['pt-BR'].contractPdf
  const blob = await generateContractPDF(title, sections, clientInfo, timestamp, language)
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${clientInfo.fullName.replace(/\s+/g, '_')}_${L.filenameSuffix}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}