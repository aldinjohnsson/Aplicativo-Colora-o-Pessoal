// src/lib/driveStorage.ts
//
// Wrapper das chamadas pra Edge Function única `drive`.

import { supabase } from './supabase'

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive`

export interface DriveStatus {
  connected:      boolean
  googleEmail:    string | null
  rootFolderId:   string | null
  rootFolderName: string | null
  connectedAt:    string | null
}

export interface DriveUploadResult {
  driveFileId:   string
  driveFolderId: string
  photoName:     string
  url:           string  // thumbnail URL pra <img src>
  downloadUrl:   string
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init.headers || {})
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(`${FN}${path}`, { ...init, headers })
}

export const driveStorage = {
  // ─── OAuth ─────────────────────────────────────────────────────────────

  async connect(): Promise<{ ok: true; googleEmail: string } | { ok: false; error: string }> {
    const redirectUri = `${FN}/callback`

    const r = await authedFetch('/start', {
      method: 'POST',
      body: JSON.stringify({ redirectUri }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      return { ok: false, error: j.error || `HTTP ${r.status}` }
    }
    const { authUrl } = await r.json() as { authUrl: string }

    return new Promise(resolve => {
      const popup = window.open(authUrl, 'drive-oauth', 'width=520,height=640')
      if (!popup) return resolve({ ok: false, error: 'Popup bloqueado pelo navegador' })

      let done = false
      const onMessage = (e: MessageEvent) => {
        if (!e.data || e.data.type !== 'drive-oauth') return
        done = true
        cleanup()
        const p = e.data.payload as { ok: boolean; googleEmail?: string; error?: string }
        resolve(p.ok && p.googleEmail
          ? { ok: true, googleEmail: p.googleEmail }
          : { ok: false, error: p.error || 'Falha desconhecida' })
      }
      const closedCheck = setInterval(() => {
        if (popup.closed && !done) { cleanup(); resolve({ ok: false, error: 'Janela fechada antes de concluir' }) }
      }, 500)
      const cleanup = () => {
        window.removeEventListener('message', onMessage)
        clearInterval(closedCheck)
      }
      window.addEventListener('message', onMessage)
    })
  },

  async disconnect(): Promise<void> {
    const r = await authedFetch('/disconnect', { method: 'POST' })
    if (!r.ok) throw new Error((await r.json()).error || 'Erro ao desconectar')
  },

  async getStatus(): Promise<DriveStatus> {
    const r = await authedFetch('/status')
    if (!r.ok) return { connected: false, googleEmail: null, rootFolderId: null, rootFolderName: null, connectedAt: null }
    return r.json()
  },

  async setRootFolder(rootFolderId: string | null, rootFolderName: string | null): Promise<void> {
    const r = await authedFetch('/set-root', {
      method: 'POST',
      body: JSON.stringify({ rootFolderId, rootFolderName }),
    })
    if (!r.ok) throw new Error((await r.json()).error || 'Erro ao salvar pasta raiz')
  },

  // ─── Upload ────────────────────────────────────────────────────────────

  async uploadPhoto(opts: {
    portalToken: string
    file: File
    categoryId: string | null
    kind?: 'photo' | 'ai_photo' | 'result_file' | 'form_image'
  }): Promise<DriveUploadResult> {
    const fd = new FormData()
    fd.append('portal_token', opts.portalToken)
    fd.append('kind', opts.kind || 'photo')
    if (opts.categoryId) fd.append('category_id', opts.categoryId)
    fd.append('file', opts.file)

    const r = await fetch(`${FN}/upload`, { method: 'POST', body: fd })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Upload falhou: HTTP ${r.status}`)
    }
    return r.json()
  },

  // ─── URLs ──────────────────────────────────────────────────────────────

  /** URL pra usar em <img src> direto (Drive público). */
  viewUrl(driveFileId: string, size = 2000): string {
    return `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w${size}`
  },

  /** URL pra download direto. */
  downloadUrl(driveFileId: string): string {
    return `https://drive.google.com/uc?export=download&id=${driveFileId}`
  },
}
