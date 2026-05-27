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
  FileText, CheckSquare, Square, Save, CheckCircle2, ListChecks, ChevronDown, ChevronUp,
  ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react'
import {
  chatWithGemini, getGeminiApiKey, fileToBase64, urlToBase64, translateText, translateTexts,
  GeminiMessage, GeminiResponsePart, MaterialData,
} from '../../lib/geminiService'
import { supabase } from '../../lib/supabase'
import { driveStorage } from '../../lib/driveStorage'
import { buildStylePdfBlob, ItemLayout } from '../../lib/templatePDFGenerator'

// Carrega a foto pra base64 preferindo o proxy autenticado do Drive (evita
// CORS em drive.google.com/thumbnail). Cai pra fetch direto da URL quando
// driveFileId não está disponível (fotos legadas no Supabase Storage).
async function photoToBase64(
  source: { driveFileId?: string | null; url: string }
): Promise<{ base64: string; mimeType: string } | null> {
  if (source.driveFileId) {
    try {
      const blob = await driveStorage.fetchPhotoBlob(source.driveFileId)
      return await new Promise<{ base64: string; mimeType: string } | null>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res({
          base64: (r.result as string).split(',')[1],
          mimeType: blob.type || 'image/jpeg',
        })
        r.onerror = rej
        r.readAsDataURL(blob)
      })
    } catch (e) {
      console.error('[GeminiChat] proxy Drive falhou, tentando URL direta:', e)
      // Fallback: tenta a URL direta (provavelmente vai falhar por CORS, mas
      // dá pra debugar olhando a aba Network)
    }
  }
  return urlToBase64(source.url)
}

interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string
  imagePreview?: string; imageBase64?: string; imageMimeType?: string
  responseParts?: GeminiResponsePart[]; timestamp: Date
  loading?: boolean; translating?: boolean; error?: string; imageGenerationFailed?: boolean
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
interface RefPhoto { type: string; label: string; storagePath: string; url: string; driveFileId?: string | null }

interface GeminiChatProps {
  clientName: string; systemPrompt: string
  referencePhotoUrl?: string | null
  referencePhotoDriveFileId?: string | null
  referencePhotos?: RefPhoto[]
  folderConfig?: FolderConfig | null
  clientId?: string
  resultFileUrls?: ResultFile[]
  resultObservations?: string
  /** Código BCP-47 do idioma de resposta (ex: 'en-US'). Default: 'pt-BR'. */
  defaultLanguage?: LanguageCode
  /** Quando true, desativa verificação e consumo de créditos (modo admin). */
  unlimited?: boolean
  /** Chave customizada para persistência no localStorage. Útil para o admin
   *  manter um histórico separado do chat real da cliente. */
  chatStorageKey?: string
  /** Token do portal da cliente (UUID). Quando presente, as imagens geradas
   *  pela IA são salvas no Google Drive do admin via driveStorage.uploadPhoto()
   *  (autenticado com o token da cliente, sem JWT).
   *  No modo admin (unlimited=true) o upload usa adminUploadPhoto() com JWT. */
  portalToken?: string
  /** Quando true, as imagens geradas vão para a pasta "MS Color IA" no Drive
   *  do admin (sem vínculo com cliente). Não requer clientId nem portalToken. */
  msColorIaMode?: boolean
  /** Quando provido, exibe o botão "Salvar em Resultado" no modal de PDF.
   *  Recebe o Blob do PDF montado e o nome do arquivo já formatado.
   *  Atualmente passado apenas pelo ClientsManager (admin); o portal da
   *  cliente não passa essa prop, então não vê o botão. */
  onSavePdf?: (blob: Blob, fileName: string) => Promise<void>
}

// ── Idiomas suportados ──────────────────────────────────────────────────────
export const SUPPORTED_LANGUAGES = [
  { code: 'pt-BR', label: '🇧🇷 Português', name: 'Português (Brasil)' },
  { code: 'en-US', label: '🇺🇸 English',   name: 'English (US)' },
  { code: 'es-ES', label: '🇪🇸 Español',   name: 'Español' },
  { code: 'fr-FR', label: '🇫🇷 Français',  name: 'Français' },
  { code: 'it-IT', label: '🇮🇹 Italiano',  name: 'Italiano' },
  { code: 'de-DE', label: '🇩🇪 Deutsch',   name: 'Deutsch' },
] as const
export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code']

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

/**
 * Salva uma imagem gerada pela IA no Google Drive do admin.
 *
 * • Admin (unlimited): usa adminUploadPhoto() com JWT — não precisa de token.
 * • Portal da cliente: usa uploadPhoto() com portalToken — sem JWT.
 *
 * Retorna a URL de thumbnail do Drive para usar em <img src>, ou null em caso de falha.
 * As imagens ficam dentro da pasta do cliente no Drive (kind='ai_photo'),
 * sem ocupar espaço no Supabase Storage.
 */
async function uploadChatImageToDrive(
  clientId: string | undefined,
  base64: string,
  mimeType: string,
  portalToken?: string,
  msColorIaMode?: boolean,
): Promise<string | null> {
  try {
    const ext = mimeType.includes('png') ? 'png' : 'jpg'
    const fileName = `ia_${Date.now()}.${ext}`
    const byteStr = atob(base64)
    const arr = new Uint8Array(byteStr.length)
    for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
    const file = new File([arr], fileName, { type: mimeType })

    let result
    if (msColorIaMode) {
      // Pasta fixa "MS Color IA" no Drive do admin — sem cliente vinculado
      result = await driveStorage.uploadMsColorIaPhoto({ file })
    } else if (portalToken) {
      // Contexto cliente: autenticado pelo token do portal, sem JWT
      result = await driveStorage.uploadPhoto({ portalToken, file, categoryId: null, kind: 'ai_photo' })
    } else {
      // Contexto admin: autenticado pelo JWT da sessão
      result = await driveStorage.adminUploadPhoto({ clientId: clientId!, file, categoryId: null })
    }

    // Retorna URL de thumbnail pública do Drive para exibir no chat
    return driveStorage.viewUrl(result.driveFileId, 2000)
  } catch (err) {
    console.error('[uploadChatImageToDrive] falhou:', err)
    return null
  }
}

/**
 * Força o download de uma imagem sem CORS.
 *
 * O atributo `download` do <a> é ignorado pelo browser para URLs cross-origin,
 * e um `fetch()` simples falha por CORS no domínio do Supabase Storage.
 *
 * Estratégia:
 *  1. Detecta se a URL é de um bucket do Supabase → usa supabase.storage.download()
 *     que retorna um Blob diretamente via o cliente autenticado (sem CORS).
 *  2. Se não for Supabase (ex: base64 já inline), cai pro fetch normal.
 *  3. Último fallback: window.open (abre nova aba).
 */
async function downloadImage(url: string, fileName: string): Promise<void> {
  try {
    // Extrai bucket e path da URL pública do Supabase Storage
    // Formato: https://[id].supabase.co/storage/v1/object/public/[bucket]/[path]
    const m = url.match(/\/storage\/v1\/object\/public\/([^/?#]+)\/(.+?)(?:\?|#|$)/)
    if (m) {
      const [, bucket, path] = m
      const { data, error } = await supabase.storage.from(bucket).download(path)
      if (data && !error) {
        const objUrl = URL.createObjectURL(data)
        const a = document.createElement('a')
        a.href = objUrl
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(objUrl), 2000)
        return
      }
    }
    // Fallback fetch (URLs não-Supabase com CORS permissivo)
    const res = await fetch(url)
    if (!res.ok) throw new Error('fetch failed')
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

const WELCOME_TEXTS: Record<string, (name: string) => string> = {
  'pt-BR': (name) => `Olá! Eu sou a **MS Color IA**, sua assistente virtual de coloração pessoal 🌈\n\nFui treinada com base na metodologia e na expertise da especialista **Marília Santos**, referência em coloração pessoal e análise de imagem.\n\nTodas as minhas recomendações são **personalizadas exclusivamente para você**, utilizando as informações da sua análise feita pela Marília.\n\nAqui, você poderá:\n• Visualizar simulações de cabelos, maquiagens, roupas, acessórios.\n• Tirar dúvidas sobre sua análise.\n\nSempre que precisar, estarei aqui para te guiar 🌈`,
  'en-US': (name) => `Hello! I'm **MS Color IA**, your personal color consultant assistant 🌈\n\nI was trained based on the methodology and expertise of specialist **Marília Santos**, a reference in personal coloring and image analysis.\n\nAll my recommendations are **personalized exclusively for you**, using information from your analysis by Marília.\n\nHere, you can:\n• View simulations of hair, makeup, outfits, and accessories.\n• Ask questions about your analysis.\n\nWhenever you need, I'll be here to guide you 🌈`,
  'es-ES': (name) => `¡Hola! Soy **MS Color IA**, tu asistente virtual de coloración personal 🌈\n\nFui entrenada con base en la metodología y la experiencia de la especialista **Marília Santos**, referencia en coloración personal y análisis de imagen.\n\nTodas mis recomendaciones son **personalizadas exclusivamente para ti**, usando la información de tu análisis hecho por Marília.\n\nAquí podrás:\n• Ver simulaciones de cabello, maquillaje, ropa y accesorios.\n• Resolver dudas sobre tu análisis.\n\nSiempre que necesites, estaré aquí para guiarte 🌈`,
  'fr-FR': (name) => `Bonjour ! Je suis **MS Color IA**, votre assistante virtuelle en colorimétrie personnelle 🌈\n\nJ'ai été formée sur la méthodologie et l'expertise de la spécialiste **Marília Santos**, référence en colorimétrie personnelle et analyse d'image.\n\nToutes mes recommandations sont **personnalisées exclusivement pour vous**, à partir des informations de votre analyse réalisée par Marília.\n\nIci, vous pourrez :\n• Visualiser des simulations de coiffures, maquillages, tenues et accessoires.\n• Poser des questions sur votre analyse.\n\nChaque fois que vous en aurez besoin, je serai là pour vous guider 🌈`,
  'it-IT': (name) => `Ciao! Sono **MS Color IA**, la tua assistente virtuale di colorazione personale 🌈\n\nSono stata addestrata sulla metodologia e l'esperienza della specialista **Marília Santos**, punto di riferimento nella colorazione personale e nell'analisi dell'immagine.\n\nTutti i miei consigli sono **personalizzati esclusivamente per te**, utilizzando le informazioni della tua analisi effettuata da Marília.\n\nQui potrai:\n• Visualizzare simulazioni di capelli, trucco, abbigliamento e accessori.\n• Chiedere informazioni sulla tua analisi.\n\nOgni volta che ne avrai bisogno, sarò qui per guidarti 🌈`,
  'de-DE': (name) => `Hallo! Ich bin **MS Color IA**, deine virtuelle Farbberatungs-Assistentin 🌈\n\nIch wurde auf der Grundlage der Methodik und des Fachwissens der Spezialistin **Marília Santos** trainiert, einer Referenz in persönlicher Farbanalyse und Imageberatung.\n\nAlle meine Empfehlungen sind **ausschließlich für dich personalisiert**, basierend auf den Informationen aus deiner Analyse von Marília.\n\nHier kannst du:\n• Simulationen von Haaren, Make-up, Outfits und Accessoires ansehen.\n• Fragen zu deiner Analyse stellen.\n\nWann immer du Hilfe brauchst, bin ich für dich da 🌈`,
}
const WELCOME = (name: string, lang: LanguageCode = 'pt-BR') =>
  (WELCOME_TEXTS[lang] ?? WELCOME_TEXTS['pt-BR'])(name)

export function GeminiChat({ clientName, systemPrompt, referencePhotoUrl, referencePhotoDriveFileId, referencePhotos = [], folderConfig, clientId, resultFileUrls = [], resultObservations = '', unlimited = false, chatStorageKey, portalToken, msColorIaMode = false, onSavePdf, defaultLanguage = 'pt-BR' }: GeminiChatProps) {
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
  // Progresso da geração do PDF. `total` inclui os N itens (cada um traduzido
  // em uma chamada-lote à Gemini via translateTexts) + 1 unidade pra montagem
  // final do PDF. Valor `null` = nada em andamento (estado limpo).
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfSaving, setPdfSaving] = useState(false)
  const [pdfSaveSuccess, setPdfSaveSuccess] = useState(false)
  const [pdfSaveError, setPdfSaveError] = useState<string | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(() => {
    try {
      const stored = localStorage.getItem('mscolors_language')
      if (stored && SUPPORTED_LANGUAGES.some(l => l.code === stored)) return stored as LanguageCode
    } catch {}
    return defaultLanguage
  })
  const [showLangMenu, setShowLangMenu] = useState(false)

  useEffect(() => {
    try { localStorage.setItem('mscolors_language', selectedLanguage) } catch {}
  }, [selectedLanguage])
  // ── Modo de seleção para apagar mensagens ────────────────────────────
  const [selectMode, setSelectMode]     = useState(false)
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set())
  // ── Mensagens longas expandidas ──────────────────────────────────────
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set())
  // ── Lightbox — foto em tela cheia com zoom ────────────────────────────
  const [lightbox, setLightbox] = useState<{ src: string; mimeType?: string } | null>(null)
  // Object URLs criados pro preview do PDF. Acumulamos e revogamos no unmount
  // (revogar enquanto a aba ainda mostra o PDF pode quebrar a visualização
  // em alguns browsers).
  const pdfUrlsRef = useRef<string[]>([])

  // Fecha o menu de idioma ao clicar fora
  const langMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showLangMenu) return
    const handler = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) setShowLangMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showLangMenu])

  const lastCtx = useRef<any>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Permite que handlers internos chamen handleSend mesmo com loading=true
  // (eles já mostram o estado de loading antes de chamar handleSend)
  const skipLoadingGuard = useRef(false)

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
    if (!referencePhotoUrl && !referencePhotoDriveFileId) return
    setLoadingRef(true)
    photoToBase64({ driveFileId: referencePhotoDriveFileId, url: referencePhotoUrl || '' })
      .then(r => { if (r) { setRefBase64(r.base64); setRefMime(r.mimeType) } })
      .finally(() => setLoadingRef(false))
  }, [referencePhotoUrl, referencePhotoDriveFileId])

  useEffect(() => {
    if (!referencePhotos.length) return
    Promise.all(referencePhotos.map(async p => { const r = await photoToBase64({ driveFileId: p.driveFileId, url: p.url }); return r ? { type: p.type, base64: r.base64, mime: r.mimeType } : null }))
      .then(results => {
        const map: Record<string, { base64: string; mime: string }> = {}
        results.forEach(r => { if (r) map[r.type] = { base64: r.base64, mime: r.mime } })
        setRefPhotoMap(map)
        if (!referencePhotoUrl && !referencePhotoDriveFileId && map['geral']) { setRefBase64(map['geral'].base64); setRefMime(map['geral'].mime) }
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
    if (!clientId || unlimited) return
    supabase.rpc('check_ai_credits', { p_client_id: clientId }).then(({ data }) => {
      if (data) { setCreditsImage(data.image ?? null); setCreditsText(data.text ?? null) }
    })
  }, [clientId, unlimited])

  // Chave usada para persistir o histórico no localStorage. O admin passa
  // `chatStorageKey` para manter um histórico próprio sem misturar com o
  // chat real da cliente (que continua usando `chatKey(clientId)`).
  const storageKey = chatStorageKey || (clientId ? chatKey(clientId) : null)

  useEffect(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved) { const msgs = deserializeMessages(saved); if (msgs.length > 0) { setMessages(msgs); return } }
    }
    setMessages([{ id: uid(), role: 'assistant', text: WELCOME(clientName.split(' ')[0], selectedLanguage), responseParts: [{ type: 'text', text: '' }], timestamp: new Date() }])
  }, [clientName, storageKey])

  useEffect(() => {
    if (!storageKey || messages.length === 0 || messages.some(m => m.loading)) return
    localStorage.setItem(storageKey, serializeMessages(messages))
  }, [messages, storageKey])

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
    skipLoadingGuard.current = true
    setLoading(true)
    // Adiciona mensagens imediatamente, antes da tradução
    const earlyUserMsgId = uid(); const earlyLid = uid()
    setMessages(prev => [...prev,
      { id: earlyUserMsgId, role: 'user', text: `✨ ${prompt.name}`, timestamp: new Date() },
      { id: earlyLid, role: 'assistant', text: '', loading: true, translating: true, timestamp: new Date() },
    ])
    const refOverride = getRefPhotoForCategory(cat)
    const rawAfterImageText = (prompt.tintReference || prompt.reference)?.trim() || undefined
    const rawCaption = prompt.tintReference || prompt.reference || prompt.name
    const catIsAccessory = cat.icon === 'gem' || cat.name.toLowerCase().includes('acess')
    const apiKey = await getGeminiApiKey()
    // Carrega imagens e traduz apenas label e section para exibição no chat.
    // caption e afterImageText ficam em PT-BR e são traduzidos somente ao gerar o PDF.
    const rawSection = getCategorySection(cat)
    const [mats, translatedLabel, translatedSection] = await Promise.all([
      loadPromptMaterials(prompt),
      selectedLanguage !== 'pt-BR' ? translateText(prompt.name, selectedLanguage, apiKey) : Promise.resolve(prompt.name),
      selectedLanguage !== 'pt-BR' ? translateText(rawSection, selectedLanguage, apiKey) : Promise.resolve(rawSection),
    ])
    const afterImageText = rawAfterImageText  // exibe em PT no chat; tradução ocorre só no PDF
    setPromptMaterials(mats)
    const meta: PdfMeta = { section: translatedSection, label: translatedLabel, caption: rawCaption, promptId: prompt.id }
    handleSend(buildPromptInstruction(cat, prompt.instructions || prompt.name, ''), true, prompt, mats, refOverride, `✨ ${translatedLabel}`, catIsAccessory, meta, afterImageText, earlyLid, earlyUserMsgId)
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
    skipLoadingGuard.current = true
    setLoading(true)
    // Adiciona mensagens imediatamente, antes da tradução
    const rawDisplayLabel = [selectedPrompt.name, length?.name, texture?.name].filter(Boolean).join(' — ')
    const earlyUserMsgId = uid(); const earlyLid = uid()
    setMessages(prev => [...prev,
      { id: earlyUserMsgId, role: 'user', text: `✨ ${rawDisplayLabel}`, timestamp: new Date() },
      { id: earlyLid, role: 'assistant', text: '', loading: true, translating: true, timestamp: new Date() },
    ])
    const refOverride = getRefPhotoForCategory(selectedCat)
    const rawAfterImageText = selectedPrompt.tintReference?.trim() || undefined
    const rawCaption = selectedPrompt.tintReference || selectedPrompt.reference || selectedPrompt.name
    const lengthPart = length?.instruction ? `\n\n═══ COMPRIMENTO ═══\n${length.instruction}` : ''
    const texturePart = texture?.instruction ? `\n\n═══ TEXTURA ═══\n${texture.instruction}` : ''
    const combinedInstructions = `${selectedPrompt.instructions || selectedPrompt.name}${lengthPart}${texturePart}`
    const apiKey = await getGeminiApiKey()
    // Carrega imagens e traduz apenas label, nomes e section para exibição no chat.
    // caption e afterImageText ficam em PT-BR e são traduzidos somente ao gerar o PDF.
    const rawSection = getCategorySection(selectedCat)
    const [promptMats, lengthMats, textureMats, translatedLabel, translatedLengthName, translatedTextureName, translatedSection] = await Promise.all([
      loadPromptMaterials(selectedPrompt),
      length ? loadImages(length.images) : Promise.resolve([]),
      texture ? loadImages(texture.images) : Promise.resolve([]),
      selectedLanguage !== 'pt-BR' ? translateText(selectedPrompt.name, selectedLanguage, apiKey) : Promise.resolve(selectedPrompt.name),
      length?.name && selectedLanguage !== 'pt-BR' ? translateText(length.name, selectedLanguage, apiKey) : Promise.resolve(length?.name),
      texture?.name && selectedLanguage !== 'pt-BR' ? translateText(texture.name, selectedLanguage, apiKey) : Promise.resolve(texture?.name),
      selectedLanguage !== 'pt-BR' ? translateText(rawSection, selectedLanguage, apiKey) : Promise.resolve(rawSection),
    ])
    const afterImageText = rawAfterImageText  // exibe em PT no chat; tradução ocorre só no PDF
    const translatedDisplayLabel = [translatedLabel, translatedLengthName, translatedTextureName].filter(Boolean).join(' — ')
    const allMats = [...promptMats, ...lengthMats, ...textureMats]; setPromptMaterials(allMats)
    const meta: PdfMeta = { section: translatedSection, label: translatedLabel, caption: rawCaption, promptId: selectedPrompt.id }
    handleSend(buildPromptInstruction(selectedCat, combinedInstructions, ''), true, selectedPrompt, allMats, refOverride, `✨ ${translatedDisplayLabel}`, false, meta, afterImageText, earlyLid, earlyUserMsgId)
  }

  const handleOptionClick = async (option: string) => {
    if (!selectedPrompt || !selectedCat) return
    setNavState('hidden')
    skipLoadingGuard.current = true
    setLoading(true)
    // Adiciona mensagens imediatamente, antes da tradução
    const earlyUserMsgId = uid(); const earlyLid = uid()
    setMessages(prev => [...prev,
      { id: earlyUserMsgId, role: 'user', text: `✨ ${selectedPrompt.name} — ${option}`, timestamp: new Date() },
      { id: earlyLid, role: 'assistant', text: '', loading: true, translating: true, timestamp: new Date() },
    ])
    const refOverride = getRefPhotoForCategory(selectedCat)
    const rawAfterImageText = selectedPrompt.tintReference?.trim() || undefined
    const rawCaption = selectedPrompt.tintReference || selectedPrompt.reference || selectedPrompt.name
    const catIsAccessory = selectedCat.icon === 'gem' || selectedCat.name.toLowerCase().includes('acess')
    const apiKey = await getGeminiApiKey()
    // Carrega imagens e traduz apenas label e section para exibição no chat.
    // caption e afterImageText ficam em PT-BR e são traduzidos somente ao gerar o PDF.
    const rawSection = getCategorySection(selectedCat)
    const [mats, translatedLabel, translatedSection] = await Promise.all([
      loadPromptMaterials(selectedPrompt),
      selectedLanguage !== 'pt-BR' ? translateText(selectedPrompt.name, selectedLanguage, apiKey) : Promise.resolve(selectedPrompt.name),
      selectedLanguage !== 'pt-BR' ? translateText(rawSection, selectedLanguage, apiKey) : Promise.resolve(rawSection),
    ])
    const afterImageText = rawAfterImageText  // exibe em PT no chat; tradução ocorre só no PDF
    setPromptMaterials(mats)
    const meta: PdfMeta = { section: translatedSection, label: translatedLabel, caption: rawCaption, promptId: selectedPrompt.id }
    handleSend(buildPromptInstruction(selectedCat, `${selectedPrompt.instructions || selectedPrompt.name} - comprimento ${option}`, ''), true, selectedPrompt, mats, refOverride, `✨ ${translatedLabel} — ${option}`, catIsAccessory, meta, afterImageText, earlyLid, earlyUserMsgId)
  }

  const goBack = () => {
    if (navState === 'textures') { if ((selectedPrompt?.lengths || []).length > 0) setNavState('lengths'); else { setNavState('prompts'); setSelectedPrompt(null) } }
    else if (navState === 'lengths') { setNavState('prompts'); setSelectedPrompt(null); setSelectedLength(null) }
    else if (navState === 'options') { setNavState('prompts'); setSelectedPrompt(null) }
    else if (navState === 'prompts') { setNavState('categories'); setSelectedCat(null) }
  }

  const handleSend = async (overrideText?: string, isImage: boolean = false, contextPrompt?: Prompt, mats?: MaterialData[], refPhotoOverride?: { base64: string; mime: string }, displayText?: string, isAccessory: boolean = false, pdfMeta?: PdfMeta, afterImageText?: string, preLid?: string, preUserMsgId?: string) => {
    const text = (overrideText || input).trim()
    if (!text && !pendingImage) return
    if (loading && !skipLoadingGuard.current) return
    skipLoadingGuard.current = false

    setApiError(null)
    const apiKey = await getGeminiApiKey()
    if (!apiKey) { setApiError('Chave da API não configurada.'); return }

    if (clientId && !unlimited) {
      const available = isImage ? creditsImage : creditsText
      if (available !== null && available <= 0) { setApiError(`Seus créditos de ${isImage ? 'imagem' : 'texto'} acabaram. Entre em contato com a consultora para adicionar mais.`); return }
    }

    let uB64: string | undefined, uMime: string | undefined, prev: string | undefined
    if (pendingImage) { const c = await fileToBase64(pendingImage.file); uB64 = c.base64; uMime = c.mimeType; prev = pendingImage.preview; setPendingImage(null) }

    const lid = preLid ?? uid()
    if (!preLid) {
      const userMsg: ChatMsg = { id: uid(), role: 'user', text: displayText || text || '(foto)', imagePreview: prev, imageBase64: uB64, imageMimeType: uMime, timestamp: new Date() }
      setMessages(prev => [...prev, userMsg, { id: lid, role: 'assistant', text: '', loading: true, timestamp: new Date(), pdfMeta }])
      setInput(''); setLoading(true)
    } else {
      // Pre-created messages already exist; upgrade loading bubble: clear translating flag and set final pdfMeta
      setMessages(prev => prev.map(m => {
        if (m.id === lid) return { ...m, translating: false, pdfMeta }
        if (preUserMsgId && m.id === preUserMsgId) return { ...m, text: displayText || text || '(foto)', imagePreview: prev, imageBase64: uB64, imageMimeType: uMime }
        return m
      }))
    }
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
      if (clientId || msColorIaMode) {
        const imageParts = response.parts.filter(p => p.type === 'image' && p.imageBase64)
        if (imageParts.length > 0) {
          Promise.all(imageParts.map(p => uploadChatImageToDrive(clientId, p.imageBase64!, p.imageMimeType || 'image/png', portalToken, msColorIaMode))).then(urls => {
            const saved = urls.filter(Boolean) as string[]
            if (saved.length > 0) setMessages(prev => prev.map(m => m.id === lid ? { ...m, savedImageUrls: saved } : m))
          })
        }
        if (!unlimited) {
          const creditType = hasImage ? 'image' : 'text'
          supabase.rpc('use_ai_credit', { p_client_id: clientId, p_type: creditType }).then(({ data }) => {
            if (data?.remaining !== undefined) { if (creditType === 'image') setCreditsImage(data.remaining); else setCreditsText(data.remaining) }
          })
        }
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

  // ── Helpers para sincronizar rawLines com o texto atual antes de gerar o PDF ──
  const SECTION_RE = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}]/u
  function pdfParseBlocks(text: string): Array<{ id: string; rawLines: string[]; isSection: boolean }> {
    if (!text.trim()) return [{ id: 'b0', rawLines: [''], isSection: false }]
    return text.split(/\n[ \t]*\n/).map((raw, i) => {
      const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
      if (!lines.length) return null
      const first = lines[0]
      const isSection = SECTION_RE.test(first) || (first === first.toUpperCase() && first.replace(/[^A-Za-z]/g, '').length >= 4)
      return { id: `b${i}`, rawLines: lines, isSection }
    }).filter(Boolean) as any[]
  }
  function pdfSyncLayout(layout: ItemLayout, text: string): ItemLayout {
    if (!layout.blocks?.length) return layout
    const freshBlocks = pdfParseBlocks(text)
    const fallback = layout.blocks[layout.blocks.length - 1] ?? {}
    return {
      ...layout,
      blocks: freshBlocks.map((b, i) => {
        const s = layout.blocks[i] ?? fallback
        return { ...b, marginBelow: s.marginBelow ?? 8, fontFamily: s.fontFamily, headerSize: s.headerSize, bodySize: s.bodySize, headerColor: s.headerColor, bodyColor: s.bodyColor, blockVariant: s.blockVariant, blockBgColor: s.blockBgColor, titleAlign: s.titleAlign, textAlign: s.textAlign, isSection: s.isSection ?? b.isSection, w: s.w, h: s.h, x: s.x, y: s.y }
      }),
    }
  }

  // Extrai e prepara os items prontos pro template PDF a partir das mensagens
  // selecionadas no modal. Reutilizado pelo download e pelo "Salvar em
  // Resultado" — single source of truth pra não divergir os dois fluxos.
  //
  // A tradução do caption (tintReference / reference) só ocorre aqui —
  // nunca durante a geração da imagem — para não atrasar o fluxo principal
  // e nunca modificar o prompt enviado ao Gemini.
  const buildPdfItems = async (): Promise<any[]> => {
    const selected = imageMsgs.filter(m => pdfSelected.has(m.id))
    if (!selected.length) return []
    // Obtém a chave uma única vez para todas as traduções do lote
    const apiKey = await getGeminiApiKey()
    // Guarda os layouts PUROS (sem sincronizar texto).
    // O texto de cada bloco é traduzido diretamente abaixo, preservando a
    // estrutura exata do layout (número e ordem de blocos inalterados).
    const freshLayoutMap = new Map<string, ItemLayout>()
    try {
      if (folderConfig?.folderName) {
        const { data: rows } = await supabase.from('ai_folders').select('config').eq('name', folderConfig.folderName).limit(1)
        const raw = rows?.[0]?.config; const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
        for (const cat of cfg?.categories ?? []) {
          for (const p of cat?.prompts ?? []) {
            if (p?.id && p?.pdfLayout) {
              freshLayoutMap.set(p.id, p.pdfLayout)
            }
          }
        }
      }
    } catch {}

    // Traduz, em UMA ÚNICA chamada por item, todos os textos do PDF:
    //   caption + label + section + rawLines de cada bloco do layout.
    //
    // Isso resolve dois problemas que apareciam quando se traduzia bloco-a-bloco
    // em paralelo:
    //   1. LENTIDÃO: para N itens com M blocos, tínhamos N × (3 + M) requisições
    //      HTTP paralelas (ex.: 5 itens × 9 = 45 calls), o que esbarrava no rate
    //      limit da Gemini (15 RPM no free tier) e amontoava os tempos.
    //      Agora: 1 chamada por item (5 ao invés de 45).
    //   2. TRUNCAMENTO: cada translateText antigo tinha maxOutputTokens=2048 sem
    //      detecção de finishReason — quando a resposta cortava, voltava texto
    //      incompleto pro PDF (ex.: "harmonious effect" sem ponto final).
    //      A nova translateTexts/translateText têm cap de 8192 + auto-split
    //      recursivo quando MAX_TOKENS dispara, então o texto NUNCA volta
    //      incompleto.
    const items = await Promise.all(selected.map(async (msg) => {
      const dataUrl = await getImgDataUrl(msg); if (!dataUrl) {
        // Mesmo quando o item não é válido, conta como concluído pra barra
        // não travar (caso contrário a porcentagem final ficaria abaixo de 100%).
        setPdfProgress(p => p ? { ...p, done: p.done + 1 } : p)
        return null
      }
      const rawCap   = msg.pdfMeta?.caption
      const rawLabel = msg.pdfMeta?.label || msg.text?.replace(/\n/g, ' ')?.slice(0, 30) || 'Imagem gerada'
      const rawSec   = msg.pdfMeta?.section
      // Busca o layout fresco do Supabase; cai pro in-memory como fallback.
      const baseLayout = (msg.pdfMeta?.promptId
        ? freshLayoutMap.get(msg.pdfMeta.promptId)
        : undefined) ?? findPromptLayout(msg.pdfMeta?.promptId)

      // Caminho rápido: pt-BR ou sem chave → não traduz nada.
      if (selectedLanguage === 'pt-BR' || !apiKey) {
        setPdfProgress(p => p ? { ...p, done: p.done + 1 } : p)
        return {
          dataUrl,
          label:   rawLabel,
          caption: rawCap,
          section: rawSec,
          layout:  baseLayout,
        }
      }

      // Monta um único array com toda a informação textual deste item.
      // Ordem fixa: [caption, label, section, blockText_1, blockText_2, ...].
      // Strings vazias são preservadas posicionalmente pela translateTexts.
      const blocks     = baseLayout?.blocks ?? []
      const blockTexts = blocks.map(b => b.rawLines.join('\n'))
      const allInputs  = [rawCap ?? '', rawLabel ?? '', rawSec ?? '', ...blockTexts]

      const translated = await translateTexts(allInputs, selectedLanguage, apiKey)
      const [tCap, tLabel, tSec, ...tBlockTexts] = translated

      let finalLayout: ItemLayout | undefined = baseLayout
      if (baseLayout && blocks.length > 0) {
        finalLayout = {
          ...baseLayout,
          blocks: blocks.map((block, i) => {
            const txt = tBlockTexts[i]
            if (!txt || !txt.trim()) return { ...block, h: undefined }
            const lines = txt.split('\n').map(l => l.trim()).filter(Boolean)
            // Remove h fixo: o texto traduzido pode ter mais linhas que o original,
            // então deixamos o renderer calcular a altura natural em vez de cortar.
            return { ...block, rawLines: lines.length ? lines : block.rawLines, h: undefined }
          }),
        }
      }

      // Marca este item como concluído pro progresso da UI.
      setPdfProgress(p => p ? { ...p, done: p.done + 1 } : p)

      return {
        dataUrl,
        label:   (tLabel && tLabel.trim()) || rawLabel,
        caption: (tCap   && tCap.trim())   ? tCap : rawCap,
        section: (tSec   && tSec.trim())   ? tSec : rawSec,
        layout:  finalLayout,
      }
    }))
    return items.filter(Boolean) as any[]
  }

  // Etapa 1 — monta o PDF, guarda o Blob em estado e abre em nova aba
  // pra cliente conferir ANTES de decidir entre baixar ou salvar.
  // Se o popup for bloqueado pelo browser, cai pra download direto (mesmo
  // efeito visual: cliente vê o arquivo no seu computador).
  const handleGeneratePdf = async () => {
    setPdfGenerating(true)
    setPdfSaveSuccess(false)
    setPdfSaveError(null)
    // Inicializa progresso: total = N itens selecionados + 1 unidade pra
    // montagem final do PDF. Cada item traduzido incrementa `done`; depois
    // a montagem do blob incrementa o último ponto.
    const totalUnits = pdfSelected.size + 1
    setPdfProgress({ done: 0, total: totalUnits })
    try {
      const validItems = await buildPdfItems()
      if (validItems.length === 0) return
      // Traduz o título da página de colagem ("Simulações") para o idioma selecionado.
      // A chave é reutilizada — buildPdfItems já a buscou; getGeminiApiKey é cacheada.
      let collageTitle: string | undefined
      if (selectedLanguage !== 'pt-BR') {
        try {
          const apiKey = await getGeminiApiKey()
          if (apiKey) collageTitle = await translateText('Simulações', selectedLanguage, apiKey)
        } catch {}
      }
      const blob = await buildStylePdfBlob({ clientName, items: validItems, collageTitle })
      // Última unidade: PDF montado.
      setPdfProgress(p => p ? { ...p, done: p.total } : p)
      setPdfBlob(blob)
      const url = URL.createObjectURL(blob)
      pdfUrlsRef.current.push(url)
      const win = window.open(url, '_blank')
      if (!win) {
        // Popup bloqueado — dispara download como fallback
        const a = document.createElement('a')
        a.href = url
        a.download = `${clientName} - Simulações IA.pdf`
        document.body.appendChild(a); a.click()
        document.body.removeChild(a)
      }
    } catch (e: any) {
      alert('Erro ao gerar PDF: ' + e.message)
    } finally {
      setPdfGenerating(false)
      setPdfProgress(null)
    }
  }

  // Etapa 2a — baixa o PDF já gerado (sem rebuildar). Reusa o blob em memória.
  const handleDownloadPdf = () => {
    if (!pdfBlob) return
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${clientName} - Simulações IA.pdf`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Etapa 2b — salva o PDF já gerado em client_result_files via prop.
  // Só ativo quando o caller passou `onSavePdf` (hoje só o ClientsManager).
  const handleSavePdfToResult = async () => {
    if (!onSavePdf || !pdfBlob) return
    setPdfSaving(true)
    setPdfSaveError(null)
    try {
      const fileName = `${clientName} - Simulações IA.pdf`
      await onSavePdf(pdfBlob, fileName)
      setPdfSaveSuccess(true)
    } catch (e: any) {
      setPdfSaveError(e?.message || String(e) || 'Erro ao salvar')
    } finally {
      setPdfSaving(false)
    }
  }

  // Invalidar o PDF gerado se a seleção mudar — força nova geração pra
  // refletir as imagens atualmente selecionadas.
  useEffect(() => {
    setPdfBlob(null)
    setPdfSaveSuccess(false)
    setPdfSaveError(null)
  }, [pdfSelected])

  // Limpa todos os Object URLs criados pelo preview no unmount.
  useEffect(() => () => {
    pdfUrlsRef.current.forEach(URL.revokeObjectURL)
    pdfUrlsRef.current = []
  }, [])

  const imageMsgs = messages.filter(m => m.role === 'assistant' && !m.loading && !m.error && (m.responseParts?.some(p => p.type === 'image' && p.imageBase64) || m.savedImageUrls?.length))

  // ── Agrupa imagens por seção para o modal do PDF ──────────────────────────────
  // Calculado fora do JSX para evitar recriação a cada render do modal.
  const pdfBySection = imageMsgs.reduce((acc, msg) => {
    const s = msg.pdfMeta?.section || 'Geral'
    if (!acc[s]) acc[s] = []
    acc[s].push(msg)
    return acc
  }, {} as Record<string, ChatMsg[]>)

  // ── Apaga as mensagens selecionadas e sai do modo de seleção ──────────
  function handleDeleteSelected() {
    if (selectedMsgs.size === 0) return
    setMessages(prev => {
      const next = prev.filter(m => !selectedMsgs.has(m.id))
      // Persiste no localStorage se houver storageKey
      if (storageKey) {
        try {
          const toSave = serializeMessages(next)
          if (toSave) localStorage.setItem(storageKey, toSave)
          else        localStorage.removeItem(storageKey)
        } catch {}
      }
      return next
    })
    setSelectedMsgs(new Set())
    setSelectMode(false)
  }

  function toggleMsgSelection(id: string) {
    setSelectedMsgs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const renderMsg = (msg: ChatMsg) => {
    const isU = msg.role === 'user'
    const isSel = selectedMsgs.has(msg.id)
    return (
      <div
        key={msg.id}
        className={`flex gap-2 sm:gap-3 ${isU ? 'flex-row-reverse' : 'flex-row'} ${selectMode ? 'cursor-pointer' : ''}`}
        onClick={selectMode ? () => toggleMsgSelection(msg.id) : undefined}
      >
        {/* Checkbox de seleção — aparece só no selectMode */}
        {selectMode && (
          <div className={`flex-shrink-0 self-center ${isU ? 'order-last ml-1' : 'order-first mr-1'}`}>
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSel ? 'bg-violet-600 border-violet-600' : 'bg-white border-gray-300'}`}>
              {isSel && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </div>
          </div>
        )}
        <div className={`flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-white ${isU ? 'bg-gradient-to-br from-rose-400 to-pink-500' : 'bg-gradient-to-br from-violet-500 to-purple-600'} ${selectMode && isSel ? 'ring-2 ring-violet-400 ring-offset-1' : ''}`}>
          {isU ? <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
        </div>
        <div className={`flex flex-col gap-2 max-w-[85%] sm:max-w-[80%] ${isU ? 'items-end' : 'items-start'} ${selectMode && isSel ? 'opacity-75' : ''}`}>
          {msg.imagePreview && <div className="rounded-2xl overflow-hidden shadow-md max-w-[180px] sm:max-w-[200px]"><img src={msg.imagePreview} alt="" className="w-full object-cover" /></div>}
          {(msg.text || msg.loading || msg.error) && (() => {
            // Considera "longa" qualquer mensagem do assistente com mais de
            // 3 quebras de linha OU mais de 220 caracteres (exclui loading/erro).
            const isLong = !isU && !msg.loading && !msg.error &&
              (msg.text.split('\n').length > 3 || msg.text.length > 220)
            const isExpanded = expandedMsgs.has(msg.id)
            return (
              <div className={`rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm text-sm leading-relaxed ${isU ? 'bg-gradient-to-br from-rose-400 to-pink-500 text-white rounded-br-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm'}`}>
                {msg.loading ? (
                  <div className="flex items-center gap-2 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-xs">{msg.translating ? 'Traduzindo...' : loadingResults ? 'Carregando materiais...' : 'Gerando...'}</span></div>
                ) : msg.error ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2 text-red-600"><AlertCircle className="h-4 w-4 mt-0.5" /><span className="text-xs">{msg.error}</span></div>
                    <button onClick={handleRetry} disabled={loading} className="self-start text-xs flex items-center gap-1 px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg"><RefreshCw className="h-3 w-3" /> Tentar novamente</button>
                  </div>
                ) : isLong ? (
                  <>
                    <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? '' : 'max-h-[4.5rem]'}`} style={isExpanded ? {} : { WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)' }}>
                      <MdText text={msg.text} />
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setExpandedMsgs(prev => {
                          const next = new Set(prev)
                          next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id)
                          return next
                        })
                      }}
                      className="mt-2 flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800 transition-colors"
                    >
                      {isExpanded
                        ? <><ChevronUp className="h-3.5 w-3.5" /> Ver menos</>
                        : <><ChevronDown className="h-3.5 w-3.5" /> Ver mais</>
                      }
                    </button>
                  </>
                ) : <MdText text={msg.text} />}
              </div>
            )
          })()}
          {msg.responseParts?.filter(p => p.type === 'image' && p.imageBase64).map((p, i) => {
            const src = `data:${p.imageMimeType};base64,${p.imageBase64}`
            return (
              <div key={i} className="relative group rounded-2xl overflow-hidden shadow-lg border w-full max-w-[260px] sm:max-w-[300px]">
                <img
                  src={src}
                  alt=""
                  className="w-full object-cover cursor-zoom-in"
                  onClick={() => setLightbox({ src, mimeType: p.imageMimeType })}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center gap-2.5">
                  <button
                    onClick={() => setLightbox({ src, mimeType: p.imageMimeType })}
                    className="opacity-0 group-hover:opacity-100 active:opacity-100 bg-white text-gray-800 rounded-full p-2.5 shadow-lg transition-opacity"
                    title="Ver em tela cheia"
                  >
                    <Maximize2 className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => { const a = document.createElement('a'); a.href = src; a.download = 'Simulação IA.png'; a.click() }}
                    className="opacity-0 group-hover:opacity-100 active:opacity-100 bg-white text-gray-800 rounded-full p-2.5 shadow-lg transition-opacity"
                    title="Baixar imagem"
                  >
                    <Download className="h-5 w-5" />
                  </button>
                </div>
                <span className="absolute bottom-2 left-2 text-xs text-white/90 bg-black/40 backdrop-blur-sm rounded-full px-2.5 py-1">✨ IA</span>
              </div>
            )
          })}
          {!msg.responseParts?.some(p => p.type === 'image' && p.imageBase64) && msg.savedImageUrls?.map((url, i) => (
            <div key={i} className="relative group rounded-2xl overflow-hidden shadow-lg border w-full max-w-[260px] sm:max-w-[300px]">
              <img
                src={url}
                alt=""
                className="w-full object-cover cursor-zoom-in"
                onClick={() => setLightbox({ src: url })}
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center gap-2.5">
                <button
                  onClick={() => setLightbox({ src: url })}
                  className="opacity-0 group-hover:opacity-100 active:opacity-100 bg-white text-gray-800 rounded-full p-2.5 shadow-lg transition-opacity"
                  title="Ver em tela cheia"
                >
                  <Maximize2 className="h-5 w-5" />
                </button>
                <button
                  onClick={() => downloadImage(url, 'Simulação IA.png')}
                  className="opacity-0 group-hover:opacity-100 active:opacity-100 bg-white text-gray-800 rounded-full p-2.5 shadow-lg transition-opacity"
                  title="Baixar imagem"
                >
                  <Download className="h-5 w-5" />
                </button>
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
                <div className="w-full aspect-[4/3] bg-gray-100 rounded flex items-center justify-center relative overflow-hidden">
                  <Wand2 className="h-4 w-4 text-gray-300" />
                  {(p.thumbnail?.url || p.images?.[0]?.url) && (
                    <img src={p.thumbnail?.url || p.images[0].url} alt={p.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={e => { e.currentTarget.style.display = 'none' }} />
                  )}
                </div>
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
               <div className="w-full aspect-[4/3] bg-gradient-to-br from-violet-50 to-purple-100 rounded flex items-center justify-center relative overflow-hidden">
                  <Scissors className="h-5 w-5 text-violet-300" />
                  {length.thumbnail?.url && (
                    <img src={length.thumbnail.url} alt={length.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={e => { e.currentTarget.style.display = 'none' }} />
                  )}
                </div>
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
                <div className="w-full aspect-[4/3] bg-gradient-to-br from-cyan-50 to-teal-100 rounded flex items-center justify-center relative overflow-hidden">
                  <svg className="h-5 w-5 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12c0-4 3-7 6-7s6 3 6 7-3 7-6 7" /><path d="M9 12c0-2 1.5-3.5 3-3.5" />
                  </svg>
                  {texture.thumbnail?.url && (
                    <img src={texture.thumbnail.url} alt={texture.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={e => { e.currentTarget.style.display = 'none' }} />
                  )}
                </div>
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
      {/*
        ── Modal de exportação PDF ───────────────────────────────────────────────
        IMPORTANTE: o modal é renderizado como JSX inline — NÃO como um
        subcomponente (const PdfModal = () => {...}).

        Quando o modal era um componente definido dentro de GeminiChat, o React
        criava uma nova função a cada render. Por ser uma referência diferente,
        o React desmontava e remontava o modal inteiro ao clicar em qualquer foto
        (mudança de estado em pdfSelected) — resetando o scroll para o topo.

        Com JSX inline, o React apenas atualiza os elementos que mudaram
        (ícone de check/uncheck), sem tocar no scroll container.
      */}
      {showPdfModal && (
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
              {Object.entries(pdfBySection).map(([section, msgs]) => (
                <div key={section}>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{section}</p>
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {msgs.map(msg => {
                      const sel = pdfSelected.has(msg.id)
                      const imgSrc = msg.responseParts?.find(p => p.type === 'image' && p.imageBase64)
                        ? `data:${msg.responseParts.find(p => p.type === 'image')?.imageMimeType || 'image/jpeg'};base64,${msg.responseParts.find(p => p.type === 'image' && p.imageBase64)?.imageBase64}`
                        : msg.savedImageUrls?.[0]
                      return (
                        <button
                          key={msg.id}
                          onClick={() => setPdfSelected(prev => {
                            const next = new Set(prev)
                            next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id)
                            return next
                          })}
                          className={`relative rounded-xl overflow-hidden border-2 text-left transition-all ${sel ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'}`}
                        >
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
            {/* Banner de status — muda conforme a etapa do fluxo */}
            {(pdfBlob || pdfSaveError) && (
              <div className="px-4 sm:px-5 pt-3">
                {pdfSaveSuccess ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-emerald-800">PDF salvo nos Resultados!</p>
                      <p className="text-[11px] text-emerald-700 mt-0.5">Já aparece na aba <strong>Resultado → Arquivos PDF</strong>.</p>
                    </div>
                  </div>
                ) : pdfBlob ? (
                  <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-violet-800">PDF gerado! Confira em uma nova aba.</p>
                      <p className="text-[11px] text-violet-700 mt-0.5">
                        {onSavePdf ? 'Se ficou bom, salve nos Resultados ou baixe.' : 'Clique em Baixar pra salvar o arquivo.'}
                      </p>
                    </div>
                  </div>
                ) : null}
                {pdfSaveError && (
                  <div className="mt-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-red-700">Erro ao salvar nos Resultados</p>
                      <p className="text-[11px] text-red-600 mt-0.5 break-words">{pdfSaveError}</p>
                    </div>
                    <button onClick={() => setPdfSaveError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="px-4 sm:px-5 py-4 border-t border-gray-100">
              {/* ── Etapa 1: ainda não gerou o PDF ─────────────────────────── */}
              {!pdfBlob && (
                <>
                  <button
                    onClick={handleGeneratePdf}
                    disabled={pdfSelected.size === 0 || pdfGenerating}
                    className="w-full py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {pdfGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {pdfGenerating
                      ? (pdfProgress
                          ? `Gerando PDF... ${Math.round((pdfProgress.done / pdfProgress.total) * 100)}%`
                          : 'Gerando...')
                      : 'Gerar PDF'}
                  </button>
                  {/* Barra de progresso — só aparece durante a geração e quando
                      pdfProgress já foi inicializado. transition-all suaviza o
                      salto de cada item finalizado. */}
                  {pdfGenerating && pdfProgress && (
                    <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all duration-300 ease-out"
                        style={{ width: `${Math.min(100, Math.round((pdfProgress.done / pdfProgress.total) * 100))}%` }}
                      />
                    </div>
                  )}
                </>
              )}

              {/* ── Etapa 2: PDF gerado, mostra ações ──────────────────────── */}
              {pdfBlob && (
                <div className="flex gap-2">
                  <button
                    onClick={handleDownloadPdf}
                    disabled={pdfSaving}
                    className="flex-1 py-2.5 border border-violet-300 text-violet-700 hover:bg-violet-50 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Download className="h-4 w-4" /> Baixar
                  </button>
                  {onSavePdf && !pdfSaveSuccess && (
                    <button
                      onClick={handleSavePdfToResult}
                      disabled={pdfSaving}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {pdfSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {pdfSaving ? 'Salvando...' : 'Salvar em Resultado'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
          {/* Seletor de idioma */}
          <div ref={langMenuRef} className="relative flex-shrink-0">
            <button
              onClick={() => setShowLangMenu(p => !p)}
              title="Idioma da resposta"
              className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-full px-2 py-1 text-xs font-medium transition-colors"
            >
              {SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage)?.label.split(' ')[0] ?? '🌐'}
              <ChevronDown className="h-3 w-3 opacity-70" />
            </button>
            {showLangMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden min-w-[160px]">
                {SUPPORTED_LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => { setSelectedLanguage(lang.code); setShowLangMenu(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-violet-50 transition-colors ${
                      selectedLanguage === lang.code ? 'font-semibold text-violet-700 bg-violet-50' : 'text-gray-700'
                    }`}
                  >
                    <span>{lang.label}</span>
                    {selectedLanguage === lang.code && <span className="ml-auto text-violet-500">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {onSavePdf && imageMsgs.length > 0 && (
            <button onClick={() => { setPdfSelected(new Set(imageMsgs.map(m => m.id))); setPdfBlob(null); setPdfSaveSuccess(false); setPdfSaveError(null); setShowPdfModal(true) }} className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-full px-2 py-1 text-xs font-medium transition-colors flex-shrink-0">
              <FileText className="h-3.5 w-3.5" /><span className="hidden sm:inline">PDF</span>
            </button>
          )}
          {creditsImage !== null && <span className="hidden sm:inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-1 text-xs flex-shrink-0">📸{creditsImage} 💬{creditsText}</span>}
          {messages.length > 1 && (
            <button
              onClick={() => { setSelectMode(p => { if (p) { setSelectedMsgs(new Set()); return false } return true }) }}
              title={selectMode ? 'Cancelar seleção' : 'Selecionar mensagens'}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors flex-shrink-0 ${selectMode ? 'bg-white text-violet-700 font-semibold' : 'bg-white/20 hover:bg-white/30'}`}
            >
              <ListChecks className="h-3.5 w-3.5" />
            </button>
          )}
          {storageKey && messages.length > 1 && !selectMode && (
            <button onClick={() => { if (!confirm('Limpar histórico?')) return; localStorage.removeItem(storageKey); resultMaterialsSent.current = false; setMessages([{ id: uid(), role: 'assistant', text: WELCOME(clientName.split(' ')[0], selectedLanguage), responseParts: [{ type: 'text', text: '' }], timestamp: new Date() }]) }} className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-full px-2 py-1 text-xs transition-colors flex-shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 sm:py-5 space-y-4 sm:space-y-5 bg-gray-50/50">
          {/* Barra de ação do modo seleção */}
          {selectMode && (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 shadow-sm mb-1">
              <span className="text-xs font-semibold text-violet-700">
                {selectedMsgs.size === 0 ? 'Toque nas mensagens para selecionar' : `${selectedMsgs.size} selecionada${selectedMsgs.size > 1 ? 's' : ''}`}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setSelectedMsgs(new Set(messages.map(m => m.id)))}
                  className="text-xs text-violet-600 font-medium hover:text-violet-800"
                >Todas</button>
                <button
                  onClick={() => setSelectedMsgs(new Set())}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >Nenhuma</button>
                <button
                  onClick={() => {
                    if (selectedMsgs.size === 0) return
                    if (!confirm(`Apagar ${selectedMsgs.size} mensagem${selectedMsgs.size > 1 ? 's' : ''}?`)) return
                    handleDeleteSelected()
                  }}
                  disabled={selectedMsgs.size === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="h-3 w-3" />Apagar
                </button>
                <button
                  onClick={() => { setSelectMode(false); setSelectedMsgs(new Set()) }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
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

        {/* CTA prominente de Gerar PDF (modo cliente — quando NÃO recebe
            onSavePdf). No admin do ClientsManager o acesso vem pela pílula
            "PDF" do header, que já tem o fluxo de salvar em Resultados. */}
        {!onSavePdf && imageMsgs.length > 0 && (
          <div className="px-3 sm:px-4 pb-2 flex-shrink-0">
            <button
              onClick={() => { setPdfSelected(new Set(imageMsgs.map(m => m.id))); setPdfBlob(null); setPdfSaveSuccess(false); setPdfSaveError(null); setShowPdfModal(true) }}
              className="w-full py-3 px-4 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 hover:from-violet-600 hover:via-purple-600 hover:to-fuchsia-600 text-white rounded-2xl font-semibold text-sm shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 transition-all flex items-center justify-center gap-2.5 group"
            >
              <span className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center group-hover:bg-white/35 transition-colors">
                <FileText className="h-4 w-4" />
              </span>
              <span>Gerar PDF das simulações</span>
              <span className="bg-white/25 px-2 py-0.5 rounded-full text-xs font-bold">{imageMsgs.length}</span>
            </button>
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

      {/* ── Lightbox ─────────────────────────────────────────────────── */}
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          mimeType={lightbox.mimeType}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
}

// ─── ImageLightbox ─────────────────────────────────────────────────────────
// Foto em tela cheia com zoom por scroll/botões e arraste para mover.

function ImageLightbox({
  src,
  mimeType,
  onClose,
}: {
  src: string
  mimeType?: string
  onClose: () => void
}) {
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

  // Touch: pinch-to-zoom + drag simples
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

  const handleDownload = () => {
    const ext = mimeType?.includes('png') ? 'png' : 'jpg'
    // Se for base64 (data URL), pode baixar diretamente.
    // Se for URL externa (cross-origin storage), usa o helper que faz fetch→blob.
    if (src.startsWith('data:')) {
      const a = document.createElement('a')
      a.href = src
      a.download = `Simulação IA.${ext}`
      a.click()
    } else {
      void downloadImage(src, `Simulação IA.${ext}`)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/92 flex items-center justify-center"
      onClick={onClose}
      ref={containerRef}
    >
      {/* ── Barra superior ────────────────────────────────────────────── */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10"
        onClick={e => e.stopPropagation()}
      >
        <span className="text-white/60 text-xs select-none">✨ Simulação IA</span>
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

      {/* ── Imagem ────────────────────────────────────────────────────── */}
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
        <img
          src={src}
          alt="Simulação IA"
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

      {/* ── Barra inferior de zoom ─────────────────────────────────────── */}
      <div
        className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/50 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 z-10"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))}
          className="text-white/70 hover:text-white transition-colors"
          title="Diminuir zoom"
        >
          <ZoomOut className="h-4 w-4" />
        </button>

        <button
          onClick={resetZoom}
          className="text-white text-xs font-mono min-w-[3rem] text-center hover:text-white/70 transition-colors"
          title="Resetar zoom"
        >
          {Math.round(scale * 100)}%
        </button>

        <button
          onClick={() => setScale(s => Math.min(5, +(s + 0.25).toFixed(2)))}
          className="text-white/70 hover:text-white transition-colors"
          title="Aumentar zoom"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>

      {/* ── Dica (desaparece após 3s via CSS) ───────────────────────── */}
      <p
        className="absolute bottom-14 left-1/2 -translate-x-1/2 text-white/30 text-[11px] whitespace-nowrap pointer-events-none select-none"
        style={{ animation: 'fadeOutHint 0.5s ease 2.5s forwards' }}
      >
        Scroll para zoom · Arraste para mover · Esc para fechar
      </p>

      <style>{`
        @keyframes fadeOutHint { to { opacity: 0 } }
      `}</style>
    </div>
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