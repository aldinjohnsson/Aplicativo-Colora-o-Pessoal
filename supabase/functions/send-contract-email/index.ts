// supabase/functions/send-contract-email/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Helpers para gerar o PDF ──────────────────────────────────

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
    p.drawText(`MS Colors - Coloracao Pessoal  -  Pagina ${i + 1} de ${pages.length}`, { x: MARGIN, y: 30, size: 8, font: fontRegular, color: rgb(0.6, 0.6, 0.65) })
  })
  return await pdfDoc.save()
}

// ── Template base de e-mail ───────────────────────────────────

function buildEmail(title: string, greeting: string, body: string): string {
  return `<!DOCTYPE html><html lang="pt-BR">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
          <tr><td style="background:linear-gradient(135deg,#fb7185,#ec4899);border-radius:16px 16px 0 0;padding:32px;text-align:center">
            <p style="margin:0;font-size:13px;color:#ffe4e6;letter-spacing:2px;text-transform:uppercase">MS Colors</p>
            <h1 style="margin:8px 0 0;font-size:20px;color:#fff;font-weight:700">${title}</h1>
          </td></tr>
          <tr><td style="background:#fff;padding:32px;border-radius:0 0 16px 16px">
            <p style="margin:0 0 20px;color:#374151;font-size:15px">${greeting}</p>
            ${body}
            <p style="margin:28px 0 0;color:#9ca3af;font-size:12px;text-align:center">MS Colors &middot; Coloracao Pessoal</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`
}

function linkButton(url: string, label: string): string {
  return `<div style="text-align:center;margin:24px 0">
    <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#fb7185,#ec4899);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px">${label}</a>
  </div>`
}

function infoTable(rows: Array<[string, string]>): string {
  const trs = rows.map(([label, value]) => `
    <tr>
      <td style="padding:6px 0;color:#6b7280;width:110px;font-size:14px">${label}</td>
      <td style="padding:6px 0;font-weight:600;font-size:14px;color:#374151">${value}</td>
    </tr>`).join('')
  return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:16px 0">
    <table width="100%" cellpadding="0" cellspacing="0">${trs}</table>
  </div>`
}

// ── Edge Function principal ───────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const emailType = payload.type || 'contract_signed'

    // ── Buscar configuracoes ──────────────────────────────
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
    const FROM_EMAIL     = cfg?.fromEmail || 'MS Colors <onboarding@resend.dev>'

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
    // ============================================================
    if (emailType === 'contract_signed') {
      const { clientName, clientEmail, planName, signedAt, contractTitle, sections, portalUrl } = payload

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
      const subject = `Contrato de ${planName} - MS Colors`

      const clientHtml = buildEmail(
        'Contrato Assinado',
        `Ola, <strong>${clientName}</strong>!`,
        `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:16px">
          <p style="margin:0 0 4px;font-size:14px;color:#166534;font-weight:600">Contrato assinado com sucesso!</p>
          <p style="margin:0;font-size:13px;color:#15803d">O PDF do contrato esta anexo neste e-mail.</p>
        </div>
        ${infoTable([['Plano', planName], ['Nome', clientName], ['E-mail', clientEmail], ['Assinado em', formattedDate]])}
        ${portalUrl ? `<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 0">Acompanhe o andamento da sua analise pelo link abaixo:</p>${linkButton(portalUrl, 'Acessar meu portal')}` : ''}`
      )

      const adminHtml = buildEmail(
        'Nova Assinatura de Contrato',
        'Nova cliente cadastrada!',
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName], ['Assinado em', formattedDate]])}`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml, attachments),
        send(ADMIN_EMAIL, subject, adminHtml, attachments),
      ])
      logResults(results, 'contract_signed')
      return jsonResponse({ success: true, type: 'contract_signed' })
    }

    // ============================================================
    // TIPO 2: FOTOS FINALIZADAS
    // ============================================================
    if (emailType === 'photos_finalized') {
      const { clientName, clientEmail, planName, portalUrl, deadlineDate } = payload

      const formattedDeadline = deadlineDate
        ? new Date(deadlineDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
        : ''

      const subject = `Suas fotos foram recebidas - MS Colors`

      const clientHtml = buildEmail(
        'Fotos Recebidas!',
        `Ola, <strong>${clientName}</strong>!`,
        `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:16px">
          <p style="margin:0 0 4px;font-size:14px;color:#166534;font-weight:600">Recebemos suas fotos e informacoes!</p>
          <p style="margin:0;font-size:13px;color:#15803d">Sua analise de coloracao pessoal esta em andamento.</p>
        </div>
        ${formattedDeadline ? `
        <div style="background:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:20px;margin-bottom:16px">
          <p style="margin:0 0 4px;font-size:13px;color:#92400e;font-weight:600">Prazo de entrega</p>
          <p style="margin:0;font-size:15px;color:#78350f;font-weight:700;text-transform:capitalize">${formattedDeadline}</p>
          <p style="margin:6px 0 0;font-size:12px;color:#a16207">Prazo calculado em dias uteis, sem contar feriados nacionais.</p>
        </div>` : ''}
        <p style="color:#374151;font-size:14px;line-height:1.6">Acompanhe o andamento e acesse o resultado quando estiver pronto:</p>
        ${linkButton(portalUrl, 'Acompanhar minha analise')}
        <p style="color:#9ca3af;font-size:12px;text-align:center">Guarde este e-mail para acessar seu portal quando precisar.</p>`
      )

      const adminHtml = buildEmail(
        'Fotos Finalizadas',
        'Uma cliente finalizou o envio de fotos!',
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName], ['Prazo', formattedDeadline || 'Nao definido']])}`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml),
        send(ADMIN_EMAIL, `Fotos finalizadas: ${clientName} - ${planName}`, adminHtml),
      ])
      logResults(results, 'photos_finalized')
      return jsonResponse({ success: true, type: 'photos_finalized' })
    }

    // ============================================================
    // TIPO 3: RESULTADO LIBERADO
    // ============================================================
    if (emailType === 'result_released') {
      const { clientName, clientEmail, planName, portalUrl } = payload

      const subject = `Sua analise esta pronta! - MS Colors`

      const clientHtml = buildEmail(
        'Sua Analise esta Pronta!',
        `Ola, <strong>${clientName}</strong>!`,
        `<div style="background:linear-gradient(135deg,#fdf2f8,#fce7f3);border:1px solid #fbcfe8;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
          <p style="margin:0 0 8px;font-size:28px">&#127881;</p>
          <p style="margin:0 0 4px;font-size:16px;color:#9d174d;font-weight:700">Sua analise de coloracao pessoal esta pronta!</p>
          <p style="margin:0;font-size:13px;color:#be185d">Acesse o link abaixo para ver seu resultado completo.</p>
        </div>
        ${linkButton(portalUrl, 'Ver meu resultado')}
        <p style="color:#6b7280;font-size:13px;text-align:center;line-height:1.6">
          Estou muito feliz em compartilhar sua paleta de cores!<br>
          Qualquer duvida, estou a disposicao.
        </p>`
      )

      const adminHtml = buildEmail(
        'Resultado Liberado',
        'Um resultado foi liberado para a cliente.',
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName]])}`
      )

      const results = await Promise.allSettled([
        send(clientEmail, subject, clientHtml),
        send(ADMIN_EMAIL, `Resultado liberado: ${clientName}`, adminHtml),
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