// src/components/admin/documents/client/GenerateAiImageDialog.tsx
//
// Modal acionado pelo GeneratedTagRow quando o admin clica em
// "Gerar" / "Regenerar". Aqui o admin escolhe **na hora**:
//   1. Qual prompt usar (dropdown dos prompts ativos)
//   2. Qual foto da galeria do cliente serve de base
//   → clica "Gerar imagem" → invoca Edge Function generate-tag-image
//
// O resultado é salvo em client_tag_values.image_storage_path e a UI da
// linha é atualizada via onGenerated(storagePath).

import React, { useEffect, useState } from 'react'
import {
  X, Sparkles, Check, AlertCircle, Image as ImageIcon, ChevronDown, ChevronUp, Wand2,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { substitutePromptVars, type PromptVarSource } from '../lib/promptVars'

// ── Btn ───────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, type = 'button', className = '',
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:   'text-gray-600 hover:bg-gray-100',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ─── Types ─────────────────────────────────────────────────────────────

interface ClientPhoto {
  id: string
  photo_name: string
  storage_path: string
  url: string
  category_id: string | null
  category_title: string | null
}

interface AiPromptLite {
  id: string
  name: string
  prompt: string
  size: string
  quality: string
}

interface Props {
  clientId: string
  tagId: string
  tagName: string
  onClose: () => void
  onGenerated: (storagePath: string) => void
}

// ─── Component ────────────────────────────────────────────────────────

export function GenerateAiImageDialog({
  clientId, tagId, tagName, onClose, onGenerated,
}: Props) {
  // ── Prompts ──
  const [prompts, setPrompts] = useState<AiPromptLite[]>([])
  const [loadingPrompts, setLoadingPrompts] = useState(true)
  const [promptsError, setPromptsError] = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [promptOpen, setPromptOpen] = useState(false)

  // ── Fotos ──
  const [photos, setPhotos] = useState<ClientPhoto[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(true)
  const [photosError, setPhotosError] = useState<string | null>(null)
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null)

  // ── Submit ──
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // ── Variáveis de prompt da cliente (ai_info_templates) ──────────────
  // Carregadas pra substituir `{{Label}}` no texto do prompt ANTES de
  // enviar pra Edge Function — sem isso, placeholder sem valor preenchido
  // (ex.: {{Subtom}}) vai cru pra OpenAI e sobra lixo tipo "Subtom: e" na
  // imagem gerada, porque a Function só resolve o que vier em
  // `promptOverride`; sozinha ela não sabe limpar {{Placeholder}} vazio.
  const [promptVarSources, setPromptVarSources] = useState<PromptVarSource[]>([])

  useEffect(() => {
    let cancelled = false
    documentsService.getTextImportSources(clientId)
      .then((sources: any[]) => {
        if (cancelled) return
        const aiInfo = (sources || [])
          .filter(s => typeof s?.key === 'string' && s.key.startsWith('ai_info:'))
          .map(s => ({ label: s.label, value: s.value }) as PromptVarSource)
        setPromptVarSources(aiInfo)
      })
      .catch(() => { if (!cancelled) setPromptVarSources([]) })
    return () => { cancelled = true }
  }, [clientId])

  // ── Load prompts ──
  useEffect(() => {
    let cancelled = false
    setLoadingPrompts(true)
    setPromptsError(null)
    documentsService.listAiImagePrompts({ promptKind: 'composition' })   // só ativos + só composition por padrão
      .then(list => { if (!cancelled) setPrompts(list as AiPromptLite[]) })
      .catch(e => { if (!cancelled) setPromptsError(e?.message || 'Erro ao carregar prompts') })
      .finally(() => { if (!cancelled) setLoadingPrompts(false) })
    return () => { cancelled = true }
  }, [])

  // ── Load fotos ──
  useEffect(() => {
    let cancelled = false
    setLoadingPhotos(true)
    setPhotosError(null)
    documentsService.listClientPhotos(clientId)
      .then(list => { if (!cancelled) setPhotos(list) })
      .catch(e => { if (!cancelled) setPhotosError(e?.message || 'Erro ao carregar fotos') })
      .finally(() => { if (!cancelled) setLoadingPhotos(false) })
    return () => { cancelled = true }
  }, [clientId])

  // ── Esc fecha ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !generating) onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose, generating])

  // Fecha o expand do prompt ao trocar a seleção
  useEffect(() => { setPromptOpen(false) }, [selectedPromptId])

  // ── Gera ──
  const handleGenerate = async () => {
    if (!selectedPromptId) { setGenError('Escolha um prompt.'); return }
    if (!selectedPhotoId) { setGenError('Selecione uma foto.'); return }
    const prompt = prompts.find(p => p.id === selectedPromptId)
    if (!prompt) { setGenError('Prompt inválido.'); return }
    setGenerating(true)
    setGenError(null)
    try {
      const promptOverride = substitutePromptVars(prompt.prompt, promptVarSources)
      const res = await documentsService.generateTagImageFromAI({
        promptId: selectedPromptId,
        clientId,
        tagId,
        photoId: selectedPhotoId,
        promptOverride,
      })
      onGenerated(res.storagePath)
    } catch (e: any) {
      setGenError(e?.message || 'Erro ao gerar imagem')
    } finally {
      setGenerating(false)
    }
  }

  // Agrupa fotos por categoria
  const grouped: Record<string, { title: string; photos: ClientPhoto[] }> = {}
  for (const p of photos) {
    const key = p.category_id || '__none__'
    if (!grouped[key]) grouped[key] = { title: p.category_title || 'Outras fotos', photos: [] }
    grouped[key].photos.push(p)
  }

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId) || null
  const resolvedPromptPreview = selectedPrompt
    ? substitutePromptVars(selectedPrompt.prompt, promptVarSources)
    : ''

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={() => { if (!generating) onClose() }}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-fuchsia-500" /> Gerar imagem com IA
            </p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              Para a tag: <span className="font-medium text-gray-700">{tagName}</span>
            </p>
          </div>
          <button
            onClick={() => { if (!generating) onClose() }}
            disabled={generating}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0 space-y-4">

          {/* ═══ Passo 1: Prompt ═══ */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />
              Prompt <span className="text-rose-500">*</span>
            </p>

            {loadingPrompts ? (
              <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-xs text-gray-400 flex items-center gap-2">
                <div className="animate-spin h-3 w-3 border-2 border-gray-300 border-t-fuchsia-400 rounded-full" />
                Carregando prompts…
              </div>
            ) : promptsError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{promptsError}</p>
              </div>
            ) : prompts.length === 0 ? (
              <p className="text-xs text-gray-500 italic px-3 py-2.5 border border-dashed border-gray-300 rounded-lg">
                Nenhum prompt cadastrado. Crie em <strong>Documents → Prompts IA</strong>.
              </p>
            ) : (
              <>
                <select
                  value={selectedPromptId}
                  onChange={e => setSelectedPromptId(e.target.value)}
                  disabled={generating}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:border-fuchsia-400 disabled:opacity-60"
                >
                  <option value="">— Escolha um prompt —</option>
                  {prompts.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.size} · {p.quality}
                    </option>
                  ))}
                </select>

                {selectedPrompt && (
                  <div className="mt-2 border border-fuchsia-200 bg-fuchsia-50/40 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPromptOpen(o => !o)}
                      className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-fuchsia-100/40 transition-colors"
                    >
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-fuchsia-700">
                        Ver texto do prompt
                      </span>
                      <span className="text-[11px] text-gray-500 ml-auto">
                        {resolvedPromptPreview.length.toLocaleString('pt-BR')} caracteres
                      </span>
                      {promptOpen
                        ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                    </button>
                    {promptOpen && (
                      <div className="px-3 pb-3 pt-1 border-t border-fuchsia-200 bg-white">
                        <p className="text-[10px] text-gray-400 mb-1.5">
                          Já com as variáveis da cliente substituídas — é este texto que vai ser enviado.
                        </p>
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
                          {resolvedPromptPreview}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ═══ Passo 2: Foto base ═══ */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-gray-500" />
              Foto base <span className="text-rose-500">*</span>
              <span className="text-gray-400 font-normal">(da galeria do cliente)</span>
            </p>
            {loadingPhotos ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-7 w-7 border-2 border-rose-400 border-t-transparent rounded-full" />
              </div>
            ) : photosError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{photosError}</p>
              </div>
            ) : photos.length === 0 ? (
              <div className="text-center py-12 text-sm text-gray-500 border border-dashed border-gray-300 rounded-xl">
                <ImageIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                Nenhuma foto enviada pelo cliente ainda.
              </div>
            ) : (
              <div className="space-y-5">
                {Object.entries(grouped).map(([key, group]) => (
                  <div key={key}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
                      {group.title}
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                      {group.photos.map(p => {
                        const selected = p.id === selectedPhotoId
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelectedPhotoId(p.id)}
                            disabled={generating}
                            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                              selected ? 'border-rose-500 ring-2 ring-rose-200' : 'border-transparent hover:border-gray-300'
                            } disabled:opacity-50`}
                          >
                            <img
                              src={p.url}
                              alt={p.photo_name}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                            {selected && (
                              <div className="absolute top-1 right-1 h-6 w-6 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg">
                                <Check className="h-3.5 w-3.5" />
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Loading message */}
          {generating && (
            <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="animate-spin h-5 w-5 border-2 border-fuchsia-400 border-t-transparent rounded-full mt-0.5" />
              <div>
                <p className="text-sm font-medium text-fuchsia-800">Gerando imagem…</p>
                <p className="text-xs text-fuchsia-700 mt-0.5">
                  Pode levar 15-30 segundos. Não feche essa janela.
                </p>
              </div>
            </div>
          )}

          {genError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700 break-words">{genError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
          <Btn variant="outline" onClick={onClose} disabled={generating}>
            Cancelar
          </Btn>
          <Btn
            variant="primary"
            onClick={handleGenerate}
            loading={generating}
            disabled={generating || !selectedPromptId || !selectedPhotoId}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {generating ? 'Gerando…' : 'Gerar imagem'}
          </Btn>
        </div>
      </div>
    </div>
  )
}