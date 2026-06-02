// src/components/admin/MsColorIAPage.tsx
//
// Página principal do chat_admin (role 'chat_admin' em admin_users).
//
// Fluxo:
//   1. Admin loga
//   2. Layout redireciona pra /admin/ms-color-ia
//   3. Esta página:
//      a) Confirma a role
//      b) Verifica chave Gemini
//      c) Carrega TODAS as ai_folders disponíveis → admin escolhe qual usar
//      d) Permite ao admin fazer upload de uma foto de referência
//         (independente da pasta — persiste mesmo ao trocar de pasta)
//      e) Renderiza GeminiChat em modo STANDALONE com a foto como referência

import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, AlertCircle, Loader2, Settings as SettingsIcon,
  Camera, ImagePlus, X, RefreshCw, FolderOpen, ChevronDown, Check, User,
  Wand2, CheckCircle, AlertTriangle, Info,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { AdminUser } from '../../lib/services'
import { billingService } from '../../lib/billingService'
import { GeminiChat } from '../client/GeminiChat'
import { documentsService } from './documents/lib/documentsService'
import { ImageLightbox } from './AIPromptConfig'

// ─── Storage keys ──────────────────────────────────────────────────────

// Pasta selecionada é salva por admin pra não conflitar quando mais de uma
// conta usa o mesmo navegador.
const selectedFolderStorageKey = (adminId: string) =>
  `ms_color_ia_selected_folder_${adminId}`

// Timestamp do último upload da foto de referência — persiste o cache-buster
// para que o reload use a mesma URL ?t=... gerada no upload e não sirva
// a versão antiga do CDN.
const refPhotoTimestampKey = (adminId: string) =>
  `ms_color_ia_ref_photo_ts_${adminId}`

// ─── Types ─────────────────────────────────────────────────────────────

interface FolderOption {
  id: string
  name: string
  config: any
}

interface LoadedConfig {
  adminName:        string
  adminId:          string
  geminiKeyPresent: boolean
  /** Chave OpenAI (GPT) do admin — usada client-side no aprimoramento de foto. */
  openaiApiKey:     string
  openaiKeyPresent: boolean
  openaiPrepaid:    boolean
  folders:          FolderOption[]
}

// ─── Component ─────────────────────────────────────────────────────────

export function MsColorIAPage() {
  const navigate  = useNavigate()
  const fileRef   = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string; canGoToSettings?: boolean }
    | { kind: 'ready'; data: LoadedConfig }
  >({ kind: 'loading' })

  // ── Pasta selecionada ────────────────────────────────────────────────
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false)

  // Nome da cliente — usado no PDF e na saudação do chat
  const [clientName, setClientName] = useState<string>('')

  // Foto de referência: guardamos a URL pública do Supabase Storage
  // (blob URL não funciona com o fetch interno do GeminiChat).
  const [refPhotoUrl,     setRefPhotoUrl]     = useState<string | null>(null)
  const [refPhotoPreview, setRefPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto,  setUploadingPhoto]  = useState(false)
  const [uploadError,     setUploadError]     = useState<string | null>(null)
  // Modal "Aprimorar com IA" (usa a chave GPT/OpenAI do admin).
  const [enhanceOpen,     setEnhanceOpen]     = useState(false)
  const [imgLeft,  setImgLeft]  = useState<number | null>(null)
  const [imgQuota, setImgQuota] = useState(0)

  useEffect(() => { void load() }, [])
  useEffect(() => { refreshImgQuota() }, [])

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    if (!folderDropdownOpen) return
    const handler = () => setFolderDropdownOpen(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [folderDropdownOpen])

  // Persiste a pasta selecionada no localStorage sempre que mudar.
  // Assim qualquer alteração feita pelo admin (troca de pasta no dropdown)
  // sobrevive a reloads, navegação e fechamento do navegador.
  useEffect(() => {
    if (state.kind !== 'ready' || !selectedFolderId) return
    try {
      localStorage.setItem(
        selectedFolderStorageKey(state.data.adminId),
        selectedFolderId,
      )
    } catch {
      // localStorage indisponível — silencia (UX continua, só não persiste)
    }
  }, [selectedFolderId, state])

  // ─── Load ─────────────────────────────────────────────────────────
  //
  // Estratégia de performance:
  //   • getSession() lê o JWT do localStorage — zero round-trip de rede.
  //     Com o userId em mãos disparamos TUDO em paralelo de imediato.
  //   • Antes: getUser() → admin_users → Promise.all(...)  = 3 bloqueios seriais
  //   • Agora: getSession() [~0 ms] → Promise.all(admin_users, settings,
  //            folders, HEAD ref-photo) = 1 único round-trip paralelo.

  async function load() {
    setState({ kind: 'loading' })
    try {
      // ── 1. Lê a sessão local — sem rede ────────────────────────────
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setState({ kind: 'error', message: 'Sessão expirada. Faça login novamente.' })
        return
      }
      const userId = session.user.id

      // ── 2. Dispara todas as queries em paralelo de uma vez ─────────
      const [
        { data: adminData },
        { data: settingsRow },
        { data: folderRows, error: folderErr },
      ] = await Promise.all([
        supabase
          .from('admin_users')
          .select('id, email, nome, telefone, role, license_active, license_expires_at, observacoes, created_at')
          .eq('id', userId)
          .single(),
        supabase
          .from('admin_content')
          .select('content')
          .eq('admin_id', userId)
          .eq('type', 'settings')
          .maybeSingle(),
        supabase
          .from('ai_folders')
          .select('id, name, config')
          .order('created_at', { ascending: true }),
        loadPersistedRefPhoto(userId),   // HEAD request — corre junto
      ])

      // ── 3. Valida admin ────────────────────────────────────────────
      if (!adminData) {
        setState({ kind: 'error', message: 'Sessão expirada. Faça login novamente.' })
        return
      }

      const admin = adminData as AdminUser

      if (admin.role !== 'chat_admin' && admin.role !== 'full_admin' && admin.role !== 'super_admin') {
        setState({ kind: 'error', message: 'Esta área é exclusiva de contas MS Color IA.' })
        return
      }

      // ── 4. Processa resultados ─────────────────────────────────────
      const geminiKey = (settingsRow?.content as any)?.geminiApiKey as string | undefined
      const geminiKeyPresent = !!(geminiKey && geminiKey.trim())

      // Chave OpenAI (GPT) — opcional. Habilita o aprimoramento de foto.
      // Vive só no row 'settings' do admin_content (filtrado por admin_id),
      // então o próprio admin consegue lê-la aqui pelo client.
      const openaiKey = ((settingsRow?.content as any)?.openaiApiKey as string | undefined)?.trim() || ''
      const openaiKeyPresent = !!openaiKey

      // Plano pré-pago de imagem? Então o aprimoramento usa a chave geral
      // (na edge) e não exige chave própria.
      const billingProfile = await billingService.getMine().catch(() => null)
      const openaiPrepaid = billingProfile?.openai_mode === 'prepaid'

      if (folderErr) {
        console.error('[MsColorIAPage] erro ao carregar ai_folders:', folderErr)
        setState({
          kind: 'error',
          message: 'Não foi possível carregar as categorias de simulação. ' +
                   'Verifique se a migração do banco foi aplicada (RLS de ai_folders pra chat_admin).',
        })
        return
      }

      if (!folderRows || folderRows.length === 0) {
        setState({
          kind: 'error',
          message: 'Nenhuma pasta de IA foi configurada pelo administrador. Entre em contato com o suporte.',
        })
        return
      }

      const folders: FolderOption[] = folderRows.map(row => ({
        id: row.id,
        name: row.name,
        config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      }))

      setState({
        kind: 'ready',
        data: {
          adminName:        admin.nome || 'Você',
          adminId:          admin.id,
          geminiKeyPresent,
          openaiApiKey:     openaiKey,
          openaiKeyPresent,
          openaiPrepaid,
          folders,
        },
      })

      // Restaura a pasta da última sessão (se ainda existir),
      // senão pré-seleciona a primeira.
      let initialFolderId = folders[0].id
      try {
        const saved = localStorage.getItem(selectedFolderStorageKey(admin.id))
        if (saved && folders.some(f => f.id === saved)) {
          initialFolderId = saved
        }
      } catch {
        // localStorage indisponível (modo privado etc) — usa a primeira
      }
      setSelectedFolderId(initialFolderId)

    } catch (e: any) {
      console.error('[MsColorIAPage] load failed:', e)
      setState({ kind: 'error', message: e?.message || 'Erro ao carregar' })
    }
  }

  // ─── Foto persistida ──────────────────────────────────────────────

  async function loadPersistedRefPhoto(adminId: string) {
    const path = `ms-color-ia-ref/${adminId}/ref_photo.jpg`
    const { data } = supabase.storage.from('client-photos').getPublicUrl(path)
    if (!data?.publicUrl) return

    try {
      const res = await fetch(data.publicUrl, { method: 'HEAD' })
      if (res.ok) {
        // Restaura o mesmo ?t= que foi usado no último upload para que o browser
        // e o CDN não sirvam a versão anterior em cache.
        let ts: string | null = null
        try { ts = localStorage.getItem(refPhotoTimestampKey(adminId)) } catch {}
        const url = ts ? `${data.publicUrl}?t=${ts}` : data.publicUrl
        setRefPhotoUrl(url)
        setRefPhotoPreview(url)
      }
    } catch {
      // arquivo não existe ainda — sem problema
    }
  }

  // ─── Upload da foto de referência ─────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('Selecione uma imagem (JPG, PNG, WebP…).')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Imagem muito grande. O limite é 10 MB.')
      return
    }

    if (state.kind !== 'ready') return
    const adminId = state.data.adminId

    const previewUrl = URL.createObjectURL(file)
    setRefPhotoPreview(previewUrl)
    setRefPhotoUrl(null)
    setUploadError(null)
    setUploadingPhoto(true)

    try {
      const compressedBlob = await compressImage(file, 1280, 0.88)

      const path = `ms-color-ia-ref/${adminId}/ref_photo.jpg`
      const { error } = await supabase.storage
        .from('client-photos')
        .upload(path, compressedBlob, { contentType: 'image/jpeg', upsert: true })

      if (error) throw error

      const { data } = supabase.storage.from('client-photos').getPublicUrl(path)
      if (!data?.publicUrl) throw new Error('Não foi possível obter a URL pública da foto.')

      const ts = Date.now()
      try { localStorage.setItem(refPhotoTimestampKey(adminId), String(ts)) } catch {}
      setRefPhotoUrl(`${data.publicUrl}?t=${ts}`)
    } catch (e: any) {
      console.error('[MsColorIAPage] upload ref photo failed:', e)
      setUploadError(e?.message || 'Erro ao enviar a foto. Tente novamente.')
      setRefPhotoPreview(null)
    } finally {
      setUploadingPhoto(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleRemovePhoto() {
    setRefPhotoUrl(null)
    setRefPhotoPreview(null)
    setUploadError(null)
    if (fileRef.current) fileRef.current.value = ''
    if (state.kind === 'ready') {
      const path = `ms-color-ia-ref/${state.data.adminId}/ref_photo.jpg`
      supabase.storage.from('client-photos').remove([path]).catch(() => {})
      try { localStorage.removeItem(refPhotoTimestampKey(state.data.adminId)) } catch {}
    }
  }

  // ─── Aprimoramento aplicado ───────────────────────────────────────
  //
  // O modal já fez o upload da versão aprimorada no mesmo caminho da foto
  // de referência. Aqui só atualizamos a URL exibida (com o ?t= novo) e
  // persistimos o timestamp pra sobreviver a reloads, igual ao upload normal.
  // Conta de imagens do plano pré-pago (OpenAI) — cobre aprimoramento e páginas.
  function refreshImgQuota() {
    billingService.getMine().then(b => {
      if (b && b.openai_mode === 'prepaid') { setImgLeft(Math.max(0, b.openai_quota - b.openai_used)); setImgQuota(b.openai_quota) }
      else setImgLeft(null)
    }).catch(() => {})
  }

  function handleEnhancedApplied(newUrl: string, ts: number) {
    setRefPhotoPreview(newUrl)
    setRefPhotoUrl(newUrl)
    setUploadError(null)
    if (state.kind === 'ready') {
      try { localStorage.setItem(refPhotoTimestampKey(state.data.adminId), String(ts)) } catch {}
    }
    refreshImgQuota()
    setEnhanceOpen(false)
  }

  // ─── Render ───────────────────────────────────────────────────────

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 mx-auto animate-spin text-fuchsia-500" />
          <p className="text-sm text-gray-500">Carregando MS Color IA…</p>
        </div>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">Não foi possível abrir o chat</p>
            <p className="text-xs text-red-700 mt-1 break-words">{state.message}</p>
            {state.canGoToSettings && (
              <button
                onClick={() => navigate('/admin/settings')}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
                Ir para Configurações
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const { adminName, adminId, geminiKeyPresent, openaiKeyPresent, openaiPrepaid, folders } = state.data

  if (!geminiKeyPresent) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-rose-500 flex items-center justify-center mb-4">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Bem-vinda à MS Color IA</h1>
          <p className="text-sm text-gray-500 mb-4">
            Pra começar, você precisa configurar sua chave Gemini.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
            <p className="text-sm text-amber-800">
              ⚠️ <strong>Sem chave configurada.</strong> O chat não vai funcionar até você
              adicionar uma chave válida em <strong>Configurações</strong>.
            </p>
          </div>
          <button
            onClick={() => navigate('/admin/settings')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-700"
          >
            <SettingsIcon className="h-4 w-4" />
            Configurar agora
          </button>
        </div>
      </div>
    )
  }

  // ── Pasta ativa ──────────────────────────────────────────────────────
  const activeFolder  = folders.find(f => f.id === selectedFolderId) ?? folders[0]
  const folderConfig  = activeFolder.config
  // Usa o nome digitado pelo admin; cai para adminName se o campo estiver vazio
  const effectiveName = clientName.trim() || adminName
  const systemPrompt  = buildSystemPrompt(effectiveName, folderConfig)

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-4 space-y-4">

      {/* Cabeçalho compacto */}
      <div className="flex items-center gap-3 px-1">
        <div className="w-10 h-10 bg-gradient-to-br from-fuchsia-500 to-rose-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base sm:text-xl font-semibold text-gray-900 truncate">MS Color IA</h1>
          <p className="text-xs text-gray-500 truncate">
            Simulações de cabelos, maquiagem, roupas e mais
          </p>
        </div>
      </div>

      {/* ── Nome da cliente ───────────────────────────────────────────
          Campo preenchido pelo admin antes ou durante o atendimento.
          É usado como clientName no GeminiChat e, portanto, no PDF gerado.
      ─────────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <User className="h-4 w-4 text-fuchsia-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-gray-900">Nome da cliente</p>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Informe o nome da cliente para que ele apareça corretamente no PDF gerado.
        </p>
        <input
          type="text"
          value={clientName}
          onChange={e => setClientName(e.target.value)}
          placeholder="Ex.: Mariana Silva"
          className="w-full sm:max-w-xs px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:border-transparent transition"
        />
      </div>

      {/* ── Seletor de pasta ──────────────────────────────────────────────
          Aparece só se houver mais de uma pasta disponível.
          A foto de referência é independente — não muda ao trocar de pasta.
      ──────────────────────────────────────────────────────────────────── */}
      {folders.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen className="h-4 w-4 text-fuchsia-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-gray-900">Pasta de simulação</p>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Escolha qual conjunto de prompts usar nesta sessão. A foto de referência é compartilhada entre todas as pastas.
          </p>

          {/* Dropdown */}
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setFolderDropdownOpen(prev => !prev)}
              className="w-full sm:w-auto min-w-[220px] flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-800 transition-colors"
            >
              <span className="flex items-center gap-2 truncate">
                <FolderOpen className="h-4 w-4 text-fuchsia-400 flex-shrink-0" />
                <span className="truncate">{activeFolder.name}</span>
              </span>
              <ChevronDown
                className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform duration-150 ${folderDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {folderDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden min-w-[220px] max-w-xs">
                {folders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => {
                      setSelectedFolderId(folder.id)
                      setFolderDropdownOpen(false)
                    }}
                    className={`
                      w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-left
                      transition-colors hover:bg-fuchsia-50
                      ${folder.id === activeFolder.id ? 'bg-fuchsia-50 text-fuchsia-700 font-semibold' : 'text-gray-700'}
                    `}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <FolderOpen className={`h-4 w-4 flex-shrink-0 ${folder.id === activeFolder.id ? 'text-fuchsia-500' : 'text-gray-400'}`} />
                      <span className="truncate">{folder.name}</span>
                    </span>
                    {folder.id === activeFolder.id && (
                      <Check className="h-4 w-4 text-fuchsia-500 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Foto de referência ─────────────────────────────────────────
          Painel compacto que fica ACIMA do chat. A foto é independente
          da pasta selecionada — persiste entre trocas de pasta.
      ─────────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
        <div className="flex items-start gap-4">

          {/* Thumbnail / placeholder */}
          <div className="flex-shrink-0">
            {refPhotoPreview ? (
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden border-2 border-fuchsia-200 shadow-sm">
                <img
                  src={refPhotoPreview}
                  alt="Foto de referência"
                  className="w-full h-full object-cover"
                />
                {uploadingPhoto && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  </div>
                )}
                {!uploadingPhoto && (
                  <button
                    onClick={handleRemovePhoto}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                    title="Remover foto"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center gap-1">
                <Camera className="h-6 w-6 text-gray-400" />
                <span className="text-[10px] text-gray-400 text-center leading-tight px-1">Sem foto</span>
              </div>
            )}
          </div>

          {/* Textos + ação */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold text-gray-900">Foto de referência</p>
              {refPhotoUrl && !uploadingPhoto && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  Pronta
                </span>
              )}
              {uploadingPhoto && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 rounded-full px-2 py-0.5">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  Enviando…
                </span>
              )}
            </div>

            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              {refPhotoUrl
                ? 'Foto carregada.'
                : 'Envie uma foto frontal da cliente com boa iluminação. Ela será usada como base em todas as simulações de cabelo, maquiagem e look.'}
            </p>

            {uploadError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                {uploadError}
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadingPhoto}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {refPhotoUrl ? (
                  <><RefreshCw className="h-3.5 w-3.5" /> Trocar foto</>
                ) : (
                  <><ImagePlus className="h-3.5 w-3.5" /> Selecionar foto</>
                )}
              </button>

              {/* Aprimorar com IA — só faz sentido quando já existe uma foto.
                  Requer a chave GPT (OpenAI) configurada nas Configurações. */}
              {refPhotoUrl && !uploadingPhoto && (
                (openaiKeyPresent || openaiPrepaid) ? (
                  <button
                    onClick={() => setEnhanceOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 hover:bg-fuchsia-100 transition-colors"
                    title="Aprimorar a foto de referência com IA"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Aprimorar com IA
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('/admin/settings')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors"
                    title="Configure sua chave GPT (OpenAI) para aprimorar fotos"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Aprimorar (requer chave GPT)
                  </button>
                )
              )}

              {refPhotoUrl && !uploadingPhoto && imgLeft !== null && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200">
                  ✨ {imgLeft}/{imgQuota} imagens
                </span>
              )}

              {!refPhotoUrl && (
                <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  ⚠️ Simulações sem foto de referência podem não preservar os traços da cliente.
                </p>
              )}
            </div>

            {refPhotoUrl && !uploadingPhoto && (openaiKeyPresent || openaiPrepaid) && (
              <p className="text-[11px] text-gray-500 flex items-start gap-1 mt-2.5">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0 text-fuchsia-400" />
                <span>O aprimoramento consome 1 crédito de imagem. Use para ajustar a iluminação de fotos que precisam de correção.</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── GeminiChat ──────────────────────────────────────────────── */}
      {/*
        key={activeFolder.id} força o GeminiChat a reiniciar o chat
        quando a pasta muda — assim os prompts no chat refletem
        a pasta correta sem misturar histórico de pastas diferentes.
      */}
      <GeminiChat
        key={activeFolder.id}
        clientName={effectiveName}
        systemPrompt={systemPrompt}
        folderConfig={folderConfig}
        msColorIaMode
        referencePhotoUrl={refPhotoUrl ?? undefined}
        referencePhotos={[]}
        resultFileUrls={[]}
        resultObservations=""
        unlimited
        chatStorageKey={`ms_color_ia_${adminId}_${activeFolder.id}`}
        // onSavePdf NÃO informado → PDF só baixa, sem persistência
      />

      {/* ── Modal Aprimorar foto de referência com IA (OpenAI / GPT) ── */}
      {enhanceOpen && refPhotoUrl && (
        <EnhancePhotoModal
          adminId={adminId}
          photoUrl={refPhotoUrl}
          onClose={() => setEnhanceOpen(false)}
          onApplied={handleEnhancedApplied}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// EnhancePhotoModal — aprimora a foto de referência com IA
//
// MESMO mecanismo da aba IA (StandardizeModal do AIPromptConfig):
//   • Carrega os prompts cadastrados do tipo 'ref_standardize'.
//   • Chama a Edge Function `generate-tag-image` passando promptOverride =
//     texto do prompt selecionado (parts[0].prompt).
//   • A Edge Function usa a chave do admin (Gemini/GPT configurada nas
//     Configurações) no servidor — o resultado fica idêntico ao da aba IA.
//
// Standalone (sem cliente): usa o próprio adminId como clientId, igual à
// StandaloneAiGenerationPage.
//
// Fluxo: carrega prompt → (seleciona, se houver mais de um) → gera →
//        preview antes/depois → "Usar esta foto" salva no caminho da
//        foto de referência.
// ═══════════════════════════════════════════════════════════════════════

interface EnhancePhotoModalProps {
  adminId:   string
  photoUrl:  string
  onClose:   () => void
  onApplied: (newUrl: string, ts: number) => void
}

function EnhancePhotoModal({ adminId, photoUrl, onClose, onApplied }: EnhancePhotoModalProps) {
  const [prompts,        setPrompts]        = useState<any[]>([])
  const [loadingPrompts, setLoadingPrompts] = useState(true)
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [running,    setRunning]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [progress,   setProgress]   = useState('')
  const [error,      setError]      = useState<string | null>(null)
  const [previewB64, setPreviewB64] = useState<string | null>(null)
  // Lightbox — URL/dataURL da imagem ampliada (null = fechado). Reaproveita
  // o mesmo ImageLightbox da aba IA (zoom, arraste, pinch e download).
  const [lightbox,   setLightbox]   = useState<string | null>(null)

  // Carrega os prompts de aprimoramento (mesma fonte da aba IA).
  useEffect(() => {
    let cancelled = false
    setLoadingPrompts(true)
    documentsService.listAiImagePrompts({ promptKind: 'ref_standardize' })
      .then((all: any[]) => {
        if (cancelled) return
        setPrompts(all)
        if (all.length === 1) setSelectedPromptId(all[0].id)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingPrompts(false) })
    return () => { cancelled = true }
  }, [])

  const handleRun = async () => {
    const prompt = prompts.find(p => p.id === selectedPromptId)
    if (!prompt) return
    setRunning(true)
    setError(null)
    try {
      // 1. Baixa a foto de referência atual como blob.
      setProgress('Carregando foto original…')
      const r = await fetch(photoUrl)
      if (!r.ok) throw new Error('Não foi possível carregar a foto de referência.')
      const photoBlob = await r.blob()

      // 2. Converte para base64 para enviar à API.
      setProgress('Preparando imagem…')
      const base64Photo = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res((reader.result as string).split(',')[1])
        reader.onerror = () => rej(new Error('Erro ao converter imagem'))
        reader.readAsDataURL(photoBlob)
      })

      // 3. Texto do prompt (primeira parte) — idêntico à aba IA.
      const promptText = Array.isArray(prompt.parts) && prompt.parts.length > 0
        ? prompt.parts[0].prompt
        : ''
      if (!promptText) throw new Error('O prompt não tem texto definido.')

      // 4. Edge Function generate-tag-image (modo standalone, clientId = admin).
      setProgress('Enviando para a IA… (pode levar até 30s)')
      const { data: { session } } = await supabase.auth.getSession()
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-tag-image`
      const resp = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          promptId: prompt.id,
          clientId: adminId,            // standalone: usa o admin como "cliente"
          promptOverride: promptText,
          uploadedImage: {
            base64: base64Photo,
            mime: photoBlob.type || 'image/jpeg',
          },
          composition: { compositionId: 'ms_color_ia_ref_standardize', index: 0 },
        }),
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}))
        throw new Error(j.error || `Erro da API: HTTP ${resp.status}`)
      }
      const result = await resp.json() as { success?: boolean; imageBase64?: string; imageMime?: string; error?: string }
      if (!result.success || !result.imageBase64) {
        throw new Error(result.error || 'A IA não retornou imagem.')
      }

      setProgress('Imagem gerada!')
      setPreviewB64(`data:${result.imageMime || 'image/png'};base64,${result.imageBase64}`)
      setRunning(false)
    } catch (err: any) {
      setError(err?.message || 'Erro ao aprimorar a foto.')
      setRunning(false)
    }
  }

  const handleConfirm = async () => {
    if (!previewB64) return
    setSaving(true)
    setError(null)
    try {
      // Converte o resultado para JPEG comprimido (mesmo formato do upload normal).
      const res = await fetch(previewB64)
      const pngBlob = await res.blob()
      const jpegBlob = await compressImage(new File([pngBlob], 'enh.png', { type: 'image/png' }), 1280, 0.9)

      const path = `ms-color-ia-ref/${adminId}/ref_photo.jpg`
      const { error: upErr } = await supabase.storage
        .from('client-photos')
        .upload(path, jpegBlob, { contentType: 'image/jpeg', upsert: true })
      if (upErr) throw upErr

      const { data } = supabase.storage.from('client-photos').getPublicUrl(path)
      if (!data?.publicUrl) throw new Error('Não foi possível obter a URL pública da foto.')

      const ts = Date.now()
      onApplied(`${data.publicUrl}?t=${ts}`, ts)
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar a foto aprimorada.')
      setSaving(false)
    }
  }

  const busy = running || saving

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-fuchsia-50 to-rose-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-fuchsia-500 to-rose-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <Wand2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-sm text-gray-900">
                {previewB64 ? 'Resultado gerado' : 'Aprimorar foto de referência'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Com IA · usa sua chave GPT (OpenAI)</p>
            </div>
          </div>
          {!busy && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {previewB64 ? (
            <>
              {/* ── PREVIEW ── */}
              <p className="text-xs text-gray-500 text-center">
                Toque na imagem para ampliar. Se gostar, clique em <strong>Usar esta foto</strong> para substituir a referência.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-gray-500 text-center uppercase tracking-wide">Antes</p>
                  <button
                    onClick={() => setLightbox(photoUrl)}
                    className="w-full aspect-square rounded-xl overflow-hidden border border-gray-200 hover:border-gray-400 transition-all relative group"
                  >
                    <img src={photoUrl} alt="Antes" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-[11px] px-2 py-1 rounded-lg">🔍 Ampliar</span>
                    </div>
                  </button>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-fuchsia-600 text-center uppercase tracking-wide">Depois ✨</p>
                  <button
                    onClick={() => setLightbox(previewB64)}
                    className="w-full aspect-square rounded-xl overflow-hidden border-2 border-fuchsia-300 hover:border-fuchsia-500 transition-all relative group"
                  >
                    <img src={previewB64} alt="Depois" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-[11px] px-2 py-1 rounded-lg">🔍 Ampliar</span>
                    </div>
                  </button>
                </div>
              </div>
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* ── CONFIGURAÇÃO ── */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <img src={photoUrl} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-gray-200" />
                <div>
                  <p className="text-xs font-semibold text-gray-700">Foto de referência atual</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    A IA vai aprimorar esta foto preservando o rosto e os traços da cliente.
                  </p>
                </div>
              </div>

              {/* Prompt de aprimoramento — mesma fonte da aba IA */}
              {loadingPrompts ? (
                <div className="flex items-center justify-center py-6 gap-2 text-fuchsia-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Carregando prompts…</span>
                </div>
              ) : prompts.length === 0 ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-1">
                  <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto" />
                  <p className="text-sm font-medium text-amber-800">Nenhum prompt cadastrado</p>
                  <p className="text-xs text-amber-600">
                    Acesse <strong>Documentos → Prompts IA</strong> e crie um prompt do tipo
                    <strong> "Aprimorar foto de referência"</strong>.
                  </p>
                </div>
              ) : prompts.length === 1 ? (
                <p className="text-xs text-gray-500 leading-relaxed">
                  Vamos aplicar o aprimoramento <strong>{prompts[0].name}</strong> mantendo a
                  identidade da cliente. É só clicar em <strong>Aprimorar foto</strong>.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    Prompt de aprimoramento
                  </label>
                  {prompts.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPromptId(p.id)}
                      disabled={running}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                        selectedPromptId === p.id
                          ? 'border-fuchsia-400 bg-fuchsia-50'
                          : 'border-gray-200 hover:border-fuchsia-200 hover:bg-fuchsia-50/40'
                      }`}
                    >
                      <Sparkles className={`h-4 w-4 flex-shrink-0 ${selectedPromptId === p.id ? 'text-fuchsia-500' : 'text-gray-400'}`} />
                      <p className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate">{p.name}</p>
                      {selectedPromptId === p.id && (
                        <CheckCircle className="h-4 w-4 text-fuchsia-500 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}

              {running && (
                <div className="flex items-center gap-3 p-3 bg-fuchsia-50 border border-fuchsia-200 rounded-xl">
                  <Loader2 className="h-5 w-5 text-fuchsia-500 animate-spin flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-fuchsia-800">Processando…</p>
                    <p className="text-xs text-fuchsia-600 mt-0.5">{progress}</p>
                  </div>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
          {previewB64 ? (
            <>
              <button
                onClick={() => { setPreviewB64(null); setError(null) }}
                disabled={saving}
                className="flex-1 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Tentar novamente
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="flex-1 py-2 text-sm font-semibold text-white bg-gradient-to-r from-fuchsia-500 to-rose-500 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</>
                  : <><CheckCircle className="h-4 w-4" /> Usar esta foto</>}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={running}
                className="flex-1 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleRun}
                disabled={running || !selectedPromptId || prompts.length === 0}
                className="flex-1 py-2 text-sm font-semibold text-white bg-gradient-to-r from-fuchsia-500 to-rose-500 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {running
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Processando…</>
                  : <><Wand2 className="h-4 w-4" /> Aprimorar foto</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>

      {/* Lightbox de zoom — mesmo componente da aba IA */}
      {lightbox && (
        <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Redimensiona e comprime a imagem via canvas antes de subir pro Supabase.
 */
async function compressImage(
  file: File,
  maxSize: number = 1280,
  quality: number = 0.88,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objUrl)
      const { width, height } = img
      let w = width, h = height

      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round((h * maxSize) / w); w = maxSize }
        else       { w = Math.round((w * maxSize) / h); h = maxSize }
      }

      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Falha ao comprimir imagem')),
        'image/jpeg',
        quality,
      )
    }

    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Falha ao carregar imagem')) }
    img.src = objUrl
  })
}

/**
 * Gera o systemPrompt da IA a partir do folderConfig da pasta selecionada.
 */
function buildSystemPrompt(name: string, folderConfig: any): string {
  const catLines = (folderConfig?.categories || [])
    .map((cat: any) => {
      const prompts = (cat.prompts || [])
        .map((p: any) => {
          let d = '  - ' + p.name
          if (p.options?.length) d += ' [' + p.options.join(', ') + ']'
          if (p.instructions)   d += ' → ' + p.instructions
          return d
        })
        .join('\n')
      return '📌 ' + cat.name + ':\n' + (prompts || '  (vazio)')
    })
    .join('\n\n')

  const base = folderConfig?.baseInstructions || ''

  return [
    `Você é a MS Color IA, assistente virtual de coloração pessoal e simulações de imagem.`,
    `Está conversando com ${name}, que vai enviar a própria foto e pedir simulações.`,
    ``,
    `RESPONDA SEMPRE EM PORTUGUÊS BRASILEIRO. Seja simpática, profissional e objetiva.`,
    ``,
    `CATEGORIAS DISPONÍVEIS PARA SIMULAÇÃO:`,
    catLines || '(nenhuma categoria configurada)',
    ``,
    base ? `INSTRUÇÕES BASE:\n${base}` : '',
    ``,
    `Faça simulações realistas baseadas nas categorias acima.`,
    `Use SEMPRE a foto de referência da cliente como base — preserve integralmente o rosto, pele, olhos e traços faciais.`,
    `Se não houver foto de referência disponível, peça gentilmente que a cliente envie uma antes de iniciar a simulação.`,
  ].filter(Boolean).join('\n')
}