// src/components/admin/AIPromptConfig.tsx
import React, { useState, useEffect, useRef } from 'react'
import {
  Wand2, Save, CheckCircle, AlertCircle, Camera, Trash2, Upload,
  Coins, Plus, Minus, Send, Lock, Unlock
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface AIPromptConfigProps {
  clientId: string
  clientName: string
  isReleased: boolean
  onRelease: () => void
  releasingResult: boolean
}

// ── Fotos de referência tipadas ─────────────────────────────

interface RefPhoto {
  type: 'cabelo' | 'roupa' | 'geral'
  label: string
  storagePath: string
  url: string
}

const PHOTO_SLOTS: { type: RefPhoto['type']; label: string; desc: string; icon: string }[] = [
  { type: 'cabelo', label: 'Foto para Cabelo', desc: 'Usada pela IA em análises e geração de cabelo', icon: '✂️' },
  { type: 'roupa', label: 'Foto para Roupas / Look', desc: 'Usada em análises de look e roupas', icon: '👗' },
  { type: 'geral', label: 'Foto Geral / Rosto', desc: 'Referência padrão (rosto da cliente)', icon: '📷' },
]

export function AIPromptConfig({ clientId, clientName, isReleased, onRelease, releasingResult }: AIPromptConfigProps) {
  const [refPhotos, setRefPhotos] = useState<RefPhoto[]>([])
  const [uploadingType, setUploadingType] = useState<RefPhoto['type'] | null>(null)

  const [creditsImage, setCreditsImage] = useState(0)
  const [creditsText, setCreditsText] = useState(0)
  const [usedImage, setUsedImage] = useState(0)
  const [usedText, setUsedText] = useState(0)
  const [savingCredits, setSavingCredits] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const photoRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => { loadData() }, [clientId])

  const loadData = async () => {
    setLoading(true)
    try {
      const { data: client } = await supabase
        .from('clients')
        .select('ai_reference_photos, ai_reference_photo_path, ai_credits_image, ai_credits_text, ai_credits_used_image, ai_credits_used_text')
        .eq('id', clientId).single()

      setCreditsImage(client?.ai_credits_image || 0)
      setCreditsText(client?.ai_credits_text || 0)
      setUsedImage(client?.ai_credits_used_image || 0)
      setUsedText(client?.ai_credits_used_text || 0)

      // Suporte legado: se só tem ai_reference_photo_path, converte para array
      if (client?.ai_reference_photos && Array.isArray(client.ai_reference_photos)) {
        setRefPhotos(client.ai_reference_photos)
      } else if (client?.ai_reference_photo_path) {
        const url = supabase.storage.from('client-photos').getPublicUrl(client.ai_reference_photo_path).data.publicUrl
        setRefPhotos([{ type: 'geral', label: 'Foto Geral/Rosto', storagePath: client.ai_reference_photo_path, url }])
      } else {
        setRefPhotos([])
      }
    } catch {} finally { setLoading(false) }
  }

  // ── Fotos ──────────────────────────────────────────────────

  const handlePhotoUpload = async (type: RefPhoto['type'], e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    setUploadingType(type)
    try {
      const path = `ai-reference/${clientId}/${type}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      await supabase.storage.from('client-photos').upload(path, file, { contentType: file.type, upsert: true })
      const url = supabase.storage.from('client-photos').getPublicUrl(path).data.publicUrl

      const slot = PHOTO_SLOTS.find(s => s.type === type)!
      const newPhoto: RefPhoto = { type, label: slot.label, storagePath: path, url }

      const updated = [...refPhotos.filter(p => p.type !== type), newPhoto]
      setRefPhotos(updated)

      await supabase.from('clients').update({
        ai_reference_photos: updated,
        // Manter legado: se for geral, atualiza ai_reference_photo_path também
        ...(type === 'geral' ? { ai_reference_photo_path: path } : {}),
      }).eq('id', clientId)

      setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setUploadingType(null) }
  }

  const handleDeletePhoto = async (type: RefPhoto['type']) => {
    if (!confirm('Remover esta foto?')) return
    const photo = refPhotos.find(p => p.type === type)
    if (!photo) return
    try { await supabase.storage.from('client-photos').remove([photo.storagePath]) } catch {}
    const updated = refPhotos.filter(p => p.type !== type)
    setRefPhotos(updated)
    await supabase.from('clients').update({
      ai_reference_photos: updated,
      ...(type === 'geral' ? { ai_reference_photo_path: null } : {}),
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
      setCreditsImage(Math.max(0, img)); setCreditsText(Math.max(0, txt))
    } catch {} finally { setSavingCredits(false) }
  }

  const handleResetUsed = async () => {
    if (!confirm('Zerar contadores?')) return
    await supabase.from('clients').update({ ai_credits_used_image: 0, ai_credits_used_text: 0 }).eq('id', clientId)
    setUsedImage(0); setUsedText(0)
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-violet-400 border-t-transparent rounded-full" /></div>

  const photosComplete = refPhotos.filter(p => p.type === 'geral').length > 0
  const inp = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-violet-500" /> Configuração IA — {clientName}
        </h3>
        <p className="text-sm text-gray-500 mt-0.5">Fotos de referência, créditos e liberação</p>
      </div>

      {/* ── Fotos de referência ── */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-violet-900 flex items-center gap-2">
            <Camera className="h-4 w-4" /> Fotos de referência da cliente
          </p>
          <p className="text-xs text-violet-700 mt-0.5">
            A IA usa a foto correta por categoria — cabelo para ✂️, roupas para 👗, geral como padrão
          </p>
        </div>

        <div className="space-y-3">
          {PHOTO_SLOTS.map(slot => {
            const photo = refPhotos.find(p => p.type === slot.type)
            const isUploading = uploadingType === slot.type

            return (
              <div key={slot.type} className="bg-white rounded-xl border border-violet-100 p-3">
                <div className="flex items-center gap-3">
                  <div className="text-xl w-8 text-center">{slot.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{slot.label}</p>
                    <p className="text-xs text-gray-400">{slot.desc}</p>
                  </div>

                  {photo ? (
                    <div className="flex items-center gap-2">
                      <img src={photo.url} alt="" className="w-12 h-12 rounded-lg object-cover border-2 border-violet-200" />
                      <div className="flex flex-col gap-1">
                        <label className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg cursor-pointer text-center">
                          <input
                            type="file" accept="image/*" className="hidden"
                            onChange={e => handlePhotoUpload(slot.type, e)}
                          />
                          {isUploading ? '...' : 'Trocar'}
                        </label>
                        <button
                          onClick={() => handleDeletePhoto(slot.type)}
                          className="text-xs px-2 py-1 bg-red-50 text-red-500 rounded-lg"
                        >
                          <Trash2 className="h-3 w-3 inline" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className={`text-xs px-3 py-2 border border-dashed border-violet-300 rounded-lg cursor-pointer hover:bg-violet-50 text-violet-600 ${isUploading ? 'opacity-60' : ''}`}>
                      <input
                        type="file" accept="image/*" className="hidden"
                        onChange={e => handlePhotoUpload(slot.type, e)}
                      />
                      {isUploading ? 'Enviando...' : '+ Adicionar'}
                    </label>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {!photosComplete && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            ⚠️ A Foto Geral/Rosto é obrigatória para a IA funcionar
          </p>
        )}
      </div>

      {/* ── Créditos ── */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
        <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
          <Coins className="h-4 w-4" /> Créditos
        </p>
        <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">📸 Imagens</label>
              <div className="flex items-center gap-1">
                <button onClick={() => handleSetCredits(creditsImage - 1, creditsText)} disabled={savingCredits || creditsImage <= 0}
                  className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center text-red-500 disabled:opacity-30"><Minus className="h-4 w-4" /></button>
                <input type="number" value={creditsImage} onChange={e => handleSetCredits(parseInt(e.target.value) || 0, creditsText)}
                  className="w-16 text-center border border-gray-300 rounded-lg py-1.5 text-sm font-bold" />
                <button onClick={() => handleSetCredits(creditsImage + 1, creditsText)} disabled={savingCredits}
                  className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-green-600 disabled:opacity-30"><Plus className="h-4 w-4" /></button>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">💬 Textos</label>
              <div className="flex items-center gap-1">
                <button onClick={() => handleSetCredits(creditsImage, creditsText - 1)} disabled={savingCredits || creditsText <= 0}
                  className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center text-red-500 disabled:opacity-30"><Minus className="h-4 w-4" /></button>
                <input type="number" value={creditsText} onChange={e => handleSetCredits(creditsImage, parseInt(e.target.value) || 0)}
                  className="w-16 text-center border border-gray-300 rounded-lg py-1.5 text-sm font-bold" />
                <button onClick={() => handleSetCredits(creditsImage, creditsText + 1)} disabled={savingCredits}
                  className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-green-600 disabled:opacity-30"><Plus className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleSetCredits(creditsImage + 10, creditsText + 50)} disabled={savingCredits}
              className="flex-1 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">+10 img +50 txt</button>
            <button onClick={handleResetUsed} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs">Zerar usados</button>
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
                ? 'A cliente já pode acessar o resultado e a IA'
                : 'A cliente ainda não vê o resultado. Libere quando estiver pronto.'}
            </p>
          </div>
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

      {saveStatus === 'saved' && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle className="h-4 w-4" /> Foto salva!
        </div>
      )}
    </div>
  )
}