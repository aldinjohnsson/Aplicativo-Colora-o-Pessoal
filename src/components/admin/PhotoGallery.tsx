import React, { useState, useEffect } from 'react'
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
  AlertCircle
} from 'lucide-react'

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

export function PhotoGallery({ photos, onDownloadAll }: PhotoGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())

  // Resetar zoom e posição quando mudar de foto
  useEffect(() => {
    setZoom(1)
    setPosition({ x: 0, y: 0 })
  }, [selectedIndex])

  // Navegação por teclado
  useEffect(() => {
    if (selectedIndex === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeFullscreen()
      } else if (e.key === 'ArrowLeft') {
        handlePrevious()
      } else if (e.key === 'ArrowRight') {
        handleNext()
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn()
      } else if (e.key === '-') {
        handleZoomOut()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex])

  const openFullscreen = (index: number) => {
    setSelectedIndex(index)
    document.body.style.overflow = 'hidden'
  }

  const closeFullscreen = () => {
    setSelectedIndex(null)
    document.body.style.overflow = 'auto'
  }

  const handlePrevious = () => {
    if (selectedIndex === null) return
    setSelectedIndex((selectedIndex - 1 + photos.length) % photos.length)
  }

  const handleNext = () => {
    if (selectedIndex === null) return
    setSelectedIndex((selectedIndex + 1) % photos.length)
  }

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.5, 5))
  }

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.5, 0.5))
  }

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
      alert('Erro ao baixar foto. Tente novamente.')
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const handleImageError = (photoId: string) => {
    setImageErrors(prev => new Set(prev).add(photoId))
  }

  // Funções de arrastar para mover a imagem quando com zoom
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Criar URL segura para a imagem
  const getPhotoUrl = (photo: Photo): string => {
    try {
      // Se já tem URL, usar ela
      if (photo.url && !photo.url.startsWith('blob:')) {
        return photo.url
      }
      
      // Caso contrário, criar nova URL do blob
      if (photo.blob) {
        return URL.createObjectURL(photo.blob)
      }
      
      return photo.url || ''
    } catch (error) {
      console.error('Erro ao criar URL da foto:', error)
      return ''
    }
  }

  if (photos.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <div className="text-center text-gray-500">
          <Camera className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-sm">Nenhuma foto disponível</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Grid de Thumbnails */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Camera className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Fotos para Análise</h3>
                <p className="text-sm text-gray-600">
                  {photos.length} foto{photos.length !== 1 ? 's' : ''} enviada{photos.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            {onDownloadAll && (
              <button
                onClick={onDownloadAll}
                className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
              >
                <Package className="h-4 w-4 mr-2" />
                Baixar Todas
              </button>
            )}
          </div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {photos.map((photo, index) => {
              const photoUrl = getPhotoUrl(photo)
              const hasError = imageErrors.has(photo.id)
              
              return (
                <div
                  key={photo.id}
                  className="group relative aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-pointer hover:ring-2 hover:ring-purple-500 transition-all"
                  onClick={() => !hasError && openFullscreen(index)}
                >
                  {!hasError ? (
                    <>
                      <img
                        src={photoUrl}
                        alt={photo.name}
                        className="w-full h-full object-cover"
                        onError={() => handleImageError(photo.id)}
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity flex items-center justify-center">
                        <Maximize2 className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-white text-xs truncate font-medium">{photo.name}</p>
                        <p className="text-white/80 text-xs">{formatFileSize(photo.size)}</p>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-gray-200">
                      <AlertCircle className="h-8 w-8 text-gray-400 mb-2" />
                      <p className="text-xs text-gray-600 text-center">Erro ao carregar</p>
                      <p className="text-xs text-gray-500 text-center truncate w-full">{photo.name}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Modal Fullscreen com Carousel */}
      {selectedIndex !== null && !imageErrors.has(photos[selectedIndex].id) && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center"
          onClick={closeFullscreen}
        >
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
                  onClick={(e) => {
                    e.stopPropagation()
                    handleZoomOut()
                  }}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="Diminuir zoom (-)"
                >
                  <ZoomOut className="h-5 w-5 text-white" />
                </button>
                <span className="text-white text-sm font-medium min-w-[4rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleZoomIn()
                  }}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="Aumentar zoom (+)"
                >
                  <ZoomIn className="h-5 w-5 text-white" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownload(photos[selectedIndex])
                  }}
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
              onClick={(e) => {
                e.stopPropagation()
                handlePrevious()
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
              title="Foto anterior (←)"
            >
              <ChevronLeft className="h-8 w-8 text-white" />
            </button>
          )}

          {/* Imagem Principal */}
          <div
            className="relative w-full h-full flex items-center justify-center p-20"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
          >
            <img
              src={getPhotoUrl(photos[selectedIndex])}
              alt={photos[selectedIndex].name}
              className="max-w-full max-h-full object-contain select-none"
              style={{
                transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                transition: isDragging ? 'none' : 'transform 0.2s ease-out'
              }}
              draggable={false}
              onError={() => handleImageError(photos[selectedIndex].id)}
            />
          </div>

          {/* Navegação - Próximo */}
          {photos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleNext()
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
              title="Próxima foto (→)"
            >
              <ChevronRight className="h-8 w-8 text-white" />
            </button>
          )}

          {/* Thumbnails na parte inferior */}
          {photos.length > 1 && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 z-10">
              <div className="max-w-7xl mx-auto overflow-x-auto">
                <div className="flex space-x-2 justify-center">
                  {photos.map((photo, index) => {
                    const photoUrl = getPhotoUrl(photo)
                    const hasError = imageErrors.has(photo.id)
                    
                    return (
                      <button
                        key={photo.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!hasError) setSelectedIndex(index)
                        }}
                        className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden transition-all ${
                          index === selectedIndex
                            ? 'ring-2 ring-white scale-110'
                            : 'opacity-60 hover:opacity-100'
                        }`}
                        disabled={hasError}
                      >
                        {!hasError ? (
                          <img
                            src={photoUrl}
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