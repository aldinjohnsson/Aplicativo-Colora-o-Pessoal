import jsPDF from 'jspdf'
import type { PhotoType } from './PhotoTypesManager'
import type { RefPhoto } from './AIPromptConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

interface FormField {
  id: string
  label: string
  type: string
  value?: any
}

export interface FormSection {
  id: string
  title: string
  fields: FormField[]
  /** ID do type ao qual esta seção pertence (ex: 'cabelo', 'maquiagem') */
  photoTypeId?: string
}

interface FormConfig {
  sections: FormSection[]
}

export interface PDFByType {
  typeId: string
  typeName: string
  typeIcon: string
  blob: Blob
  fileName: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

const fileToBase64 = (file: File | Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

const urlToBase64 = async (url: string): Promise<string | null> => {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    return await fileToBase64(blob)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gerador de um único PDF (genérico)
// ─────────────────────────────────────────────────────────────────────────────

async function buildPDF(opts: {
  clientName: string
  clientEmail: string
  clientPhone: string
  formData: any
  sections: FormSection[]
  completedDate: string
  formAttachments: File[]
  /** Título principal do PDF (ex: "Cabelo" ou "Maquiagem") */
  pdfTitle: string
  /** Subtítulo */
  pdfSubtitle?: string
  /** Base64 da foto de referência do type */
  refPhotoBase64?: string | null
}): Promise<Blob> {
  const {
    clientName, clientEmail, clientPhone, formData, sections,
    completedDate, formAttachments, pdfTitle, pdfSubtitle, refPhotoBase64,
  } = opts

  const pdf = new jsPDF()
  let y = 20
  const pageHeight = pdf.internal.pageSize.height
  const pageWidth = pdf.internal.pageSize.width
  const margin = 20
  const maxWidth = pageWidth - 2 * margin

  const checkPage = (space = 20) => {
    if (y + space > pageHeight - margin) {
      pdf.addPage()
      y = margin
    }
  }

  const hline = (color: [number, number, number] = [200, 200, 200]) => {
    pdf.setDrawColor(...color)
    pdf.line(margin, y, pageWidth - margin, y)
    y += 5
  }

  // ── Cabeçalho ──────────────────────────────────────────────

  // Data
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(120, 120, 120)
  const dateText = new Date(completedDate).toLocaleDateString('pt-BR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  pdf.text(dateText, pageWidth - margin - pdf.getTextWidth(dateText), y)
  y += 10

  // Foto de referência (canto superior direito, abaixo da data)
  let refPhotoRightX = pageWidth - margin
  const refPhotoSize = 40
  if (refPhotoBase64) {
    try {
      const imgProps = pdf.getImageProperties(refPhotoBase64)
      const ratio = imgProps.width / imgProps.height
      const w = ratio >= 1 ? refPhotoSize : refPhotoSize * ratio
      const h = ratio >= 1 ? refPhotoSize / ratio : refPhotoSize
      const xPos = pageWidth - margin - w
      pdf.addImage(refPhotoBase64, 'JPEG', xPos, y, w, h)
      refPhotoRightX = xPos - 5
    } catch {}
  }

  // Título
  pdf.setFontSize(20)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0, 0, 0)
  pdf.text(pdfTitle, margin, y + 8)
  y += 14

  if (pdfSubtitle) {
    pdf.setFontSize(13)
    pdf.setFont('helvetica', 'bold')
    pdf.text(pdfSubtitle, margin, y)
    y += 8
  }

  if (refPhotoBase64) y = Math.max(y, 20 + refPhotoSize + 5)
  y += 6

  // ── Dados do cliente ──────────────────────────────────────

  const clientInfoY = y
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0, 0, 0)
  pdf.text('Nome', margin, y); y += 5
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientName, margin, y); y += 9

  pdf.setFont('helvetica', 'bold')
  pdf.text('E-mail', margin, y); y += 5
  pdf.setFont('helvetica', 'normal')
  pdf.text(clientEmail, margin, y); y += 9

  if (clientPhone) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('Telefone', margin, y); y += 5
    pdf.setFont('helvetica', 'normal')
    pdf.text(clientPhone, margin, y); y += 9
  }

  y += 5
  hline()
  y += 3

  // ── Seções / Perguntas ────────────────────────────────────

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]

    // Título da seção (se houver mais de uma)
    if (sections.length > 1) {
      checkPage(18)
      pdf.setFontSize(13)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(50, 50, 150)
      pdf.text(section.title, margin, y)
      y += 10
    }

    for (let fi = 0; fi < section.fields.length; fi++) {
      const field = section.fields[fi]
      checkPage(35)

      // Pergunta
      pdf.setFontSize(11)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(0, 0, 0)
      const qLines = pdf.splitTextToSize(`${si + 1}.${fi + 1} ${field.label}`, maxWidth)
      qLines.forEach((line: string) => { checkPage(); pdf.text(line, margin, y); y += 6 })
      y += 2

      // Resposta
      const value = formData[field.id]
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(60, 60, 60)

      if (value === undefined || value === null || value === '') {
        pdf.setFont('helvetica', 'italic')
        pdf.setTextColor(160, 160, 160)
        pdf.text('(Não respondido)', margin + 5, y)
        y += 8
      } else if (field.type === 'file' || field.type === 'image') {
        const fieldImages = formAttachments.filter(f =>
          f.name.includes(field.id) || (f.type && f.type.startsWith('image/'))
        )
        if (fieldImages.length > 0) {
          pdf.text(`${fieldImages.length} imagem${fieldImages.length > 1 ? 'ns' : ''} enviada${fieldImages.length > 1 ? 's' : ''}:`, margin + 5, y)
          y += 10
          const thumbSize = 70
          const spacing = 5
          const perRow = Math.floor(maxWidth / (thumbSize + spacing))
          let xPos = margin + 5
          let rowH = 0
          for (let i = 0; i < fieldImages.length; i++) {
            try {
              const b64 = await fileToBase64(fieldImages[i])
              if (i > 0 && i % perRow === 0) { y += rowH + spacing; xPos = margin + 5; rowH = 0; checkPage(thumbSize + 10) }
              const ip = pdf.getImageProperties(b64)
              const r = ip.width / ip.height
              const w = r >= 1 ? thumbSize : thumbSize * r
              const h = r >= 1 ? thumbSize / r : thumbSize
              pdf.addImage(b64, 'JPEG', xPos, y, w, h)
              pdf.setFontSize(8); pdf.setTextColor(100, 100, 100)
              const name = fieldImages[i].name.length > 15 ? fieldImages[i].name.substring(0, 12) + '...' : fieldImages[i].name
              pdf.text(name, xPos, y + h + 3)
              xPos += thumbSize + spacing
              rowH = Math.max(rowH, h + 8)
            } catch {}
          }
          y += rowH + 5
        } else {
          pdf.setFont('helvetica', 'italic'); pdf.setTextColor(160, 160, 160)
          pdf.text('(Nenhuma imagem enviada)', margin + 5, y); y += 8
        }
      } else if (typeof value === 'boolean') {
        pdf.text(value ? '✓ Sim' : '✗ Não', margin + 5, y); y += 8
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          pdf.setFont('helvetica', 'italic'); pdf.setTextColor(160, 160, 160)
          pdf.text('(Nenhuma opção selecionada)', margin + 5, y); y += 8
        } else {
          value.forEach(item => { checkPage(); pdf.text(`• ${item}`, margin + 5, y); y += 6 })
          y += 2
        }
      } else {
        const lines = pdf.splitTextToSize(String(value), maxWidth - 10)
        lines.forEach((line: string) => { checkPage(); pdf.text(line, margin + 5, y); y += 6 })
        y += 2
      }

      y += 5
      if (fi < section.fields.length - 1) {
        pdf.setDrawColor(230, 230, 230)
        pdf.line(margin + 5, y, pageWidth - margin - 5, y)
        y += 7
      }
    }

    if (si < sections.length - 1) y += 10
  }

  // ── Rodapé em todas as páginas ────────────────────────────

  const totalPages = (pdf as any).internal.pages.length - 1
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(160, 160, 160)
    const pageText = `Página ${i} de ${totalPages}`
    pdf.text(pageText, pageWidth - margin - pdf.getTextWidth(pageText), pageHeight - 10)
    pdf.text(clientName, margin, pageHeight - 10)
  }

  return pdf.output('blob')
}

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA — por type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gera um PDF separado para cada type que tiver ao menos uma seção.
 *
 * @param clientName     Nome completo da cliente
 * @param clientEmail    E-mail da cliente
 * @param clientPhone    Telefone da cliente
 * @param formData       Mapa { fieldId: value }
 * @param formConfig     Configuração do formulário (seções com photoTypeId preenchido)
 * @param completedDate  ISO string da data de conclusão
 * @param formAttachments Arquivos anexados no formulário
 * @param photoTypes     Lista de types configurados globalmente
 * @param refPhotos      Fotos de referência da cliente por type
 * @returns              Array de { typeId, typeName, typeIcon, blob, fileName }
 */
export const generateFormPDFsPerType = async (
  clientName: string,
  clientEmail: string,
  clientPhone: string,
  formData: any,
  formConfig: FormConfig | null,
  completedDate: string,
  formAttachments: File[] = [],
  photoTypes: PhotoType[] = [],
  refPhotos: RefPhoto[] = []
): Promise<PDFByType[]> => {
  if (!formConfig?.sections?.length) return []

  // Agrupar seções por typeId (seções sem type vão para 'sem_tipo')
  const grouped: Record<string, FormSection[]> = {}
  for (const section of formConfig.sections) {
    const key = section.photoTypeId || 'sem_tipo'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(section)
  }

  const results: PDFByType[] = []

  // Gerar PDF para cada group
  for (const [typeId, sections] of Object.entries(grouped)) {
    const type = photoTypes.find(t => t.id === typeId)
    const typeName = type?.name || (typeId === 'sem_tipo' ? 'Geral' : typeId)
    const typeIcon = type?.icon || '📄'

    // Foto de referência
    const refPhoto = refPhotos.find(p => p.typeId === typeId)
      || refPhotos.find(p => p.typeId === 'geral') // fallback para geral
    const refPhotoBase64 = refPhoto ? await urlToBase64(refPhoto.url) : null

    const blob = await buildPDF({
      clientName,
      clientEmail,
      clientPhone,
      formData,
      sections,
      completedDate,
      formAttachments,
      pdfTitle: `${typeIcon} ${typeName}`,
      pdfSubtitle: 'Coloração Pessoal Online',
      refPhotoBase64,
    })

    const safeType = typeName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')
    const safeName = clientName.replace(/\s+/g, '_')

    results.push({
      typeId,
      typeName,
      typeIcon,
      blob,
      fileName: `${safeName}_${safeType}.pdf`,
    })
  }

  return results
}

/**
 * Baixa todos os PDFs por type (um arquivo por type).
 */
export const downloadFormPDFsPerType = async (
  clientName: string,
  clientEmail: string,
  clientPhone: string,
  formData: any,
  formConfig: FormConfig | null,
  completedDate: string,
  formAttachments: File[] = [],
  photoTypes: PhotoType[] = [],
  refPhotos: RefPhoto[] = []
): Promise<void> => {
  const pdfs = await generateFormPDFsPerType(
    clientName, clientEmail, clientPhone, formData,
    formConfig, completedDate, formAttachments, photoTypes, refPhotos
  )

  for (const { blob, fileName } of pdfs) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    // pequeno delay entre downloads
    await new Promise(r => setTimeout(r, 300))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API LEGADA — mantida para compatibilidade
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use generateFormPDFsPerType
 */
export const generateFormPDF = async (
  clientName: string,
  clientEmail: string,
  clientPhone: string,
  formData: any,
  formConfig: { sections: FormSection[] } | null,
  completedDate: string,
  formAttachments: File[] = []
): Promise<Blob> => {
  const sections = formConfig?.sections || []
  return buildPDF({
    clientName, clientEmail, clientPhone, formData, sections,
    completedDate, formAttachments,
    pdfTitle: 'Coloração Pessoal Online',
    pdfSubtitle: 'Formulário Completo',
  })
}

/**
 * @deprecated Use downloadFormPDFsPerType
 */
export const downloadFormPDF = async (
  clientName: string,
  clientEmail: string,
  clientPhone: string,
  formData: any,
  formConfig: { sections: FormSection[] } | null,
  completedDate: string,
  formAttachments: File[] = []
): Promise<void> => {
  const blob = await generateFormPDF(
    clientName, clientEmail, clientPhone, formData,
    formConfig, completedDate, formAttachments
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