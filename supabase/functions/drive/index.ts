// supabase/functions/drive/index.ts
//
// Edge Function única para integração com Google Drive.
// Rotas (path após /functions/v1/drive):
//
//   POST /start        — admin: gera URL de autorização OAuth
//   GET  /callback     — Google → recebe code, troca por tokens, salva
//   GET  /status       — admin: retorna se está conectado
//   POST /disconnect   — admin: remove credenciais
//   POST /set-root     — admin: define pasta raiz no Drive
//   POST /upload       — cliente (portal_token) ou admin (kind=admin_photo|composition + JWT): envia foto pro Drive
//   GET  /photo-proxy  — admin (JWT): proxy de download de foto do Drive sem CORS
//   POST /cleanup      — cron: apaga pastas de clientes finalizados há 21+ dias
//
// Env vars necessárias:
//   SUPABASE_URL              (auto)
//   SUPABASE_SERVICE_ROLE_KEY (auto)
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   CLEANUP_SECRET            (string aleatória, qualquer coisa)

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DRIVE_API     = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD  = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME   = 'application/vnd.google-apps.folder'

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-token',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE',
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function adminSb(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}

async function getAuthUser(req: Request) {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const { data, error } = await sb.auth.getUser(auth.slice(7))
  if (error || !data.user) return null
  return data.user
}

function sanitizeFolderName(name: string): string {
  return name.trim().replace(/[\/\\]/g, '-').replace(/\s+/g, ' ').slice(0, 200) || 'cliente'
}

// ─── Google OAuth ──────────────────────────────────────────────────────────

async function exchangeCode(code: string, redirectUri: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  })
  if (!r.ok) throw new Error(`OAuth exchange: ${r.status} ${await r.text()}`)
  return r.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>
}

async function refresh(refreshToken: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      grant_type:    'refresh_token',
    }),
  })
  if (!r.ok) throw new Error(`OAuth refresh: ${r.status} ${await r.text()}`)
  return r.json() as Promise<{ access_token: string; expires_in: number }>
}

async function getAdminToken(sb: SupabaseClient, adminId: string) {
  const { data: c } = await sb
    .from('admin_drive_credentials')
    .select('refresh_token, access_token, access_token_expires_at, root_folder_id')
    .eq('admin_id', adminId)
    .maybeSingle()
  if (!c) throw new Error('Admin não conectou o Google Drive')

  const exp = c.access_token_expires_at ? new Date(c.access_token_expires_at).getTime() : 0
  if (c.access_token && exp > Date.now() + 60_000) {
    return { accessToken: c.access_token, rootFolderId: c.root_folder_id }
  }

  const r = await refresh(c.refresh_token)
  const newExp = new Date(Date.now() + r.expires_in * 1000).toISOString()
  await sb.from('admin_drive_credentials').update({
    access_token: r.access_token,
    access_token_expires_at: newExp,
    updated_at: new Date().toISOString(),
  }).eq('admin_id', adminId)

  return { accessToken: r.access_token, rootFolderId: c.root_folder_id }
}

async function fetchUserEmail(token: string): Promise<string> {
  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!r.ok) throw new Error(`userinfo: ${r.status}`)
  const j = await r.json()
  return j.email
}

// ─── Drive API ──────────────────────────────────────────────────────────────

async function findOrCreateFolder(token: string, name: string, parentId: string | null, makePublic = false): Promise<string> {
  const escaped = name.replace(/'/g, "\\'")
  const q = [
    `mimeType='${FOLDER_MIME}'`,
    `name='${escaped}'`,
    'trashed=false',
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean).join(' and ')

  const sr = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!sr.ok) throw new Error(`Drive search: ${sr.status} ${await sr.text()}`)
  const sj = await sr.json() as { files: { id: string }[] }
  if (sj.files?.length) return sj.files[0].id

  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME }
  if (parentId) body.parents = [parentId]

  const cr = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!cr.ok) throw new Error(`Drive create folder: ${cr.status} ${await cr.text()}`)
  const cj = await cr.json() as { id: string }

  if (makePublic) await makeAnyoneReader(token, cj.id)
  return cj.id
}

async function makeAnyoneReader(token: string, fileId: string): Promise<void> {
  const r = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
  if (!r.ok && r.status !== 409) {  // 409 = já tem permissão
    throw new Error(`Drive perms: ${r.status} ${await r.text()}`)
  }
}

async function uploadToDrive(token: string, opts: {
  name: string; mimeType: string; parents: string[]; body: Uint8Array
}): Promise<{ id: string }> {
  const boundary = '----b' + Math.random().toString(36).slice(2)
  const enc = new TextEncoder()
  const meta = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: opts.name, mimeType: opts.mimeType, parents: opts.parents })}\r\n`)
  const dataStart = enc.encode(`--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`)
  const end = enc.encode(`\r\n--${boundary}--`)

  const merged = new Uint8Array(meta.length + dataStart.length + opts.body.length + end.length)
  let off = 0
  merged.set(meta, off); off += meta.length
  merged.set(dataStart, off); off += dataStart.length
  merged.set(opts.body, off); off += opts.body.length
  merged.set(end, off)

  const r = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: merged,
  })
  if (!r.ok) throw new Error(`Drive upload: ${r.status} ${await r.text()}`)
  return r.json()
}

async function deleteFromDrive(token: string, fileId: string): Promise<void> {
  const r = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!r.ok && r.status !== 404) throw new Error(`Drive delete: ${r.status} ${await r.text()}`)
}

// ─── HTML do popup OAuth ────────────────────────────────────────────────────

function popupCloser(result: { ok: boolean; error?: string; googleEmail?: string }) {
  const safe = JSON.stringify(result).replace(/</g, '\\u003c')
  return `<!doctype html><meta charset="utf-8"><title>Drive</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;color:#111827;padding:40px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{color:#6b7280;font-size:14px}</style>
<h1>${result.ok ? '✓ Drive conectado!' : '✗ Falha ao conectar'}</h1>
<p>${result.ok ? 'Esta janela vai fechar automaticamente.' : (result.error || 'Tente novamente.')}</p>
<script>
(function(){
  var d=${safe};
  try{ if(window.opener) window.opener.postMessage({type:'drive-oauth',payload:d},'*'); }catch(e){}
  setTimeout(function(){ try{window.close()}catch(e){} },1500);
})();
</script>`
}

// ─── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const path = url.pathname.replace(/^.*\/drive/, '') || '/'

  try {
    // ─── POST /start ───────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/start') {
      const user = await getAuthUser(req)
      if (!user) return json({ error: 'Não autenticado' }, 401)

      const redirectUri = `${env('SUPABASE_URL')}/functions/v1/drive/callback`

      // Recebe a origem do app para redirecionar o popup de volta após OAuth.
      // Isso contorna o COOP do Google/Supabase: o popup termina no mesmo domínio
      // do opener, sem nenhuma restrição cross-origin.
      const body = await req.json().catch(() => ({})) as { appOrigin?: string }
      const appOrigin = (body.appOrigin && /^https?:\/\/[^/\s]+$/.test(body.appOrigin))
        ? body.appOrigin : ''

      // Codifica appOrigin no state (sem alterar schema do DB).
      const uuid  = crypto.randomUUID()
      const state = appOrigin ? `${uuid}|${encodeURIComponent(appOrigin)}` : uuid

      const sb = adminSb()
      const { error } = await sb.from('admin_drive_oauth_state').insert({ state, admin_id: user.id })
      if (error) return json({ error: error.message }, 500)

      const params = new URLSearchParams({
        client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
      })
      return json({ authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
    }

    // ─── GET /callback ─────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/callback') {
      const code  = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const err   = url.searchParams.get('error')

      if (err)              return html(popupCloser({ ok: false, error: err }))
      if (!code || !state)  return html(popupCloser({ ok: false, error: 'missing code/state' }))

      const sb = adminSb()
      const { data: stateRow } = await sb
        .from('admin_drive_oauth_state')
        .select('admin_id, expires_at')
        .eq('state', state)
        .maybeSingle()
      if (!stateRow) return html(popupCloser({ ok: false, error: 'state inválido' }))
      if (new Date(stateRow.expires_at).getTime() < Date.now()) {
        await sb.from('admin_drive_oauth_state').delete().eq('state', state)
        return html(popupCloser({ ok: false, error: 'state expirado' }))
      }
      await sb.from('admin_drive_oauth_state').delete().eq('state', state)

      const redirectUri = `${env('SUPABASE_URL')}/functions/v1/drive/callback`
      const tokens = await exchangeCode(code, redirectUri)
      if (!tokens.refresh_token) {
        return html(popupCloser({ ok: false, error: 'Google não retornou refresh_token. Revogue em myaccount.google.com/permissions e tente de novo.' }))
      }

      const email = await fetchUserEmail(tokens.access_token)
      await sb.from('admin_drive_credentials').upsert({
        admin_id: stateRow.admin_id,
        google_email: email,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'admin_id' })

      // Redireciona o popup de volta ao app com ?drive_connected=1.
      // O app detecta esse param e fecha a janela — sem COOP, sem HTML cru.
      const [, encodedOrigin] = state.split('|')
      const appOrigin = encodedOrigin ? decodeURIComponent(encodedOrigin) : ''
      if (appOrigin) {
        return Response.redirect(`${appOrigin}?drive_connected=1`, 302)
      }
      return html(popupCloser({ ok: true, googleEmail: email }))
    }

    // ─── GET /status ───────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/status') {
      const user = await getAuthUser(req)
      if (!user) return json({ error: 'Não autenticado' }, 401)

      const sb = adminSb()
      const { data } = await sb
        .from('admin_drive_credentials')
        .select('google_email, root_folder_id, root_folder_name, connected_at')
        .eq('admin_id', user.id)
        .maybeSingle()

      return json({
        connected:      !!data,
        googleEmail:    data?.google_email     ?? null,
        rootFolderId:   data?.root_folder_id   ?? null,
        rootFolderName: data?.root_folder_name ?? null,
        connectedAt:    data?.connected_at     ?? null,
      })
    }

    // ─── POST /disconnect ──────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/disconnect') {
      const user = await getAuthUser(req)
      if (!user) return json({ error: 'Não autenticado' }, 401)
      const sb = adminSb()
      await sb.from('admin_drive_credentials').delete().eq('admin_id', user.id)
      return json({ ok: true })
    }

    // ─── POST /set-root ────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/set-root') {
      const user = await getAuthUser(req)
      if (!user) return json({ error: 'Não autenticado' }, 401)
      const { rootFolderId, rootFolderName } = await req.json() as { rootFolderId: string | null; rootFolderName: string | null }
      const sb = adminSb()
      await sb.from('admin_drive_credentials').update({
        root_folder_id: rootFolderId,
        root_folder_name: rootFolderName,
        updated_at: new Date().toISOString(),
      }).eq('admin_id', user.id)
      return json({ ok: true })
    }

    // ─── POST /upload ──────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/upload') {
      const form       = await req.formData()
      const kind       = String(form.get('kind') ?? 'photo') as 'photo' | 'ai_photo' | 'result_file' | 'form_image' | 'admin_photo' | 'composition' | 'ms_color_ia' | 'ms_color_ia_ref'
      const categoryId = form.get('category_id') ? String(form.get('category_id')) : null
      const file       = form.get('file') as File | null

      if (!(file instanceof File)) return json({ error: 'file obrigatório' }, 400)

      const sb = adminSb()

      // ── Caminho composition (kind='composition') ───────────────────────
      // Autenticado via JWT do admin. Pra composições IA: sobe o PNG
      // gerado na subpasta "Composições IA" dentro da pasta do cliente.
      // NÃO faz insert em client_photos — composições são material
      // intermediário de sessão (várias páginas pra montar um PDF),
      // não fotos de galeria do cliente.
      if (kind === 'composition') {
        const authUser = await getAuthUser(req)
        if (!authUser) return json({ error: 'Não autenticado' }, 401)

        const clientId = form.get('client_id') ? String(form.get('client_id')) : null
        if (!clientId) return json({ error: 'client_id obrigatório' }, 400)

        // Opcional — só pra ajudar a debugar / agrupar arquivos no Drive.
        const compositionIndex = form.get('composition_index')
          ? Math.max(0, Math.floor(Number(form.get('composition_index')) || 0))
          : 0

        const { data: client } = await sb
          .from('clients')
          .select('id, admin_id, full_name, drive_folder_id')
          .eq('id', clientId)
          .maybeSingle()
        if (!client) return json({ error: 'Cliente não encontrado' }, 404)
        if (client.admin_id !== authUser.id) return json({ error: 'Acesso negado' }, 403)

        let accessToken: string, rootFolderId: string | null
        try {
          const t = await getAdminToken(sb, authUser.id)
          accessToken  = t.accessToken
          rootFolderId = t.rootFolderId
        } catch (e: any) {
          return json({ error: e.message }, 412)
        }

        // Pasta do cliente (mesma lógica dos outros kinds)
        let clientFolderId = client.drive_folder_id
        if (!clientFolderId) {
          const folderName = sanitizeFolderName(client.full_name || `cliente-${client.id}`)
          clientFolderId = await findOrCreateFolder(accessToken, folderName, rootFolderId, /* makePublic */ true)
          await sb.from('clients').update({ drive_folder_id: clientFolderId }).eq('id', client.id)
        }

        // Subpasta dedicada às composições — agrupa pra ficar organizado no Drive.
        const compFolderId = await findOrCreateFolder(accessToken, 'Composições IA', clientFolderId, false)

        const idxStr   = String(compositionIndex).padStart(3, '0')
        const safeName = `${Date.now()}_${idxStr}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const bytes    = new Uint8Array(await file.arrayBuffer())

        const uploaded = await uploadToDrive(accessToken, {
          name:     safeName,
          mimeType: file.type || 'image/png',
          parents:  [compFolderId],
          body:     bytes,
        })
        // Permissão pública: mesmo padrão das fotos do cliente. Permite
        // <img src="drive.google.com/thumbnail?id=..."> sem precisar passar
        // pelo /photo-proxy autenticado pra cada preview.
        await makeAnyoneReader(accessToken, uploaded.id)

        return json({
          ok:            true,
          driveFileId:   uploaded.id,
          driveFolderId: compFolderId,
          photoName:     safeName,
          url:           `https://drive.google.com/thumbnail?id=${uploaded.id}&sz=w2000`,
          downloadUrl:   `https://drive.google.com/uc?export=download&id=${uploaded.id}`,
        })
      }

      // ── Caminho admin (kind='admin_photo') ─────────────────────────────
      // Autenticado via JWT do admin; usa client_id diretamente; insere em
      // client_photos sem passar pelo RPC save_client_photo_drive (que checa
      // status da cliente e bloquearia uploads fora da janela de envio).
      if (kind === 'admin_photo') {
        const authUser = await getAuthUser(req)
        if (!authUser) return json({ error: 'Não autenticado' }, 401)

        const clientId = form.get('client_id') ? String(form.get('client_id')) : null
        if (!clientId) return json({ error: 'client_id obrigatório' }, 400)

        const { data: client } = await sb
          .from('clients')
          .select('id, admin_id, full_name, drive_folder_id')
          .eq('id', clientId)
          .maybeSingle()
        if (!client) return json({ error: 'Cliente não encontrado' }, 404)
        if (client.admin_id !== authUser.id) return json({ error: 'Acesso negado' }, 403)

        // Tenta conectar ao Drive; se não estiver configurado, usa Supabase Storage
        let accessToken: string | null = null
        let rootFolderId: string | null = null
        try {
          const t = await getAdminToken(sb, authUser.id)
          accessToken  = t.accessToken
          rootFolderId = t.rootFolderId
        } catch {
          // Drive não conectado — continua sem ele (cai no fallback abaixo)
        }

        const safeName = `${Date.now()}_admin_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const bytes    = new Uint8Array(await file.arrayBuffer())

        // ── Caminho Drive ──────────────────────────────────────────────────
        if (accessToken) {
          let clientFolderId = client.drive_folder_id
          if (!clientFolderId) {
            const folderName = sanitizeFolderName(client.full_name || `cliente-${client.id}`)
            clientFolderId = await findOrCreateFolder(accessToken, folderName, rootFolderId, /* makePublic */ true)
            await sb.from('clients').update({ drive_folder_id: clientFolderId }).eq('id', client.id)
          }

          const uploaded = await uploadToDrive(accessToken, {
            name:     safeName,
            mimeType: file.type || 'application/octet-stream',
            parents:  [clientFolderId],
            body:     bytes,
          })
          await makeAnyoneReader(accessToken, uploaded.id)

          const { error: insErr } = await sb.from('client_photos').insert({
            client_id:     client.id,
            photo_name:    safeName,
            photo_type:    file.type,
            photo_size:    file.size,
            drive_file_id: uploaded.id,
            category_id:   categoryId,
          })
          if (insErr) {
            try { await deleteFromDrive(accessToken, uploaded.id) } catch {}
            return json({ error: insErr.message }, 500)
          }

          return json({
            ok:            true,
            driveFileId:   uploaded.id,
            driveFolderId: clientFolderId,
            photoName:     safeName,
            url:           `https://drive.google.com/thumbnail?id=${uploaded.id}&sz=w2000`,
            downloadUrl:   `https://drive.google.com/uc?export=download&id=${uploaded.id}`,
          })
        }

        // ── Fallback: Supabase Storage (Drive não configurado) ─────────────
        // Usa service role key → bypassa qualquer RLS policy
        const storagePath = `${client.id}/${safeName}`
        const { error: storageErr } = await sb.storage
          .from('client-photos')
          .upload(storagePath, bytes, { contentType: file.type || 'application/octet-stream', upsert: true })
        if (storageErr) return json({ error: storageErr.message }, 500)

        const { data: { publicUrl } } = sb.storage.from('client-photos').getPublicUrl(storagePath)

        const { error: insErr } = await sb.from('client_photos').insert({
          client_id:    client.id,
          photo_name:   safeName,
          photo_type:   file.type,
          photo_size:   file.size,
          storage_path: storagePath,
          category_id:  categoryId,
        })
        if (insErr) return json({ error: insErr.message }, 500)

        return json({
          ok:            true,
          driveFileId:   null,
          driveFolderId: null,
          photoName:     safeName,
          url:           publicUrl,
          downloadUrl:   publicUrl,
        })
      }

      // ── Caminho MS Color IA (kind='ms_color_ia') ───────────────────────
      // Autenticado via JWT do admin; sem cliente vinculado.
      // Cria/reutiliza uma pasta fixa "MS Color IA" dentro da pasta raiz
      // do admin no Drive. Não insere em client_photos.
      if (kind === 'ms_color_ia') {
        const authUser = await getAuthUser(req)
        if (!authUser) return json({ error: 'Não autenticado' }, 401)

        let accessToken: string, rootFolderId: string | null
        try {
          const t = await getAdminToken(sb, authUser.id)
          accessToken  = t.accessToken
          rootFolderId = t.rootFolderId
        } catch (e: any) {
          return json({ error: e.message }, 412)
        }

        const iaFolderId = await findOrCreateFolder(accessToken, 'MS Color IA', rootFolderId, false)

        const safeName = `${Date.now()}_ia_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const bytes    = new Uint8Array(await file.arrayBuffer())
        const uploaded = await uploadToDrive(accessToken, {
          name:     safeName,
          mimeType: file.type || 'image/png',
          parents:  [iaFolderId],
          body:     bytes,
        })
        // Sem makeAnyoneReader: imagens são exibidas via /photo-proxy autenticado
        // (mesmo padrão das fotos de referência do admin).

        return json({
          ok:            true,
          driveFileId:   uploaded.id,
          driveFolderId: iaFolderId,
          photoName:     safeName,
          url:           `https://drive.google.com/thumbnail?id=${uploaded.id}&sz=w2000`,
          downloadUrl:   `https://drive.google.com/uc?export=download&id=${uploaded.id}`,
        })
      }

      // ── Caminho MS Color IA Ref (kind='ms_color_ia_ref') ──────────────────
      // Foto de referência do admin nos planos avulsos (chat_admin / full_admin).
      // Salva numa subpasta fixa "Fotos de referência" dentro de "MS Color IA".
      // Suporta replace_file_id para sobrescrever a foto anterior no Drive sem
      // acumular arquivos. Não toca no Supabase Storage. Retorna o driveFileId
      // que o front persiste em admin_content (settings) para recarregar depois.
      if (kind === 'ms_color_ia_ref') {
        const authUser = await getAuthUser(req)
        if (!authUser) return json({ error: 'Não autenticado' }, 401)

        let accessToken: string, rootFolderId: string | null
        try {
          const t = await getAdminToken(sb, authUser.id)
          accessToken  = t.accessToken
          rootFolderId = t.rootFolderId
        } catch (e: any) {
          return json({ error: e.message }, 412)
        }

        // Cria/reutiliza: Drive raiz → "MS Color IA" → "Fotos de referência"
        const iaFolderId  = await findOrCreateFolder(accessToken, 'MS Color IA', rootFolderId, false)
        const refFolderId = await findOrCreateFolder(accessToken, 'Fotos de referência', iaFolderId, false)

        // Apaga o arquivo anterior se fornecido (replace_file_id)
        const replaceFileId = form.get('replace_file_id') ? String(form.get('replace_file_id')) : null
        if (replaceFileId) {
          try { await deleteFromDrive(accessToken, replaceFileId) } catch {}
        }

        const safeName = `ref_photo_${Date.now()}.jpg`
        const bytes    = new Uint8Array(await file.arrayBuffer())
        const uploaded = await uploadToDrive(accessToken, {
          name:     safeName,
          mimeType: 'image/jpeg',
          parents:  [refFolderId],
          body:     bytes,
        })
        // Sem makeAnyoneReader — acesso via /photo-proxy autenticado (JWT do admin)

        return json({
          ok:            true,
          driveFileId:   uploaded.id,
          driveFolderId: refFolderId,
          photoName:     safeName,
          url:           `https://drive.google.com/thumbnail?id=${uploaded.id}&sz=w2000`,
          downloadUrl:   `https://drive.google.com/uc?export=download&id=${uploaded.id}`,
        })
      }

      // ── Caminho cliente (portal_token) ─────────────────────────────────
      const portalToken = String(form.get('portal_token') ?? '')
      if (!portalToken) return json({ error: 'portal_token obrigatório' }, 400)

      const { data: client } = await sb
        .from('clients')
        .select('id, admin_id, full_name, drive_folder_id')
        .eq('token', portalToken)
        .maybeSingle()
      if (!client) return json({ error: 'Token inválido' }, 401)

      let accessToken: string, rootFolderId: string | null
      try {
        const t = await getAdminToken(sb, client.admin_id)
        accessToken  = t.accessToken
        rootFolderId = t.rootFolderId
      } catch (e: any) {
        return json({ error: e.message }, 412)
      }

      // Pasta do cliente (com permissão pública). Se já existe, reusa.
      let clientFolderId = client.drive_folder_id
      if (!clientFolderId) {
        const folderName = sanitizeFolderName(client.full_name || `cliente-${client.id}`)
        clientFolderId = await findOrCreateFolder(accessToken, folderName, rootFolderId, /* makePublic */ true)
        await sb.from('clients').update({ drive_folder_id: clientFolderId }).eq('id', client.id)
      }

      // Resultados e imagens de formulário vão em subpastas separadas dentro do cliente
      let targetFolderId = clientFolderId
      if (kind === 'result_file') {
        targetFolderId = await findOrCreateFolder(accessToken, 'Resultados', clientFolderId, false)
      } else if (kind === 'form_image') {
        targetFolderId = await findOrCreateFolder(accessToken, 'Formulário', clientFolderId, false)
      }

      const safeName = `${Date.now()}_${kind === 'ai_photo' ? 'ai_' : ''}${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const bytes    = new Uint8Array(await file.arrayBuffer())
      const uploaded = await uploadToDrive(accessToken, {
        name:     safeName,
        mimeType: file.type || 'application/octet-stream',
        parents:  [targetFolderId],
        body:     bytes,
      })

      // Registra no DB
      if (kind === 'photo' || kind === 'ai_photo') {
        const { data: rpcData, error: rpcErr } = await sb.rpc('save_client_photo_drive', {
          p_token:         portalToken,
          p_photo_name:    safeName,
          p_photo_type:    file.type,
          p_photo_size:    file.size,
          p_drive_file_id: uploaded.id,
          p_category_id:   categoryId,
          p_is_ai_photo:   kind === 'ai_photo',
        })
        if (rpcErr || rpcData?.error) {
          try { await deleteFromDrive(accessToken, uploaded.id) } catch {}
          return json({ error: rpcErr?.message ?? rpcData?.error }, 500)
        }
      } else if (kind === 'result_file') {
        const { error: insErr } = await sb.from('client_result_files').insert({
          client_id:     client.id,
          file_name:     file.name,
          file_size:     file.size,
          drive_file_id: uploaded.id,
          storage_path:  null,
        })
        if (insErr) {
          try { await deleteFromDrive(accessToken, uploaded.id) } catch {}
          return json({ error: insErr.message }, 500)
        }
      }

      // ── Tornar público arquivos acessados via URL direta pelo cliente ───
      //
      // Resultados (PDF/áudio/foto) e imagens de formulário são apresentados
      // pra cliente no ClientPortal, que NÃO tem auth. Por isso o arquivo
      // precisa ser publicamente acessível por link — caso contrário <audio>
      // e <img src=drive.google.com/...> falham com 403. PDFs funcionam mesmo
      // sem isso porque abrem via window.open() (Drive serve a página de
      // download), mas áudio/imagem inline exigem permission anyone:reader.
      if (kind === 'result_file' || kind === 'form_image') {
        try { await makeAnyoneReader(accessToken, uploaded.id) } catch (e) {
          console.warn(`[drive] makeAnyoneReader (${kind}) falhou:`, e)
        }
      }

      // URL pública pra exibir direto no <img>
      const viewUrl     = `https://drive.google.com/thumbnail?id=${uploaded.id}&sz=w2000`
      const downloadUrl = `https://drive.google.com/uc?export=download&id=${uploaded.id}`

      return json({
        ok:           true,
        driveFileId:  uploaded.id,
        driveFolderId: targetFolderId,
        photoName:    safeName,
        url:          viewUrl,
        downloadUrl,
      })
    }

    // ─── GET /audio-proxy ──────────────────────────────────────────────────
    // Proxy de áudio para o ClientPortal (sem JWT — usa portal_token).
    // O <audio> nativo não envia cabeçalhos de auth, então não podemos usar
    // /photo-proxy (que exige JWT). Aqui validamos pelo portal_token da cliente
    // e buscamos o arquivo do Drive com o token OAuth do admin dono.
    if (req.method === 'GET' && path === '/audio-proxy') {
      const portalToken = url.searchParams.get('token')
      const fileId      = url.searchParams.get('id')

      if (!portalToken) return json({ error: 'token obrigatório' }, 400)
      if (!fileId)      return json({ error: 'id obrigatório' }, 400)

      const sb = adminSb()

      const { data: client } = await sb
        .from('clients')
        .select('id, admin_id')
        .eq('token', portalToken)
        .maybeSingle()
      if (!client) return json({ error: 'Token inválido' }, 401)

      // Verifica que o drive_file_id realmente pertence a um arquivo de resultado
      // desta cliente — evita usar o proxy como gateway aberto pro Drive.
      const { data: resultFile } = await sb
        .from('client_result_files')
        .select('id')
        .eq('client_id', client.id)
        .eq('drive_file_id', fileId)
        .maybeSingle()
      if (!resultFile) return json({ error: 'Arquivo não encontrado' }, 404)

      let accessToken: string
      try {
        const t = await getAdminToken(sb, client.admin_id)
        accessToken = t.accessToken
      } catch (e: any) {
        return json({ error: e.message }, 412)
      }

      const driveRes = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!driveRes.ok) {
        return json({ error: `Drive: ${driveRes.status}` }, driveRes.status as number)
      }

      const contentType = driveRes.headers.get('content-type') || 'audio/mpeg'
      return new Response(driveRes.body, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type':  contentType,
          'Cache-Control': 'private, max-age=3600',
          'Accept-Ranges': 'bytes',
        },
      })
    }

    // ─── GET /photo-proxy ──────────────────────────────────────────────────
    // Proxy autenticado pra baixar fotos do Drive sem CORS no browser.
    // O browser não consegue fazer fetch() direto de drive.google.com
    // (CORS + auth), então o frontend passa o driveFileId e a Edge Function
    // busca com o access_token do admin e devolve o blob.
    // Usado por driveStorage.fetchPhotoBlob() — necessário pra evitar
    // "canvas tainted" ao desenhar a imagem no <canvas> da ferramenta de contraste.
    if (req.method === 'GET' && path === '/photo-proxy') {
      const user = await getAuthUser(req)
      if (!user) return json({ error: 'Não autenticado' }, 401)

      const fileId = url.searchParams.get('id')
      if (!fileId) return json({ error: 'id obrigatório' }, 400)

      const sb = adminSb()
      let accessToken: string
      try {
        const t = await getAdminToken(sb, user.id)
        accessToken = t.accessToken
      } catch (e: any) {
        return json({ error: e.message }, 412)
      }

      const driveRes = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!driveRes.ok) {
        return json({ error: `Drive: ${driveRes.status}` }, driveRes.status as number)
      }

      const contentType = driveRes.headers.get('content-type') || 'image/jpeg'
      return new Response(driveRes.body, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type':  contentType,
          'Cache-Control': 'private, max-age=300',
        },
      })
    }

 // ─── POST /replace-media ──────────────────────────────────────────────
if (req.method === 'POST' && path === '/replace-media') {
  const user = await getAuthUser(req)
  if (!user) return json({ error: 'Não autenticado' }, 401)

  const sb = adminSb()
  let accessToken: string
  try {
    const t = await getAdminToken(sb, user.id)
    accessToken = t.accessToken
  } catch (e: any) {
    return json({ error: e.message }, 412)
  }

  const form = await req.formData()
  const driveFileId = form.get('drive_file_id') as string | null
  const photoId     = form.get('photo_id')     as string | null
  const file        = form.get('file')         as File | null

  if (!driveFileId) return json({ error: 'drive_file_id obrigatório' }, 400)
  if (!photoId)     return json({ error: 'photo_id obrigatório' }, 400)
  if (!file)        return json({ error: 'file obrigatório' }, 400)

  // Busca a pasta pai do arquivo original no Drive
  const metaRes = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?fields=name,parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!metaRes.ok) return json({ error: `Drive meta: ${metaRes.status} ${await metaRes.text()}` }, 500)
  const meta = await metaRes.json() as { name: string; parents: string[] }

  const bytes    = new Uint8Array(await file.arrayBuffer())
  const mimeType = file.type || 'image/jpeg'

  // Faz upload do arquivo novo na mesma pasta com o mesmo nome
  const uploaded = await uploadToDrive(accessToken, {
    name:     meta.name,
    mimeType,
    parents:  meta.parents,
    body:     bytes,
  })

  // Apaga o arquivo antigo (best-effort — não bloqueia se falhar)
  try { await deleteFromDrive(accessToken, driveFileId) } catch {}

  // Atualiza drive_file_id no banco
  const { error: dbErr } = await sb
    .from('client_photos')
    .update({ drive_file_id: uploaded.id })
    .eq('id', photoId)
  if (dbErr) return json({ error: `DB update: ${dbErr.message}` }, 500)

  return json({ ok: true, driveFileId: uploaded.id })
}

    // ─── POST /cleanup ─────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/cleanup') {
      const secret = req.headers.get('x-cleanup-token')
      if (secret !== env('CLEANUP_SECRET')) return json({ error: 'Não autorizado' }, 401)

      const sb = adminSb()
      const { data: expired, error } = await sb
        .from('v_drive_expired_clients')
        .select('client_id, full_name, admin_id, drive_folder_id, released_at')
        .limit(100)
      if (error) return json({ error: error.message }, 500)

      const results: any[] = []
      // Agrupa por admin pra reusar access_token
      const byAdmin = new Map<string, typeof expired>()
      for (const row of expired || []) {
        const arr = byAdmin.get(row.admin_id) ?? []
        arr.push(row)
        byAdmin.set(row.admin_id, arr)
      }

      // ─── Flag por admin: limpeza automática ligada/desligada ────────────
      // Row admin_content type='drive_prefs' content {autoCleanup: boolean}.
      // Sem row ou sem o campo = LIGADA (comportamento atual preservado).
      // Vive em row próprio (não em 'settings') pra não ser sobrescrita pelo
      // save geral de configurações.
      const adminIds = [...byAdmin.keys()]
      const optedOut = new Set<string>()
      if (adminIds.length > 0) {
        const { data: prefsRows } = await sb
          .from('admin_content')
          .select('admin_id, content')
          .eq('type', 'drive_prefs')
          .in('admin_id', adminIds)
        for (const p of prefsRows || []) {
          if ((p as any).content?.autoCleanup === false) optedOut.add((p as any).admin_id)
        }
      }

      for (const [adminId, rows] of byAdmin) {
        if (optedOut.has(adminId)) {
          results.push({ adminId, skipped: rows.length, reason: 'limpeza automática desativada pelo admin' })
          continue
        }
        let accessToken: string
        try {
          const t = await getAdminToken(sb, adminId)
          accessToken = t.accessToken
        } catch (e: any) {
          results.push({ adminId, error: `auth: ${e.message}`, skipped: rows.length })
          continue
        }

        for (const r of rows) {
          try {
            await deleteFromDrive(accessToken, r.drive_folder_id)
          } catch (e: any) {
            results.push({ clientId: r.client_id, error: `drive: ${e.message}` })
            continue
          }
          await sb.from('clients').update({
            drive_folder_id: null,
            drive_purged_at: new Date().toISOString(),
          }).eq('id', r.client_id)
          await sb.from('client_photos').delete().eq('client_id', r.client_id)
          await sb.from('client_result_files').delete().eq('client_id', r.client_id)
          results.push({ clientId: r.client_id, fullName: r.full_name, purged: true })
        }
      }

      return json({ ok: true, purged: results.filter(r => r.purged).length, results })
    }

    return json({ error: 'Rota não encontrada' }, 404)
  } catch (e: any) {
    console.error('drive error:', e)
    return json({ error: e?.message ?? String(e) }, 500)
  }
})