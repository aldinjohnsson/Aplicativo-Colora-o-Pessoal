// supabase/functions/send-contract-email/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Corrige portalUrl com localhost vindo do frontend em dev ─────────────────
// Configure SITE_URL no painel do Supabase → Edge Functions → Secrets
// Ex: SITE_URL=https://seudominio.com.br
function sanitizePortalUrl(url: string): string {
  if (!url) return url
  const siteUrl = Deno.env.get('SITE_URL') || ''
  if (!siteUrl) return url
  // substitui qualquer origem localhost:XXXX ou localhost pelo domínio real
  return url.replace(/^https?:\/\/localhost(:\d+)?/, siteUrl.replace(/\/$/, ''))
}

// ── Helpers para gerar o PDF ──────────────────────────────────────────────────

function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = []
  const paragraphs = text.split('\n')
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') { lines.push(''); continue }
    const words = paragraph.split(' ')
    let currentLine = ''
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const width = font.widthOfTextAtSize(testLine, fontSize)
      if (width > maxWidth && currentLine) { lines.push(currentLine); currentLine = word }
      else { currentLine = testLine }
    }
    if (currentLine) lines.push(currentLine)
  }
  return lines
}

async function generateContractPDF(
  contractTitle: string,
  sections: Array<{ title: string; content: string; order: number }>,
  clientName: string, clientEmail: string, planName: string, signedAt: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 60
  const CONTENT_W = PAGE_W - MARGIN * 2, LINE_HEIGHT = 16, SECTION_GAP = 24
  let page = pdfDoc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN }
  }
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: rgb(0.937, 0.267, 0.459) })
  y -= 16
  const titleLines = wrapText(contractTitle, fontBold, 16, CONTENT_W)
  for (const line of titleLines) {
    ensureSpace(22)
    const tw = fontBold.widthOfTextAtSize(line, 16)
    page.drawText(line, { x: MARGIN + (CONTENT_W - tw) / 2, y, size: 16, font: fontBold, color: rgb(0.067, 0.067, 0.067) })
    y -= 22
  }
  y -= 12
  ensureSpace(80)
  page.drawRectangle({ x: MARGIN, y: y - 60, width: CONTENT_W, height: 68, color: rgb(0.96, 0.96, 0.98), borderColor: rgb(0.88, 0.88, 0.92), borderWidth: 0.5 })
  page.drawText('CONTRATANTE', { x: MARGIN + 14, y: y - 16, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.5) })
  page.drawText(clientName, { x: MARGIN + 14, y: y - 32, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
  page.drawText(`${clientEmail}  -  Plano: ${planName}`, { x: MARGIN + 14, y: y - 48, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.45) })
  y -= 84
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  for (const section of sorted) {
    if (section.title) {
      const stLines = wrapText(section.title, fontBold, 11, CONTENT_W)
      for (const line of stLines) { ensureSpace(LINE_HEIGHT + 4); page.drawText(line, { x: MARGIN, y, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) }); y -= LINE_HEIGHT }
      y -= 4
    }
    const contentLines = wrapText(section.content, fontRegular, 10, CONTENT_W)
    for (const line of contentLines) {
      ensureSpace(LINE_HEIGHT)
      if (line === '') { y -= 8; continue }
      page.drawText(line, { x: MARGIN, y, size: 10, font: fontRegular, color: rgb(0.25, 0.25, 0.28) })
      y -= LINE_HEIGHT
    }
    y -= SECTION_GAP
  }
  ensureSpace(80); y -= 8
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) })
  y -= 20
  const formattedDate = new Date(signedAt).toLocaleString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  page.drawText(`[ASSINADO]  Aceito digitalmente por ${clientName}`, { x: MARGIN, y, size: 10, font: fontBold, color: rgb(0.13, 0.55, 0.33) })
  y -= 16
  page.drawText(`em ${formattedDate}`, { x: MARGIN + 14, y, size: 9, font: fontRegular, color: rgb(0.42, 0.42, 0.45) })
  const pages = pdfDoc.getPages()
  pages.forEach((p, i) => {
    p.drawText(`MS Color - Coloracao Pessoal  -  Pagina ${i + 1} de ${pages.length}`, { x: MARGIN, y: 30, size: 8, font: fontRegular, color: rgb(0.6, 0.6, 0.65) })
  })
  return await pdfDoc.save()
}

// ── Template base de e-mail (responsivo para mobile) ─────────────────────────

function buildEmail(title: string, greeting: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-text-size-adjust: 100%; }
    .wrapper { background: #f3f4f6; padding: 24px 12px; }
    .container { max-width: 600px; width: 100%; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #fb7185, #ec4899); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center; }
    .header-brand { margin: 0 0 4px; font-size: 11px; color: #ffe4e6; letter-spacing: 2px; text-transform: uppercase; }
    .header-title { margin: 0; font-size: 20px; color: #ffffff; font-weight: 700; line-height: 1.3; }
    .body { background: #ffffff; padding: 28px 24px; border-radius: 0 0 16px 16px; }
    .greeting { margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6; }
    .footer-brand { margin: 28px 0 0; color: #9ca3af; font-size: 11px; text-align: center; }
    .info-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 16px 0; }
    .info-row { display: flex; padding: 5px 0; font-size: 14px; }
    .info-label { color: #6b7280; min-width: 100px; flex-shrink: 0; }
    .info-value { color: #374151; font-weight: 600; }
    .btn-wrap { text-align: center; margin: 24px 0; }
    .btn { display: inline-block; background: linear-gradient(135deg, #fb7185, #ec4899); color: #ffffff !important; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 15px; }
    .alert-green { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .alert-green-title { margin: 0 0 4px; font-size: 14px; color: #166534; font-weight: 600; }
    .alert-green-text { margin: 0; font-size: 13px; color: #15803d; }
    .alert-yellow { background: #fefce8; border: 1px solid #fde68a; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .alert-yellow-title { margin: 0 0 4px; font-size: 13px; color: #92400e; font-weight: 600; }
    .alert-yellow-value { margin: 0; font-size: 15px; color: #78350f; font-weight: 700; text-transform: capitalize; }
    .alert-yellow-sub { margin: 6px 0 0; font-size: 12px; color: #a16207; }
    .alert-pink { background: linear-gradient(135deg, #fdf2f8, #fce7f3); border: 1px solid #fbcfe8; border-radius: 12px; padding: 20px; margin-bottom: 16px; text-align: center; }
    .alert-pink-emoji { margin: 0 0 8px; font-size: 28px; }
    .alert-pink-title { margin: 0 0 4px; font-size: 16px; color: #9d174d; font-weight: 700; }
    .alert-pink-text { margin: 0; font-size: 13px; color: #be185d; }
    .alert-amber { background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .alert-amber-title { margin: 0 0 4px; font-size: 14px; color: #92400e; font-weight: 600; }
    .alert-amber-text { margin: 0; font-size: 13px; color: #b45309; }
    .rejection-box { border-radius: 12px; padding: 16px; margin-bottom: 12px; }
    .rejection-purple { background: #faf5ff; border: 1px solid #e9d5ff; }
    .rejection-blue { background: #eff6ff; border: 1px solid #bfdbfe; }
    .rejection-type { margin: 0 0 6px; font-size: 13px; font-weight: 700; }
    .rejection-type-purple { color: #7c3aed; }
    .rejection-type-blue { color: #2563eb; }
    .rejection-reason { margin: 0; font-size: 14px; color: #374151; line-height: 1.6; }
    .small-center { color: #9ca3af; font-size: 12px; text-align: center; line-height: 1.6; }
    @media only screen and (max-width: 480px) {
      .wrapper { padding: 12px 8px !important; }
      .header { padding: 20px 16px !important; border-radius: 12px 12px 0 0 !important; }
      .header-title { font-size: 17px !important; }
      .body { padding: 20px 16px !important; border-radius: 0 0 12px 12px !important; }
      .btn { padding: 13px 24px !important; font-size: 14px !important; display: block !important; }
      .info-box { padding: 12px !important; }
      .info-row { flex-direction: column !important; padding: 6px 0 !important; }
      .info-label { min-width: auto !important; margin-bottom: 2px; font-size: 11px !important; }
      .info-value { font-size: 13px !important; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table class="container" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td class="header">
            <p class="header-brand">MS Color</p>
            <h1 class="header-title">${title}</h1>
          </td></tr>
          <tr><td class="body">
            <p class="greeting">${greeting}</p>
            ${body}
            <p class="footer-brand">MS Color &middot; Coloracao Pessoal</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>
</body>
</html>`
}

function linkButton(url: string, label: string): string {
  return `<div class="btn-wrap"><a href="${url}" class="btn">${label}</a></div>`
}

function infoTable(rows: Array<[string, string]>): string {
  const trs = rows.map(([label, value]) => `
    <div class="info-row">
      <span class="info-label">${label}</span>
      <span class="info-value">${value}</span>
    </div>`).join('')
  return `<div class="info-box">${trs}</div>`
}

// ── Edge Function principal ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const emailType = payload.type || 'contract_signed'

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: settingsRow } = await supabaseClient
      .from('admin_content')
      .select('content')
      .eq('type', 'settings')
      .maybeSingle()

    const cfg = settingsRow?.content as any
    const RESEND_API_KEY = cfg?.resendApiKey
    const ADMIN_EMAIL    = cfg?.adminEmail
    const FROM_EMAIL     = cfg?.fromEmail || 'MS Color <onboarding@resend.dev>'

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
      console.warn('E-mail nao configurado. Pulando envio.')
      return jsonResponse({ skipped: true })
    }

    const send = async (to: string, subject: string, html: string, attachments: any[] = []) => {
      const body: any = { from: FROM_EMAIL, to, subject, html }
      if (attachments.length > 0) body.attachments = attachments
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Resend error ${res.status}: ${text}`)
      }
    }

    // ============================================================
    // TIPO 1: CONTRATO ASSINADO
    // Envia PDF do contrato para cliente e admin
    // ============================================================
    if (emailType === 'contract_signed') {
      const { clientName, clientEmail, planName, signedAt, contractTitle, sections } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const formattedDate = new Date(signedAt).toLocaleString('pt-BR', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })

      const title = contractTitle ?? 'CONTRATO DE PRESTACAO DE SERVICOS'
      let pdfBase64 = ''
      if (sections?.length) {
        const pdfBytes = await generateContractPDF(title, sections, clientName, clientEmail, planName, signedAt)
        let binary = ''
        for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i])
        pdfBase64 = btoa(binary)
      }

      const attachments = pdfBase64 ? [{ filename: `Contrato - ${planName}.pdf`, content: pdfBase64 }] : []
      const subject = `Contrato de ${planName} - MS Color`

      const clientHtml = buildEmail(
        'Contrato Assinado',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-green">
          <p class="alert-green-title">&#10003; Contrato assinado com sucesso!</p>
          <p class="alert-green-text">O PDF do contrato esta anexo neste e-mail para seu registro.</p>
        </div>
        ${infoTable([['Plano', planName], ['Nome', clientName], ['E-mail', clientEmail], ['Assinado em', formattedDate]])}
        ${portalUrl ? `<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 0">Acompanhe o andamento da sua analise pelo portal:</p>${linkButton(portalUrl, 'Acessar meu portal')}` : ''}`
      )

      const adminHtml = buildEmail(
        'Nova Assinatura de Contrato',
        '&#128221; Nova cliente cadastrada!',
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName], ['Assinado em', formattedDate]])}`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml, attachments),
        send(ADMIN_EMAIL, `[MS Color] Nova assinatura: ${clientName} - ${planName}`, adminHtml, attachments),
      ])
      logResults(results, 'contract_signed')
      return jsonResponse({ success: true, type: 'contract_signed' })
    }

    // ============================================================
    // TIPO 2: FOTOS FINALIZADAS (cliente submeteu fotos)
    // Cliente recebe confirmação + prazo; admin recebe aviso para revisar
    // ============================================================
    if (emailType === 'photos_finalized') {
      const { clientName, clientEmail, planName, deadlineDate } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const formattedDeadline = deadlineDate
        ? new Date(deadlineDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
        : ''

      const subject = `Suas fotos foram recebidas - MS Color`

      const clientHtml = buildEmail(
        'Fotos Recebidas!',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-green">
          <p class="alert-green-title">&#128247; Recebemos suas fotos e informacoes!</p>
          <p class="alert-green-text">Sua analise de coloracao pessoal esta em andamento.</p>
        </div>
        ${formattedDeadline ? `
        <div class="alert-yellow">
          <p class="alert-yellow-title">&#128197; Prazo de entrega estimado</p>
          <p class="alert-yellow-value">${formattedDeadline}</p>
          <p class="alert-yellow-sub">Prazo calculado em dias uteis, sem contar feriados nacionais.</p>
        </div>` : ''}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 4px">Acompanhe o andamento e acesse o resultado quando estiver pronto:</p>
        ${linkButton(portalUrl, 'Acompanhar minha analise')}
        <p class="small-center">Guarde este e-mail — voce pode acessar seu portal por ele quando precisar.</p>`
      )

      const adminHtml = buildEmail(
        '&#128247; Fotos para Revisar',
        `<strong>${clientName}</strong> finalizou o envio de fotos e aguarda sua aprovacao.`,
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName], ['Prazo', formattedDeadline || 'Nao definido']])}`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml),
        send(ADMIN_EMAIL, `[MS Color] &#128247; Fotos para revisar: ${clientName}`, adminHtml),
      ])
      logResults(results, 'photos_finalized')
      return jsonResponse({ success: true, type: 'photos_finalized' })
    }

    // ============================================================
    // TIPO 3: ANALISE APROVADA (admin aprovou fotos + form)
    // Somente cliente recebe — admin ja sabe que acabou de aprovar
    // ============================================================
    if (emailType === 'analysis_approved') {
      const { clientName, clientEmail, planName, deadlineDate } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const formattedDeadline = deadlineDate
        ? new Date(deadlineDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
        : ''

      const subject = `Sua analise foi aprovada! - MS Color`

      const clientHtml = buildEmail(
        'Analise em Andamento!',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-green">
          <p class="alert-green-title">&#10003; Tudo certo! Sua analise foi aprovada.</p>
          <p class="alert-green-text">Suas fotos e formulario foram revisados e estao prontos para a analise de coloracao.</p>
        </div>
        ${formattedDeadline ? `
        <div class="alert-yellow">
          <p class="alert-yellow-title">&#128197; Previsao de entrega</p>
          <p class="alert-yellow-value">${formattedDeadline}</p>
          <p class="alert-yellow-sub">Prazo calculado em dias uteis. Voce recebera um aviso quando o resultado estiver pronto.</p>
        </div>` : ''}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 4px">Acompanhe o status da sua analise pelo portal:</p>
        ${linkButton(portalUrl, 'Ver status da minha analise')}
        <p class="small-center">Qualquer duvida, entre em contato com a consultora.</p>`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml),
      ])
      logResults(results, 'analysis_approved')
      return jsonResponse({ success: true, type: 'analysis_approved' })
    }

    // ============================================================
    // TIPO 4: AJUSTE SOLICITADO (admin rejeitou fotos e/ou form)
    // Somente cliente recebe — admin acabou de solicitar
    // ============================================================
    if (emailType === 'analysis_rejected') {
      const { clientName, clientEmail, planName, rejectPhotos, photosReason, rejectForm, formReason } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const subject = `Ajuste necessario na sua analise - MS Color`

      const rejectionBlocks = [
        rejectPhotos && photosReason ? `
        <div class="rejection-box rejection-purple">
          <p class="rejection-type rejection-type-purple">&#128247; Ajuste nas fotos</p>
          <p class="rejection-reason">${photosReason}</p>
        </div>` : '',
        rejectForm && formReason ? `
        <div class="rejection-box rejection-blue">
          <p class="rejection-type rejection-type-blue">&#128203; Ajuste no formulario</p>
          <p class="rejection-reason">${formReason}</p>
        </div>` : '',
      ].filter(Boolean).join('')

      const clientHtml = buildEmail(
        'Ajuste Necessario',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-amber">
          <p class="alert-amber-title">&#9888;&#65039; Precisamos de um ajuste antes de continuar</p>
          <p class="alert-amber-text">Nao se preocupe — seus dados estao salvos. Acesse o portal e ajuste apenas o que for solicitado abaixo.</p>
        </div>
        ${rejectionBlocks}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">Acesse o portal para realizar os ajustes:</p>
        ${linkButton(portalUrl, 'Acessar e corrigir')}
        <p class="small-center">Apos o ajuste, o envio sera feito automaticamente para nova revisao.</p>`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml),
      ])
      logResults(results, 'analysis_rejected')
      return jsonResponse({ success: true, type: 'analysis_rejected' })
    }

    // ============================================================
    // TIPO 5b: RESULTADO PARCIAL LIBERADO (prévia durante simulações)
    // Disparado SOMENTE quando a admin clica em "Liberar resultado parcial"
    // Mensagem diferenciada: avisa que as simulações ainda continuam
    // ============================================================
    if (emailType === 'partial_result_released') {
      const { clientName, clientEmail, planName } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const subject = `Prévia do seu resultado disponível - MS Color`

      const clientHtml = buildEmail(
        `Prévia do seu Resultado`,
        `Olá, <strong>${clientName}</strong>!`,
        `<div class="alert-pink">
          <p class="alert-pink-emoji">✨</p>
          <p class="alert-pink-title">Sua prévia está disponível!</p>
          <p class="alert-pink-text">Acesse o portal para conferir o resultado parcial da sua análise.</p>
        </div>
        <div class="alert-yellow">
          <p class="alert-yellow-title">⏳ Simulações ainda em andamento</p>
          <p class="alert-yellow-sub">Nossa consultora ainda está finalizando os últimos detalhes. Você receberá um novo aviso assim que o resultado completo estiver pronto.</p>
        </div>
        ${linkButton(portalUrl, 'Ver minha prévia')}
        <p class="small-center">Qualquer dúvida, entre em contato com a consultora.</p>`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml),
      ])
      logResults(results, 'partial_result_released')
      return jsonResponse({ success: true, type: 'partial_result_released' })
    }

    // ============================================================
    // TIPO 5: RESULTADO FINAL LIBERADO
    // Somente a cliente recebe — admin nao precisa de notificacao
    // ============================================================
    if (emailType === 'result_released') {
      const { clientName, clientEmail, planName } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const subject = `Sua analise ${planName} esta pronta! - MS Color`

      const clientHtml = buildEmail(
        `Sua Analise ${planName} esta Pronta!`,
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-pink">
          <p class="alert-pink-emoji">&#127881;</p>
          <p class="alert-pink-title">Sua analise ${planName} esta pronta!</p>
          <p class="alert-pink-text">Acesse o link abaixo para ver seu resultado completo.</p>
        </div>
        ${linkButton(portalUrl, 'Ver meu resultado')}
        <p class="small-center">
          Muito obrigada por me escolher para fazer parte dessa descoberta,<br>
          foi um prazer atender voce. &#10084;&#65039;
        </p>`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml),
      ])
      logResults(results, 'result_released')
      return jsonResponse({ success: true, type: 'result_released' })
    }

    return jsonResponse({ error: 'Tipo de e-mail desconhecido: ' + emailType }, 400)

  } catch (error: any) {
    const msg = error?.message || String(error)
    console.error('send-contract-email error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function logResults(results: PromiseSettledResult<void>[], type: string) {
  results.forEach((r, i) => {
    const target = i === 0 ? 'cliente' : 'admin'
    if (r.status === 'rejected') {
      console.warn(`[${type}] Falha ao enviar para ${target}:`, (r as PromiseRejectedResult).reason?.message)
    }
  })
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}