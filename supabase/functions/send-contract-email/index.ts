// supabase/functions/send-contract-email/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Corrige portalUrl com localhost vindo do frontend em dev ─────────────────
function sanitizePortalUrl(url: string): string {
  if (!url) return url
  const siteUrl = Deno.env.get('SITE_URL') || ''
  if (!siteUrl) return url
  return url.replace(/^https?:\/\/localhost(:\d+)?/, siteUrl.replace(/\/$/, ''))
}

// ── Monta header "From" em formato RFC 5322 ──────────────────────────────────
//
// Recebe o nome de exibição (do settings do admin) e o endereço de e-mail global
// (que pode vir como "email puro" ou como "Display <email>"). Retorna o header
// completo com o nome de exibição + e-mail do remetente, ex:
//
//   buildFromHeader('Salão da Fulana', 'contato@iacolor.online')
//     → 'Salão da Fulana <contato@iacolor.online>'
//
//   buildFromHeader('', 'noreply@x.com')
//     → 'noreply@x.com'  (fallback sem display name)
//
// Caracteres especiais (vírgula, ponto-e-vírgula) forçam aspas duplas
// no display name pra não quebrar o header.
function buildFromHeader(displayName: string, fromHeaderOrEmail: string): string {
  const src = (fromHeaderOrEmail || '').trim()
  if (!src) return 'onboarding@resend.dev'

  // Extrai só o e-mail caso `src` venha como "Display <email>"
  const match = src.match(/<([^>]+)>/)
  const email = (match ? match[1] : src).trim()

  const name = (displayName || '').replace(/[<>"]/g, '').trim()
  if (!name) return src   // sem display name → usa o header global cru

  // Quote se tiver vírgula/ponto-e-vírgula/dois-pontos (RFC 5322)
  if (/[,;:]/.test(name)) return `"${name}" <${email}>`
  return `${name} <${email}>`
}

// ── Helper de quebra de texto ─────────────────────────────────────────────────
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

// ── Geração do PDF do contrato ────────────────────────────────────────────────
//
// Correções aplicadas:
//  • Aceita `clientIp` e `signatureDataUrl` como parâmetros
//  • Exibe IP do signatário no bloco de assinatura
//  • Hora com segundos (HH:mm:ss)
//  • Embute a imagem PNG da assinatura manuscrita via pdfDoc.embedPng()
//  • Bloco de assinatura calculado previamente — nunca quebra de página

async function generateContractPDF(
  contractTitle: string,
  sections: Array<{ title: string; content: string; order: number }>,
  clientName: string,
  clientEmail: string,
  planName: string,
  signedAt: string,
  clientIp?: string,
  signatureDataUrl?: string,
  brandName?: string,
): Promise<Uint8Array> {
  const pdfDoc      = await PDFDocument.create()
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const PAGE_W      = 595.28
  const PAGE_H      = 841.89
  const MARGIN      = 60
  const CONTENT_W   = PAGE_W - MARGIN * 2
  const LINE_HEIGHT = 16
  const SECTION_GAP = 24

  let page = pdfDoc.addPage([PAGE_W, PAGE_H])
  let y    = PAGE_H - MARGIN

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H])
      y    = PAGE_H - MARGIN
    }
  }

  // ── Faixa de cor no topo ──────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8,
    color: rgb(0.937, 0.267, 0.459),
  })
  y -= 16

  // ── Título do contrato ────────────────────────────────────────────────────
  const titleLines = wrapText(contractTitle, fontBold, 16, CONTENT_W)
  for (const line of titleLines) {
    ensureSpace(22)
    const tw = fontBold.widthOfTextAtSize(line, 16)
    page.drawText(line, {
      x: MARGIN + (CONTENT_W - tw) / 2, y,
      size: 16, font: fontBold, color: rgb(0.067, 0.067, 0.067),
    })
    y -= 22
  }
  y -= 12

  // ── Bloco do contratante ──────────────────────────────────────────────────
  ensureSpace(80)
  page.drawRectangle({
    x: MARGIN, y: y - 60, width: CONTENT_W, height: 68,
    color: rgb(0.96, 0.96, 0.98),
    borderColor: rgb(0.88, 0.88, 0.92), borderWidth: 0.5,
  })
  page.drawText('CONTRATANTE', {
    x: MARGIN + 14, y: y - 16, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.5),
  })
  page.drawText(clientName, {
    x: MARGIN + 14, y: y - 32, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1),
  })
  page.drawText(`${clientEmail}  -  Plano: ${planName}`, {
    x: MARGIN + 14, y: y - 48, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.45),
  })
  y -= 84

  // ── Cláusulas ─────────────────────────────────────────────────────────────
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  for (const section of sorted) {
    if (section.title) {
      const stLines = wrapText(section.title, fontBold, 11, CONTENT_W)
      for (const line of stLines) {
        ensureSpace(LINE_HEIGHT + 4)
        page.drawText(line, { x: MARGIN, y, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
        y -= LINE_HEIGHT
      }
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

  // ── Bloco de assinatura digital ───────────────────────────────────────────
  //
  // Calculamos o espaço total ANTES de começar a desenhar.
  // Se não couber na página atual, forçamos nova página,
  // garantindo que assinatura + dados legais fiquem sempre juntos.
  //
  const sigImgH   = signatureDataUrl ? 60 : 24
  const extraRows = (clientIp ? 1 : 0)
  const sigBlockH = 20             // linha divisória + margem
                  + LINE_HEIGHT    // "[ASSINADO]  Aceito por..."
                  + LINE_HEIGHT    // "em DD/MM/YYYY às HH:mm:ss"
                  + LINE_HEIGHT    // "E-mail: ..."
                  + extraRows * LINE_HEIGHT
                  + 16             // espaço antes da assinatura
                  + sigImgH        // caixa/linha da assinatura
                  + 10             // margem
                  + 36             // caixa de declaração legal
                  + 10             // margem final

  if (y - sigBlockH < MARGIN) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H])
    y    = PAGE_H - MARGIN
  }

  // Linha divisória
  y -= 8
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5, color: rgb(0.85, 0.85, 0.88),
  })
  y -= 20

  // Data e hora com segundos (timezone Brasil — servidor roda em UTC)
  const signDate    = new Date(signedAt)
  const dateStr     = signDate.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  })
  const timeStr     = signDate.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
  const datetimeStr = `${dateStr} às ${timeStr}`

  page.drawText(`[ASSINADO]  Aceito digitalmente por ${clientName}`, {
    x: MARGIN, y, size: 10, font: fontBold, color: rgb(0.13, 0.55, 0.33),
  })
  y -= LINE_HEIGHT

  page.drawText(`em ${datetimeStr}`, {
    x: MARGIN + 14, y, size: 9, font: fontRegular, color: rgb(0.42, 0.42, 0.45),
  })
  y -= LINE_HEIGHT

  page.drawText(`E-mail: ${clientEmail}`, {
    x: MARGIN + 14, y, size: 9, font: fontRegular, color: rgb(0.42, 0.42, 0.45),
  })
  y -= LINE_HEIGHT

  if (clientIp) {
    page.drawText(`IP do signatario: ${clientIp}`, {
      x: MARGIN + 14, y, size: 9, font: fontRegular, color: rgb(0.42, 0.42, 0.45),
    })
    y -= LINE_HEIGHT
  }

  y -= 8

  // ── Assinatura manuscrita (PNG base64) ────────────────────────────────────
  if (signatureDataUrl) {
    try {
      const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '')
      const pngBytes   = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
      const pngImage   = await pdfDoc.embedPng(pngBytes)

      const sigW = 160
      const sigH = 48

      page.drawText('Assinatura manuscrita digital:', {
        x: MARGIN, y, size: 8, font: fontBold, color: rgb(0.3, 0.3, 0.3),
      })
      y -= 6

      // Caixa de fundo
      page.drawRectangle({
        x: MARGIN, y: y - sigH, width: sigW, height: sigH,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5,
      })

      // Linha de base
      page.drawLine({
        start: { x: MARGIN + 4,        y: y - sigH + 10 },
        end:   { x: MARGIN + sigW - 4, y: y - sigH + 10 },
        thickness: 0.5, color: rgb(0.82, 0.82, 0.82),
      })

      // Imagem da assinatura
      page.drawImage(pngImage, {
        x:      MARGIN + 4,
        y:      y - sigH + 12,
        width:  sigW - 8,
        height: sigH - 16,
      })

      y -= sigH + 10
    } catch (imgErr) {
      console.warn('Nao foi possivel inserir a imagem da assinatura:', imgErr)
      // Fallback: linha clássica
      page.drawLine({
        start: { x: MARGIN, y: y - 12 }, end: { x: MARGIN + 120, y: y - 12 },
        thickness: 0.5, color: rgb(0, 0, 0),
      })
      y -= 24
    }
  } else {
    page.drawLine({
      start: { x: MARGIN, y: y - 12 }, end: { x: MARGIN + 120, y: y - 12 },
      thickness: 0.5, color: rgb(0, 0, 0),
    })
    page.drawText('Assinatura', {
      x: MARGIN, y: y - 22, size: 8, font: fontRegular, color: rgb(0.6, 0.6, 0.6),
    })
    y -= 30
  }

  // ── Declaração legal ──────────────────────────────────────────────────────
  y -= 4
  const declarationText =
    'O contratante declara ter lido, compreendido e aceito todos os termos e condicoes deste contrato.'
  const declarationLines = wrapText(declarationText, fontRegular, 8, CONTENT_W - 20)
  const declBoxH = declarationLines.length * 12 + 16

  page.drawRectangle({
    x: MARGIN, y: y - declBoxH + 8, width: CONTENT_W, height: declBoxH,
    color: rgb(0.95, 0.95, 0.95),
    borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.5,
  })

  let dy = y - 4
  for (const line of declarationLines) {
    page.drawText(line, {
      x: MARGIN + 8, y: dy, size: 8, font: fontRegular, color: rgb(0.35, 0.35, 0.35),
    })
    dy -= 12
  }

  // ── Rodapé em todas as páginas ────────────────────────────────────────────
  const pages = pdfDoc.getPages()
  const footerBrand = (brandName || '').trim()
  pages.forEach((p, i) => {
    const text = footerBrand
      ? `${footerBrand}  -  Pagina ${i + 1} de ${pages.length}`
      : `Pagina ${i + 1} de ${pages.length}`
    p.drawText(
      text,
      { x: MARGIN, y: 30, size: 8, font: fontRegular, color: rgb(0.6, 0.6, 0.65) }
    )
  })

  return await pdfDoc.save()
}

// ── Template base de e-mail (responsivo para mobile) ─────────────────────────

function buildEmail(title: string, greeting: string, body: string, brandName?: string): string {
  const brand = (brandName || '').trim()
  const headerBrandHtml = brand
    ? `<p class="header-brand" style="margin: 0 0 4px; font-size: 11px; color: #ffe4e6; letter-spacing: 2px; text-transform: uppercase;">${brand}</p>`
    : ''
  const footerBrandHtml = brand
    ? `<p class="footer-brand" style="margin: 28px 0 0; color: #9ca3af; font-size: 11px; text-align: center;">${brand}</p>`
    : ''
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
    .header { background: #ec4899; background: linear-gradient(135deg, #fb7185, #ec4899); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center; }
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
    .btn { display: inline-block; background: #ec4899; background: linear-gradient(135deg, #fb7185, #ec4899); color: #ffffff !important; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 15px; }
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
          <tr><td class="header" bgcolor="#ec4899" style="background-color: #ec4899; background: linear-gradient(135deg, #fb7185, #ec4899); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
            ${headerBrandHtml}
            <h1 class="header-title" style="margin: 0; font-size: 20px; color: #ffffff; font-weight: 700; line-height: 1.3;">${title}</h1>
          </td></tr>
          <tr><td class="body">
            <p class="greeting">${greeting}</p>
            ${body}
            ${footerBrandHtml}
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
    <tr>
      <td style="padding:5px 8px 5px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${label}</td>
      <td style="padding:5px 0;font-size:13px;color:#374151;font-weight:600;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${value}</td>
    </tr>`).join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;margin:16px 0;border-collapse:separate;border-spacing:0;">
    <tr><td style="padding:12px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${trs}</table>
    </td></tr>
  </table>`
}

// ── Edge Function principal ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const rawBody  = await req.text()
    const userAgent = req.headers.get('user-agent') || 'unknown'
    const origin    = req.headers.get('origin')     || 'no-origin'
    const referer   = req.headers.get('referer')    || 'no-referer'
    console.log(`[DEBUG request] method=${req.method} | bytes=${rawBody.length} | ua="${userAgent}" | origin="${origin}" | referer="${referer}"`)

    let payload: any = {}
    try {
      payload = rawBody ? JSON.parse(rawBody) : {}
    } catch (parseErr) {
      console.warn(`[DEBUG request] body nao e JSON valido: ${rawBody.slice(0, 200)}`)
      return jsonResponse({ error: 'Body invalido' }, 400)
    }

    const emailType = payload.type
    if (!emailType) {
      console.warn(`[DEBUG request] payload.type ausente. payload keys=${Object.keys(payload).join(',') || '(vazio)'}`)
      return jsonResponse({ skipped: true, reason: 'type ausente no payload' })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    console.log(`[DEBUG payload] type=${emailType} | adminId=${payload.adminId ?? 'NULL'} | clientToken=${payload.clientToken ?? 'NULL'}`)

    let clientFromDb: {
      full_name?: string
      email?: string
      admin_id?: string | null
      plan_name?: string
    } | null = null

    if (payload.clientToken) {
      const { data: row } = await supabaseClient
        .from('clients')
        .select('full_name, email, admin_id, plan:plans(name)')
        .eq('token', payload.clientToken)
        .maybeSingle()

      if (row) {
        clientFromDb = {
          full_name: (row as any).full_name ?? '',
          email:     (row as any).email     ?? '',
          admin_id:  (row as any).admin_id  ?? null,
          plan_name: (row as any).plan?.name ?? '',
        }
        console.log(`[${emailType}] cliente hidratado via clientToken: email=${clientFromDb.email} admin_id=${clientFromDb.admin_id ?? 'NULL'}`)
      } else {
        console.warn(`[${emailType}] clientToken nao encontrado em clients`)
      }
    }

    let adminId: string | null = payload.adminId || clientFromDb?.admin_id || null

    if (!adminId) {
      adminId = Deno.env.get('DEFAULT_ADMIN_ID') || null
      if (adminId) {
        console.log(`[${emailType}] adminId resolvido via DEFAULT_ADMIN_ID env var`)
      }
    }

    if (!adminId) {
      console.warn(`[${emailType}] adminId nao resolvido. Pulando envio.`)
      return jsonResponse({ skipped: true, reason: 'adminId nao resolvido' })
    }

    const clientName  = (payload.clientName  || clientFromDb?.full_name || '').trim()
    const clientEmail = (payload.clientEmail || clientFromDb?.email     || '').trim()
    const planName    = (payload.planName    || clientFromDb?.plan_name || '').trim()

    const { data: settingsRow } = await supabaseClient
      .from('admin_content')
      .select('content')
      .eq('type', 'settings')
      .eq('admin_id', adminId)
      .maybeSingle()

    const cfg = settingsRow?.content as any
    const ADMIN_EMAIL = cfg?.adminEmail

    // ─── Config global compartilhada (super_admin) ─────────────────────────
    //
    // O super_admin configura UMA VEZ a chave Resend + domínio remetente
    // (em admin_content type='global_email_settings'). Todos os admins
    // (salões) usam essa config — eles só preenchem o `adminEmail` deles.
    //
    // A config própria do admin (cfg.resendApiKey / cfg.fromEmail) ainda
    // tem precedência se existir — escape hatch pra admin legacy que já
    // tinha configurado conta própria antes dessa mudança.
    const { data: superAdminRow } = await supabaseClient
      .from('admin_users')
      .select('id')
      .eq('role', 'super_admin')
      .limit(1)
      .maybeSingle()

    let globalResendKey: string | null = null
    let globalFromEmail: string | null = null

    if (superAdminRow?.id) {
      const { data: globalRow } = await supabaseClient
        .from('admin_content')
        .select('content')
        .eq('admin_id', superAdminRow.id)
        .eq('type', 'global_email_settings')
        .maybeSingle()

      const globalCfg = globalRow?.content as any
      globalResendKey = globalCfg?.resendApiKey || null
      globalFromEmail = globalCfg?.fromEmail || null
    }

    // Nome de exibição do remetente — cada usuário (admin OU super_admin) define o
    // próprio no settings. Fallback pra admins.nome (nome dado pelo super_admin ao
    // criar o admin) se o usuário ainda não preencheu o campo personalizado.
    //
    // A cliente vê: "<emailDisplayName> <contato@mariliasantoscolor.com.br>"
    // Ex: "Marília Color <contato@...>" ou "Salão da Fulana <contato@...>".
    let adminDisplayName = (cfg?.emailDisplayName || '').trim()

    if (!adminDisplayName) {
      const { data: thisAdminRow } = await supabaseClient
        .from('admin_users')
        .select('nome')
        .eq('id', adminId)
        .maybeSingle()
      adminDisplayName = (thisAdminRow?.nome || '').trim()
    }

    // Sempre usa a config GLOBAL do super_admin — sem escape hatch.
    // (A UI já esconde os campos resendApiKey/fromEmail no settings do admin,
    // mas valores legacy do banco poderiam interferir se respeitássemos `cfg`.)
    const RESEND_API_KEY = globalResendKey
    const FROM_EMAIL_BASE = globalFromEmail || 'onboarding@resend.dev'
    const FROM_EMAIL = buildFromHeader(adminDisplayName, FROM_EMAIL_BASE)

    // Nome de marca usado nos subjects, headers/footers de e-mail e PDF.
    // Genérico — vem do que o admin definir como `emailDisplayName`. Se vazio,
    // os e-mails e PDFs não exibem marca (fallback minimalista).
    const BRAND = adminDisplayName
    const BRAND_SUFFIX = BRAND ? ` - ${BRAND}` : ''
    const BRAND_PREFIX = BRAND ? `[${BRAND}] ` : ''

    // Wrapper que injeta o BRAND automaticamente em todas as chamadas de buildEmail.
    // Evita repetir BRAND como último argumento em cada uma das ~12 chamadas.
    const renderEmail = (title: string, greeting: string, body: string) =>
      buildEmail(title, greeting, body, BRAND)

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
      console.warn(`[${emailType}] E-mail nao configurado para admin ${adminId}. Pulando envio. (resendKey=${!!RESEND_API_KEY}, adminEmail=${!!ADMIN_EMAIL})`)
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

    const sendToClient = async (subject: string, html: string, attachments: any[] = []) => {
      if (!clientEmail) {
        console.warn(`[${emailType}] clientEmail vazio — envio pro cliente pulado. token=${payload.clientToken ?? 'NULL'}`)
        return
      }
      await send(clientEmail, subject, html, attachments)
    }

    // ============================================================
    // TIPO 1: CONTRATO ASSINADO
    // Envia PDF do contrato (com assinatura manuscrita + IP) para
    // cliente e admin via Resend.
    // ============================================================
    if (emailType === 'contract_signed') {
      const { signedAt, contractTitle, sections } = payload

      // Campos enviados pelo ClientSignup.tsx (corrigido)
      const contractIp           = (payload.ip             || '').trim()
      const contractSignatureUrl = (payload.signatureDataUrl || '').trim()

      const portalUrl     = sanitizePortalUrl(payload.portalUrl || '')
      const formattedDate = new Date(signedAt).toLocaleString('pt-BR', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })

      const title = contractTitle ?? 'CONTRATO DE PRESTACAO DE SERVICOS'
      let pdfBase64 = ''

      if (sections?.length) {
        const pdfBytes = await generateContractPDF(
          title,
          sections,
          clientName,
          clientEmail,
          planName,
          signedAt,
          contractIp           || undefined,
          contractSignatureUrl || undefined,
          BRAND,
        )
        let binary = ''
        for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i])
        pdfBase64 = btoa(binary)
      }

      const attachments = pdfBase64
        ? [{ filename: `Contrato - ${planName}.pdf`, content: pdfBase64 }]
        : []

      const subject = `Contrato de ${planName}${BRAND_SUFFIX}`

      const clientHtml = renderEmail(
        'Contrato Assinado',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-green">
          <p class="alert-green-title">&#10003; Contrato assinado com sucesso!</p>
          <p class="alert-green-text">O PDF do contrato esta anexo neste e-mail para seu registro.</p>
        </div>
        ${infoTable([
          ['Plano',       planName],
          ['Nome',        clientName],
          ['E-mail',      clientEmail],
          ['Assinado em', formattedDate],
          ...(contractIp ? [['IP', contractIp] as [string, string]] : []),
        ])}
        ${portalUrl
          ? `<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 0">Acompanhe o andamento da sua analise pelo portal:</p>${linkButton(portalUrl, 'Acessar meu portal')}`
          : ''
        }`
      )

      const adminHtml = renderEmail(
        'Nova Assinatura de Contrato',
        '&#128221; Nova cliente cadastrada!',
        `${infoTable([
          ['Cliente',     clientName],
          ['E-mail',      clientEmail],
          ['Plano',       planName],
          ['Assinado em', formattedDate],
          ...(contractIp ? [['IP', contractIp] as [string, string]] : []),
        ])}`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml, attachments),
        send(ADMIN_EMAIL, `${BRAND_PREFIX}Nova assinatura: ${clientName} - ${planName}`, adminHtml, attachments),
      ])
      logResults(results, 'contract_signed')
      return jsonResponse({ success: true, type: 'contract_signed' })
    }

    // ============================================================
    // TIPO 2: FOTOS FINALIZADAS (cliente submeteu fotos)
    // ============================================================
    if (emailType === 'photos_finalized') {
      const adminHtml = renderEmail(
        '📷 Fotos para Revisar',
        `<strong>${clientName}</strong> finalizou o envio de fotos e aguarda sua aprovacao.`,
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName]])}`
      )

      const results = await Promise.allSettled([
        send(ADMIN_EMAIL, `${BRAND_PREFIX}📷 Fotos para revisar: ${clientName}`, adminHtml),
      ])
      logResults(results, 'photos_finalized')
      return jsonResponse({ success: true, type: 'photos_finalized' })
    }

    // ============================================================
    // TIPO 3: ANALISE APROVADA (admin aprovou fotos + form)
    // ============================================================
    if (emailType === 'analysis_approved') {
      const { deadlineDate } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const formattedDeadline = deadlineDate
        ? new Date(deadlineDate + 'T12:00:00').toLocaleDateString('pt-BR', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            timeZone: 'America/Sao_Paulo',
          })
        : ''

      const subject = `Sua analise foi aprovada!${BRAND_SUFFIX}`

      const clientHtml = renderEmail(
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
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'analysis_approved')
      return jsonResponse({ success: true, type: 'analysis_approved' })
    }

    // ============================================================
    // TIPO 4: AJUSTE SOLICITADO (admin rejeitou fotos e/ou form)
    // ============================================================
    if (emailType === 'analysis_rejected') {
      const { rejectPhotos, photosReason, rejectForm, formReason } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const subject = `Ajuste necessario na sua analise${BRAND_SUFFIX}`

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

      const clientHtml = renderEmail(
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
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'analysis_rejected')
      return jsonResponse({ success: true, type: 'analysis_rejected' })
    }

    // ============================================================
    // TIPO 5b: RESULTADO PARCIAL LIBERADO (prévia durante simulações)
    // ============================================================
    if (emailType === 'partial_result_released') {
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')
      const subject   = `Prévia do seu resultado disponível${BRAND_SUFFIX}`

      const clientHtml = renderEmail(
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
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'partial_result_released')
      return jsonResponse({ success: true, type: 'partial_result_released' })
    }

    // ============================================================
    // TIPO 5: RESULTADO FINAL LIBERADO
    // ============================================================
    if (emailType === 'result_released') {
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')
      const subject   = `Sua analise ${planName} esta pronta!${BRAND_SUFFIX}`

      const clientHtml = renderEmail(
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
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'result_released')
      return jsonResponse({ success: true, type: 'result_released' })
    }

    // ============================================================
    // TIPO 6: FOTOS APROVADAS
    // ============================================================
    if (emailType === 'photos_approved') {
      const { deadlineDate } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const formattedDeadline = deadlineDate
        ? new Date(deadlineDate + 'T12:00:00').toLocaleDateString('pt-BR', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            timeZone: 'America/Sao_Paulo',
          })
        : ''

      const subject = `Suas fotos foram aprovadas!${BRAND_SUFFIX}`

      const clientHtml = renderEmail(
        'Fotos Aprovadas!',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-green">
          <p class="alert-green-title">&#10003; Suas fotos foram aprovadas!</p>
          <p class="alert-green-text">Tudo certo por aqui. Sua analise ja está em andamento.</p>
        </div>
        ${formattedDeadline ? `
        <div class="alert-yellow">
          <p class="alert-yellow-title">&#128197; Previsao de entrega</p>
          <p class="alert-yellow-value">${formattedDeadline}</p>
          <p class="alert-yellow-sub">Prazo calculado em dias uteis. Voce recebera um aviso quando o resultado estiver pronto.</p>
        </div>` : ''}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 4px">Acompanhe o andamento da sua analise pelo portal:</p>
        ${linkButton(portalUrl, 'Acompanhar minha analise')}
        <p class="small-center">Qualquer duvida, entre em contato com a consultora.</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'photos_approved')
      return jsonResponse({ success: true, type: 'photos_approved' })
    }

    // ============================================================
    // TIPO 7: FOTOS REJEITADAS
    // ============================================================
    if (emailType === 'photos_rejected') {
      const { reason } = payload
      const portalUrl  = sanitizePortalUrl(payload.portalUrl || '')
      const subject    = `Suas fotos precisam de um ajuste${BRAND_SUFFIX}`

      const clientHtml = renderEmail(
        'Ajuste nas Fotos',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-amber">
          <p class="alert-amber-title">&#9888;&#65039; Precisamos de um ajuste nas suas fotos</p>
          <p class="alert-amber-text">Nao se preocupe — suas fotos atuais estao salvas. Acesse o portal e substitua apenas o que for solicitado abaixo.</p>
        </div>
        <div class="rejection-box rejection-purple">
          <p class="rejection-type rejection-type-purple">&#128247; Motivo do ajuste</p>
          <p class="rejection-reason">${reason}</p>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">Acesse o portal para enviar as novas fotos:</p>
        ${linkButton(portalUrl, 'Acessar portal e corrigir')}
        <p class="small-center">Apos o reenvio, suas fotos serao revisadas novamente.</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'photos_rejected')
      return jsonResponse({ success: true, type: 'photos_rejected' })
    }

    // ============================================================
    // TIPO 8: FORMULARIO REJEITADO
    // ============================================================
    if (emailType === 'form_rejected') {
      const { reason } = payload
      const portalUrl  = sanitizePortalUrl(payload.portalUrl || '')
      const subject    = `Seu formulario precisa de um ajuste${BRAND_SUFFIX}`

      const clientHtml = renderEmail(
        'Ajuste no Formulario',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-amber">
          <p class="alert-amber-title">&#9888;&#65039; Precisamos de um ajuste no seu formulario</p>
          <p class="alert-amber-text">Nao se preocupe — seus dados estao salvos. Acesse o portal e corrija apenas o que for solicitado abaixo.</p>
        </div>
        <div class="rejection-box rejection-blue">
          <p class="rejection-type rejection-type-blue">&#128203; Motivo do ajuste</p>
          <p class="rejection-reason">${reason}</p>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">Acesse o portal para realizar a correcao:</p>
        ${linkButton(portalUrl, 'Acessar portal e corrigir')}
        <p class="small-center">Apos a correcao, o formulario sera reenviado automaticamente para revisao.</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'form_rejected')
      return jsonResponse({ success: true, type: 'form_rejected' })
    }

    // ============================================================
    // TIPO 9: AMBOS REJEITADOS (fotos + form)
    // ============================================================
    if (emailType === 'both_rejected') {
      const { formReason, photosReason } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')
      const subject   = `Ajustes necessarios na sua analise${BRAND_SUFFIX}`

      const clientHtml = renderEmail(
        'Ajustes Necessarios',
        `Ola, <strong>${clientName}</strong>!`,
        `<div class="alert-amber">
          <p class="alert-amber-title">&#9888;&#65039; Precisamos de alguns ajustes antes de continuar</p>
          <p class="alert-amber-text">Nao se preocupe — seus dados estao salvos. Acesse o portal e corrija apenas o que for solicitado abaixo.</p>
        </div>
        ${photosReason ? `
        <div class="rejection-box rejection-purple">
          <p class="rejection-type rejection-type-purple">&#128247; Ajuste nas fotos</p>
          <p class="rejection-reason">${photosReason}</p>
        </div>` : ''}
        ${formReason ? `
        <div class="rejection-box rejection-blue">
          <p class="rejection-type rejection-type-blue">&#128203; Ajuste no formulario</p>
          <p class="rejection-reason">${formReason}</p>
        </div>` : ''}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">Acesse o portal para realizar os ajustes:</p>
        ${linkButton(portalUrl, 'Acessar portal e corrigir')}
        <p class="small-center">Apos os ajustes, o envio sera feito automaticamente para nova revisao.</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'both_rejected')
      return jsonResponse({ success: true, type: 'both_rejected' })
    }

    // ============================================================
    // ALIAS: photos_submitted → mesmo comportamento de photos_finalized
    // ============================================================
    if (emailType === 'photos_submitted') {
      const adminPanelUrl = sanitizePortalUrl(payload.adminPanelUrl || '')
      const adminHtml = renderEmail(
        '📷 Fotos para Revisar',
        `<strong>${clientName}</strong> finalizou o envio de fotos e aguarda sua aprovacao.`,
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName]])}
        ${adminPanelUrl ? '<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">Acesse o painel para revisar e aprovar:</p>' + linkButton(adminPanelUrl, 'Revisar fotos no painel') : ''}`
      )

      const results = await Promise.allSettled([
        send(ADMIN_EMAIL, `${BRAND_PREFIX}📷 Fotos para revisar: ${clientName}`, adminHtml),
      ])
      logResults(results, 'photos_submitted')
      return jsonResponse({ success: true, type: 'photos_submitted' })
    }

    // ============================================================
    // TIPO 12: FOTO PARA SIMULAÇÃO (IA) ENVIADA
    // ============================================================
    if (emailType === 'ai_photo_submitted') {
      const adminPanelUrl = sanitizePortalUrl(payload.adminPanelUrl || '')
      const adminHtml = renderEmail(
        '✨ Foto para simulação enviada',
        `<strong>${clientName}</strong> enviou a foto para a simulação. A consultora deve validar antes de avançar para "Simulações".`,
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName]])}
        ${adminPanelUrl ? '<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">Acesse o painel para validar a foto:</p>' + linkButton(adminPanelUrl, 'Validar foto no painel') : ''}`
      )

      const results = await Promise.allSettled([
        send(ADMIN_EMAIL, `${BRAND_PREFIX}✨ Foto IA para validar: ${clientName}`, adminHtml),
      ])
      logResults(results, 'ai_photo_submitted')
      return jsonResponse({ success: true, type: 'ai_photo_submitted' })
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