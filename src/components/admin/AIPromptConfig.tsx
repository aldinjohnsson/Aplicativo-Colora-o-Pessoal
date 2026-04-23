// src/components/admin/AIPromptConfig.tsx
import React, { useState, useEffect } from 'react'
import {
  Wand2, Save, CheckCircle, Camera, Trash2,
  Coins, Plus, Minus, Send, Lock, Unlock, RefreshCw, MessageSquare
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { photoTypesService, PhotoType } from './PhotoTypesManager'

interface AIPromptConfigProps {
  clientId: string
  clientName: string
  isReleased: boolean
  onRelease: () => void
  releasingResult: boolean
  chatEnabled: boolean
  onChatEnabledChange: (v: boolean) => void
  onSaveChatEnabled: () => Promise<void>
}

// ── Foto de referência vinculada a um type ──────────────────

export interface RefPhoto {
  typeId: string
  typeName: string
  storagePath: string
  url: string
}

export function AIPromptConfig({ clientId, clientName, isReleased, onRelease, releasingResult, chatEnabled, onChatEnabledChange, onSaveChatEnabled }: AIPromptConfigProps) {
  const [photoTypes, setPhotoTypes] = useState<PhotoType[]>([])
  const [refPhotos, setRefPhotos] = useState<RefPhoto[]>([])
  const [uploadingTypeId, setUploadingTypeId] = useState<string | null>(null)

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
    } catch (err: any) {
      alert('Erro ao enviar foto: ' + err.message)
    } finally { setUploadingTypeId(null) }
  }

  const handleDeletePhoto = async (typeId: string) => {
    if (!confirm('Remover esta foto de referência?')) return
    const photo = refPhotos.find(p => p.typeId === typeId)
    if (!photo) return
    try { await supabase.storage.from('client-photos').remove([photo.storagePath]) } catch {}
    const updated = refPhotos.filter(p => p.typeId !== typeId)
    setRefPhotos(updated)
    await supabase.from('clients').update({
      ai_reference_photos: updated,
      ...(typeId === 'geral' ? { ai_reference_photo_path: null } : {}),
    }).eq('id', clientId)
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
                      <img src={photo.url} alt="" className="w-12 h-12 rounded-lg object-cover border-2 border-violet-200" />
                      <div className="flex flex-col gap-1">
                        <label className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg cursor-pointer text-center whitespace-nowrap">
                          <input type="file" accept="image/*" className="hidden" onChange={e => handlePhotoUpload(type, e)} />
                          {isUploading ? '...' : 'Trocar'}
                        </label>
                        <button
                          onClick={() => handleDeletePhoto(type.id)}
                          className="text-xs px-2 py-1 bg-red-50 text-red-500 rounded-lg hover:bg-red-100"
                        >
                          <Trash2 className="h-3 w-3 inline" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className={`text-xs px-3 py-2 border border-dashed border-violet-300 rounded-lg cursor-pointer hover:bg-violet-50 text-violet-600 whitespace-nowrap ${isUploading ? 'opacity-60' : ''}`}>
                      <input type="file" accept="image/*" className="hidden" onChange={e => handlePhotoUpload(type, e)} />
                      {isUploading ? 'Enviando...' : '+ Adicionar'}
                    </label>
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
                : 'A cliente ainda não vê o resultado. Libere quando estiver pronto.'}
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
          {/* Botão salvar — só aparece quando o resultado já foi liberado */}
          {isReleased && (
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
          )}
        </div>

        {!isReleased && (
          <button
            onClick={onRelease}
            disabled={releasingResult}
            className="w-full py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {releasingResult
              ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              : <Send className="h-4 w-4" />}
            {releasingResult ? 'Liberando...' : 'Salvar e Liberar para a Cliente'}
          </button>
        )}
      </div>
    </div>
  )
}