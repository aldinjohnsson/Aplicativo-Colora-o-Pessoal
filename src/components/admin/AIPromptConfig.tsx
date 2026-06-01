// src/components/admin/AIPromptConfig.tsx
import React, { useState, useEffect, useRef } from 'react'
import {
  Wand2, Save, CheckCircle, Camera, Trash2,
  Coins, Plus, Minus, Lock, Unlock, RefreshCw, MessageSquare,
  X, FolderOpen, Loader2, Upload, ImagePlus, Sparkles, AlertTriangle,
  ZoomIn, ZoomOut, Download,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { driveStorage } from '../../lib/driveStorage'
import { photoTypesService, PhotoType } from './PhotoTypesManager'
import { documentsService } from './documents/lib/documentsService'
import { REF_CATEGORIES } from './documents/prompts/refCategories'

interface AIPromptConfigProps {
  clientId: string
  clientName: string
  isReleased: boolean
  chatEnabled: boolean
  onChatEnabledChange: (v: boolean) => void
  onSaveChatEnabled: () => Promise<void>
  /** Fotos já carregadas da cliente (vêm do load() do ClientDetail) */
  clientPhotos?: any[]
  /** Categorias de fotos da cliente */
  photoCategories?: any[]
  /** Chamado após salvar/trocar/remover foto de referência para forçar reload no pai */
  onAfterSaveRefPhotos?: () => void
}

// ── Foto de referência vinculada a um type ──────────────────

export interface RefPhoto {
  typeId: string
  typeName: string
  storagePath: string
  url: string
  /** Quando a foto está no Drive da admin, em vez do Supabase Storage. */
  driveFileId?: string | null
}

export function AIPromptConfig({
  clientId, clientName, isReleased, chatEnabled,
  onChatEnabledChange, onSaveChatEnabled,
  clientPhotos, photoCategories, onAfterSaveRefPhotos,
}: AIPromptConfigProps) {
  const [photoTypes, setPhotoTypes] = useState<PhotoType[]>([])
  const [refPhotos, setRefPhotos] = useState<RefPhoto[]>([])
  const [uploadingTypeId, setUploadingTypeId] = useState<string | null>(null)
  /** typeId da categoria IA em que o usuário clicou "+ Adicionar" / "Trocar" via galeria */
  const [galleryPickerTypeId, setGalleryPickerTypeId] = useState<string | null>(null)
  /** Aprimorar foto — tipo selecionado para padronização */
  const [standardizeTypeId, setStandardizeTypeId] = useState<string | null>(null)
  /** Lightbox — URL da foto a ampliar nos cards de referência */
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const [creditsImage, setCreditsImage] = useState(0)
  const [creditsText, setCreditsText] = useState(0)
  const [usedImage, setUsedImage] = useState(0)
  const [usedText, setUsedText] = useState(0)
  const [savingCredits, setSavingCredits] = useState(false)

  const [savingChat, setSavingChat] = useState(false)
  const [chatSaved, setChatSaved] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => { loadData() }, [clientId])

  const loadData = async () => {
    setLoading(true)
    try {
      // Carregar types configurados globalmente
      const types = await photoTypesService.getAll()
      setPhotoTypes(types)

      const { data: client } = await supabase
        .from('clients')
        .select('ai_reference_photos, ai_reference_photo_path, ai_credits_image, ai_credits_text, ai_credits_used_image, ai_credits_used_text')
        .eq('id', clientId).single()

      setCreditsImage(client?.ai_credits_image || 0)
      setCreditsText(client?.ai_credits_text || 0)
      setUsedImage(client?.ai_credits_used_image || 0)
      setUsedText(client?.ai_credits_used_text || 0)

      // Migrar formato legado → novo formato com typeId
      if (client?.ai_reference_photos && Array.isArray(client.ai_reference_photos)) {
        const photos: RefPhoto[] = client.ai_reference_photos.map((p: any) => ({
          typeId: p.typeId || p.type || 'geral',
          typeName: p.typeName || p.label || p.type || 'Geral',
          storagePath: p.storagePath,
          url: p.url,
          driveFileId: p.driveFileId || null,
        }))
        setRefPhotos(photos)
      } else if (client?.ai_reference_photo_path) {
        // legado: só tinha uma foto geral
        const url = supabase.storage.from('client-photos').getPublicUrl(client.ai_reference_photo_path).data.publicUrl
        setRefPhotos([{ typeId: 'geral', typeName: 'Geral / Rosto', storagePath: client.ai_reference_photo_path, url }])
      } else {
        setRefPhotos([])
      }
    } catch (e) {
      console.error('Erro ao carregar dados:', e)
    } finally { setLoading(false) }
  }

  // ── Fotos ──────────────────────────────────────────────────

  /** Salva uma foto já existente na galeria como referência de IA (sem upload) */
  const handleSaveRefPhoto = async (type: PhotoType, picked: { url: string; storagePath: string; driveFileId?: string | null }) => {
    const newPhoto: RefPhoto = {
      typeId: type.id,
      typeName: type.name,
      storagePath: picked.storagePath,
      url: picked.url,
      driveFileId: picked.driveFileId || null,
    }
    const updated = [...refPhotos.filter(p => p.typeId !== type.id), newPhoto]
    setRefPhotos(updated)
    await supabase.from('clients').update({
      ai_reference_photos: updated,
      ...(type.id === 'geral' ? { ai_reference_photo_path: picked.storagePath } : {}),
    }).eq('id', clientId)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
    onAfterSaveRefPhotos?.()
  }

  const handlePhotoUpload = async (type: PhotoType, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadingTypeId(type.id)
    try {
      const path = `ai-reference/${clientId}/${type.id}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      await supabase.storage.from('client-photos').upload(path, file, { contentType: file.type, upsert: true })
      const url = supabase.storage.from('client-photos').getPublicUrl(path).data.publicUrl

      const newPhoto: RefPhoto = { typeId: type.id, typeName: type.name, storagePath: path, url }
      const updated = [...refPhotos.filter(p => p.typeId !== type.id), newPhoto]
      setRefPhotos(updated)

      await supabase.from('clients').update({
        ai_reference_photos: updated,
        // manter legado para geral
        ...(type.id === 'geral' ? { ai_reference_photo_path: path } : {}),
      }).eq('id', clientId)

      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
      onAfterSaveRefPhotos?.()
    } catch (err: any) {
      alert('Erro ao enviar foto: ' + err.message)
    } finally { setUploadingTypeId(null) }
  }

  const handleDeletePhoto = async (typeId: string) => {
    if (!confirm('Remover esta foto de referência?')) return
    const photo = refPhotos.find(p => p.typeId === typeId)
    if (!photo) return
    // Só apaga do Supabase Storage se for foto legada (sem driveFileId)
    // Fotos do Drive: só removemos a referência aqui; o arquivo continua no
    // Drive (já que pode estar referenciado na galeria também).
    if (!photo.driveFileId && photo.storagePath) {
      try { await supabase.storage.from('client-photos').remove([photo.storagePath]) } catch {}
    }
    const updated = refPhotos.filter(p => p.typeId !== typeId)
    setRefPhotos(updated)
    await supabase.from('clients').update({
      ai_reference_photos: updated,
      ...(typeId === 'geral' ? { ai_reference_photo_path: null } : {}),
    }).eq('id', clientId)
    onAfterSaveRefPhotos?.()
  }

  // ── Créditos ────────────────────────────────────────────────

  const handleSetCredits = async (img: number, txt: number) => {
    setSavingCredits(true)
    try {
      await supabase.from('clients').update({
        ai_credits_image: Math.max(0, img),
        ai_credits_text: Math.max(0, txt),
      }).eq('id', clientId)
      setCreditsImage(Math.max(0, img))
      setCreditsText(Math.max(0, txt))
    } catch {} finally { setSavingCredits(false) }
  }

  const handleResetUsed = async () => {
    if (!confirm('Zerar contadores de uso?')) return
    await supabase.from('clients').update({ ai_credits_used_image: 0, ai_credits_used_text: 0 }).eq('id', clientId)
    setUsedImage(0)
    setUsedText(0)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin h-6 w-6 border-2 border-violet-400 border-t-transparent rounded-full" />
    </div>
  )

  const hasGeral = refPhotos.some(p => p.typeId === 'geral')

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-violet-500" /> Configuração IA — {clientName}
        </h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Fotos de referência por tipo · créditos · liberação
        </p>
      </div>

      {/* ── Fotos de referência por type ── */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-violet-900 flex items-center gap-2">
              <Camera className="h-4 w-4" /> Fotos de referência
            </p>
            <p className="text-xs text-violet-700 mt-0.5">
              Uma foto por tipo — usada pela IA e no PDF de cada categoria
            </p>
          </div>
          <button onClick={loadData} className="p-1.5 text-violet-400 hover:text-violet-700 hover:bg-violet-100 rounded-lg" title="Recarregar tipos">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {photoTypes.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            ⚠️ Nenhum tipo configurado. Acesse <strong>Configurações → Tipos de Foto</strong>.
          </p>
        )}

        <div className="space-y-3">
          {photoTypes.map(type => {
            const photo = refPhotos.find(p => p.typeId === type.id)
            const isUploading = uploadingTypeId === type.id

            return (
              <div key={type.id} className="bg-white rounded-xl border border-violet-100 p-3">
                <div className="flex items-center gap-3">
                  {/* Ícone do type */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                    style={{ backgroundColor: type.color + '20', border: `2px solid ${type.color}40` }}
                  >
                    {type.icon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{type.name}</p>
                  </div>

                  {/* Foto */}
                  {photo ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setLightboxUrl(photo.url)}
                        className="w-12 h-12 rounded-lg overflow-hidden border-2 border-violet-200 hover:border-violet-500 transition-all flex-shrink-0 group relative"
                        title="Clique para ampliar"
                      >
                        <img src={photo.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px]">🔍</span>
                        </div>
                      </button>
                      <div className="flex flex-col gap-1">
                        {/* Trocar via galeria (se clientPhotos disponível) ou upload */}
                        {clientPhotos ? (
                          <button
                            onClick={() => setGalleryPickerTypeId(type.id)}
                            className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg cursor-pointer text-center whitespace-nowrap"
                          >
                            Trocar
                          </button>
                        ) : (
                          <label className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg cursor-pointer text-center whitespace-nowrap">
                            <input type="file" accept="image/*" className="hidden" onChange={e => handlePhotoUpload(type, e)} />
                            {isUploading ? '...' : 'Trocar'}
                          </label>
                        )}
                        <button
                          onClick={() => setStandardizeTypeId(type.id)}
                          className="text-xs px-2 py-1 bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200 rounded-lg hover:bg-fuchsia-100 whitespace-nowrap flex items-center gap-1 justify-center"
                          title="Aprimorar foto com IA para uso como referência"
                        >
                          <Sparkles className="h-3 w-3" /> Aprimorar
                        </button>
                        <button
                          onClick={() => handleDeletePhoto(type.id)}
                          className="text-xs px-2 py-1 bg-red-50 text-red-500 rounded-lg hover:bg-red-100"
                        >
                          <Trash2 className="h-3 w-3 inline" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Adicionar via galeria (se clientPhotos disponível) ou upload */
                    clientPhotos ? (
                      <button
                        onClick={() => setGalleryPickerTypeId(type.id)}
                        className="text-xs px-3 py-2 border border-dashed border-violet-300 rounded-lg cursor-pointer hover:bg-violet-50 text-violet-600 whitespace-nowrap"
                      >
                        + Adicionar
                      </button>
                    ) : (
                      <label className={`text-xs px-3 py-2 border border-dashed border-violet-300 rounded-lg cursor-pointer hover:bg-violet-50 text-violet-600 whitespace-nowrap ${isUploading ? 'opacity-60' : ''}`}>
                        <input type="file" accept="image/*" className="hidden" onChange={e => handlePhotoUpload(type, e)} />
                        {isUploading ? 'Enviando...' : '+ Adicionar'}
                      </label>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {!hasGeral && photoTypes.some(t => t.id === 'geral') && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            ⚠️ A foto do type <strong>Geral / Rosto</strong> é o fallback padrão da IA
          </p>
        )}

        {saveStatus === 'saved' && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" /> Foto salva!
          </div>
        )}
      </div>

      {/* ── Créditos ── */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
        <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
          <Coins className="h-4 w-4" /> Créditos
        </p>
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <div className="bg-white rounded-lg p-3 border border-amber-100 text-center">
            <p className="text-xs text-gray-500 mb-1">📸 Imagens</p>
            <p className="text-2xl font-bold text-violet-600">{creditsImage}</p>
            <p className="text-xs text-gray-400">{usedImage} usadas</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-amber-100 text-center">
            <p className="text-xs text-gray-500 mb-1">💬 Textos</p>
            <p className="text-2xl font-bold text-blue-600">{creditsText}</p>
            <p className="text-xs text-gray-400">{usedText} usados</p>
          </div>
        </div>
        <div className="bg-white rounded-lg p-3 border border-amber-100 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">📸 Imagens</label>
              <div className="flex items-center gap-1">
                <button onClick={() => handleSetCredits(creditsImage - 1, creditsText)} disabled={savingCredits || creditsImage <= 0}
                  className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center text-red-500 disabled:opacity-30">
                  <Minus className="h-4 w-4" />
                </button>
                <input type="number" value={creditsImage}
                  onChange={e => handleSetCredits(parseInt(e.target.value) || 0, creditsText)}
                  className="w-16 text-center border border-gray-300 rounded-lg py-1.5 text-sm font-bold" />
                <button onClick={() => handleSetCredits(creditsImage + 1, creditsText)} disabled={savingCredits}
                  className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-green-600 disabled:opacity-30">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">💬 Textos</label>
              <div className="flex items-center gap-1">
                <button onClick={() => handleSetCredits(creditsImage, creditsText - 1)} disabled={savingCredits || creditsText <= 0}
                  className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center text-red-500 disabled:opacity-30">
                  <Minus className="h-4 w-4" />
                </button>
                <input type="number" value={creditsText}
                  onChange={e => handleSetCredits(creditsImage, parseInt(e.target.value) || 0)}
                  className="w-16 text-center border border-gray-300 rounded-lg py-1.5 text-sm font-bold" />
                <button onClick={() => handleSetCredits(creditsImage, creditsText + 1)} disabled={savingCredits}
                  className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-green-600 disabled:opacity-30">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleSetCredits(creditsImage + 10, creditsText + 50)} disabled={savingCredits}
              className="flex-1 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
              +10 img +50 txt
            </button>
            <button onClick={handleResetUsed} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs">
              Zerar usados
            </button>
          </div>
        </div>
      </div>

      {/* ── Modal Aprimorar foto com IA ── */}
      {standardizeTypeId && (() => {
        const type = photoTypes.find(t => t.id === standardizeTypeId)
        const photo = refPhotos.find(p => p.typeId === standardizeTypeId)
        if (!type || !photo) return null
        return (
          <StandardizeModal
            clientId={clientId}
            type={type}
            photo={photo}
            onClose={() => setStandardizeTypeId(null)}
            onDone={async (newPhoto) => {
              setStandardizeTypeId(null)
              const updated = [...refPhotos.filter(p => p.typeId !== type.id), newPhoto]
              setRefPhotos(updated)
              await supabase.from('clients').update({ ai_reference_photos: updated }).eq('id', clientId)
              setSaveStatus('saved')
              setTimeout(() => setSaveStatus('idle'), 2000)
              onAfterSaveRefPhotos?.()
            }}
          />
        )
      })()}

      {/* ── GalleryPhotoPicker modal ── */}
      {galleryPickerTypeId && (
        <GalleryPhotoPicker
          typeId={galleryPickerTypeId}
          typeName={photoTypes.find(t => t.id === galleryPickerTypeId)?.name || galleryPickerTypeId}
          clientId={clientId}
          clientPhotos={clientPhotos || []}
          photoCategories={photoCategories || []}
          onClose={() => setGalleryPickerTypeId(null)}
          onSelect={async (picked) => {
            const type = photoTypes.find(t => t.id === galleryPickerTypeId)
            setGalleryPickerTypeId(null)
            if (!type) return
            await handleSaveRefPhoto(type, picked)
          }}
        />
      )}

      {/* ── Liberar para a cliente ── */}
      <div className={`rounded-xl p-4 border space-y-3 ${isReleased ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isReleased ? 'bg-green-100' : 'bg-gray-100'}`}>
            {isReleased ? <Unlock className="h-5 w-5 text-green-600" /> : <Lock className="h-5 w-5 text-gray-400" />}
          </div>
          <div>
            <p className="font-medium text-sm text-gray-800">
              {isReleased ? 'Resultado liberado para a cliente' : 'Resultado ainda não liberado'}
            </p>
            <p className="text-xs text-gray-500">
              {isReleased
                ? `A cliente já pode acessar o resultado${chatEnabled ? ' e o chat IA' : ''}`
                : 'A liberação é feita via Controle de Etapas (conclusão ou liberação parcial).'}
            </p>
          </div>
        </div>

        {/* Toggle chat — visível sempre para permitir alteração após liberação */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-violet-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-800">Chat com IA</p>
                <p className="text-xs text-gray-400">Liberar acesso à consultora virtual</p>
              </div>
            </div>
            <button
              onClick={() => { onChatEnabledChange(!chatEnabled); setChatSaved(false) }}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${chatEnabled ? 'bg-violet-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${chatEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {!chatEnabled && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              A cliente verá apenas os materiais (pasta, PDFs, observações), sem chat.
            </p>
          )}
          {/* Botão salvar — sempre visível para permitir salvar antes ou depois da liberação */}
          <button
            onClick={async () => {
              setSavingChat(true)
              try {
                await onSaveChatEnabled()
                setChatSaved(true)
                setTimeout(() => setChatSaved(false), 2500)
              } finally { setSavingChat(false) }
            }}
            disabled={savingChat}
            className="w-full py-2 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            {savingChat
              ? <div className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
              : chatSaved
                ? <CheckCircle className="h-3.5 w-3.5" />
                : <Save className="h-3.5 w-3.5" />}
            {savingChat ? 'Salvando...' : chatSaved ? 'Salvo!' : 'Salvar configuração do chat'}
          </button>
        </div>

      </div>

      {/* ── Lightbox de zoom para fotos de referência dos cards ── */}
      {lightboxUrl && (
        <ImageLightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// StandardizeModal — aprimora foto de referência via prompt IA
// ══════════════════════════════════════════════════════════════════════════

// Mapeamento: type.id (slug do photoType) → ref_category do prompt
// O type.id pode ser o slug direto ('cabelo', 'roupa', etc.) ou qualquer string.
// Tentamos correspondência exata; se não bater, usamos prompt sem categoria.
function inferRefCategory(typeId: string): string | null {
  const map: Record<string, string> = {
    cabelo:    'cabelo',
    roupa:     'roupa',
    roupas:    'roupa',
    maquiagem: 'maquiagem',
    acessorio: 'acessorio',
    acessórios:'acessorio',
    acessorios:'acessorio',
  }
  return map[typeId.toLowerCase()] ?? null
}

interface StandardizeModalProps {
  clientId: string
  type: PhotoType
  photo: RefPhoto
  onClose: () => void
  onDone: (newPhoto: RefPhoto) => void
}

function StandardizeModal({ clientId, type, photo, onClose, onDone }: StandardizeModalProps) {
  const [prompts, setPrompts]               = useState<any[]>([])
  const [loadingPrompts, setLoadingPrompts] = useState(true)
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [running, setRunning]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [progress, setProgress]             = useState<string>('')
  const [saving, setSaving]                 = useState(false)

  // Preview da imagem gerada — fica aqui até o usuário confirmar ou descartar
  const [previewB64, setPreviewB64]         = useState<string | null>(null)
  const [previewBlob, setPreviewBlob]       = useState<Uint8Array | null>(null)
  // Lightbox — URL da imagem ampliada (null = fechado)
  const [lightbox, setLightbox]             = useState<string | null>(null)

  const refCategory = inferRefCategory(type.id)

  useEffect(() => {
    let cancelled = false
    setLoadingPrompts(true)
    documentsService.listAiImagePrompts({ promptKind: 'ref_standardize' })
      .then(all => {
        if (cancelled) return
        // Filtrar: sem categoria (qualquer) OU categoria bate com o tipo
        const filtered = all.filter(p =>
          !p.ref_category || p.ref_category === refCategory
        )
        setPrompts(filtered)
        if (filtered.length === 1) setSelectedPromptId(filtered[0].id)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingPrompts(false) })
    return () => { cancelled = true }
  }, [type.id])

  const handleRun = async () => {
    const prompt = prompts.find(p => p.id === selectedPromptId)
    if (!prompt) return
    setRunning(true)
    setError(null)

    try {
      // 1. Baixar a foto original como blob
      setProgress('Carregando foto original…')
      let photoBlob: Blob
      if (photo.driveFileId) {
        photoBlob = await driveStorage.fetchPhotoBlob(photo.driveFileId)
      } else if (photo.storagePath) {
        const url = supabase.storage.from('client-photos').getPublicUrl(photo.storagePath).data.publicUrl
        const r = await fetch(url)
        if (!r.ok) throw new Error('Erro ao baixar foto do Storage')
        photoBlob = await r.blob()
      } else {
        throw new Error('Foto sem origem válida')
      }

      // 2. Converter para base64 para enviar à API
      setProgress('Preparando imagem…')
      const base64Photo = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res((reader.result as string).split(',')[1])
        reader.onerror = () => rej(new Error('Erro ao converter imagem'))
        reader.readAsDataURL(photoBlob)
      })

      // 3. Montar o prompt final (usa a primeira parte)
      const promptText = Array.isArray(prompt.parts) && prompt.parts.length > 0
        ? prompt.parts[0].prompt
        : ''
      if (!promptText) throw new Error('O prompt não tem texto definido.')

      // 4. Chamar a Edge Function generate-tag-image (modo standalone)
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
          clientId,
          promptOverride: promptText,
          uploadedImage: {
            base64: base64Photo,
            mime: photoBlob.type || 'image/jpeg',
          },
          // composition mode standalone — não toca em client_tag_values
          composition: { compositionId: `ref_standardize_${type.id}`, index: 0 },
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

      // 5. Guardar resultado como preview (sem salvar ainda)
      setProgress('Imagem gerada!')
      const byteStr = atob(result.imageBase64)
      const arr = new Uint8Array(byteStr.length)
      for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)

      // Data URL para exibir no preview
      const blob = new Blob([arr], { type: 'image/png' })
      const dataUrl = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result as string)
        reader.onerror = () => rej(new Error('Erro ao converter preview'))
        reader.readAsDataURL(blob)
      })

      setPreviewB64(dataUrl)
      setPreviewBlob(arr)
      setRunning(false)

    } catch (err: any) {
      setError(err.message || 'Erro ao aprimorar foto')
      setRunning(false)
    }
  }

  // Chamado quando o usuário confirma "Usar esta foto"
  const handleConfirm = async () => {
    if (!previewBlob) return
    setSaving(true)
    try {
      const resultFile = new File([previewBlob], `ref_${type.id}_aprimorada_${Date.now()}.png`, { type: 'image/png' })
      const uploadResult = await driveStorage.adminUploadPhoto({
        clientId,
        file: resultFile,
        categoryId: null,
      })
      const newPhoto: RefPhoto = {
        typeId: type.id,
        typeName: type.name,
        storagePath: '',
        url: uploadResult.url,
        driveFileId: uploadResult.driveFileId,
      }
      onDone(newPhoto)
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar foto')
      setSaving(false)
    }
  }

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId)

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
        onClick={e => { if (e.target === e.currentTarget && !running && !saving) onClose() }}
      >
        <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-fuchsia-50 to-violet-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-fuchsia-500 to-violet-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-sm text-gray-900">
                  {previewB64 ? 'Resultado gerado' : 'Aprimorar foto de referência'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {type.name} · Padronização Profissional para IA Capilar
                </p>
              </div>
            </div>
            {!running && !saving && (
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* ── TELA DE PREVIEW ── */}
            {previewB64 ? (
              <>
                <p className="text-xs text-gray-500 text-center">
                  Toque na imagem para ampliar. Se gostar, clique em <strong>Usar esta foto</strong>.
                </p>

                {/* Comparação: antes × depois */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-gray-500 text-center uppercase tracking-wide">Antes</p>
                    <button
                      onClick={() => setLightbox(photo.url)}
                      className="w-full aspect-square rounded-xl overflow-hidden border border-gray-200 hover:border-gray-400 transition-all relative group"
                    >
                      <img
                        src={photo.url}
                        alt="Antes"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-[11px] px-2 py-1 rounded-lg">
                          🔍 Ampliar
                        </span>
                      </div>
                    </button>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-fuchsia-600 text-center uppercase tracking-wide">Depois ✨</p>
                    <button
                      onClick={() => setLightbox(previewB64)}
                      className="w-full aspect-square rounded-xl overflow-hidden border-2 border-fuchsia-300 hover:border-fuchsia-500 transition-all relative group"
                    >
                      <img
                        src={previewB64}
                        alt="Resultado"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-[11px] px-2 py-1 rounded-lg">
                          🔍 Ampliar
                        </span>
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
                {/* ── TELA DE CONFIGURAÇÃO ── */}

                {/* Preview da foto atual */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <img src={photo.url} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-gray-200" />
                  <div>
                    <p className="text-xs font-semibold text-gray-700">Foto atual — {type.name}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      A IA vai aprimorar esta foto e a nova versão virará a referência.
                    </p>
                  </div>
                </div>

                {/* Seletor de prompt */}
                {loadingPrompts ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-violet-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Carregando prompts…</span>
                  </div>
                ) : prompts.length === 0 ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-1">
                    <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto" />
                    <p className="text-sm font-medium text-amber-800">Nenhum prompt cadastrado</p>
                    <p className="text-xs text-amber-600">
                      Acesse <strong>Documentos → Prompts IA</strong> e crie um prompt do tipo
                      <strong> "Aprimorar foto de referência"</strong>
                      {refCategory ? ` para a categoria "${REF_CATEGORIES.find(c => c.value === refCategory)?.label}"` : ''}.
                    </p>
                  </div>
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
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                          {p.ref_category && (
                            <p className="text-[11px] text-fuchsia-600 mt-0.5">
                              {REF_CATEGORIES.find(c => c.value === p.ref_category)?.emoji}{' '}
                              {REF_CATEGORIES.find(c => c.value === p.ref_category)?.label}
                            </p>
                          )}
                        </div>
                        {selectedPromptId === p.id && (
                          <CheckCircle className="h-4 w-4 text-fuchsia-500 flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Progresso / erro */}
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
                  onClick={() => { setPreviewB64(null); setPreviewBlob(null); setError(null) }}
                  disabled={saving}
                  className="flex-1 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Tentar novamente
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={saving}
                  className="flex-1 py-2 text-sm font-semibold text-white bg-gradient-to-r from-fuchsia-500 to-violet-500 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</>
                    : <><CheckCircle className="h-4 w-4" /> Usar esta foto</>
                  }
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
                  className="flex-1 py-2 text-sm font-semibold text-white bg-gradient-to-r from-fuchsia-500 to-violet-500 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {running
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Processando…</>
                    : <><Sparkles className="h-4 w-4" /> Aprimorar foto</>
                  }
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Lightbox de zoom ── */}
      {lightbox && (
        <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// DriveImage — carrega foto do Drive via proxy autenticado (evita CORS)
// ══════════════════════════════════════════════════════════════════════════

interface DriveImageProps {
  photo: any
  alt: string
  className?: string
}

function DriveImage({ photo, alt, className }: DriveImageProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    if (photo.drive_file_id) {
      // Busca via proxy autenticado para evitar bloqueio CORS/auth do Drive
      driveStorage.fetchPhotoBlob(photo.drive_file_id)
        .then(blob => {
          if (cancelled) return
          objectUrl = URL.createObjectURL(blob)
          setSrc(objectUrl)
        })
        .catch(() => {
          if (!cancelled) setError(true)
        })
    } else if (photo.storage_path) {
      // Legado: Supabase Storage — URL pública direta
      const url = supabase.storage.from('client-photos').getPublicUrl(photo.storage_path).data.publicUrl
      setSrc(url)
    } else if (photo.url) {
      setSrc(photo.url)
    } else {
      setError(true)
    }

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.drive_file_id, photo.storage_path, photo.url])

  if (error) {
    return (
      <div className={`${className} flex items-center justify-center bg-gray-100`}>
        <Camera className="h-5 w-5 text-gray-300" />
      </div>
    )
  }

  if (!src) {
    return (
      <div className={`${className} flex items-center justify-center bg-gray-100 animate-pulse`}>
        <Loader2 className="h-4 w-4 text-gray-300 animate-spin" />
      </div>
    )
  }

  return <img src={src} alt={alt} className={className} />
}

// ══════════════════════════════════════════════════════════════════════════
// GalleryPhotoPicker — seleciona foto da galeria da cliente por categoria
// ══════════════════════════════════════════════════════════════════════════

interface GalleryPhotoPickerProps {
  typeId: string
  typeName: string
  clientId: string
  clientPhotos: any[]
  photoCategories: any[]
  onClose: () => void
  onSelect: (picked: { url: string; storagePath: string; driveFileId?: string | null }) => void
}

function GalleryPhotoPicker({
  typeId, typeName, clientId, clientPhotos, photoCategories, onClose, onSelect,
}: GalleryPhotoPickerProps) {
  // ── mode: null = tela inicial, 'gallery' = escolher da galeria, 'upload' = fazer upload
  const [mode, setMode] = useState<null | 'gallery' | 'upload'>(null)

  // ── gallery flow
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null)

  // ── upload flow
  const [uploadCatId, setUploadCatId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadInputRef = React.useRef<HTMLInputElement>(null)

  const catName = (cat: any) => cat.title || cat.name || 'Sem nome'

  // Categorias que têm pelo menos uma foto (para galeria)
  const catsWithPhotos = photoCategories.filter((cat: any) =>
    clientPhotos.some((p: any) => p.category_id === cat.id)
  )

  // Fotos da categoria selecionada com pelo menos uma origem válida
  const photosInCat = selectedCatId
    ? clientPhotos.filter((p: any) =>
        p.category_id === selectedCatId &&
        !!(p.drive_file_id || p.storage_path || p.url)
      )
    : []

  const selectedCat = photoCategories.find(c => c.id === selectedCatId)
  const uploadCat = photoCategories.find(c => c.id === uploadCatId)

  // ── upload handler
  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !uploadCatId) return
    e.target.value = ''
    setUploading(true)
    setUploadError(null)
    try {
      const result = await driveStorage.adminUploadPhoto({
        clientId,
        file,
        categoryId: uploadCatId,
      })
      onSelect({
        url: result.url,
        storagePath: '',
        driveFileId: result.driveFileId,
      })
    } catch (err: any) {
      setUploadError(err.message || 'Erro ao enviar foto')
      setUploading(false)
    }
  }

  // ── header title/subtitle logic
  const headerTitle = () => {
    if (mode === null) return 'Adicionar foto de referência'
    if (mode === 'gallery') {
      if (selectedCatId) return <span>Escolher foto — <span className="text-violet-600">{catName(selectedCat)}</span></span>
      return 'Escolher da galeria'
    }
    if (mode === 'upload') {
      if (uploadCatId) return <span>Enviar para — <span className="text-violet-600">{catName(uploadCat)}</span></span>
      return 'Fazer upload'
    }
  }
  const headerSub = () => {
    if (mode === null) return `Referência para: ${typeName}`
    if (mode === 'gallery' && selectedCatId) return 'Toque na foto para usar como referência'
    if (mode === 'gallery') return 'De qual categoria você quer buscar a foto?'
    if (mode === 'upload' && uploadCatId) return 'Escolha o arquivo para enviar'
    if (mode === 'upload') return 'Selecione a categoria de destino'
    return ''
  }

  // ── back button
  const handleBack = () => {
    if (mode === 'gallery' && selectedCatId) { setSelectedCatId(null); return }
    if (mode === 'upload' && uploadCatId) { setUploadCatId(null); setUploadError(null); return }
    setMode(null)
    setSelectedCatId(null)
    setUploadCatId(null)
    setUploadError(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {mode !== null && (
              <button
                onClick={handleBack}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 -ml-1 mr-0.5 transition-colors"
                aria-label="Voltar"
              >
                ←
              </button>
            )}
            <div>
              <p className="font-semibold text-sm text-gray-900">{headerTitle()}</p>
              <p className="text-xs text-gray-400 mt-0.5">{headerSub()}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto">

          {/* ══ Tela inicial: dois modos ══ */}
          {mode === null && (
            <div className="p-5 space-y-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-1 mb-4">
                Como deseja adicionar?
              </p>
              <button
                onClick={() => setMode('gallery')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-violet-400 hover:bg-violet-50 transition-all text-left group"
              >
                <div className="w-11 h-11 rounded-xl bg-violet-50 group-hover:bg-violet-100 flex items-center justify-center flex-shrink-0 transition-colors">
                  <FolderOpen className="h-5 w-5 text-violet-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">Escolher da galeria</p>
                  <p className="text-xs text-gray-400 mt-0.5">Selecione uma foto já enviada pela cliente</p>
                </div>
                <span className="text-gray-300 group-hover:text-violet-400 transition-colors flex-shrink-0 text-lg">→</span>
              </button>
              <button
                onClick={() => setMode('upload')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-pink-400 hover:bg-pink-50 transition-all text-left group"
              >
                <div className="w-11 h-11 rounded-xl bg-pink-50 group-hover:bg-pink-100 flex items-center justify-center flex-shrink-0 transition-colors">
                  <Upload className="h-5 w-5 text-pink-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">Fazer upload</p>
                  <p className="text-xs text-gray-400 mt-0.5">Envie uma nova foto e adicione à galeria</p>
                </div>
                <span className="text-gray-300 group-hover:text-pink-400 transition-colors flex-shrink-0 text-lg">→</span>
              </button>
            </div>
          )}

          {/* ══ Modo galeria ══ */}
          {mode === 'gallery' && (
            <>
              {/* Etapa 1: tiles de categoria */}
              {!selectedCatId && (
                <div className="p-4 space-y-3">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-1">
                    Categoria de fotos:
                  </p>
                  {catsWithPhotos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                      <FolderOpen className="h-10 w-10 mb-2 opacity-30" />
                      <p className="text-sm">Nenhuma foto cadastrada para esta cliente</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {catsWithPhotos.map((cat: any) => {
                        const count = clientPhotos.filter((p: any) => p.category_id === cat.id).length
                        return (
                          <button
                            key={cat.id}
                            onClick={() => setSelectedCatId(cat.id)}
                            className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:border-pink-300 hover:bg-pink-50 transition-all text-left group"
                          >
                            <div className="w-9 h-9 rounded-lg bg-pink-50 group-hover:bg-pink-100 flex items-center justify-center flex-shrink-0 transition-colors">
                              <FolderOpen className="h-4 w-4 text-pink-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 leading-snug truncate">{catName(cat)}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{count} foto{count !== 1 ? 's' : ''}</p>
                            </div>
                            <span className="text-gray-300 group-hover:text-pink-400 transition-colors flex-shrink-0">→</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 2: grid de fotos da categoria */}
              {selectedCatId && (
                <div className="p-4">
                  {photosInCat.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                      <Camera className="h-10 w-10 mb-2 opacity-30" />
                      <p className="text-sm">Nenhuma foto nesta categoria.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {photosInCat.map((photo: any) => (
                        <button
                          key={photo.id}
                          onClick={() => {
                            const url = photo.drive_file_id
                              ? driveStorage.viewUrl(photo.drive_file_id)
                              : photo.url || (photo.storage_path
                                  ? supabase.storage.from('client-photos').getPublicUrl(photo.storage_path).data.publicUrl
                                  : '')
                            onSelect({
                              url,
                              storagePath: photo.storage_path || '',
                              driveFileId: photo.drive_file_id || null,
                            })
                          }}
                          className="aspect-square rounded-xl overflow-hidden border-2 border-transparent hover:border-violet-500 focus:outline-none focus:border-violet-500 transition-all group bg-gray-100"
                        >
                          <DriveImage
                            photo={photo}
                            alt={photo.photo_name || ''}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ══ Modo upload ══ */}
          {mode === 'upload' && (
            <>
              {/* Etapa 1: selecionar categoria de destino */}
              {!uploadCatId && (
                <div className="p-4 space-y-3">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-1">
                    Para qual categoria enviar?
                  </p>
                  {photoCategories.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                      <FolderOpen className="h-10 w-10 mb-2 opacity-30" />
                      <p className="text-sm">Nenhuma categoria cadastrada</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {photoCategories.map((cat: any) => (
                        <button
                          key={cat.id}
                          onClick={() => setUploadCatId(cat.id)}
                          className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:border-pink-300 hover:bg-pink-50 transition-all text-left group"
                        >
                          <div className="w-9 h-9 rounded-lg bg-pink-50 group-hover:bg-pink-100 flex items-center justify-center flex-shrink-0 transition-colors">
                            <FolderOpen className="h-4 w-4 text-pink-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 leading-snug truncate">{catName(cat)}</p>
                          </div>
                          <span className="text-gray-300 group-hover:text-pink-400 transition-colors flex-shrink-0">→</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 2: área de upload */}
              {uploadCatId && (
                <div className="p-5 flex flex-col items-center gap-4">
                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUploadFile}
                    disabled={uploading}
                  />

                  {uploading ? (
                    <div className="w-full flex flex-col items-center justify-center py-12 gap-3 text-violet-600">
                      <Loader2 className="h-10 w-10 animate-spin" />
                      <p className="text-sm font-medium">Enviando foto...</p>
                      <p className="text-xs text-gray-400">Salvando na galeria e na referência IA</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => uploadInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-3 py-12 px-6 rounded-2xl border-2 border-dashed border-pink-300 hover:border-pink-500 hover:bg-pink-50 transition-all group"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-pink-50 group-hover:bg-pink-100 flex items-center justify-center transition-colors">
                        <ImagePlus className="h-7 w-7 text-pink-400 group-hover:text-pink-600 transition-colors" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-gray-700 group-hover:text-gray-900">Clique para escolher a foto</p>
                        <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP — a foto será salva na galeria da cliente</p>
                      </div>
                    </button>
                  )}

                  {uploadError && (
                    <div className="w-full flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
                      <span className="flex-shrink-0">⚠️</span>
                      <span>{uploadError}</span>
                      <button
                        onClick={() => setUploadError(null)}
                        className="ml-auto text-red-400 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancelar
          </button>
        </div>

      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// DriveProxyImg — carrega URLs do Drive pelo proxy autenticado
// ══════════════════════════════════════════════════════════════════════════

function DriveProxyImg({ src, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(src)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
    if (!src) return
    const m = src.match(/[?&]id=([^&]+)/)
    if (!src.includes('drive.google.com') || !m) { setResolvedSrc(src); return }
    let objectUrl: string | null = null
    driveStorage.fetchPhotoBlob(m[1])
      .then(blob => { objectUrl = URL.createObjectURL(blob); setResolvedSrc(objectUrl) })
      .catch(() => setResolvedSrc(src))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src])
  if (!resolvedSrc || failed) return null
  return <img src={resolvedSrc} {...props} onError={() => setFailed(true)} />
}

// ══════════════════════════════════════════════════════════════════════════
// ImageLightbox — foto em tela cheia com zoom, arraste, pinch e download
// ══════════════════════════════════════════════════════════════════════════

export function ImageLightbox({ src, mimeType, onClose }: { src: string; mimeType?: string; onClose: () => void }) {
  const [scale, setScale]   = useState(1)
  const [pos,   setPos]     = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Zoom via scroll do mouse
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setScale(s => Math.min(5, Math.max(0.5, s * (1 - e.deltaY * 0.001))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Fecha com Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Arraste para mover (só quando zoom > 1)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return
    e.preventDefault()
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return
    setPos({
      x: dragStart.current.px + (e.clientX - dragStart.current.mx),
      y: dragStart.current.py + (e.clientY - dragStart.current.my),
    })
  }
  const handleMouseUp = () => { setDragging(false); dragStart.current = null }

  // Touch: pinch-to-zoom
  const lastTouch = useRef<{ dist: number; scale: number } | null>(null)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastTouch.current = { dist: Math.hypot(dx, dy), scale }
    }
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouch.current) {
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      const next = Math.min(5, Math.max(0.5, lastTouch.current.scale * (dist / lastTouch.current.dist)))
      setScale(next)
    }
  }

  const resetZoom = () => { setScale(1); setPos({ x: 0, y: 0 }) }

  const handleDownload = async () => {
    const ext = mimeType?.includes('png') ? 'png' : 'jpg'
    const fileName = `foto_referencia.${ext}`
    if (src.startsWith('data:')) {
      const a = document.createElement('a'); a.href = src; a.download = fileName; a.click(); return
    }
    // Drive URL — usa proxy
    const driveMatch = src.includes('drive.google.com') && src.match(/[?&]id=([^&]+)/)
    if (driveMatch) {
      try {
        const blob = await driveStorage.fetchPhotoBlob(driveMatch[1])
        const objUrl = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = objUrl; a.download = fileName
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(objUrl), 2000)
        return
      } catch {}
    }
    window.open(src, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/92 flex items-center justify-center"
      onClick={onClose}
      ref={containerRef}
    >
      {/* Barra superior */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10"
        onClick={e => e.stopPropagation()}
      >
        <span className="text-white/60 text-xs select-none">📸 Foto de referência</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-400 text-white text-xs font-semibold rounded-full px-3.5 py-1.5 shadow-lg shadow-violet-900/40 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Baixar
          </button>
          <button
            onClick={onClose}
            className="bg-violet-500 hover:bg-violet-400 text-white rounded-full p-1.5 shadow-lg shadow-violet-900/40 transition-colors"
            title="Fechar (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Imagem */}
      <div
        className="relative select-none"
        style={{ cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onClick={e => e.stopPropagation()}
      >
        <DriveProxyImg
          src={src}
          alt="Foto de referência"
          draggable={false}
          style={{
            transform: `scale(${scale}) translate(${pos.x / scale}px, ${pos.y / scale}px)`,
            transition: dragging ? 'none' : 'transform 0.12s ease',
            maxWidth:  '92vw',
            maxHeight: '82vh',
            objectFit: 'contain',
          }}
          className="rounded-xl shadow-2xl"
        />
      </div>

      {/* Barra de zoom */}
      <div
        className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/50 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 z-10"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))} className="text-white/70 hover:text-white transition-colors" title="Diminuir zoom">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={resetZoom} className="text-white text-xs font-mono min-w-[3rem] text-center hover:text-white/70 transition-colors" title="Resetar zoom">
          {Math.round(scale * 100)}%
        </button>
        <button onClick={() => setScale(s => Math.min(5, +(s + 0.25).toFixed(2)))} className="text-white/70 hover:text-white transition-colors" title="Aumentar zoom">
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>

      {/* Dica */}
      <p
        className="absolute bottom-14 left-1/2 -translate-x-1/2 text-white/30 text-[11px] whitespace-nowrap pointer-events-none select-none"
        style={{ animation: 'fadeOutHint 0.5s ease 2.5s forwards' }}
      >
        Scroll para zoom · Arraste para mover · Esc para fechar
      </p>
      <style>{`@keyframes fadeOutHint { to { opacity: 0 } }`}</style>
    </div>
  )
}