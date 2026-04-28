// src/components/client/GeminiChat.tsx
// ── Responsive mobile updates:
//   • Use 100dvh instead of 100vh (avoids iOS toolbar collapse issues)
//   • Bottom input area has pb-safe for safe-area-inset on notched phones
//   • Nav grid adapts better on narrow screens
//   • Header info compresses gracefully
import React, { useState, useRef, useEffect } from 'react'
import {
  Send, X, Loader2, AlertCircle, Bot, User, Download,
  Wand2, RefreshCw, ArrowLeft, Scissors, Palette, Shirt, Gem, FolderOpen, Trash2,
  FileText, CheckSquare, Square
} from 'lucide-react'
import {
  chatWithGemini, getGeminiApiKey, fileToBase64, urlToBase64,
  GeminiMessage, GeminiResponsePart, MaterialData,
} from '../../lib/geminiService'
import { supabase } from '../../lib/supabase'
import { downloadStylePDF, ItemLayout } from '../../lib/templatePDFGenerator'

interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string
  imagePreview?: string; imageBase64?: string; imageMimeType?: string
  responseParts?: GeminiResponsePart[]; timestamp: Date
  loading?: boolean; error?: string; imageGenerationFailed?: boolean
  savedImageUrls?: string[]
  pdfMeta?: PdfMeta
}

type PdfSection = string
interface PdfMeta { section: PdfSection; label: string; caption: string; promptId?: string }
interface PromptImage { url: string; storagePath: string; label: string }
interface SubOption { id: string; name: string; thumbnail: PromptImage | null; instruction: string; images: PromptImage[] }
interface Prompt { id: string; name: string; instructions: string; images: PromptImage[]; thumbnail: PromptImage | null; options: string[]; tintReference: string; reference: string; lengths: SubOption[]; textures: SubOption[]; pdfLayout?: ItemLayout }
interface Category { id: string; name: string; icon: string; type: string; refPhotoType?: string; prompts: Prompt[] }
interface FolderConfig { folderName: string; baseInstructions: string; categories: Category[] }
interface ResultFile { url: string; name: string }
interface RefPhoto { type: string; label: string; storagePath: string; url: string }

interface GeminiChatProps {
  clientName: string; systemPrompt: string
  referencePhotoUrl?: string | null
  referencePhotos?: RefPhoto[]
  folderConfig?: FolderConfig | null
  clientId?: string
  resultFileUrls?: ResultFile[]
  resultObservations?: string
}

const uid = () => Math.random().toString(36).slice(2)
const ftime = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const ICONS: Record<string, any> = { scissors: Scissors, palette: Palette, shirt: Shirt, gem: Gem, folder: FolderOpen }
const chatKey = (clientId: string) => `mscolors_chat_${clientId}`

function serializeMessages(msgs: ChatMsg[]): string {
  const lean = msgs.filter(m => !m.loading && !m.error).map(m => ({
    ...m, imagePreview: undefined,
    responseParts: m.responseParts?.map(p => p.type === 'image' ? { type: 'image', imageMimeType: p.imageMimeType } : p),
  }))
  return JSON.stringify(lean)
}
function deserializeMessages(raw: string): ChatMsg[] {
  try { return (JSON.parse(raw) as any[]).map(m => ({ ...m, timestamp: new Date(m.timestamp) })) } catch { return [] }
}

async function uploadChatImage(clientId: string, msgId: string, idx: number, base64: string, mimeType: string): Promise<string | null> {
  try {
    const ext = mimeType.includes('png') ? 'png' : 'jpg'
    const path = `ai-chat-images/${clientId}/${msgId}_${idx}.${ext}`
    const byteString = atob(base64); const arr = new Uint8Array(byteString.length)
    for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i)
    const blob = new Blob([arr], { type: mimeType })
    const { error } = await supabase.storage.from('client-photos').upload(path, blob, { contentType: mimeType, upsert: true })
    if (error) return null
    return supabase.storage.from('client-photos').getPublicUrl(path).data.publicUrl
  } catch { return null }
}

const WELCOME = (name: string) => `Olá! Eu sou a **MS Color IA**, sua assistente virtual de coloração pessoal 🌈\n\nFui treinada com base na metodologia e na expertise da especialista **Marília Santos**, referência em coloração pessoal e análise de imagem.\n\nTodas as minhas recomendações são **personalizadas exclusivamente para você**, utilizando as informações da sua análise feita pela Marília.\n\nAqui, você poderá:\n• Visualizar simulações de cabelos, maquiagens, roupas, acessórios.\n• Tirar dúvidas sobre sua análise.\n\nSempre que precisar, estarei aqui para te guiar 🌈`

export function GeminiChat({ clientName, systemPrompt, referencePhotoUrl, referencePhotos = [], folderConfig, clientId, resultFileUrls = [], resultObservations = '' }: GeminiChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const [navState, setNavState] = useState<'categories' | 'prompts' | 'lengths' | 'textures' | 'options' | 'hidden'>('categories')
  const [selectedCat, setSelectedCat] = useState<Category | null>(null)
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const [selectedLength, setSelectedLength] = useState<SubOption | null>(null)

  const [refBase64, setRefBase64] = useState<string | null>(null)
  const [refMime, setRefMime] = useState('image/jpeg')
  const [loadingRef, setLoadingRef] = useState(false)
  const [promptMaterials, setPromptMaterials] = useState<MaterialData[]>([])
  const [refPhotoMap, setRefPhotoMap] = useState<Record<string, { base64: string; mime: string }>>({})
  const [resultMaterials, setResultMaterials] = useState<MaterialData[]>([])
  const [loadingResults, setLoadingResults] = useState(false)
  const resultMaterialsSent = useRef(false)
  const [creditsImage, setCreditsImage] = useState<number | null>(null)
  const [creditsText, setCreditsText] = useState<number | null>(null)
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [pdfSelected, setPdfSelected] = useState<Set<string>>(new Set())
  const [pdfGenerating, setPdfGenerating] = useState(false)

  const lastCtx = useRef<any>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const categories = (folderConfig?.categories || []).map(c => ({
    ...c, type: c.type || (c.icon === 'scissors' ? 'cabelos' : 'geral'),
    prompts: (c.prompts || []).map(p => ({
      ...p, thumbnail: p.thumbnail || null, tintReference: (p as any).tintReference || '',
      reference: (p as any).reference || '', options: p.options || [],
      lengths: (p.lengths || []).map((l: any) => ({ ...l, thumbnail: l.thumbnail || null, images: l.images || [] })),
      textures: (p.textures || []).map((t: any) => ({ ...t, thumbnail: t.thumbnail || null, images: t.images || [] })),
      pdfLayout: (p as any).pdfLayout || undefined,
    }))
  }))

  const fullSystemPrompt = resultObservations
    ? `${systemPrompt || ''}\n\n═══ OBSERVAÇÕES DA CONSULTORA SOBRE ESTA CLIENTE ═══\n${resultObservations}\n\nUse estas observações como base para TODAS as suas respostas.`
    : systemPrompt || ''

  useEffect(() => {
    if (!referencePhotoUrl) return
    setLoadingRef(true)
    urlToBase64(referencePhotoUrl).then(r => { if (r) { setRefBase64(r.base64); setRefMime(r.mimeType) } }).finally(() => setLoadingRef(false))
  }, [referencePhotoUrl])

  useEffect(() => {
    if (!referencePhotos.length) return
    Promise.all(referencePhotos.map(async p => { const r = await urlToBase64(p.url); return r ? { type: p.type, base64: r.base64, mime: r.mimeType } : null }))
      .then(results => {
        const map: Record<string, { base64: string; mime: string }> = {}
        results.forEach(r => { if (r) map[r.type] = { base64: r.base64, mime: r.mime } })
        setRefPhotoMap(map)
        if (!referencePhotoUrl && map['geral']) { setRefBase64(map['geral'].base64); setRefMime(map['geral'].mime) }
      })
  }, [referencePhotos])

  useEffect(() => {
    if (!resultFileUrls.length) return
    setLoadingResults(true)
    Promise.all(resultFileUrls.map(async (file) => {
      try {
        const res = await fetch(file.url); const blob = await res.blob()
        return new Promise<MaterialData>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve({ base64: (r.result as string).split(',')[1], mimeType: blob.type || 'application/pdf' })
          r.onerror = reject; r.readAsDataURL(blob)
        })
      } catch { return null }
    })).then(results => { setResultMaterials(results.filter(Boolean) as MaterialData[]); setLoadingResults(false) })
  }, [resultFileUrls])

  useEffect(() => {
    if (!clientId) return
    supabase.rpc('check_ai_credits', { p_client_id: clientId }).then(({ data }) => {
      if (data) { setCreditsImage(data.image ?? null); setCreditsText(data.text ?? null) }
    })
  }, [clientId])

  useEffect(() => {
    if (clientId) {
      const saved = localStorage.getItem(chatKey(clientId))
      if (saved) { const msgs = deserializeMessages(saved); if (msgs.length > 0) { setMessages(msgs); return } }
    }
    setMessages([{ id: uid(), role: 'assistant', text: WELCOME(clientName.split(' ')[0]), responseParts: [{ type: 'text', text: '' }], timestamp: new Date() }])
  }, [clientName, clientId])

  useEffect(() => {
    if (!clientId || messages.length === 0 || messages.some(m => m.loading)) return
    localStorage.setItem(chatKey(clientId), serializeMessages(messages))
  }, [messages, clientId])

  // Scroll só dentro do container de mensagens, NUNCA a página inteira.
  // scrollIntoView (mesmo com block: 'nearest') pode rolar a janela em mobile,
  // fazendo a tela "saltar" para o final do chat assim que ele monta.
  useEffect(() => {
    const end = endRef.current
    if (!end) return
    const container = end.parentElement
    if (container) container.scrollTop = container.scrollHeight
  }, [messages])

  const loadImages = async (images: PromptImage[]): Promise<MaterialData[]> => {
    if (!images.length) return []
    const results = await Promise.all(images.map(async img => {
      try {
        const blob = await (await fetch(img.url)).blob()
        return new Promise<MaterialData>((res, rej) => {
          const r = new FileReader(); r.onload = () => res({ base64: (r.result as string).split(',')[1], mimeType: blob.type }); r.onerror = rej; r.readAsDataURL(blob)
        })
      } catch { return null }
    }))
    return results.filter(Boolean) as MaterialData[]
  }
  const loadPromptMaterials = (prompt: Prompt) => loadImages(prompt.images)

  const handleCatClick = (cat: Category) => { setSelectedCat(cat); setSelectedPrompt(null); setSelectedLength(null); setNavState('prompts') }

  const getCategorySection = (cat: Category): PdfSection => {
    if (cat.refPhotoType) { const r = referencePhotos.find(p => p.type === cat.refPhotoType); if (r?.label) return r.label; return cat.refPhotoType }
    return cat.name
  }

  const getRefPhotoForCategory = (cat: Category) => {
    if (cat.refPhotoType) return refPhotoMap[cat.refPhotoType] || refPhotoMap['geral'] || (refBase64 ? { base64: refBase64, mime: refMime } : undefined)
    if (cat.type === 'cabelos') return refPhotoMap['cabelo'] || refPhotoMap['geral'] || (refBase64 ? { base64: refBase64, mime: refMime } : undefined)
    if (cat.icon === 'shirt') return refPhotoMap['roupa'] || refPhotoMap['geral'] || (refBase64 ? { base64: refBase64, mime: refMime } : undefined)
    return refPhotoMap['geral'] || (refBase64 ? { base64: refBase64, mime: refMime } : undefined)
  }

  const buildPromptInstruction = (cat: Category, instructions: string, suffix: string): string => {
    const isAccessory = cat.icon === 'gem' || cat.name.toLowerCase().includes('acess')
    if (isAccessory) {
      return `Gere uma imagem realista da cliente usando o acessório exibido na imagem de referência.\n\nINSTRUÇÕES ESPECÍFICAS DO ACESSÓRIO:\n${instructions}\n\nORDEM DAS IMAGENS ENVIADAS:\n- IMAGEM 1 = referência do acessório → use apenas para copiar o acessório, NUNCA como base de pessoa ou enquadramento\n- ÚLTIMA IMAGEM = foto real da cliente → esta é a BASE OBRIGATÓRIA, a pessoa que deve aparecer na imagem final\n\nREGRAS:\n- Use a IMAGEM 1 (cliente) como base absoluta da geração\n- ADICIONE o acessório da IMAGEM 2 na cliente de forma natural e bem posicionada\n- Preserve EXATAMENTE o rosto, pele, olhos, tom de pele e traços faciais da cliente\n- NÃO altere nenhuma característica facial — apenas adicione o acessório\n- ENQUADRAMENTO OBRIGATÓRIO: a imagem final deve ter EXATAMENTE o mesmo recorte, zoom, ângulo e proporção da IMAGEM 1 (cliente) — ignore completamente o enquadramento da IMAGEM 2\n- A cliente DEVE aparecer na imagem final com o acessório aplicado${suffix}`
    }
    return `Gere uma imagem realista aplicando EXATAMENTE este visual na foto da cliente:\n\n${instructions}\n\nREGRAS ABSOLUTAS:\n- PRESERVE INTEGRALMENTE o rosto, pele, olhos, formato facial e traços da cliente — NÃO altere NADA no rosto\n- Mude SOMENTE o que está descrito acima\n- Use a foto da cliente como base obrigatória — ela DEVE aparecer na imagem gerada\n- Use as imagens de referência como guia visual exato${suffix}`
  }

  const handlePromptClick = async (prompt: Prompt) => {
    setSelectedPrompt(prompt)
    const cat = selectedCat!
    const isCabelo = cat.type === 'cabelo' || cat.type === 'cabelos' || cat.icon === 'scissors'
    if (isCabelo) {
      if ((prompt.lengths || []).length > 0) { setNavState('lengths'); return }
      if ((prompt.textures || []).length > 0) { setSelectedLength(null); setNavState('textures'); return }
      if (prompt.options.length > 0) { setNavState('options'); return }
    }
    setNavState('hidden')
    const mats = await loadPromptMaterials(prompt); setPromptMaterials(mats)
    const refOverride = getRefPhotoForCategory(cat)
    const afterImageText = (prompt.tintReference || prompt.reference)?.trim() || undefined
    const catIsAccessory = cat.icon === 'gem' || cat.name.toLowerCase().includes('acess')
    const meta: PdfMeta = { section: getCategorySection(cat), label: prompt.name, caption: prompt.tintReference || prompt.reference || prompt.name, promptId: prompt.id }
    handleSend(buildPromptInstruction(cat, prompt.instructions || prompt.name, ''), true, prompt, mats, refOverride, `✨ ${prompt.name}`, catIsAccessory, meta, afterImageText)
  }

  const handleLengthClick = (length: SubOption) => {
    setSelectedLength(length)
    if ((selectedPrompt?.textures || []).length > 0) setNavState('textures')
    else sendHairResult(length, null)
  }

  const handleTextureClick = (texture: SubOption) => { sendHairResult(selectedLength, texture) }

  const sendHairResult = async (length: SubOption | null, texture: SubOption | null) => {
    if (!selectedPrompt || !selectedCat) return
    setNavState('hidden')
    const [promptMats, lengthMats, textureMats] = await Promise.all([loadPromptMaterials(selectedPrompt), length ? loadImages(length.images) : Promise.resolve([]), texture ? loadImages(texture.images) : Promise.resolve([])])
    const allMats = [...promptMats, ...lengthMats, ...textureMats]; setPromptMaterials(allMats)
    const refOverride = getRefPhotoForCategory(selectedCat)
    const afterImageText = selectedPrompt.tintReference?.trim() || undefined
    const lengthPart = length?.instruction ? `\n\n═══ COMPRIMENTO ═══\n${length.instruction}` : ''
    const texturePart = texture?.instruction ? `\n\n═══ TEXTURA ═══\n${texture.instruction}` : ''
    const combinedInstructions = `${selectedPrompt.instructions || selectedPrompt.name}${lengthPart}${texturePart}`
    const displayLabel = [selectedPrompt.name, length?.name, texture?.name].filter(Boolean).join(' — ')
    const meta: PdfMeta = { section: getCategorySection(selectedCat), label: selectedPrompt.name, caption: selectedPrompt.tintReference || selectedPrompt.reference || selectedPrompt.name, promptId: selectedPrompt.id }
    handleSend(buildPromptInstruction(selectedCat, combinedInstructions, ''), true, selectedPrompt, allMats, refOverride, `✨ ${displayLabel}`, false, meta, afterImageText)
  }

  const handleOptionClick = async (option: string) => {
    if (!selectedPrompt || !selectedCat) return
    setNavState('hidden')
    const mats = await loadPromptMaterials(selectedPrompt); setPromptMaterials(mats)
    const refOverride = getRefPhotoForCategory(selectedCat)
    const afterImageText = selectedPrompt.tintReference?.trim() || undefined
    const catIsAccessory = selectedCat.icon === 'gem' || selectedCat.name.toLowerCase().includes('acess')
    const meta: PdfMeta = { section: getCategorySection(selectedCat), label: selectedPrompt.name, caption: selectedPrompt.tintReference || selectedPrompt.reference || selectedPrompt.name, promptId: selectedPrompt.id }
    handleSend(buildPromptInstruction(selectedCat, `${selectedPrompt.instructions || selectedPrompt.name} - comprimento ${option}`, ''), true, selectedPrompt, mats, refOverride, `✨ ${selectedPrompt.name} — ${option}`, catIsAccessory, meta, afterImageText)
  }

  const goBack = () => {
    if (navState === 'textures') { if ((selectedPrompt?.lengths || []).length > 0) setNavState('lengths'); else { setNavState('prompts'); setSelectedPrompt(null) } }
    else if (navState === 'lengths') { setNavState('prompts'); setSelectedPrompt(null); setSelectedLength(null) }
    else if (navState === 'options') { setNavState('prompts'); setSelectedPrompt(null) }
    else if (navState === 'prompts') { setNavState('categories'); setSelectedCat(null) }
  }

  const handleSend = async (overrideText?: string, isImage: boolean = false, contextPrompt?: Prompt, mats?: MaterialData[], refPhotoOverride?: { base64: string; mime: string }, displayText?: string, isAccessory: boolean = false, pdfMeta?: PdfMeta, afterImageText?: string) => {
    const text = (overrideText || input).trim()
    if (!text && !pendingImage) return
    if (loading) return

    setApiError(null)
    const apiKey = await getGeminiApiKey()
    if (!apiKey) { setApiError('Chave da API não configurada.'); return }

    if (clientId) {
      const available = isImage ? creditsImage : creditsText
      if (available !== null && available <= 0) { setApiError(`Seus créditos de ${isImage ? 'imagem' : 'texto'} acabaram. Entre em contato com a consultora para adicionar mais.`); return }
    }

    let uB64: string | undefined, uMime: string | undefined, prev: string | undefined
    if (pendingImage) { const c = await fileToBase64(pendingImage.file); uB64 = c.base64; uMime = c.mimeType; prev = pendingImage.preview; setPendingImage(null) }

    const userMsg: ChatMsg = { id: uid(), role: 'user', text: displayText || text || '(foto)', imagePreview: prev, imageBase64: uB64, imageMimeType: uMime, timestamp: new Date() }
    const lid = uid()
    setMessages(prev => [...prev, userMsg, { id: lid, role: 'assistant', text: '', loading: true, timestamp: new Date(), pdfMeta }])
    setInput(''); setLoading(true)
    lastCtx.current = { text, isImage, refPhotoOverride, displayText, mats, isAccessory, pdfMeta, afterImageText }

    try {
      const history: GeminiMessage[] = messages.filter(m => !m.loading && m.id !== messages[0]?.id).map(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text || ' ' } as GeminiMessage))
      let materialsToSend: MaterialData[] = mats || promptMaterials
      if (!isAccessory && !resultMaterialsSent.current && resultMaterials.length > 0) { materialsToSend = [...resultMaterials, ...materialsToSend]; resultMaterialsSent.current = true }
      const activeRef = refPhotoOverride || (refBase64 ? { base64: refBase64, mime: refMime } : null)
      console.log('[GeminiChat] enviando →', {
        forceImage: isImage,
        clientFirst: isAccessory,
        hasUserImage: !!uB64,
        hasRefPhoto: !!activeRef?.base64,
        materialsCount: materialsToSend.length,
        userTextPreview: text.slice(0, 120),
      })
      const response = await chatWithGemini({ apiKey, systemPrompt: fullSystemPrompt, history, userText: text, userImageBase64: uB64, userImageMimeType: uMime, referencePhotoBase64: activeRef?.base64 || undefined, referencePhotoMimeType: activeRef?.mime || refMime, materials: materialsToSend, forceImage: isImage, clientFirst: isAccessory })
      console.log('[GeminiChat] resposta ←', {
        modelUsed: response.modelUsed,
        imageGenerationFailed: response.imageGenerationFailed,
        partsCount: response.parts.length,
        textParts: response.parts.filter(p => p.type === 'text').length,
        imageParts: response.parts.filter(p => p.type === 'image').length,
        firstCandidateFinishReason: response.raw?.candidates?.[0]?.finishReason,
        firstImageMime: response.parts.find(p => p.type === 'image')?.imageMimeType,
        firstImageSizeKB: (() => {
          const b64 = response.parts.find(p => p.type === 'image')?.imageBase64
          return b64 ? Math.round((b64.length * 3 / 4) / 1024) : null
        })(),
      })
      const mainText = response.parts.filter(p => p.type === 'text' && p.text?.trim()).map(p => p.text).join('\n').trim()
      setMessages(prev => prev.map(m => m.id === lid ? { ...m, loading: false, text: mainText || '✨', responseParts: response.parts, imageGenerationFailed: response.imageGenerationFailed } : m))
      const hasImage = response.parts.some(p => p.type === 'image' && p.imageBase64)
      if (hasImage && !response.imageGenerationFailed && afterImageText?.trim()) {
        setMessages(prev => [...prev, { id: uid(), role: 'assistant', text: afterImageText.trim(), responseParts: [{ type: 'text', text: afterImageText.trim() }], timestamp: new Date() }])
      }
      if (clientId) {
        const imageParts = response.parts.filter(p => p.type === 'image' && p.imageBase64)
        if (imageParts.length > 0) {
          Promise.all(imageParts.map((p, i) => uploadChatImage(clientId, lid, i, p.imageBase64!, p.imageMimeType || 'image/png'))).then(urls => {
            const saved = urls.filter(Boolean) as string[]
            if (saved.length > 0) setMessages(prev => prev.map(m => m.id === lid ? { ...m, savedImageUrls: saved } : m))
          })
        }
        const creditType = hasImage ? 'image' : 'text'
        supabase.rpc('use_ai_credit', { p_client_id: clientId, p_type: creditType }).then(({ data }) => {
          if (data?.remaining !== undefined) { if (creditType === 'image') setCreditsImage(data.remaining); else setCreditsText(data.remaining) }
        })
      }
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === lid ? { ...m, loading: false, text: '', error: err.message || 'Erro' } : m))
    } finally { setLoading(false) }
  }

  const handleRetry = () => {
    if (!lastCtx.current || loading) return
    setMessages(prev => { const idx = prev.findLastIndex(m => m.role === 'assistant' && (m.error || m.imageGenerationFailed)); return idx === -1 ? prev : prev.filter((_, i) => i !== idx && i !== idx - 1) })
    handleSend(lastCtx.current.text, lastCtx.current.isImage, undefined, lastCtx.current.mats, lastCtx.current.refPhotoOverride, lastCtx.current.displayText, lastCtx.current.isAccessory, lastCtx.current.pdfMeta, lastCtx.current.afterImageText)
  }

  const getImgDataUrl = async (msg: ChatMsg): Promise<string | null> => {
    const part = msg.responseParts?.find(p => p.type === 'image' && p.imageBase64)
    if (part?.imageBase64) return `data:${part.imageMimeType || 'image/jpeg'};base64,${part.imageBase64}`
    const url = msg.savedImageUrls?.[0]; if (!url) return null
    try { const blob = await (await fetch(url)).blob(); return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob) }) } catch { return null }
  }

  const findPromptLayout = (promptId?: string): ItemLayout | undefined => {
    if (!promptId) return undefined
    for (const cat of categories) { const p = cat.prompts.find(pp => pp.id === promptId); if (p?.pdfLayout) return p.pdfLayout }
    return undefined
  }

  const generatePDF = async () => {
    const selected = imageMsgs.filter(m => pdfSelected.has(m.id))
    if (!selected.length) return
    setPdfGenerating(true)
    try {
      const freshLayoutMap = new Map<string, ItemLayout>()
      try {
        if (folderConfig?.folderName) {
          const { data: rows } = await supabase.from('ai_folders').select('config').eq('name', folderConfig.folderName).limit(1)
          const raw = rows?.[0]?.config; const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
          for (const cat of cfg?.categories ?? []) { for (const p of cat?.prompts ?? []) { if (p?.id && p?.pdfLayout) freshLayoutMap.set(p.id, p.pdfLayout) } }
        }
      } catch {}
      const getLayout = (promptId?: string): ItemLayout | undefined => (promptId ? freshLayoutMap.get(promptId) : undefined) ?? findPromptLayout(promptId)
      const items = await Promise.all(selected.map(async (msg) => { const dataUrl = await getImgDataUrl(msg); if (!dataUrl) return null; return { dataUrl, label: msg.pdfMeta?.label || msg.text?.replace(/\n/g, ' ')?.slice(0, 30) || 'Imagem gerada', caption: msg.pdfMeta?.caption, section: msg.pdfMeta?.section, layout: getLayout(msg.pdfMeta?.promptId) } }))
      const validItems = items.filter(Boolean) as any[]
      if (validItems.length === 0) return
      await downloadStylePDF({ clientName, items: validItems })
    } catch (e: any) { alert('Erro ao gerar PDF: ' + e.message) } finally { setPdfGenerating(false) }
  }

  const imageMsgs = messages.filter(m => m.role === 'assistant' && !m.loading && !m.error && (m.responseParts?.some(p => p.type === 'image' && p.imageBase64) || m.savedImageUrls?.length))

  const PdfModal = () => {
    const bySection = imageMsgs.reduce((acc, msg) => { const s = msg.pdfMeta?.section || 'Geral'; if (!acc[s]) acc[s] = []; acc[s].push(msg); return acc }, {} as Record<string, ChatMsg[]>)
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90dvh] flex flex-col">
          <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900 text-sm sm:text-base">Exportar PDF</p>
              <p className="text-xs text-gray-500">{pdfSelected.size} de {imageMsgs.length} imagens selecionadas</p>
            </div>
            <div className="flex gap-3 items-center">
              <button onClick={() => setPdfSelected(new Set(imageMsgs.map(m => m.id)))} className="text-xs text-violet-600 font-medium">Todas</button>
              <button onClick={() => setPdfSelected(new Set())} className="text-xs text-gray-400">Nenhuma</button>
              <button onClick={() => setShowPdfModal(false)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
            {Object.entries(bySection).map(([s, msgs]) => (
              <div key={s}>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{s}</p>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  {msgs.map(msg => {
                    const sel = pdfSelected.has(msg.id)
                    const imgSrc = msg.responseParts?.find(p => p.type === 'image' && p.imageBase64) ? `data:${msg.responseParts.find(p => p.type === 'image')?.imageMimeType || 'image/jpeg'};base64,${msg.responseParts.find(p => p.type === 'image' && p.imageBase64)?.imageBase64}` : msg.savedImageUrls?.[0]
                    return (
                      <button key={msg.id} onClick={() => setPdfSelected(prev => { const s = new Set(prev); s.has(msg.id) ? s.delete(msg.id) : s.add(msg.id); return s })}
                        className={`relative rounded-xl overflow-hidden border-2 text-left transition-all ${sel ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'}`}>
                        {imgSrc && <img src={imgSrc} alt="" className="w-full aspect-square object-cover" />}
                        <div className={`absolute top-2 right-2 ${sel ? 'text-violet-600' : 'text-gray-400'}`}>
                          {sel ? <CheckSquare className="h-5 w-5 bg-white rounded" /> : <Square className="h-5 w-5 bg-white/80 rounded" />}
                        </div>
                        <div className="px-2 py-1.5 bg-white/95">
                          <p className="text-xs font-medium text-gray-700 leading-tight line-clamp-2">{msg.pdfMeta?.label || '✨ Imagem gerada'}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 sm:px-5 py-4 border-t border-gray-100 flex gap-2">
            <button onClick={() => setShowPdfModal(false)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={generatePDF} disabled={pdfSelected.size === 0 || pdfGenerating}
              className="flex-1 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
              {pdfGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {pdfGenerating ? 'Gerando...' : 'Baixar PDF'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderMsg = (msg: ChatMsg) => {
    const isU = msg.role === 'user'
    return (
      <div key={msg.id} className={`flex gap-2 sm:gap-3 ${isU ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-white ${isU ? 'bg-gradient-to-br from-rose-400 to-pink-500' : 'bg-gradient-to-br from-violet-500 to-purple-600'}`}>
          {isU ? <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
        </div>
        <div className={`flex flex-col gap-2 max-w-[85%] sm:max-w-[80%] ${isU ? 'items-end' : 'items-start'}`}>
          {msg.imagePreview && <div className="rounded-2xl overflow-hidden shadow-md max-w-[180px] sm:max-w-[200px]"><img src={msg.imagePreview} alt="" className="w-full object-cover" /></div>}
          {(msg.text || msg.loading || msg.error) && (
            <div className={`rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm text-sm leading-relaxed ${isU ? 'bg-gradient-to-br from-rose-400 to-pink-500 text-white rounded-br-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm'}`}>
              {msg.loading ? (
                <div className="flex items-center gap-2 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-xs">{loadingResults ? 'Carregando materiais...' : 'Gerando...'}</span></div>
              ) : msg.error ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-2 text-red-600"><AlertCircle className="h-4 w-4 mt-0.5" /><span className="text-xs">{msg.error}</span></div>
                  <button onClick={handleRetry} disabled={loading} className="self-start text-xs flex items-center gap-1 px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg"><RefreshCw className="h-3 w-3" /> Tentar novamente</button>
                </div>
              ) : <MdText text={msg.text} />}
            </div>
          )}
          {msg.responseParts?.filter(p => p.type === 'image' && p.imageBase64).map((p, i) => (
            <div key={i} className="relative group rounded-2xl overflow-hidden shadow-lg border w-full max-w-[260px] sm:max-w-[300px]">
              <img src={`data:${p.imageMimeType};base64,${p.imageBase64}`} alt="" className="w-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                <button onClick={() => { const a = document.createElement('a'); a.href = `data:${p.imageMimeType};base64,${p.imageBase64}`; a.download = 'Simulação IA.png'; a.click() }} className="opacity-0 group-hover:opacity-100 active:opacity-100 bg-white text-gray-800 rounded-full p-2.5 shadow-lg"><Download className="h-5 w-5" /></button>
              </div>
              <span className="absolute bottom-2 left-2 text-xs text-white/90 bg-black/40 backdrop-blur-sm rounded-full px-2.5 py-1">✨ IA</span>
            </div>
          ))}
          {!msg.responseParts?.some(p => p.type === 'image' && p.imageBase64) && msg.savedImageUrls?.map((url, i) => (
            <div key={i} className="relative group rounded-2xl overflow-hidden shadow-lg border w-full max-w-[260px] sm:max-w-[300px]">
              <img src={url} alt="" className="w-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                <a href={url} download="Simulação IA.png" target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 active:opacity-100 bg-white text-gray-800 rounded-full p-2.5 shadow-lg"><Download className="h-5 w-5" /></a>
              </div>
              <span className="absolute bottom-2 left-2 text-xs text-white/90 bg-black/40 backdrop-blur-sm rounded-full px-2.5 py-1">✨ IA</span>
            </div>
          ))}
          {msg.imageGenerationFailed && !msg.error && (
            <button onClick={handleRetry} disabled={loading} className="text-xs flex items-center gap-1 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Tentar gerar imagem
            </button>
          )}
          {!msg.loading && <span className="text-xs text-gray-400 px-1">{ftime(msg.timestamp)}</span>}
        </div>
      </div>
    )
  }

  const renderNav = () => {
    if (navState === 'hidden' || !categories.length) return null
    return (
      <div className="border-t border-gray-100 bg-white px-3 sm:px-4 py-3 max-h-72 overflow-y-auto">
        {navState === 'categories' && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600 text-center">Escolha o que deseja explorar:</p>
            <div className="grid grid-cols-2 gap-2">
              {categories.map(cat => { const Icon = ICONS[cat.icon] || FolderOpen; return <button key={cat.id} onClick={() => handleCatClick(cat)} disabled={loading} className="flex items-center gap-2 px-3 py-2.5 bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 rounded-xl text-xs sm:text-sm font-medium text-violet-700 hover:from-violet-100 hover:to-purple-100 disabled:opacity-50 text-left"><Icon className="h-4 w-4 flex-shrink-0" /><span className="truncate">{cat.name}</span></button> })}
            </div>
          </div>
        )}
        {navState === 'prompts' && selectedCat && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></button>
              <p className="text-xs font-semibold text-gray-600 truncate">{selectedCat.name} — Escolha a cor:</p>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {selectedCat.prompts.map(p => (
                <button key={p.id} onClick={() => handlePromptClick(p)} disabled={loading} className="flex flex-col items-center gap-1 p-1.5 bg-white border border-gray-200 rounded-lg hover:border-violet-300 hover:bg-violet-50 transition-all disabled:opacity-50 text-center">
                  {(p.thumbnail?.url || p.images?.[0]?.url) ? <img src={p.thumbnail?.url || p.images[0].url} alt={p.name} className="w-full aspect-[4/3] object-cover rounded" /> : <div className="w-full aspect-[4/3] bg-gray-100 rounded flex items-center justify-center"><Wand2 className="h-4 w-4 text-gray-300" /></div>}
                  <span className="text-[10px] font-medium text-gray-700 leading-tight line-clamp-2">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {navState === 'lengths' && selectedPrompt && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></button>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-600 truncate">{selectedPrompt.name} — Comprimento:</p>
                <div className="flex items-center gap-1 mt-0.5"><span className="w-4 h-1 bg-violet-500 rounded-full" /><span className={`w-4 h-1 rounded-full ${(selectedPrompt.textures || []).length > 0 ? 'bg-gray-200' : 'bg-violet-500'}`} /></div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {(selectedPrompt.lengths || []).map(length => (
                <button key={length.id} onClick={() => handleLengthClick(length)} disabled={loading} className="flex flex-col items-center gap-1 p-1.5 bg-white border border-gray-200 rounded-lg hover:border-violet-300 hover:bg-violet-50 transition-all disabled:opacity-50 text-center">
                  {length.thumbnail?.url ? <img src={length.thumbnail.url} alt={length.name} className="w-full aspect-[4/3] object-cover rounded" /> : <div className="w-full aspect-[4/3] bg-gradient-to-br from-violet-50 to-purple-100 rounded flex items-center justify-center"><Scissors className="h-5 w-5 text-violet-300" /></div>}
                  <span className="text-[10px] font-medium text-gray-700 leading-tight line-clamp-2">{length.name || '—'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {navState === 'textures' && selectedPrompt && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></button>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-600 truncate">{[selectedPrompt.name, selectedLength?.name].filter(Boolean).join(' — ')} — Textura:</p>
                <div className="flex items-center gap-1 mt-0.5"><span className="w-4 h-1 bg-violet-500 rounded-full" />{(selectedPrompt.lengths || []).length > 0 && <span className="w-4 h-1 bg-violet-500 rounded-full" />}<span className="w-4 h-1 bg-violet-500 rounded-full" /></div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {(selectedPrompt.textures || []).map(texture => (
                <button key={texture.id} onClick={() => handleTextureClick(texture)} disabled={loading} className="flex flex-col items-center gap-1 p-1.5 bg-white border border-gray-200 rounded-lg hover:border-violet-300 hover:bg-violet-50 transition-all disabled:opacity-50 text-center">
                  {texture.thumbnail?.url ? <img src={texture.thumbnail.url} alt={texture.name} className="w-full aspect-[4/3] object-cover rounded" /> : <div className="w-full aspect-[4/3] bg-gradient-to-br from-cyan-50 to-teal-100 rounded flex items-center justify-center"><svg className="h-5 w-5 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12c0-4 3-7 6-7s6 3 6 7-3 7-6 7" /><path d="M9 12c0-2 1.5-3.5 3-3.5" /></svg></div>}
                  <span className="text-[10px] font-medium text-gray-700 leading-tight line-clamp-2">{texture.name || '—'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {navState === 'options' && selectedPrompt && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></button>
              <p className="text-xs font-semibold text-gray-600 truncate">{selectedPrompt.name} — Comprimento:</p>
            </div>
            {(selectedPrompt.thumbnail?.url || selectedPrompt.images?.[0]?.url) && (
              <div className="flex justify-center"><img src={selectedPrompt.thumbnail?.url || selectedPrompt.images[0].url} alt="" className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-xl border" /></div>
            )}
            <div className="flex flex-wrap gap-2 justify-center">
              {selectedPrompt.options.map((o, i) => <button key={i} onClick={() => handleOptionClick(o)} disabled={loading} className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50">{o}</button>)}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {showPdfModal && <PdfModal />}
      {/*
        Altura do chat:
        - Mobile (< sm): 75dvh com mínimo absoluto de 480px (fallback caso dvh
          não seja suportado) e máximo de 720px. Não usamos min() inline porque
          alguns WebViews móveis (Instagram in-app, Safari iOS antigo)
          renderizavam o container com altura zero, escondendo o chat por
          completo no e-mail/portal.
        - Desktop (>= sm): 780px fixo, mas no max-h respeita a viewport menos
          margem para a barra de endereços e header — assim o chat também não
          vaza em laptops com tela pequena.
      */}
      <div
        className="flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden h-[75dvh] min-h-[480px] max-h-[720px] sm:h-[780px] sm:max-h-[calc(100dvh_-_120px)]"
      >
        {/* Header */}
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 sm:py-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white flex-shrink-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0"><Wand2 className="h-4 w-4 sm:h-5 sm:w-5" /></div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">MS Color IA</p>
            <p className="text-white/70 text-xs truncate">
              {loadingRef || loadingResults ? 'Carregando...' : ''}
              {!loadingRef && !loadingResults && refBase64 ? 'Foto ✓' : ''}
              {!loadingRef && !loadingResults && resultMaterials.length > 0 ? ` · ${resultMaterials.length} doc${resultMaterials.length > 1 ? 's' : ''} ✓` : ''}
            </p>
          </div>
          {refBase64 && referencePhotoUrl && <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden border-2 border-white/40 flex-shrink-0"><img src={referencePhotoUrl} alt="" className="w-full h-full object-cover" /></div>}
          <span className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-1 text-xs flex-shrink-0"><span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse" /><span className="hidden sm:inline">Online</span></span>
          {imageMsgs.length > 0 && (
            <button onClick={() => { setPdfSelected(new Set(imageMsgs.map(m => m.id))); setShowPdfModal(true) }} className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-full px-2 py-1 text-xs font-medium transition-colors flex-shrink-0">
              <FileText className="h-3.5 w-3.5" /><span className="hidden sm:inline">PDF</span>
            </button>
          )}
          {creditsImage !== null && <span className="hidden sm:inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-1 text-xs flex-shrink-0">📸{creditsImage} 💬{creditsText}</span>}
          {clientId && messages.length > 1 && (
            <button onClick={() => { if (!confirm('Limpar histórico?')) return; localStorage.removeItem(chatKey(clientId)); resultMaterialsSent.current = false; setMessages([{ id: uid(), role: 'assistant', text: WELCOME(clientName.split(' ')[0]), responseParts: [{ type: 'text', text: '' }], timestamp: new Date() }]) }} className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-full px-2 py-1 text-xs transition-colors flex-shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 sm:py-5 space-y-4 sm:space-y-5 bg-gray-50/50">
          {messages.map(renderMsg)}
          <div ref={endRef} />
        </div>

        {/* Nav */}
        {renderNav()}

        {navState === 'hidden' && categories.length > 0 && (
          <div className="px-3 sm:px-4 py-2 border-t border-gray-100 bg-white flex-shrink-0">
            <button onClick={() => { setNavState('categories'); setSelectedCat(null); setSelectedPrompt(null); setSelectedLength(null) }} className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"><Wand2 className="h-3 w-3" /> Voltar ao menu</button>
          </div>
        )}

        {apiError && (
          <div className="mx-3 sm:mx-4 mb-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex-shrink-0">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" /><p className="text-xs text-red-700 flex-1">{apiError}</p>
            <button onClick={() => setApiError(null)}><X className="h-3.5 w-3.5 text-red-400" /></button>
          </div>
        )}

        {pendingImage && (
          <div className="mx-3 sm:mx-4 mb-2 flex items-center gap-2 sm:gap-3 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 flex-shrink-0">
            <img src={pendingImage.preview} alt="" className="w-10 h-10 sm:w-12 sm:h-12 object-cover rounded-lg flex-shrink-0" />
            <p className="text-xs text-violet-800 truncate flex-1">{pendingImage.file.name}</p>
            <button onClick={() => { URL.revokeObjectURL(pendingImage.preview); setPendingImage(null) }}><X className="h-4 w-4 text-violet-400" /></button>
          </div>
        )}

        {/* Input area */}
        <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 bg-white border-t border-gray-100 flex-shrink-0" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(undefined, false) } }}
              placeholder="Pergunte sobre suas cores..."
              rows={1} disabled={loading}
              className="flex-1 resize-none rounded-xl border border-gray-200 px-3 sm:px-4 py-2 sm:py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 max-h-28"
              style={{ minHeight: '38px' }}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 112) + 'px' }}
            />
            <button
              onClick={() => handleSend(undefined, false)}
              disabled={loading || !input.trim()}
              className="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center disabled:opacity-40 shadow-sm"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function MdText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div>
      {lines.map((line, li) => {
        if (line === '') return <br key={li} />
        if (line.startsWith('• ') || line.startsWith('- ')) {
          const content = line.slice(2)
          return <div key={li} className="flex gap-2 mt-0.5"><span className="flex-shrink-0">•</span><span>{renderInline(content)}</span></div>
        }
        return <div key={li}>{renderInline(line)}</div>
      })}
    </div>
  )
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    return <span key={i}>{p}</span>
  })
}