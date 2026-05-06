import React, { useState, useEffect, useRef, useMemo, useCallback, useTransition, memo } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
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
const THUMBNAIL_SIZE = 200
const THUMBNAIL_QUALITY = 0.7
const THUMBNAIL_WINDOW = 5
const THUMBNAIL_CONCURRENCY = 2

// ─── GERADOR DE THUMBNAILS ───────────────────────────────────────────────
const generateThumbnail = async (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    let img: HTMLImageElement | null = new Image()
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      URL.revokeObjectURL(url)

      let width = img!.width
      let height = img!.height
      const maxSize = THUMBNAIL_SIZE

      if (width > height) {
        if (width > maxSize) { height = (height * maxSize) / width; width = maxSize }
      } else {
        if (height > maxSize) { width = (width * maxSize) / height; height = maxSize }
      }

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
      img!.src = ''
      img = null

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
  const [isMainImageLoading, setIsMainImageLoading] = useState(false)

  // Drag refs — sem setState durante mousemove
  const positionRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const dragImageRef = useRef<HTMLImageElement>(null)
  const dragContainerRef = useRef<HTMLDivElement>(null)

  // ─── CACHE DE THUMBNAILS ─────────────────────────────────────────────────
  const thumbnailCacheRef = useRef<Map<string, string>>(new Map())
  const [thumbnailsLoading, setThumbnailsLoading] = useState<Set<string>>(new Set())
  const thumbnailGenerationQueue = useRef<Set<string>>(new Set())

  const priorityQueueRef = useRef<string[]>([])
  const activeCountRef = useRef<number>(0)

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

  const blobUrlCacheRef = useRef<Map<string, string>>(new Map())
  const urlsToCleanupRef = useRef<string[]>([])

  const [convertedUrls, setConvertedUrls] = useState<Map<string, string>>(new Map())
  const [convertingIds, setConvertingIds] = useState<Set<string>>(new Set())
  const queueRef = useRef<Set<string>>(new Set())

  const photosRef = useRef(photos)
  useEffect(() => { photosRef.current = photos }, [photos])

  const isModalOpenRef = useRef(false)
  useEffect(() => {
    isModalOpenRef.current = selectedIndex !== null
  }, [selectedIndex])

  // ─── FILA COM CONCORRÊNCIA LIMITADA ──────────────────────────────────────
  const processQueueRef = useRef<() => void>(() => {})
  processQueueRef.current = () => {
    if (isModalOpenRef.current && activeCountRef.current >= THUMBNAIL_CONCURRENCY) return

    while (
      priorityQueueRef.current.length > 0 &&
      activeCountRef.current < THUMBNAIL_CONCURRENCY
    ) {
      const photoId = priorityQueueRef.current.shift()!

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
          pendingCompletedRef.current.push(photoId)
          scheduleFlush()
        })
        .catch(() => {
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
      priorityQueueRef.current.unshift(photoId)
    } else {
      priorityQueueRef.current.push(photoId)
    }

    processQueueRef.current()
  }, [imageErrors]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── INTERSECTIONOBSERVER ─────────────────────────────────────────────────
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
      { rootMargin: '100px' }
    )

    gridItemRefs.current.forEach(el => observerRef.current?.observe(el))

    return () => observerRef.current?.disconnect()
  }, [photos, enqueueThumbnail])

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
    if (convertedUrls.has(photo.id)) return convertedUrls.get(photo.id)!
    if (thumbnailCacheRef.current.has(photo.id)) return thumbnailCacheRef.current.get(photo.id)!
    return ''
  }

  const getPhotoUrl = (photo: Photo): string => {
    if (convertedUrls.has(photo.id)) return convertedUrls.get(photo.id)!
    if (!isHeicPhoto(photo)) return getCachedBlobUrl(photo)
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
    positionRef.current = { x: 0, y: 0 }
    isDraggingRef.current = false
    if (dragImageRef.current) {
      dragImageRef.current.style.transform = 'scale(1) translate(0px, 0px)'
      dragImageRef.current.style.transition = 'transform 0.2s ease-out'
    }
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
    startTransition(() => {
      setSelectedIndex(index)
    })
    document.body.style.overflow = 'hidden'
  }

  const closeFullscreen = () => {
    setSelectedIndex(null)
    document.body.style.overflow = 'auto'
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

  // ─── DRAG COM ZOOM ────────────────────────────────────────────────────────
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

  // ─── ESTILOS INLINE DOS BOTÕES DO MODAL ──────────────────────────────────
  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    flexShrink: 0,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  }

  return (
    <>
      {/* ── Header com estatísticas ── */}
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

      {/* ── Grid de fotos ── */}
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
                <div
                  key={photo.id}
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

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL FULLSCREEN — Layout em flex-column para evitar sobreposição
          de elementos em mobile. NENHUMA barra usa position:absolute.
          Estrutura:
            [TOP BAR]  ← botões Fechar / Baixar / Zoom / Contador
            [IMAGEM ]  ← flex-1, setas ← → absolutas DENTRO deste bloco
            [THUMBS ]  ← strip de miniaturas
          Assim os botões nunca ficam atrás de nada.
         ══════════════════════════════════════════════════════════════════════ */}
      {selectedIndex !== null && !imageErrors.has(photos[selectedIndex].id) && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            // Máximo z-index possível — sobrepõe qualquer nav/sidebar/drawer externo
            zIndex: 2147483647,
            display: 'flex',
            flexDirection: 'column',
            background: '#000',
            // Força camada de composição própria no Safari/WebKit mobile.
            // Sem isso, elementos externos com transform ou isolation podem
            // aparecer na frente mesmo com z-index menor.
            transform: 'translateZ(0)',
            WebkitTransform: 'translateZ(0)',
            isolation: 'isolate',
            // Garante que o modal ocupe a área segura do iOS
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          {/* ── TOP BAR ─────────────────────────────────────────────────── */}
          {/* Não é absolute — é um flex item real. Nunca fica atrás de nada. */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              paddingTop: 'max(env(safe-area-inset-top, 0px), 8px)',
              background: 'rgba(0,0,0,0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              minHeight: 56,
            }}
          >
            {/* Botão Voltar */}
            <button
              onClick={closeFullscreen}
              style={{ ...btnStyle, gap: 4, padding: '8px 12px', paddingRight: 14 }}
            >
              <ChevronLeft style={{ width: 18, height: 18, color: '#fff', flexShrink: 0 }} />
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>
                Voltar
              </span>
            </button>

            {/* Contador + Nome (flex-1 centralizado) */}
            <div style={{ flex: 1, minWidth: 0, textAlign: 'center', overflow: 'hidden' }}>
              <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>
                {selectedIndex + 1} / {photos.length}
              </p>
              <p style={{
                margin: 0, color: 'rgba(255,255,255,0.45)', fontSize: 11,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.3, marginTop: 1,
              }}>
                {photos[selectedIndex].name} · {formatFileSize(photos[selectedIndex].size)}
              </p>
            </div>

            {/* Grupo de ações à direita */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {/* Zoom Out */}
              <button
                onClick={e => { e.stopPropagation(); handleZoomOut() }}
                style={{ ...btnStyle, width: 36, height: 36 }}
                title="Diminuir zoom"
              >
                <ZoomOut style={{ width: 16, height: 16, color: '#fff' }} />
              </button>

              {/* Percentual zoom */}
              <span style={{
                color: '#fff', fontSize: 12, fontWeight: 600,
                minWidth: 36, textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {Math.round(zoom * 100)}%
              </span>

              {/* Zoom In */}
              <button
                onClick={e => { e.stopPropagation(); handleZoomIn() }}
                style={{ ...btnStyle, width: 36, height: 36 }}
                title="Aumentar zoom"
              >
                <ZoomIn style={{ width: 16, height: 16, color: '#fff' }} />
              </button>

              {/* Baixar */}
              <button
                onClick={e => { e.stopPropagation(); handleDownload(photos[selectedIndex]) }}
                style={{ ...btnStyle, width: 36, height: 36, marginLeft: 4 }}
                title="Baixar foto"
              >
                <Download style={{ width: 16, height: 16, color: '#fff' }} />
              </button>

              {/* Fechar */}
              <button
                onClick={e => { e.stopPropagation(); closeFullscreen() }}
                style={{ ...btnStyle, width: 36, height: 36 }}
                title="Fechar (Esc)"
              >
                <X style={{ width: 16, height: 16, color: '#fff' }} />
              </button>
            </div>
          </div>

          {/* ── ÁREA DA IMAGEM ───────────────────────────────────────────── */}
          {/* flex-1 — ocupa TODO o espaço restante entre top e bottom bars   */}
          <div
            ref={dragContainerRef}
            onClick={closeFullscreen}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              flex: 1,
              position: 'relative',
              overflow: 'hidden',
              cursor: zoom > 1 ? 'grab' : 'default',
              minHeight: 0, // necessário para flex-1 funcionar em coluna
            }}
          >
            {/* Seta — Anterior */}
            {photos.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); handlePrevious() }}
                style={{
                  ...btnStyle,
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 10,
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.55)',
                }}
                title="Foto anterior (←)"
              >
                <ChevronLeft style={{ width: 26, height: 26, color: '#fff' }} />
              </button>
            )}

            {/* Imagem / Loader de conversão */}
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 16, boxSizing: 'border-box',
              }}
            >
              {isConverting(photos[selectedIndex]) ? (
                <div style={{ textAlign: 'center', color: '#fff' }}>
                  <Loader2 style={{ width: 56, height: 56, margin: '0 auto 16px' }} className="animate-spin" />
                  <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Convertendo HEIC...</p>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 8 }}>
                    Aguarde, fotos do iPhone precisam ser convertidas para visualização.
                  </p>
                </div>
              ) : (
                <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isMainImageLoading && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      zIndex: 5, pointerEvents: 'none',
                    }}>
                      <Loader2 style={{ width: 44, height: 44, color: 'rgba(255,255,255,0.5)' }} className="animate-spin" />
                    </div>
                  )}
                  <img
                    ref={dragImageRef}
                    src={getPhotoUrl(photos[selectedIndex])}
                    alt={photos[selectedIndex].name}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      userSelect: 'none',
                      transform: `scale(${zoom}) translate(${positionRef.current.x / zoom}px, ${positionRef.current.y / zoom}px)`,
                      opacity: isMainImageLoading ? 0 : 1,
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

            {/* Seta — Próximo */}
            {photos.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); handleNext() }}
                style={{
                  ...btnStyle,
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 10,
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.55)',
                }}
                title="Próxima foto (→)"
              >
                <ChevronRight style={{ width: 26, height: 26, color: '#fff' }} />
              </button>
            )}

            {/* Dica teclado — só desktop */}
            <div style={{
              position: 'absolute',
              bottom: 12, left: '50%', transform: 'translateX(-50%)',
              color: 'rgba(255,255,255,0.4)', fontSize: 11,
              pointerEvents: 'none', whiteSpace: 'nowrap',
              display: 'none', // hidden on mobile via className
            }} className="hidden sm:block">
              ← → navegar · +/− zoom · Esc fechar
            </div>
          </div>

          {/* ── BARRA DE THUMBNAILS ──────────────────────────────────────── */}
          {/* Não é absolute — é um flex item real. Sempre visível abaixo da imagem. */}
          {photos.length > 1 && (
            <div
              onClick={e => e.stopPropagation()}
              style={{
                flexShrink: 0,
                background: 'rgba(0,0,0,0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 10px)',
                padding: '10px 12px',
                paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 10px)',
              }}
            >
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <div style={{
                  display: 'flex',
                  gap: 6,
                  justifyContent: 'center',
                  minWidth: 'max-content',
                  margin: '0 auto',
                }}>
                  {/* Indicador: fotos antes da janela */}
                  {visibleThumbnailIndices[0] > 0 && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setSelectedIndex(visibleThumbnailIndices[0] - 1)
                      }}
                      style={{
                        ...btnStyle,
                        width: 56, height: 56,
                        borderRadius: 8,
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.6)',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <ChevronLeft style={{ width: 14, height: 14 }} />
                      <span>+{visibleThumbnailIndices[0]}</span>
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
                        onClick={e => {
                          e.stopPropagation()
                          if (!hasError && !converting) setSelectedIndex(index)
                        }}
                        style={{
                          flexShrink: 0,
                          width: 56, height: 56,
                          borderRadius: 8,
                          overflow: 'hidden',
                          border: index === selectedIndex
                            ? '2px solid #fff'
                            : '2px solid transparent',
                          opacity: index === selectedIndex ? 1 : 0.55,
                          transform: index === selectedIndex ? 'scale(1.1)' : 'scale(1)',
                          transition: 'all 0.15s ease',
                          background: 'transparent',
                          cursor: hasError || converting ? 'not-allowed' : 'pointer',
                          padding: 0,
                          touchAction: 'manipulation',
                        }}
                        disabled={hasError || converting}
                      >
                        {converting ? (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(88,28,135,0.4)' }}>
                            <Loader2 style={{ width: 18, height: 18, color: '#fff' }} className="animate-spin" />
                          </div>
                        ) : !hasError && thumbnailUrl ? (
                          <img
                            src={thumbnailUrl}
                            alt={photo.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={() => handleImageError(photo.id)}
                          />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(55,65,81,1)' }}>
                            <AlertCircle style={{ width: 20, height: 20, color: '#9ca3af' }} />
                          </div>
                        )}
                      </button>
                    )
                  })}

                  {/* Indicador: fotos depois da janela */}
                  {visibleThumbnailIndices[visibleThumbnailIndices.length - 1] < photos.length - 1 && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setSelectedIndex(visibleThumbnailIndices[visibleThumbnailIndices.length - 1] + 1)
                      }}
                      style={{
                        ...btnStyle,
                        width: 56, height: 56,
                        borderRadius: 8,
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.6)',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <ChevronRight style={{ width: 14, height: 14 }} />
                      <span>+{photos.length - 1 - visibleThumbnailIndices[visibleThumbnailIndices.length - 1]}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
