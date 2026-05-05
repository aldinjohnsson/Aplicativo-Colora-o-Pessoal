import React, { useState, useEffect, useRef, useMemo, useCallback, useTransition, memo } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  Maximize2,
  Camera,
  Package,
  AlertCircle,
  Loader2
} from 'lucide-react'
import heic2any from 'heic2any'

interface Photo {
  id: string
  name: string
  blob: Blob
  size: number
  url: string
}

interface PhotoGalleryProps {
  photos: Photo[]
  onDownloadAll?: () => void
}

// ─── CONFIGURAÇÃO DE THUMBNAILS ───────────────────────────────────────────
const THUMBNAIL_SIZE = 200     // tamanho da miniatura (200x200px)
const THUMBNAIL_QUALITY = 0.7  // qualidade JPEG das miniaturas (70%)
const THUMBNAIL_WINDOW = 5     // quantas thumbnails carregar no carrossel (±5 = 11 max)
const THUMBNAIL_CONCURRENCY = 2 // máximo de gerações simultâneas

// ─── GERADOR DE THUMBNAILS ───────────────────────────────────────────────
// Reduz a foto original para uma miniatura comprimida usando Canvas.
// FIX: img.src = '' logo após drawImage libera o bitmap decodificado
// (~48MB por foto iPhone 12MP) antes do canvas.toBlob ser executado.
const generateThumbnail = async (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    let img: HTMLImageElement | null = new Image()
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Calcular dimensões mantendo proporção
      let width = img!.width
      let height = img!.height
      const maxSize = THUMBNAIL_SIZE

      if (width > height) {
        if (width > maxSize) { height = (height * maxSize) / width; width = maxSize }
      } else {
        if (height > maxSize) { width = (width * maxSize) / height; height = maxSize }
      }

      // Criar canvas e desenhar imagem redimensionada
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        img!.src = ''; img = null
        reject(new Error('Não foi possível criar contexto do canvas'))
        return
      }

      ctx.drawImage(img!, 0, 0, width, height)

      // ★ FIX CRÍTICO: libera o bitmap completo (~48MB) da memória AGORA,
      // antes do canvas.toBlob (que é assíncrono). Sem isso, todas as
      // imagens decodificadas ficam acumuladas até o GC rodar.
      img!.src = ''
      img = null

      // Converter canvas para blob JPEG comprimido
      canvas.toBlob(
        (thumbnailBlob) => {
          if (!thumbnailBlob) { reject(new Error('Falha ao criar thumbnail')); return }
          resolve(URL.createObjectURL(thumbnailBlob))
        },
        'image/jpeg',
        THUMBNAIL_QUALITY
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      img!.src = ''; img = null
      reject(new Error('Falha ao carregar imagem'))
    }

    img.src = url
  })
}

// Detecta se a foto é HEIC/HEIF (formato padrão do iPhone)
const isHeicPhoto = (photo: Photo): boolean => {
  const name = photo.name.toLowerCase()
  return (
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    photo.blob?.type === 'image/heic' ||
    photo.blob?.type === 'image/heif'
  )
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── GRID ITEM MEMOIZADO ──────────────────────────────────────────────────────
// ★ FIX CRÍTICO: sem memo, TODOS os N itens re-renderizam a cada thumbnail que
// carrega, pois thumbnailsLoading é estado compartilhado. Com memo + comparador
// customizado, apenas o item cujo dado mudou re-renderiza.
interface PhotoGridItemProps {
  photo: Photo
  index: number
  thumbnailUrl: string
  isLoading: boolean
  hasError: boolean
  converting: boolean
  onOpen: (index: number) => void
  onError: (id: string) => void
}

const PhotoGridItem = memo(({
  photo, index, thumbnailUrl, isLoading, hasError, converting, onOpen, onError
}: PhotoGridItemProps) => (
  <div
    data-photo-id={photo.id}
    onClick={() => { if (!hasError && !converting) onOpen(index) }}
    className={`aspect-square rounded-lg overflow-hidden shadow-md transition-all ${
      hasError || converting
        ? 'cursor-not-allowed opacity-50'
        : 'cursor-pointer hover:shadow-xl hover:scale-105'
    }`}
  >
    {hasError ? (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-red-50">
        <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
        <p className="text-xs text-red-600 text-center">Erro ao carregar</p>
      </div>
    ) : converting ? (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-purple-50">
        <Loader2 className="h-8 w-8 text-purple-500 mb-2 animate-spin" />
        <p className="text-xs text-purple-600 text-center">Convertendo...</p>
      </div>
    ) : isLoading ? (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-gray-50">
        <Loader2 className="h-8 w-8 text-gray-400 mb-2 animate-spin" />
        <p className="text-xs text-gray-500 text-center">Carregando...</p>
      </div>
    ) : thumbnailUrl ? (
      <img
        src={thumbnailUrl}
        alt={photo.name}
        className="w-full h-full object-cover"
        onError={() => onError(photo.id)}
        loading="lazy"
      />
    ) : (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-purple-50">
        <Camera className="h-8 w-8 text-purple-300 mb-2" />
        <p className="text-xs text-purple-500 text-center font-medium">HEIC</p>
        <p className="text-xs text-gray-500 text-center truncate w-full mt-1">{photo.name}</p>
      </div>
    )}
  </div>
), (prev, next) =>
  prev.thumbnailUrl === next.thumbnailUrl &&
  prev.isLoading === next.isLoading &&
  prev.hasError === next.hasError &&
  prev.converting === next.converting
)

export function PhotoGallery({ photos, onDownloadAll }: PhotoGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [, startTransition] = useTransition()
  const [zoom, setZoom] = useState(1)
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())
  // ★ FIX PERFORMANCE: controla spinner enquanto foto full-size decodifica (async)
  const [isMainImageLoading, setIsMainImageLoading] = useState(false)

  // ★ FIX DRAG PERFORMANCE: drag fora do ciclo React — sem setPosition a cada mousemove.
  // Refs não causam re-render; o transform é aplicado direto no DOM.
  const positionRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const dragImageRef = useRef<HTMLImageElement>(null)
  const dragContainerRef = useRef<HTMLDivElement>(null)

  // ─── CACHE DE THUMBNAILS ─────────────────────────────────────────────────
  // Armazena as miniaturas comprimidas (200x200px ~10KB cada)
  const thumbnailCacheRef = useRef<Map<string, string>>(new Map())
  const [thumbnailsLoading, setThumbnailsLoading] = useState<Set<string>>(new Set())
  const thumbnailGenerationQueue = useRef<Set<string>>(new Set())

  // ★ FIX: fila priorizada (visíveis na frente) + semáforo de concorrência
  const priorityQueueRef = useRef<string[]>([])     // IDs a processar (frente = maior prioridade)
  const activeCountRef = useRef<number>(0)           // gerações em andamento

  // ★ FIX BATCH: acumula completions e faz UM único setState por frame de animação.
  // Antes: cada thumbnail que terminava chamava setThumbnailsLoading() individualmente
  // → N thumbnails prontos = N re-renders seguidos, causando jank visível.
  // Agora: todas as completions dentro do mesmo frame são agrupadas em 1 setState.
  const pendingCompletedRef = useRef<string[]>([])
  const pendingErrorsRef = useRef<string[]>([])
  const flushRafRef = useRef<number | null>(null)

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current !== null) return
    flushRafRef.current = requestAnimationFrame(() => {
      flushRafRef.current = null
      const completed = pendingCompletedRef.current.splice(0)
      const errors = pendingErrorsRef.current.splice(0)
      if (completed.length > 0 || errors.length > 0) {
        if (completed.length > 0) {
          setThumbnailsLoading(prev => {
            const n = new Set(prev)
            completed.forEach(id => n.delete(id))
            return n
          })
        }
        if (errors.length > 0) {
          setImageErrors(prev => {
            const n = new Set(prev)
            errors.forEach(id => n.add(id))
            return n
          })
          setThumbnailsLoading(prev => {
            const n = new Set(prev)
            errors.forEach(id => n.delete(id))
            return n
          })
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cache de URLs originais (apenas criadas quando necessário)
  const blobUrlCacheRef = useRef<Map<string, string>>(new Map())
  const urlsToCleanupRef = useRef<string[]>([])

  // Conversão de HEIC -> JPEG
  const [convertedUrls, setConvertedUrls] = useState<Map<string, string>>(new Map())
  const [convertingIds, setConvertingIds] = useState<Set<string>>(new Set())
  const queueRef = useRef<Set<string>>(new Set())

  // Ref para acessar `photos` dentro de callbacks sem capturar closure stale
  const photosRef = useRef(photos)
  useEffect(() => { photosRef.current = photos }, [photos])

  // ─── FILA COM CONCORRÊNCIA LIMITADA ──────────────────────────────────────
  // Processa até THUMBNAIL_CONCURRENCY gerações simultâneas.
  // Quando uma termina, puxa a próxima da fila automaticamente.
  const processQueueRef = useRef<() => void>(() => {})
  processQueueRef.current = () => {
    // ★ FIX PERFORMANCE: Pausa novas gerações enquanto modal está aberto e ocupado.
    // Evita que processamento em background concorra com decodificação da foto principal.
    if (isModalOpenRef.current && activeCountRef.current >= THUMBNAIL_CONCURRENCY) return

    while (
      priorityQueueRef.current.length > 0 &&
      activeCountRef.current < THUMBNAIL_CONCURRENCY
    ) {
      const photoId = priorityQueueRef.current.shift()!

      // Já foi gerado ou é HEIC (tratado separadamente)
      if (thumbnailCacheRef.current.has(photoId)) continue

      const photo = photosRef.current.find(p => p.id === photoId)
      if (!photo || isHeicPhoto(photo)) {
        thumbnailGenerationQueue.current.delete(photoId)
        continue
      }

      activeCountRef.current++

      generateThumbnail(photo.blob)
        .then(url => {
          thumbnailCacheRef.current.set(photoId, url)
          urlsToCleanupRef.current.push(url)
          // ★ FIX BATCH: acumula no buffer em vez de disparar setState agora
          pendingCompletedRef.current.push(photoId)
          scheduleFlush()
        })
        .catch(() => {
          // ★ FIX BATCH: acumula erros no buffer
          pendingErrorsRef.current.push(photoId)
          scheduleFlush()
        })
        .finally(() => {
          activeCountRef.current--
          thumbnailGenerationQueue.current.delete(photoId)
          processQueueRef.current()
        })
    }
  }

  // ─── ENFILEIRAR THUMBNAIL (visíveis têm prioridade) ──────────────────────
  const enqueueThumbnail = useCallback((photoId: string, priority: 'high' | 'low' = 'low') => {
    if (
      thumbnailCacheRef.current.has(photoId) ||
      thumbnailGenerationQueue.current.has(photoId)
    ) return

    const photo = photosRef.current.find(p => p.id === photoId)
    if (!photo || isHeicPhoto(photo) || imageErrors.has(photoId)) return

    thumbnailGenerationQueue.current.add(photoId)
    setThumbnailsLoading(prev => new Set(prev).add(photoId))

    if (priority === 'high') {
      // Visível: vai para a frente da fila
      priorityQueueRef.current.unshift(photoId)
    } else {
      // Fora da tela: vai para o fim
      priorityQueueRef.current.push(photoId)
    }

    processQueueRef.current()
  }, [imageErrors]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── INTERSECTIONOBSERVER: dispara apenas fotos visíveis na tela ─────────
  // ★ FIX: ao invés de gerar todas as 30 thumbnails no mount,
  //   observamos cada célula do grid e geramos só quando ela entra na viewport.
  const gridItemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const photoId = (entry.target as HTMLElement).dataset.photoId
            if (photoId) enqueueThumbnail(photoId, 'high')
          }
        })
      },
      { rootMargin: '100px' } // pré-carrega 100px antes de aparecer
    )

    // Registra todos os itens do grid no observer
    gridItemRefs.current.forEach(el => observerRef.current?.observe(el))

    return () => observerRef.current?.disconnect()
  }, [photos, enqueueThumbnail])

  // ★ FIX PERFORMANCE: Removido o pre-enqueue em massa ('low') de TODAS as fotos.
  // Antes, 30+ thumbnails eram enfileiradas de uma vez no mount, gerando em background
  // e competindo com a decodificação da foto principal no modal.
  // Agora apenas o IntersectionObserver (grid visível) e o modal (carrossel) disparam geração.

  // Ref para saber se o modal está aberto (sem causar re-render na fila)
  const isModalOpenRef = useRef(false)
  useEffect(() => {
    isModalOpenRef.current = selectedIndex !== null
  }, [selectedIndex])
  const getCachedBlobUrl = useCallback((photo: Photo): string => {
    if (blobUrlCacheRef.current.has(photo.id)) {
      return blobUrlCacheRef.current.get(photo.id)!
    }
    try {
      const url = URL.createObjectURL(photo.blob)
      blobUrlCacheRef.current.set(photo.id, url)
      urlsToCleanupRef.current.push(url)
      return url
    } catch {
      return ''
    }
  }, [])

  const getThumbnailUrl = (photo: Photo): string => {
    // Para fotos HEIC convertidas, usar a URL convertida
    if (convertedUrls.has(photo.id)) {
      return convertedUrls.get(photo.id)!
    }
    // Usar thumbnail se disponível
    if (thumbnailCacheRef.current.has(photo.id)) {
      return thumbnailCacheRef.current.get(photo.id)!
    }
    return ''
  }

  const getPhotoUrl = (photo: Photo): string => {
    // Para modal: usar foto em resolução completa
    if (convertedUrls.has(photo.id)) {
      return convertedUrls.get(photo.id)!
    }
    if (!isHeicPhoto(photo)) {
      return getCachedBlobUrl(photo)
    }
    return ''
  }

  const isConverting = (photo: Photo): boolean => {
    return isHeicPhoto(photo) && convertingIds.has(photo.id)
  }

  const handleImageError = (photoId: string) => {
    setImageErrors(prev => new Set(prev).add(photoId))
  }

  // Liberar URLs ao desmontar
  useEffect(() => {
    return () => {
      urlsToCleanupRef.current.forEach(url => {
        try { URL.revokeObjectURL(url) } catch { /* ignora */ }
      })
      urlsToCleanupRef.current = []
      blobUrlCacheRef.current.clear()
      thumbnailCacheRef.current.clear()
    }
  }, [])

  // Resetar zoom e posição ao mudar foto
  useEffect(() => {
    setZoom(1)
    // ★ FIX DRAG: reset via ref, sem re-render
    positionRef.current = { x: 0, y: 0 }
    isDraggingRef.current = false
    if (dragImageRef.current) {
      dragImageRef.current.style.transform = 'scale(1) translate(0px, 0px)'
      dragImageRef.current.style.transition = 'transform 0.2s ease-out'
    }
    // ★ FIX PERFORMANCE: ativa spinner enquanto a nova foto full-size carrega/decodifica
    if (selectedIndex !== null) setIsMainImageLoading(true)
  }, [selectedIndex])

  // ─── CONVERSÃO HEIC SOB DEMANDA ───────────────────────────────────────────
  const heicToConvert = useMemo(() => {
    if (selectedIndex === null) return []
    const start = Math.max(0, selectedIndex - 2)
    const end = Math.min(photos.length - 1, selectedIndex + 2)
    return photos.slice(start, end + 1).filter(isHeicPhoto)
  }, [selectedIndex, photos])

  useEffect(() => {
    if (heicToConvert.length === 0) return
    let cancelled = false

    const convertQueue = async () => {
      for (const photo of heicToConvert) {
        if (cancelled) return
        if (convertedUrls.has(photo.id)) continue
        if (queueRef.current.has(photo.id)) continue
        if (imageErrors.has(photo.id)) continue

        queueRef.current.add(photo.id)
        setConvertingIds(prev => new Set(prev).add(photo.id))

        try {
          const result = await heic2any({
            blob: photo.blob,
            toType: 'image/jpeg',
            quality: 0.85
          })
          if (cancelled) return

          const convertedBlob = Array.isArray(result) ? result[0] : result
          const url = URL.createObjectURL(convertedBlob)
          urlsToCleanupRef.current.push(url)

          setConvertedUrls(prev => {
            const next = new Map(prev)
            next.set(photo.id, url)
            return next
          })
        } catch (error) {
          console.error('Erro ao converter HEIC:', photo.name, error)
          if (!cancelled) {
            setImageErrors(prev => new Set(prev).add(photo.id))
          }
        } finally {
          queueRef.current.delete(photo.id)
          if (!cancelled) {
            setConvertingIds(prev => {
              const next = new Set(prev)
              next.delete(photo.id)
              return next
            })
          }
        }
      }
    }

    convertQueue()
    return () => { cancelled = true }
  }, [heicToConvert]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── NAVEGAÇÃO POR TECLADO ────────────────────────────────────────────────
  useEffect(() => {
    if (selectedIndex === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFullscreen()
      else if (e.key === 'ArrowLeft') handlePrevious()
      else if (e.key === 'ArrowRight') handleNext()
      else if (e.key === '+' || e.key === '=') handleZoomIn()
      else if (e.key === '-') handleZoomOut()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const openFullscreen = (index: number) => {
    // ★ FIX PERFORMANCE: startTransition marca a abertura do modal como atualização
    // de baixa prioridade — o browser pode finalizar eventos de input/paint pendentes
    // antes de commitar o re-render pesado do modal.
    startTransition(() => {
      setSelectedIndex(index)
    })
    document.body.style.overflow = 'hidden'
  }

  // Retomar fila de thumbnails ao fechar o modal
  const closeFullscreen = () => {
    setSelectedIndex(null)
    document.body.style.overflow = 'auto'
    // Retoma o processamento que foi pausado durante o modal
    setTimeout(() => processQueueRef.current(), 300)
  }

  const handlePrevious = () => {
    if (selectedIndex === null) return
    setSelectedIndex((selectedIndex - 1 + photos.length) % photos.length)
  }

  const handleNext = () => {
    if (selectedIndex === null) return
    setSelectedIndex((selectedIndex + 1) % photos.length)
  }

  // ★ FIX DRAG: aplica transform direto no DOM — zero re-renders durante drag
  const applyDragTransform = (z: number) => {
    if (!dragImageRef.current) return
    const { x, y } = positionRef.current
    dragImageRef.current.style.transform = `scale(${z}) translate(${x / z}px, ${y / z}px)`
  }

  const handleZoomIn = () => setZoom(prev => {
    const next = Math.min(prev + 0.5, 5)
    requestAnimationFrame(() => applyDragTransform(next))
    return next
  })
  const handleZoomOut = () => setZoom(prev => {
    const next = Math.max(prev - 0.5, 0.5)
    requestAnimationFrame(() => applyDragTransform(next))
    return next
  })

  const handleDownload = (photo: Photo) => {
    try {
      const url = URL.createObjectURL(photo.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = photo.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao baixar foto:', error)
      alert('Erro ao baixar a foto. Tente novamente.')
    }
  }

  // ─── CONTROLES DE ARRASTAR IMAGEM COM ZOOM ────────────────────────────────
  // ★ FIX DRAG PERFORMANCE: nenhum setState aqui — cada mousemove antes causava
  // re-render completo do componente (grid inteiro + modal). Agora:
  // 1. isDragging / position / dragStart → refs (sem re-render)
  // 2. transform aplicado diretamente no <img> via dragImageRef
  // 3. cursor atualizado diretamente no container via dragContainerRef
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    isDraggingRef.current = true
    dragStartRef.current = {
      x: e.clientX - positionRef.current.x,
      y: e.clientY - positionRef.current.y,
    }
    if (dragContainerRef.current) dragContainerRef.current.style.cursor = 'grabbing'
    if (dragImageRef.current) dragImageRef.current.style.transition = 'none'
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || zoom <= 1) return
    positionRef.current = {
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    }
    applyDragTransform(zoom)
  }

  const handleMouseUp = () => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (dragContainerRef.current) dragContainerRef.current.style.cursor = zoom > 1 ? 'grab' : 'default'
    if (dragImageRef.current) dragImageRef.current.style.transition = 'transform 0.2s ease-out'
  }

  // ─── THUMBNAILS VISÍVEIS NO CARROSSEL ─────────────────────────────────────
  const visibleThumbnailIndices = useMemo(() => {
    if (selectedIndex === null) return []
    const start = Math.max(0, selectedIndex - THUMBNAIL_WINDOW)
    const end = Math.min(photos.length - 1, selectedIndex + THUMBNAIL_WINDOW)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }, [selectedIndex, photos.length])

  // ★ FIX PERFORMANCE: defer + batching.
  // Antes: enqueueThumbnail chamado 11x em loop → 11x setThumbnailsLoading → 11 re-renders
  //   concorrendo com a decodificação da imagem principal.
  // Agora: aguarda 80ms (modal já renderizou), coleta todos os IDs de uma vez e
  //   faz UM único setThumbnailsLoading com todos os IDs.
  useEffect(() => {
    if (selectedIndex === null) return
    const timer = setTimeout(() => {
      const toLoad: string[] = []
      visibleThumbnailIndices.forEach(idx => {
        const photo = photos[idx]
        if (
          !thumbnailCacheRef.current.has(photo.id) &&
          !thumbnailGenerationQueue.current.has(photo.id) &&
          !isHeicPhoto(photo) &&
          !imageErrors.has(photo.id)
        ) {
          toLoad.push(photo.id)
          thumbnailGenerationQueue.current.add(photo.id)
          priorityQueueRef.current.unshift(photo.id)
        }
      })
      if (toLoad.length > 0) {
        // ★ UM único update de estado para todos os thumbnails visíveis
        setThumbnailsLoading(prev => {
          const n = new Set(prev)
          toLoad.forEach(id => n.add(id))
          return n
        })
        processQueueRef.current()
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [selectedIndex, visibleThumbnailIndices]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── ESTATÍSTICAS ─────────────────────────────────────────────────────────
  const totalSize = useMemo(() => photos.reduce((sum, p) => sum + p.size, 0), [photos])
  const heicCount = useMemo(() => photos.filter(isHeicPhoto).length, [photos])

  return (
    <>
      {/* Header com estatísticas */}
      <div className="sticky top-0 z-10 bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Galeria de Fotos</h2>
              <p className="text-sm text-gray-600 mt-1">
                {photos.length} {photos.length === 1 ? 'foto' : 'fotos'} · {formatFileSize(totalSize)}
                {heicCount > 0 && ` · ${heicCount} HEIC`}
              </p>
            </div>
            {onDownloadAll && photos.length > 0 && (
              <button
                onClick={onDownloadAll}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Package className="h-5 w-5" />
                <span>Baixar Todas</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid de fotos */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {photos.length === 0 ? (
          <div className="text-center py-16">
            <Camera className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">Nenhuma foto disponível</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {photos.map((photo, index) => {
              const thumbnailUrl = getThumbnailUrl(photo)
              const isLoading = thumbnailsLoading.has(photo.id)
              const hasError = imageErrors.has(photo.id)
              const converting = isConverting(photo)

              return (
                // Wrapper div mantém o ref do IntersectionObserver separado do item memoizado
                <div
                  key={photo.id}
                  // ★ FIX: observe() era chamado em TODA re-render (thumbnail carregando,
                  // estado mudando, etc.) → IntersectionObserver recebia 30+ registros
                  // duplicados por re-render. Agora só registra quando o elemento é novo.
                  ref={el => {
                    if (el) {
                      if (!gridItemRefs.current.has(photo.id)) {
                        gridItemRefs.current.set(photo.id, el)
                        observerRef.current?.observe(el)
                      }
                    } else {
                      const prev = gridItemRefs.current.get(photo.id)
                      if (prev) observerRef.current?.unobserve(prev)
                      gridItemRefs.current.delete(photo.id)
                    }
                  }}
                  data-photo-id={photo.id}
                >
                  <PhotoGridItem
                    photo={photo}
                    index={index}
                    thumbnailUrl={thumbnailUrl}
                    isLoading={isLoading}
                    hasError={hasError}
                    converting={converting}
                    onOpen={openFullscreen}
                    onError={handleImageError}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Fullscreen com Carousel */}
      {selectedIndex !== null && !imageErrors.has(photos[selectedIndex].id) && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center"
          onClick={closeFullscreen}
          onTouchEnd={(e) => { if (e.target === e.currentTarget) closeFullscreen() }}
        >
          {/* Botão fechar — mobile, fixo no topo esquerdo, grande e fácil de tocar */}
          <button
            onClick={closeFullscreen}
            className="sm:hidden absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/60 active:bg-black/80"
            style={{ touchAction: 'manipulation' }}
          >
            <ChevronLeft className="h-5 w-5 text-white" />
            <span className="text-white text-sm font-medium">Voltar</span>
          </button>
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-4 z-10">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <div className="text-white">
                <p className="text-sm font-medium">{photos[selectedIndex].name}</p>
                <p className="text-xs text-white/70">
                  {selectedIndex + 1} de {photos.length} · {formatFileSize(photos[selectedIndex].size)}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleZoomOut() }}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="Diminuir zoom (-)"
                >
                  <ZoomOut className="h-5 w-5 text-white" />
                </button>
                <span className="text-white text-sm font-medium min-w-[4rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleZoomIn() }}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="Aumentar zoom (+)"
                >
                  <ZoomIn className="h-5 w-5 text-white" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownload(photos[selectedIndex]) }}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="Baixar foto"
                >
                  <Download className="h-5 w-5 text-white" />
                </button>
                <button
                  onClick={closeFullscreen}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="Fechar (Esc)"
                >
                  <X className="h-5 w-5 text-white" />
                </button>
              </div>
            </div>
          </div>

          {/* Navegação - Anterior */}
          {photos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); handlePrevious() }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
              title="Foto anterior (←)"
            >
              <ChevronLeft className="h-8 w-8 text-white" />
            </button>
          )}

          {/* Imagem Principal */}
          <div
            className="relative w-full h-full flex items-center justify-center p-16 sm:p-20"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: zoom > 1 ? (isDraggingRef.current ? 'grabbing' : 'grab') : 'default' }}
          >
            {isConverting(photos[selectedIndex]) ? (
              <div className="text-white text-center">
                <Loader2 className="h-16 w-16 mx-auto mb-4 animate-spin" />
                <p className="text-lg font-medium">Convertendo HEIC...</p>
                <p className="text-sm text-white/70 mt-2">
                  Aguarde, fotos do iPhone precisam ser convertidas para visualização.
                </p>
              </div>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center">
                {/* ★ FIX PERFORMANCE: spinner visível enquanto foto full-size decodifica com decoding="async" */}
                {isMainImageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                    <Loader2 className="h-12 w-12 text-white/60 animate-spin" />
                  </div>
                )}
                <img
                  src={getPhotoUrl(photos[selectedIndex])}
                  alt={photos[selectedIndex].name}
                  className="max-w-full max-h-full object-contain select-none"
                  style={{
                    transform: `scale(${zoom}) translate(${positionRef.current.x / zoom}px, ${positionRef.current.y / zoom}px)`,
                    opacity: isMainImageLoading ? 0 : 1,
                    // ★ FIX: havia duas chaves 'transition' duplicadas (JS object sobrescreve a primeira).
                    // Também removido 'isDragging' que era undefined — o cursor já é gerenciado via dragContainerRef.
                    transition: isMainImageLoading ? 'none' : 'opacity 0.2s ease-in, transform 0.2s ease-out',
                  }}
                  draggable={false}
                  decoding="async"
                  onLoad={() => setIsMainImageLoading(false)}
                  onError={() => { handleImageError(photos[selectedIndex].id); setIsMainImageLoading(false) }}
                />
              </div>
            )}
          </div>

          {/* Navegação - Próximo */}
          {photos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleNext() }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
              title="Próxima foto (→)"
            >
              <ChevronRight className="h-8 w-8 text-white" />
            </button>
          )}

          {/* Thumbnails na parte inferior — virtualizado */}
          {photos.length > 1 && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 z-10">
              <div className="max-w-7xl mx-auto overflow-x-auto">
                <div className="flex space-x-2 justify-center">
                  {/* Indicador numérico para fotos antes da janela */}
                  {visibleThumbnailIndices[0] > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedIndex(visibleThumbnailIndices[0] - 1)
                      }}
                      className="flex-shrink-0 w-16 h-16 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 text-xs"
                    >
                      +{visibleThumbnailIndices[0]}
                    </button>
                  )}

                  {visibleThumbnailIndices.map((index) => {
                    const photo = photos[index]
                    const thumbnailUrl = getThumbnailUrl(photo)
                    const hasError = imageErrors.has(photo.id)
                    const converting = isConverting(photo)

                    return (
                      <button
                        key={photo.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!hasError && !converting) setSelectedIndex(index)
                        }}
                        className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden transition-all ${
                          index === selectedIndex
                            ? 'ring-2 ring-white scale-110'
                            : 'opacity-60 hover:opacity-100'
                        }`}
                        disabled={hasError || converting}
                      >
                        {converting ? (
                          <div className="w-full h-full flex items-center justify-center bg-purple-900/40">
                            <Loader2 className="h-5 w-5 text-white animate-spin" />
                          </div>
                        ) : !hasError && thumbnailUrl ? (
                          <img
                            src={thumbnailUrl}
                            alt={photo.name}
                            className="w-full h-full object-cover"
                            onError={() => handleImageError(photo.id)}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-700">
                            <AlertCircle className="h-6 w-6 text-gray-400" />
                          </div>
                        )}
                      </button>
                    )
                  })}

                  {/* Indicador numérico para fotos depois da janela */}
                  {visibleThumbnailIndices[visibleThumbnailIndices.length - 1] < photos.length - 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedIndex(visibleThumbnailIndices[visibleThumbnailIndices.length - 1] + 1)
                      }}
                      className="flex-shrink-0 w-16 h-16 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 text-xs"
                    >
                      +{photos.length - 1 - visibleThumbnailIndices[visibleThumbnailIndices.length - 1]}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Instruções */}
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-white/60 text-xs text-center z-10 pointer-events-none">
            <p>Use as setas ← → para navegar · +/- para zoom · Esc para fechar</p>
          </div>
        </div>
      )}
    </>
  )
}