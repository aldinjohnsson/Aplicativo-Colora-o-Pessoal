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
//      c) Carrega ai_folder configurada pelo super_admin
//      d) Permite ao admin fazer upload de uma foto de referência
//         (obrigatória para as simulações — sem ela o Gemini não tem base)
//      e) Renderiza GeminiChat em modo STANDALONE com a foto como referência

import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, AlertCircle, Loader2, Settings as SettingsIcon,
  Camera, ImagePlus, X, RefreshCw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { adminService } from '../../lib/services'
import { GeminiChat } from '../client/GeminiChat'

// ─── Types ─────────────────────────────────────────────────────────────

interface LoadedConfig {
  adminName:        string
  adminId:          string
  systemPrompt:     string
  folderConfig:     any
  geminiKeyPresent: boolean
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

  // Foto de referência: guardamos a URL pública do Supabase Storage
  // (blob URL não funciona com o fetch interno do GeminiChat).
  const [refPhotoUrl,     setRefPhotoUrl]     = useState<string | null>(null)
  const [refPhotoPreview, setRefPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto,  setUploadingPhoto]  = useState(false)
  const [uploadError,     setUploadError]     = useState<string | null>(null)

  useEffect(() => { void load() }, [])

  // ─── Load ─────────────────────────────────────────────────────────

  async function load() {
    setState({ kind: 'loading' })
    try {
      const admin = await adminService.getCurrentAdmin()
      if (!admin) {
        setState({ kind: 'error', message: 'Sessão expirada. Faça login novamente.' })
        return
      }

      if (admin.role !== 'chat_admin' && admin.role !== 'super_admin') {
        setState({ kind: 'error', message: 'Esta área é exclusiva de contas MS Color IA.' })
        return
      }

      const { data: settingsRow } = await supabase
        .from('admin_content')
        .select('content')
        .eq('admin_id', admin.id)
        .eq('type', 'settings')
        .maybeSingle()

      const geminiKey = (settingsRow?.content as any)?.geminiApiKey as string | undefined
      const geminiKeyPresent = !!(geminiKey && geminiKey.trim())

      const { data: folderRow, error: folderErr } = await supabase
        .from('ai_folders')
        .select('id, name, config')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (folderErr) {
        console.error('[MsColorIAPage] erro ao carregar ai_folder:', folderErr)
        setState({
          kind: 'error',
          message: 'Não foi possível carregar as categorias de simulação. ' +
                   'Verifique se a migração do banco foi aplicada (RLS de ai_folders pra chat_admin).',
        })
        return
      }

      if (!folderRow) {
        setState({
          kind: 'error',
          message: 'Nenhuma pasta de IA foi configurada pelo administrador. Entre em contato com o suporte.',
        })
        return
      }

      const folderConfig = typeof folderRow.config === 'string'
        ? JSON.parse(folderRow.config)
        : folderRow.config

      const systemPrompt = buildSystemPrompt(admin.nome || 'Você', folderConfig)

      // Tenta carregar foto salva de uma sessão anterior
      await loadPersistedRefPhoto(admin.id)

      setState({
        kind: 'ready',
        data: { adminName: admin.nome || 'Você', adminId: admin.id, systemPrompt, folderConfig, geminiKeyPresent },
      })
    } catch (e: any) {
      console.error('[MsColorIAPage] load failed:', e)
      setState({ kind: 'error', message: e?.message || 'Erro ao carregar' })
    }
  }

  // ─── Foto persistida ──────────────────────────────────────────────
  // Se o admin já tiver enviado uma foto nesta sessão / sessão anterior,
  // restaura a URL pública do Supabase Storage pro `referencePhotoUrl`.

  async function loadPersistedRefPhoto(adminId: string) {
    const path = `ms-color-ia-ref/${adminId}/ref_photo.jpg`
    // Só chama getPublicUrl — não bate na rede, é apenas montagem de URL.
    const { data } = supabase.storage.from('client-photos').getPublicUrl(path)
    if (!data?.publicUrl) return

    // Valida se o arquivo realmente existe (HEAD request barato).
    try {
      const res = await fetch(data.publicUrl, { method: 'HEAD' })
      if (res.ok) {
        setRefPhotoUrl(data.publicUrl)
        setRefPhotoPreview(data.publicUrl)
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

    // Preview imediato via object URL (só pra mostrar enquanto sobe)
    const previewUrl = URL.createObjectURL(file)
    setRefPhotoPreview(previewUrl)
    setRefPhotoUrl(null)
    setUploadError(null)
    setUploadingPhoto(true)

    try {
      // Converte pra JPEG pra economizar espaço (canvas resize)
      const compressedBlob = await compressImage(file, 1280, 0.88)

      const path = `ms-color-ia-ref/${adminId}/ref_photo.jpg`
      const { error } = await supabase.storage
        .from('client-photos')
        .upload(path, compressedBlob, { contentType: 'image/jpeg', upsert: true })

      if (error) throw error

      const { data } = supabase.storage.from('client-photos').getPublicUrl(path)
      if (!data?.publicUrl) throw new Error('Não foi possível obter a URL pública da foto.')

      // Adiciona cache-buster pra forçar o browser (e o Gemini) a buscar a
      // versão recém-enviada, ignorando qualquer cache de CDN.
      setRefPhotoUrl(`${data.publicUrl}?t=${Date.now()}`)
    } catch (e: any) {
      console.error('[MsColorIAPage] upload ref photo failed:', e)
      setUploadError(e?.message || 'Erro ao enviar a foto. Tente novamente.')
      setRefPhotoPreview(null)
    } finally {
      setUploadingPhoto(false)
      // Limpa o input pra permitir re-seleção do mesmo arquivo
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleRemovePhoto() {
    setRefPhotoUrl(null)
    setRefPhotoPreview(null)
    setUploadError(null)
    if (fileRef.current) fileRef.current.value = ''
    // Opcional: remove do storage também
    if (state.kind === 'ready') {
      const path = `ms-color-ia-ref/${state.data.adminId}/ref_photo.jpg`
      supabase.storage.from('client-photos').remove([path]).catch(() => {})
    }
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

  const { adminName, adminId, systemPrompt, folderConfig, geminiKeyPresent } = state.data

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

      {/* ── Foto de referência ─────────────────────────────────────────
          Painel compacto que fica ACIMA do chat. O admin precisa definir
          a foto da cliente antes de fazer simulações — sem ela o Gemini
          não tem base para preservar o rosto e traços.
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
                {/* Botão remover */}
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
                ? 'Foto carregada. O Gemini vai usá-la como base para preservar rosto e traços nas simulações.'
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

              {!refPhotoUrl && (
                <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  ⚠️ Simulações sem foto de referência podem não preservar os traços da cliente.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── GeminiChat ──────────────────────────────────────────────── */}
      <GeminiChat
        clientName={adminName}
        systemPrompt={systemPrompt}
        folderConfig={folderConfig}
        clientId={adminId}
        referencePhotoUrl={refPhotoUrl ?? undefined}
        referencePhotos={[]}
        resultFileUrls={[]}
        resultObservations=""
        unlimited
        chatStorageKey={`ms_color_ia_${adminId}`}
        // onSavePdf NÃO informado → PDF só baixa, sem persistência
      />
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Redimensiona e comprime a imagem via canvas antes de subir pro Supabase.
 * Reduz o tamanho do payload enviado pro Gemini (menos tokens de imagem = menor custo).
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
 * Gera o systemPrompt da IA a partir do folderConfig do super_admin.
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