// src/components/client/GeminiChat.tsx
import React, { useState, useRef, useEffect } from 'react'
import {
  Send, ImagePlus, X, Loader2, AlertCircle, Bot, User, Download,
  Wand2, RefreshCw, ArrowLeft, Scissors, Palette, Shirt, Gem, FolderOpen, Trash2,
  FileText, CheckSquare, Square
} from 'lucide-react'
import {
  chatWithGemini, getGeminiApiKey, fileToBase64, urlToBase64,
  GeminiMessage, GeminiResponsePart, MaterialData,
} from '../../lib/geminiService'
import { supabase } from '../../lib/supabase'
import { downloadStylePDF } from '../../lib/templatePDFGenerator'

interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string
  imagePreview?: string; imageBase64?: string; imageMimeType?: string
  responseParts?: GeminiResponsePart[]; timestamp: Date
  loading?: boolean; error?: string; imageGenerationFailed?: boolean
  savedImageUrls?: string[]   // images uploaded to Storage — survive page reload
  pdfMeta?: PdfMeta
}

// PdfSection is now a free string — uses the actual category name (e.g. "Cabelos", "Maquiagens")
type PdfSection = string
interface PdfMeta { section: PdfSection; label: string; caption: string }

interface PromptImage { url: string; storagePath: string; label: string }
interface Prompt { id: string; name: string; instructions: string; images: PromptImage[]; thumbnail: PromptImage | null; options: string[]; tintReference: string; reference: string }
interface Category { id: string; name: string; icon: string; type: 'cabelos' | 'geral'; refPhotoType?: string; prompts: Prompt[] }
interface FolderConfig { folderName: string; baseInstructions: string; categories: Category[] }

interface ResultFile { url: string; name: string }
// type is a dynamic typeId string (e.g. 'cabelo', 'roupa', 'maquiagem', 'geral') — must not be a closed union
interface RefPhoto { type: string; label: string; storagePath: string; url: string }

interface GeminiChatProps {
  clientName: string; systemPrompt: string
  referencePhotoUrl?: string | null
  referencePhotos?: RefPhoto[]   // typed photos (cabelo / roupa / geral)
  folderConfig?: FolderConfig | null
  clientId?: string
  resultFileUrls?: ResultFile[]
  resultObservations?: string
}

const uid = () => Math.random().toString(36).slice(2)
const ftime = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const ICONS: Record<string, any> = { scissors: Scissors, palette: Palette, shirt: Shirt, gem: Gem, folder: FolderOpen }

// ── Chat persistence ────────────────────────────────────────

const chatKey = (clientId: string) => `mscolors_chat_${clientId}`

/** Strip heavy base64 from responseParts before saving; keep savedImageUrls */
function serializeMessages(msgs: ChatMsg[]): string {
  const lean = msgs
    .filter(m => !m.loading && !m.error)
    .map(m => ({
      ...m,
      imagePreview: undefined,          // object URL — not serializable
      responseParts: m.responseParts?.map(p =>
        p.type === 'image' ? { type: 'image', imageMimeType: p.imageMimeType } : p
      ),
    }))
  return JSON.stringify(lean)
}

function deserializeMessages(raw: string): ChatMsg[] {
  try {
    const parsed = JSON.parse(raw) as any[]
    return parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
  } catch { return [] }
}

/** Upload a base64 image to Supabase Storage and return its public URL */
async function uploadChatImage(clientId: string, msgId: string, idx: number, base64: string, mimeType: string): Promise<string | null> {
  try {
    const ext = mimeType.includes('png') ? 'png' : 'jpg'
    const path = `ai-chat-images/${clientId}/${msgId}_${idx}.${ext}`
    const byteString = atob(base64)
    const arr = new Uint8Array(byteString.length)
    for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i)
    const blob = new Blob([arr], { type: mimeType })
    const { error } = await supabase.storage.from('client-photos').upload(path, blob, { contentType: mimeType, upsert: true })
    if (error) return null
    return supabase.storage.from('client-photos').getPublicUrl(path).data.publicUrl
  } catch { return null }
}

const WELCOME = (name: string) => `Olá! Eu sou a **MS Color IA**, sua assistente virtual de coloração pessoal 🌈

Fui treinada com base na metodologia e na expertise da especialista **Marília Santos**, referência em coloração pessoal e análise de imagem.

Todas as minhas recomendações são **personalizadas exclusivamente para você**, utilizando as informações da sua análise feita pela Marília.

Aqui, você poderá:
• Visualizar simulações de cabelos, maquiagens, roupas, acessórios.
• Tirar dúvidas sobre sua análise.

Sempre que precisar, estarei aqui para te guiar 🌈`

export function GeminiChat({ clientName, systemPrompt, referencePhotoUrl, referencePhotos = [], folderConfig, clientId, resultFileUrls = [], resultObservations = '' }: GeminiChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const [navState, setNavState] = useState<'categories' | 'prompts' | 'options' | 'hidden'>('categories')
  const [selectedCat, setSelectedCat] = useState<Category | null>(null)
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)

  const [refBase64, setRefBase64] = useState<string | null>(null)
  const [refMime, setRefMime] = useState('image/jpeg')
  const [loadingRef, setLoadingRef] = useState(false)
  const [promptMaterials, setPromptMaterials] = useState<MaterialData[]>([])

  // Map of typed reference photos: type → {base64, mime}
  const [refPhotoMap, setRefPhotoMap] = useState<Record<string, { base64: string; mime: string }>>({})

  // Materiais do resultado (PDFs da consultoria) — carregados uma vez
  const [resultMaterials, setResultMaterials] = useState<MaterialData[]>([])
  const [loadingResults, setLoadingResults] = useState(false)
  const resultMaterialsSent = useRef(false)

  const [creditsImage, setCreditsImage] = useState<number | null>(null)
  const [creditsText, setCreditsText] = useState<number | null>(null)
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [pdfSelected, setPdfSelected] = useState<Set<string>>(new Set())
  const [pdfGenerating, setPdfGenerating] = useState(false)

  const lastCtx = useRef<{ text: string; isImage: boolean; refPhotoOverride?: { base64: string; mime: string }; displayText?: string; mats?: MaterialData[]; isAccessory?: boolean; pdfMeta?: PdfMeta } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const categories = (folderConfig?.categories || []).map(c => ({
    ...c, type: c.type || (c.icon === 'scissors' ? 'cabelos' : 'geral') as any,
    prompts: (c.prompts || []).map(p => ({ ...p, thumbnail: p.thumbnail || null, tintReference: (p as any).tintReference || '', reference: (p as any).reference || '', options: p.options || [] }))
  }))

  // Montar system prompt com observações do resultado
  const fullSystemPrompt = resultObservations
    ? `${systemPrompt || ''}\n\n═══ OBSERVAÇÕES DA CONSULTORA SOBRE ESTA CLIENTE ═══\n${resultObservations}\n\nUse estas observações como base para TODAS as suas respostas.`
    : systemPrompt || ''

  // Carregar foto de referência (legado / fallback "geral")
  useEffect(() => {
    if (!referencePhotoUrl) return
    setLoadingRef(true)
    urlToBase64(referencePhotoUrl).then(r => { if (r) { setRefBase64(r.base64); setRefMime(r.mimeType) } }).finally(() => setLoadingRef(false))
  }, [referencePhotoUrl])

  // Pre-load all typed reference photos into a map for fast access
  useEffect(() => {
    if (!referencePhotos.length) return
    Promise.all(
      referencePhotos.map(async p => {
        const r = await urlToBase64(p.url)
        return r ? { type: p.type, base64: r.base64, mime: r.mimeType } : null
      })
    ).then(results => {
      const map: Record<string, { base64: string; mime: string }> = {}
      results.forEach(r => { if (r) map[r.type] = { base64: r.base64, mime: r.mime } })
      setRefPhotoMap(map)
      // Also set the default refBase64 from "geral" if not already set
      if (!referencePhotoUrl && map['geral']) {
        setRefBase64(map['geral'].base64)
        setRefMime(map['geral'].mime)
      }
    })
  }, [referencePhotos])

  // Carregar PDFs/arquivos do resultado como base64
  useEffect(() => {
    if (!resultFileUrls.length) return
    setLoadingResults(true)
    Promise.all(resultFileUrls.map(async (file) => {
      try {
        const res = await fetch(file.url)
        const blob = await res.blob()
        return new Promise<MaterialData>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve({ base64: (r.result as string).split(',')[1], mimeType: blob.type || 'application/pdf' })
          r.onerror = reject; r.readAsDataURL(blob)
        })
      } catch { return null }
    })).then(results => {
      setResultMaterials(results.filter(Boolean) as MaterialData[])
      setLoadingResults(false)
    })
  }, [resultFileUrls])

  // Carregar créditos
  useEffect(() => {
    if (!clientId) return
    supabase.rpc('check_ai_credits', { p_client_id: clientId }).then(({ data }) => {
      if (data) { setCreditsImage(data.image ?? null); setCreditsText(data.text ?? null) }
    })
  }, [clientId])

  // Boas-vindas ou histórico salvo
  useEffect(() => {
    if (clientId) {
      const saved = localStorage.getItem(chatKey(clientId))
      if (saved) {
        const msgs = deserializeMessages(saved)
        if (msgs.length > 0) { setMessages(msgs); return }
      }
    }
    setMessages([{ id: uid(), role: 'assistant', text: WELCOME(clientName.split(' ')[0]), responseParts: [{ type: 'text', text: '' }], timestamp: new Date() }])
  }, [clientName, clientId])

  // Persistir histórico sempre que messages mudar (exceto estado de loading)
  useEffect(() => {
    if (!clientId || messages.length === 0) return
    if (messages.some(m => m.loading)) return
    localStorage.setItem(chatKey(clientId), serializeMessages(messages))
  }, [messages, clientId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Carregar materiais de um prompt específico
  const loadPromptMaterials = async (prompt: Prompt): Promise<MaterialData[]> => {
    if (!prompt.images.length) return []
    const results = await Promise.all(prompt.images.map(async img => {
      try { const blob = await (await fetch(img.url)).blob(); return new Promise<MaterialData>((res, rej) => { const r = new FileReader(); r.onload = () => res({ base64: (r.result as string).split(',')[1], mimeType: blob.type }); r.onerror = rej; r.readAsDataURL(blob) }) } catch { return null }
    }))
    return results.filter(Boolean) as MaterialData[]
  }

  // ── Navigation ─────────────────────────────────────────────

  const handleCatClick = (cat: Category) => { setSelectedCat(cat); setSelectedPrompt(null); setNavState('prompts') }

  // Section key = photo type label when available, else category name.
  // This groups all categories that share the same refPhotoType (e.g. "Cabelo") into ONE
  // section in the PDF, instead of creating a separate section per category name.
  const getCategorySection = (cat: Category): PdfSection => {
    if (cat.refPhotoType) {
      // Look up the human-readable label from the client's typed reference photos.
      // The label is the display name of the photo type (e.g. "Cabelo", "Maquiagem").
      const refPhoto = referencePhotos.find(p => p.type === cat.refPhotoType)
      if (refPhoto?.label) return refPhoto.label
      // Fallback: use the raw typeId so at least it groups consistently
      return cat.refPhotoType
    }
    return cat.name
  }

  /**
   * Selects the best reference photo for a category.
   * Priority:
   *  1. Explicit `refPhotoType` set by admin on the category
   *  2. Type-based inference (cabelos → cabelo, shirt icon → roupa)
   *  3. Always falls back to 'geral', then to the legacy single refBase64
   */
  const getRefPhotoForCategory = (cat: Category): { base64: string; mime: string } | undefined => {
    // 1. Admin-configured override takes full priority
    if (cat.refPhotoType) {
      return refPhotoMap[cat.refPhotoType] || refPhotoMap['geral'] || (refBase64 ? { base64: refBase64, mime: refMime } : undefined)
    }
    // 2. Type-based inference
    if (cat.type === 'cabelos') {
      return refPhotoMap['cabelo'] || refPhotoMap['geral'] || (refBase64 ? { base64: refBase64, mime: refMime } : undefined)
    }
    if (cat.icon === 'shirt') {
      return refPhotoMap['roupa'] || refPhotoMap['geral'] || (refBase64 ? { base64: refBase64, mime: refMime } : undefined)
    }
    // 3. Default (acessórios, maquiagem, geral, etc.) → always use face/geral photo
    return refPhotoMap['geral'] || (refBase64 ? { base64: refBase64, mime: refMime } : undefined)
  }

  /**
   * Builds the image-generation instruction based on category type.
   * Accessories (gem icon) need different rules: the item goes ON the face/body,
   * so "NÃO altere NADA no rosto" would block the AI from placing glasses etc.
   */
  const buildPromptInstruction = (cat: Category, instructions: string, suffix: string): string => {
    const isAccessory = cat.icon === 'gem' || cat.name.toLowerCase().includes('acess')
    if (isAccessory) {
      return (
        `Gere uma imagem realista da cliente usando o acessório exibido na imagem de referência.\n\n` +
        `INSTRUÇÕES ESPECÍFICAS DO ACESSÓRIO:\n${instructions}\n\n` +
        `ORDEM DAS IMAGENS ENVIADAS:\n` +
        `- IMAGEM 1 = referência do acessório → use apenas para copiar o acessório, NUNCA como base de pessoa ou enquadramento\n` +
        `- ÚLTIMA IMAGEM = foto real da cliente → esta é a BASE OBRIGATÓRIA, a pessoa que deve aparecer na imagem final\n\n` +
        `REGRAS:\n` +
        `- Use a IMAGEM 1 (cliente) como base absoluta da geração\n` +
        `- ADICIONE o acessório da IMAGEM 2 na cliente de forma natural e bem posicionada\n` +
        `- Preserve EXATAMENTE o rosto, pele, olhos, tom de pele e traços faciais da cliente\n` +
        `- NÃO altere nenhuma característica facial — apenas adicione o acessório\n` +
        `- ENQUADRAMENTO OBRIGATÓRIO: a imagem final deve ter EXATAMENTE o mesmo recorte, zoom, ângulo e proporção da IMAGEM 1 (cliente) — ignore completamente o enquadramento da IMAGEM 2\n` +
        `- A cliente DEVE aparecer na imagem final com o acessório aplicado${suffix}`
      )
    }
    return (
      `Gere uma imagem realista aplicando EXATAMENTE este visual na foto da cliente:\n\n` +
      `${instructions}\n\n` +
      `REGRAS ABSOLUTAS:\n` +
      `- PRESERVE INTEGRALMENTE o rosto, pele, olhos, formato facial e traços da cliente — NÃO altere NADA no rosto\n` +
      `- Mude SOMENTE o que está descrito acima\n` +
      `- Use a foto da cliente como base obrigatória — ela DEVE aparecer na imagem gerada\n` +
      `- Use as imagens de referência como guia visual exato${suffix}`
    )
  }

  const handlePromptClick = async (prompt: Prompt) => {
    setSelectedPrompt(prompt)
    const cat = selectedCat!
    if (cat.type === 'cabelos' && prompt.options.length > 0) {
      setNavState('options')
    } else {
      setNavState('hidden')
      const mats = await loadPromptMaterials(prompt)
      setPromptMaterials(mats)
      const refOverride = getRefPhotoForCategory(cat)
      const suffix = prompt.reference ? `\n\nApós gerar, informe: "📌 Referência: ${prompt.reference}"` : ''
      const catIsAccessory = cat.icon === 'gem' || cat.name.toLowerCase().includes('acess')
      const meta: PdfMeta = { section: getCategorySection(cat), label: prompt.name, caption: prompt.tintReference || prompt.reference || prompt.name }
      handleSend(buildPromptInstruction(cat, prompt.instructions || prompt.name, suffix), true, prompt, mats, refOverride, `✨ ${prompt.name}`, catIsAccessory, meta)
    }
  }

  const handleOptionClick = async (option: string) => {
    if (!selectedPrompt || !selectedCat) return
    setNavState('hidden')
    const mats = await loadPromptMaterials(selectedPrompt)
    setPromptMaterials(mats)
    const refOverride = getRefPhotoForCategory(selectedCat)
    const suffix = selectedPrompt.tintReference ? `\n\nApós gerar, informe: "🎨 Tinta recomendada: ${selectedPrompt.tintReference}"` : ''
    const catIsAccessory = selectedCat.icon === 'gem' || selectedCat.name.toLowerCase().includes('acess')
    const meta: PdfMeta = { section: getCategorySection(selectedCat), label: `${selectedPrompt.name} — ${option}`, caption: selectedPrompt.tintReference || selectedPrompt.reference || selectedPrompt.name }
    handleSend(buildPromptInstruction(selectedCat, `${selectedPrompt.instructions || selectedPrompt.name} - comprimento ${option}`, suffix), true, selectedPrompt, mats, refOverride, `✨ ${selectedPrompt.name} — ${option}`, catIsAccessory, meta)
  }

  const goBack = () => {
    if (navState === 'options') { setNavState('prompts'); setSelectedPrompt(null) }
    else if (navState === 'prompts') { setNavState('categories'); setSelectedCat(null) }
  }

  // ── Send ───────────────────────────────────────────────────

  const handleSend = async (overrideText?: string, isImage: boolean = false, contextPrompt?: Prompt, mats?: MaterialData[], refPhotoOverride?: { base64: string; mime: string }, displayText?: string, isAccessory: boolean = false, pdfMeta?: PdfMeta) => {
    const text = (overrideText || input).trim()
    if (!text && !pendingImage) return
    if (loading) return

    setApiError(null)
    const apiKey = await getGeminiApiKey()
    if (!apiKey) { setApiError('Chave da API não configurada.'); return }

    // Verificar créditos
    if (clientId) {
      const available = isImage ? creditsImage : creditsText
      if (available !== null && available <= 0) {
        setApiError(`Seus créditos de ${isImage ? 'imagem' : 'texto'} acabaram. Entre em contato com a consultora para adicionar mais.`)
        return
      }
    }

    let uB64: string | undefined, uMime: string | undefined, prev: string | undefined
    if (pendingImage) { const c = await fileToBase64(pendingImage.file); uB64 = c.base64; uMime = c.mimeType; prev = pendingImage.preview; setPendingImage(null) }

    // Show displayText in chat; send full prompt to AI
    const userMsg: ChatMsg = { id: uid(), role: 'user', text: displayText || text || '(foto)', imagePreview: prev, imageBase64: uB64, imageMimeType: uMime, timestamp: new Date() }
    const lid = uid()
    setMessages(prev => [...prev, userMsg, { id: lid, role: 'assistant', text: '', loading: true, timestamp: new Date(), pdfMeta }])
    setInput(''); setLoading(true)
    lastCtx.current = { text, isImage, refPhotoOverride, displayText, mats, isAccessory, pdfMeta }

    try {
      const history: GeminiMessage[] = messages.filter(m => !m.loading && m.id !== messages[0]?.id).map(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text || ' ' } as GeminiMessage))

      // Materiais a enviar:
      // - Acessórios: só as imagens do prompt (PDFs da consultoria atrapalham o try-on)
      // - Primeira mensagem de texto: resultMaterials (PDFs) + prompt materials
      // - Nas demais: só prompt materials
      let materialsToSend: MaterialData[] = mats || promptMaterials
      if (!isAccessory && !resultMaterialsSent.current && resultMaterials.length > 0) {
        materialsToSend = [...resultMaterials, ...materialsToSend]
        resultMaterialsSent.current = true
      }

      const activeRef = refPhotoOverride || (refBase64 ? { base64: refBase64, mime: refMime } : null)

      const response = await chatWithGemini({
        apiKey, systemPrompt: fullSystemPrompt, history,
        userText: text,
        userImageBase64: uB64, userImageMimeType: uMime,
        referencePhotoBase64: activeRef?.base64 || undefined,
        referencePhotoMimeType: activeRef?.mime || refMime,
        materials: materialsToSend,
        forceImage: isImage,
        clientFirst: isAccessory,
      })

      const mainText = response.parts.filter(p => p.type === 'text' && p.text?.trim()).map(p => p.text).join('\n').trim()
      setMessages(prev => prev.map(m => m.id === lid ? { ...m, loading: false, text: mainText || '✨', responseParts: response.parts, imageGenerationFailed: response.imageGenerationFailed } : m))

      // Upload generated images to Storage so they survive page reload
      if (clientId) {
        const imageParts = response.parts.filter(p => p.type === 'image' && p.imageBase64)
        if (imageParts.length > 0) {
          Promise.all(
            imageParts.map((p, i) => uploadChatImage(clientId, lid, i, p.imageBase64!, p.imageMimeType || 'image/png'))
          ).then(urls => {
            const saved = urls.filter(Boolean) as string[]
            if (saved.length > 0) {
              setMessages(prev => prev.map(m => m.id === lid ? { ...m, savedImageUrls: saved } : m))
            }
          })
        }
      }

      // Descontar crédito
      if (clientId) {
        const hasImage = response.parts.some(p => p.type === 'image')
        const creditType = hasImage ? 'image' : 'text'
        supabase.rpc('use_ai_credit', { p_client_id: clientId, p_type: creditType }).then(({ data }) => {
          if (data?.remaining !== undefined) {
            if (creditType === 'image') setCreditsImage(data.remaining)
            else setCreditsText(data.remaining)
          }
        })
      }
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === lid ? { ...m, loading: false, text: '', error: err.message || 'Erro' } : m))
    } finally { setLoading(false) }
  }

  const handleRetry = () => {
    if (!lastCtx.current || loading) return
    setMessages(prev => { const idx = prev.findLastIndex(m => m.role === 'assistant' && (m.error || m.imageGenerationFailed)); return idx === -1 ? prev : prev.filter((_, i) => i !== idx && i !== idx - 1) })
    handleSend(lastCtx.current.text, lastCtx.current.isImage, undefined, lastCtx.current.mats, lastCtx.current.refPhotoOverride, lastCtx.current.displayText, lastCtx.current.isAccessory, lastCtx.current.pdfMeta)
  }


  // ── PDF Export ────────────────────────────────────────────────

  const getImgDataUrl = async (msg: ChatMsg): Promise<string | null> => {
    // Try live base64 first
    const part = msg.responseParts?.find(p => p.type === 'image' && p.imageBase64)
    if (part?.imageBase64) return `data:${part.imageMimeType || 'image/jpeg'};base64,${part.imageBase64}`
    // Fallback: fetch saved URL
    const url = msg.savedImageUrls?.[0]
    if (!url) return null
    try {
      const blob = await (await fetch(url)).blob()
      return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob) })
    } catch { return null }
  }

  const generatePDF = async () => {
    const selected = imageMsgs.filter(m => pdfSelected.has(m.id))
    if (!selected.length) return
    setPdfGenerating(true)
    try {
      // Montar lista de imagens com metadados para o gerador de template
      const items = await Promise.all(
        selected.map(async (msg) => {
          const dataUrl = await getImgDataUrl(msg)
          if (!dataUrl) return null
          return {
            dataUrl,
            label: msg.pdfMeta?.label || msg.text?.replace(/\n/g, ' ')?.slice(0, 30) || 'Imagem gerada',
            caption: msg.pdfMeta?.caption,
            section: msg.pdfMeta?.section ?? 'Geral',
          }
        })
      )

      const validItems = items.filter(Boolean) as Array<{
        dataUrl: string; label: string; caption?: string; section: string
      }>

      if (!validItems.length) { alert('Nenhuma imagem válida encontrada.'); return }

      // URL do template — coloque o Modelo.pdf na pasta public/ do projeto
      const templateUrl = '/Modelo.pdf'

      await downloadStylePDF(templateUrl, clientName, validItems)
      setShowPdfModal(false)
    } catch (e: any) { alert('Erro ao gerar PDF: ' + e.message) }
    finally { setPdfGenerating(false) }
  }

  const imageMsgs = messages.filter(m =>
    m.role === 'assistant' && !m.loading && !m.error &&
    (m.responseParts?.some(p => p.type === 'image' && p.imageBase64) || m.savedImageUrls?.length)
  )

  const PdfModal = () => {
    // Build sections in the order they first appear in the chat
    const seenSections: PdfSection[] = []
    imageMsgs.forEach(m => {
      const s = m.pdfMeta?.section ?? 'Geral'
      if (!seenSections.includes(s)) seenSections.push(s)
    })
    const sections = seenSections.map(s => ({ s, msgs: imageMsgs.filter(m => (m.pdfMeta?.section ?? 'Geral') === s) }))
    const allIds = new Set(imageMsgs.map(m => m.id))
    const allSelected = imageMsgs.every(m => pdfSelected.has(m.id))

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
          <div className="px-5 py-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <p className="font-semibold">Gerar PDF do Estilo</p>
            </div>
            <button onClick={() => setShowPdfModal(false)}><X className="h-5 w-5 opacity-70 hover:opacity-100" /></button>
          </div>

          <div className="px-5 py-2 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">{pdfSelected.size} de {imageMsgs.length} selecionadas</p>
            <button onClick={() => setPdfSelected(allSelected ? new Set() : new Set(allIds))}
              className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1">
              {allSelected ? <Square className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
              {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {sections.map(({ s, msgs }) => (
              <div key={s}>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  {s}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {msgs.map(msg => {
                    const sel = pdfSelected.has(msg.id)
                    const imgSrc = msg.responseParts?.find(p => p.type === 'image' && p.imageBase64)
                      ? `data:${msg.responseParts.find(p => p.type === 'image')?.imageMimeType || 'image/jpeg'};base64,${msg.responseParts.find(p => p.type === 'image' && p.imageBase64)?.imageBase64}`
                      : msg.savedImageUrls?.[0]
                    return (
                      <button key={msg.id} onClick={() => {
                        setPdfSelected(prev => { const s = new Set(prev); s.has(msg.id) ? s.delete(msg.id) : s.add(msg.id); return s })
                      }} className={`relative rounded-xl overflow-hidden border-2 text-left transition-all ${sel ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'}`}>
                        {imgSrc && <img src={imgSrc} alt="" className="w-full aspect-square object-cover" />}
                        <div className={`absolute top-2 right-2 rounded-full ${sel ? 'text-violet-600' : 'text-gray-400'}`}>
                          {sel ? <CheckSquare className="h-5 w-5 bg-white rounded" /> : <Square className="h-5 w-5 bg-white/80 rounded" />}
                        </div>
                        <div className="px-2 py-1.5 bg-white/95">
                          <p className="text-xs font-medium text-gray-700 truncate">{msg.pdfMeta?.label || msg.text?.slice(0, 40) || '✨ Imagem gerada'}</p>
                          {msg.pdfMeta?.caption && msg.pdfMeta.caption !== msg.pdfMeta.label &&
                            <p className="text-[10px] text-violet-600 truncate">{msg.pdfMeta.caption}</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <button onClick={() => setShowPdfModal(false)}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
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

  // ── Render message ─────────────────────────────────────────

  const renderMsg = (msg: ChatMsg) => {
    const isU = msg.role === 'user'
    return (
      <div key={msg.id} className={`flex gap-3 ${isU ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white ${isU ? 'bg-gradient-to-br from-rose-400 to-pink-500' : 'bg-gradient-to-br from-violet-500 to-purple-600'}`}>
          {isU ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
        <div className={`flex flex-col gap-2 max-w-[80%] ${isU ? 'items-end' : 'items-start'}`}>
          {msg.imagePreview && <div className="rounded-2xl overflow-hidden shadow-md max-w-[200px]"><img src={msg.imagePreview} alt="" className="w-full object-cover" /></div>}
          {(msg.text || msg.loading || msg.error) && (
            <div className={`rounded-2xl px-4 py-3 shadow-sm text-sm leading-relaxed ${isU ? 'bg-gradient-to-br from-rose-400 to-pink-500 text-white rounded-br-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm'}`}>
              {msg.loading ? (
                <div className="flex items-center gap-2 text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs">{loadingResults ? 'Carregando materiais...' : 'Gerando...'}</span>
                </div>
              ) : msg.error ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-2 text-red-600"><AlertCircle className="h-4 w-4 mt-0.5" /><span className="text-xs">{msg.error}</span></div>
                  <button onClick={handleRetry} disabled={loading} className="self-start text-xs flex items-center gap-1 px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg"><RefreshCw className="h-3 w-3" /> Tentar novamente</button>
                </div>
              ) : <MdText text={msg.text} />}
            </div>
          )}
          {/* Fresh images (base64 — current session) */}
          {msg.responseParts?.filter(p => p.type === 'image' && p.imageBase64).map((p, i) => (
            <div key={i} className="relative group rounded-2xl overflow-hidden shadow-lg border max-w-[300px]">
              <img src={`data:${p.imageMimeType};base64,${p.imageBase64}`} alt="" className="w-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                <button onClick={() => { const a = document.createElement('a'); a.href = `data:${p.imageMimeType};base64,${p.imageBase64}`; a.download = 'Simulação IA.png'; a.click() }}
                  className="opacity-0 group-hover:opacity-100 bg-white text-gray-800 rounded-full p-2.5 shadow-lg"><Download className="h-5 w-5" /></button>
              </div>
              <span className="absolute bottom-2 left-2 text-xs text-white/90 bg-black/40 backdrop-blur-sm rounded-full px-2.5 py-1">✨ IA</span>
            </div>
          ))}
          {/* Persisted images (URL — restored from storage) */}
          {!msg.responseParts?.some(p => p.type === 'image' && p.imageBase64) &&
            msg.savedImageUrls?.map((url, i) => (
              <div key={i} className="relative group rounded-2xl overflow-hidden shadow-lg border max-w-[300px]">
                <img src={url} alt="" className="w-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                  <a href={url} download="Simulação IA.png" target="_blank" rel="noopener noreferrer"
                    className="opacity-0 group-hover:opacity-100 bg-white text-gray-800 rounded-full p-2.5 shadow-lg"><Download className="h-5 w-5" /></a>
                </div>
                <span className="absolute bottom-2 left-2 text-xs text-white/90 bg-black/40 backdrop-blur-sm rounded-full px-2.5 py-1">✨ IA</span>
              </div>
            ))
          }
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

  // ── Nav ────────────────────────────────────────────────────

  const renderNav = () => {
    if (navState === 'hidden' || !categories.length) return null
    return (
      <div className="border-t border-gray-100 bg-white px-4 py-3 max-h-72 overflow-y-auto">
        {navState === 'categories' && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600 text-center">Escolha o que deseja explorar:</p>
            <div className="grid grid-cols-2 gap-2">
              {categories.map(cat => {
                const Icon = ICONS[cat.icon] || FolderOpen
                return <button key={cat.id} onClick={() => handleCatClick(cat)} disabled={loading}
                  className="flex items-center gap-2 px-4 py-3 bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 rounded-xl text-sm font-medium text-violet-700 hover:from-violet-100 hover:to-purple-100 disabled:opacity-50">
                  <Icon className="h-4 w-4" /> {cat.name}
                </button>
              })}
            </div>
          </div>
        )}
        {navState === 'prompts' && selectedCat && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></button>
              <p className="text-xs font-semibold text-gray-600">{selectedCat.name} — Escolha:</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {selectedCat.prompts.map(p => (
                <button key={p.id} onClick={() => handlePromptClick(p)} disabled={loading}
                  className="flex flex-col items-center gap-1 p-1.5 bg-white border border-gray-200 rounded-lg hover:border-violet-300 hover:bg-violet-50 transition-all disabled:opacity-50 text-center">
                  {(p.thumbnail?.url || p.images?.[0]?.url) ? (
                    <img src={p.thumbnail?.url || p.images[0].url} alt={p.name} className="w-full aspect-[4/3] object-cover rounded" />
                  ) : (
                    <div className="w-full aspect-[4/3] bg-gray-100 rounded flex items-center justify-center"><Wand2 className="h-4 w-4 text-gray-300" /></div>
                  )}
                  <span className="text-[10px] font-medium text-gray-700 leading-tight line-clamp-2">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {navState === 'options' && selectedPrompt && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></button>
              <p className="text-xs font-semibold text-gray-600">{selectedPrompt.name} — Comprimento:</p>
            </div>
            {(selectedPrompt.thumbnail?.url || selectedPrompt.images?.[0]?.url) && (
              <div className="flex justify-center">
                <img src={selectedPrompt.thumbnail?.url || selectedPrompt.images[0].url} alt="" className="w-24 h-24 object-cover rounded-xl border" />
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-center">
              {selectedPrompt.options.map((o, i) => (
                <button key={i} onClick={() => handleOptionClick(o)} disabled={loading}
                  className="px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50">{o}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
    {showPdfModal && <PdfModal />}
    <div className="flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden" style={{ height: 'min(780px, calc(100vh - 140px))' }}>
      <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white">
        <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center"><Wand2 className="h-5 w-5" /></div>
        <div className="flex-1">
          <p className="font-semibold text-sm">MS Color IA</p>
          <p className="text-white/70 text-xs mt-0.5">
            {loadingRef || loadingResults ? 'Carregando materiais...' : ''}
            {!loadingRef && !loadingResults && refBase64 ? 'Foto ✓' : ''}
            {!loadingRef && !loadingResults && resultMaterials.length > 0 ? ` · ${resultMaterials.length} doc${resultMaterials.length > 1 ? 's' : ''} ✓` : ''}
            {folderConfig?.folderName ? ` · ${folderConfig.folderName}` : ''}
          </p>
        </div>
        {refBase64 && referencePhotoUrl && <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white/40"><img src={referencePhotoUrl} alt="" className="w-full h-full object-cover" /></div>}
        <span className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2.5 py-1 text-xs"><span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse" /> Online</span>
        {imageMsgs.length > 0 && (
          <button onClick={() => { setPdfSelected(new Set(imageMsgs.map(m => m.id))); setShowPdfModal(true) }}
            title="Gerar PDF"
            className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-full px-2.5 py-1 text-xs font-medium transition-colors">
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
        )}
        {creditsImage !== null && (
          <span className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2.5 py-1 text-xs">📸{creditsImage} 💬{creditsText}</span>
        )}
        {clientId && messages.length > 1 && (
          <button
            onClick={() => {
              if (!confirm('Limpar o histórico do chat? As imagens geradas não serão perdidas, mas o PDF incluirá apenas as novas imagens geradas.')) return
              localStorage.removeItem(chatKey(clientId))
              // Reset result materials flag so the AI context is re-sent on the next message
              resultMaterialsSent.current = false
              setMessages([{ id: uid(), role: 'assistant', text: WELCOME(clientName.split(' ')[0]), responseParts: [{ type: 'text', text: '' }], timestamp: new Date() }])
            }}
            title="Limpar conversa"
            className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" /> Limpar
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 bg-gray-50/50">
        {messages.map(renderMsg)}
        <div ref={endRef} />
      </div>

      {renderNav()}

      {navState === 'hidden' && categories.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 bg-white">
          <button onClick={() => { setNavState('categories'); setSelectedCat(null); setSelectedPrompt(null) }}
            className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"><Wand2 className="h-3 w-3" /> Voltar ao menu</button>
        </div>
      )}

      {apiError && (
        <div className="mx-4 mb-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" /><p className="text-xs text-red-700 flex-1">{apiError}</p>
          <button onClick={() => setApiError(null)}><X className="h-3.5 w-3.5 text-red-400" /></button>
        </div>
      )}

      {pendingImage && (
        <div className="mx-4 mb-2 flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2">
          <img src={pendingImage.preview} alt="" className="w-12 h-12 object-cover rounded-lg" />
          <p className="text-xs text-violet-800 truncate flex-1">{pendingImage.file.name}</p>
          <button onClick={() => { URL.revokeObjectURL(pendingImage.preview); setPendingImage(null) }}><X className="h-4 w-4 text-violet-400" /></button>
        </div>
      )}

      <div className="px-4 pb-4 pt-2 bg-white border-t border-gray-100">
        <div className="flex items-end gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={loading} className="flex-shrink-0 w-10 h-10 rounded-xl bg-gray-100 hover:bg-violet-100 text-gray-500 hover:text-violet-600 flex items-center justify-center"><ImagePlus className="h-5 w-5" /></button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f?.type.startsWith('image/')) setPendingImage({ file: f, preview: URL.createObjectURL(f) }); if (e.target) e.target.value = '' }} />
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(undefined, false) } }}
            placeholder="Pergunte sobre suas cores, combinações..."
            rows={1} disabled={loading}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 max-h-32"
            style={{ minHeight: '42px' }}
            onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 128) + 'px' }} />
          <button onClick={() => handleSend(undefined, false)} disabled={loading || (!input.trim() && !pendingImage)}
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center disabled:opacity-40 shadow-sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  </>
  )
}

function MdText({ text }: { text: string }) {
  return <span>{text.split(/(\*\*[^*]+\*\*|\n|• .+)/).map((p, i) => {
    if (p === '\n') return <br key={i} />
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('• ')) return <div key={i} className="flex gap-2 mt-1"><span>•</span><span>{p.slice(2)}</span></div>
    return <span key={i}>{p}</span>
  })}</span>
}