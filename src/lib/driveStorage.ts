// src/lib/driveStorage.ts
//
// Wrapper das chamadas pra Edge Function única `drive`.

import { getAccessToken } from './authSession'
import { rotateImageBlob } from './imageOrientation'

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

/**
 * Retorna true se o erro indica que o token do Drive foi gerado sem os
 * escopos necessários (usuário precisa desconectar e reconectar).
 */
export function isDriveScopeError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('access_token_scope_insufficient') ||
    msg.includes('insufficientpermissions') ||
    msg.includes('insufficient authentication scopes') ||
    msg.includes('permission_denied')
  )
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
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
      body: JSON.stringify({ redirectUri, appOrigin: window.location.origin }),
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

      const finish = (result: { ok: true; googleEmail: string } | { ok: false; error: string }) => {
        if (done) return
        done = true
        clearInterval(poll)
        window.removeEventListener('message', onMessage)
        // Não tentamos fechar o popup daqui: o Google define COOP: same-origin
        // nas suas páginas OAuth, o que impossibilita qualquer acesso cross-window.
        // O popup fecha sozinho ao ser redirecionado para o domínio do app.
        resolve(result)
      }

      // Caminho rápido: postMessage — funciona quando window.opener está disponível.
      // Em muitos browsers isso é bloqueado durante fluxos OAuth cross-origin,
      // então serve apenas como atalho; o polling abaixo é o mecanismo principal.
      const onMessage = (e: MessageEvent) => {
        if (!e.data || e.data.type !== 'drive-oauth') return
        const p = e.data.payload as { ok: boolean; googleEmail?: string; error?: string }
        finish(p.ok && p.googleEmail
          ? { ok: true, googleEmail: p.googleEmail }
          : { ok: false, error: p.error || 'Falha desconhecida' })
      }
      window.addEventListener('message', onMessage)

      // Polling do /status a cada 1.5 s — mecanismo principal de detecção.
      // Não usamos popup.closed: o Google define COOP: same-origin que bloqueia
      // qualquer acesso cross-window, mesmo dentro de try/catch.
      const TIMEOUT_MS = 5 * 60 * 1000
      const started = Date.now()

      const poll = setInterval(async () => {
        if (done) return

        if (Date.now() - started > TIMEOUT_MS) {
          finish({ ok: false, error: 'Tempo esgotado — tente novamente' })
          return
        }

        try {
          const r = await authedFetch('/status')
          const status: DriveStatus | null = r.ok ? await r.json() : null
          if (status?.connected && status?.googleEmail) {
            finish({ ok: true, googleEmail: status.googleEmail })
          }
        } catch {
          // erro de rede pontual — ignora e aguarda próximo tick
        }
      }, 1500)
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
    /**
     * Só relevante pra kind='ai_photo'. true (padrão) = apaga as fotos
     * anteriores da categoria antes de gravar (1ª foto do lote / reenvio).
     * false = acumula (fotos 2..N do mesmo lote).
     */
    clearPrevious?: boolean
  }): Promise<DriveUploadResult> {
    const fd = new FormData()
    fd.append('portal_token', opts.portalToken)
    fd.append('kind', opts.kind || 'photo')
    if (opts.categoryId) fd.append('category_id', opts.categoryId)
    fd.append('clear_previous', opts.clearPrevious === false ? '0' : '1')
    fd.append('file', opts.file)

    const r = await fetch(`${FN}/upload`, { method: 'POST', body: fd })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Upload falhou: HTTP ${r.status}`)
    }
    return r.json()
  },

  /**
   * Upload de foto feito pelo admin no painel — autenticado com JWT.
   *
   * Diferenças em relação a uploadPhoto():
   *  - Usa authedFetch (envia Authorization header com token da sessão admin).
   *  - Passa client_id em vez de portal_token.
   *  - A Edge Function usa kind='admin_photo' → insert direto em client_photos,
   *    sem chamar o RPC save_client_photo_drive que checa status da cliente.
   *    Isso permite que o admin adicione fotos em qualquer etapa do fluxo.
   */
  async adminUploadPhoto(opts: {
    clientId: string
    file: File
    categoryId: string | null
  }): Promise<DriveUploadResult> {
    const fd = new FormData()
    fd.append('client_id', opts.clientId)
    fd.append('kind', 'admin_photo')
    if (opts.categoryId) fd.append('category_id', opts.categoryId)
    fd.append('file', opts.file)

    const r = await authedFetch('/upload', { method: 'POST', body: fd })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Upload falhou: HTTP ${r.status}`)
    }
    return r.json()
  },

  // ─── Photo proxy ──────────────────────────────────────────────────────
  //
  // Baixa uma foto do Drive pelo servidor (Edge Function) para evitar
  // bloqueio CORS ao fazer fetch() direto de drive.google.com no browser.

  async fetchPhotoBlob(driveFileId: string, { bust = false }: { bust?: boolean } = {}): Promise<Blob> {
    const ts = bust ? `&_t=${Date.now()}` : ''
    const r = await authedFetch(`/photo-proxy?id=${encodeURIComponent(driveFileId)}${ts}`)
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Erro ao baixar foto: HTTP ${r.status}`)
    }
    return r.blob()
  },

  /**
   * Upload da foto de REFERÊNCIA do admin nos planos avulsos (chat_admin / full_admin).
   * Salva em Drive > "MS Color IA" > "Fotos de referência".
   * Passa replace_file_id para apagar a versão anterior e evitar acúmulo.
   * Retorna driveFileId que deve ser persistido no admin_content (settings).
   */
  async uploadMsColorIaRefPhoto(opts: {
    file: File
    replaceFileId?: string | null
  }): Promise<DriveUploadResult> {
    const fd = new FormData()
    fd.append('kind', 'ms_color_ia_ref')
    fd.append('file', opts.file)
    if (opts.replaceFileId) fd.append('replace_file_id', opts.replaceFileId)

    const r = await authedFetch('/upload', { method: 'POST', body: fd })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Upload falhou: HTTP ${r.status}`)
    }
    return r.json()
  },

  /**
   * Baixa uma foto do Drive via /photo-proxy e retorna como base64 data-URL.
   * Usado pelos consumidores que precisam mandar a foto pra IA (EnhancePhotoModal,
   * GeminiChat) sem fazer fetch() direto (CORS).
   */
  async fetchRefPhotoAsBase64(driveFileId: string): Promise<string> {
    const blob = await this.fetchPhotoBlob(driveFileId)
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Erro ao converter foto para base64'))
      reader.readAsDataURL(blob)
    })
  },

  /**
   * Delete + re-upload na mesma pasta do Drive (contorna o limite do scope
   * drive.file que impede PATCH em arquivos criados por outra sessão OAuth).
   * Atualiza drive_file_id no banco via Edge Function e retorna o novo id.
   */
  async replaceDrivePhoto(driveFileId: string, blob: Blob, photoId: string): Promise<string> {
    const fd = new FormData()
    fd.append('drive_file_id', driveFileId)
    fd.append('photo_id', photoId)
    fd.append('file', new File([blob], 'rotated.jpg', { type: blob.type || 'image/jpeg' }))
    const r = await authedFetch('/replace-media', { method: 'POST', body: fd })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `Falha ao substituir foto: HTTP ${r.status}`)
    }
    const j = await r.json()
    return j.driveFileId as string
  },

  /**
   * Gira (90° por padrão) uma foto que está no Drive:
   * baixa pelo proxy, gira no navegador, faz delete + re-upload e retorna
   * o novo driveFileId (o id muda porque não é mais um PATCH in-place).
   */
  async rotateDrivePhoto(driveFileId: string, photoId: string, degrees = 270): Promise<string> {
    // bust=true: ignora cache do proxy — garante que pegamos o conteúdo atual
    // do Drive, não uma versão anterior já cacheada (bug da segunda rotação).
    const current = await this.fetchPhotoBlob(driveFileId, { bust: true })
    const rotated = await rotateImageBlob(current, degrees)
    return this.replaceDrivePhoto(driveFileId, rotated, photoId)
  },


  /**
   * Autenticado com JWT do admin; a Edge Function cria/reutiliza uma pasta
   * fixa "MS Color IA" dentro da pasta raiz do admin no Drive.
   * kind='ms_color_ia' — não usa client_id nem portal_token.
   */
  async uploadMsColorIaPhoto(opts: { file: File }): Promise<DriveUploadResult> {
    const fd = new FormData()
    fd.append('kind', 'ms_color_ia')
    fd.append('file', opts.file)

    const r = await authedFetch('/upload', { method: 'POST', body: fd })
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

  /**
   * URL do proxy autenticado (JWT) pra baixar um client_result_file com o
   * Content-Disposition já setado com o nome correto — usar no painel admin.
   */
  fileProxyUrl(driveFileId: string): string {
    return `${FN}/file-proxy?id=${encodeURIComponent(driveFileId)}`
  },

  /**
   * URL do proxy sem JWT (portal_token) pra baixar um client_result_file
   * com o Content-Disposition já setado com o nome correto — usar no
   * ClientPortal (sem sessão autenticada).
   */
  filePortalProxyUrl(driveFileId: string, portalToken: string): string {
    return `${FN}/file-proxy?id=${encodeURIComponent(driveFileId)}&token=${encodeURIComponent(portalToken)}`
  },
}