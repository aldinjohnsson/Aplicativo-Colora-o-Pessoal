import React, { useState, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, Maximize2, Camera, Package, AlertCircle } from 'lucide-react'

interface Photo { id: string; name: string; blob: Blob; size: number; url: string }
interface PhotoGalleryProps { photos: Photo[]; onDownloadAll?: () => void }

export function PhotoGallery({ photos, onDownloadAll }: PhotoGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())

  useEffect(() => { setZoom(1); setPosition({ x: 0, y: 0 }) }, [selectedIndex])

  useEffect(() => {
    if (selectedIndex === null) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.5, 5))
      else if (e.key === '-') setZoom(z => Math.max(z - 0.5, 0.5))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selectedIndex])

  const open = (index: number) => { setSelectedIndex(index); document.body.style.overflow = 'hidden' }
  const close = () => { setSelectedIndex(null); document.body.style.overflow = 'auto' }
  const prev = () => { if (selectedIndex === null) return; setSelectedIndex((selectedIndex - 1 + photos.length) % photos.length) }
  const next = () => { if (selectedIndex === null) return; setSelectedIndex((selectedIndex + 1) % photos.length) }

  const handleDownload = (photo: Photo) => {
    try {
      const url = URL.createObjectURL(photo.blob); const a = document.createElement('a')
      a.href = url; a.download = photo.name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    } catch { alert('Erro ao baixar foto.') }
  }

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'; const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k)); return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const handleImageError = (id: string) => setImageErrors(prev => new Set(prev).add(id))

  const handleMouseDown = (e: React.MouseEvent) => { if (zoom <= 1) return; setIsDragging(true); setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y }) }
  const handleMouseMove = (e: React.MouseEvent) => { if (!isDragging || zoom <= 1) return; setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }) }
  const handleMouseUp = () => setIsDragging(false)

  const getPhotoUrl = (photo: Photo): string => {
    try {
      if (photo.url && !photo.url.startsWith('blob:')) return photo.url
      if (photo.blob) return URL.createObjectURL(photo.blob)
      return photo.url || ''
    } catch { return '' }
  }

  if (photos.length === 0) return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8">
      <div className="text-center text-gray-500">
        <Camera className="h-10 w-10 sm:h-12 sm:w-12 text-gray-400 mx-auto mb-3" />
        <p className="text-sm">Nenhuma foto disponível</p>
      </div>
    </div>
  )

  return (
    <>
      {/* Grid */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Camera className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm sm:text-lg font-semibold text-gray-900">Fotos para Análise</h3>
                <p className="text-xs sm:text-sm text-gray-600">{photos.length} foto{photos.length !== 1 ? 's' : ''} enviada{photos.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            {onDownloadAll && (
              <button onClick={onDownloadAll} className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-xs sm:text-sm font-medium">
                <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Baixar Todas</span>
                <span className="sm:hidden">Baixar</span>
              </button>
            )}
          </div>
        </div>

        <div className="p-3 sm:p-6">
          {/* Responsive grid: 3 cols on mobile, more on larger screens */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-4">
            {photos.map((photo, index) => {
              const photoUrl = getPhotoUrl(photo)
              const hasError = imageErrors.has(photo.id)
              return (
                <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-pointer hover:ring-2 hover:ring-purple-500 transition-all active:scale-95" onClick={() => !hasError && open(index)}>
                  {!hasError ? (
                    <>
                      <img src={photoUrl} alt={photo.name} className="w-full h-full object-cover" onError={() => handleImageError(photo.id)} loading="lazy" />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity flex items-center justify-center">
                        <Maximize2 className="h-6 w-6 sm:h-8 sm:w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 sm:p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-white text-[10px] sm:text-xs truncate font-medium">{photo.name}</p>
                        <p className="text-white/80 text-[9px] sm:text-xs">{formatSize(photo.size)}</p>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-2 sm:p-4 bg-gray-200">
                      <AlertCircle className="h-6 w-6 sm:h-8 sm:w-8 text-gray-400 mb-1 sm:mb-2" />
                      <p className="text-[10px] sm:text-xs text-gray-600 text-center">Erro ao carregar</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Fullscreen modal */}
      {selectedIndex !== null && !imageErrors.has(photos[selectedIndex].id) && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center" onClick={close} style={{ touchAction: 'none' }}>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-3 sm:p-4 z-10" style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-white min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium truncate">{photos[selectedIndex].name}</p>
                <p className="text-[10px] sm:text-xs text-white/70">{selectedIndex + 1} de {photos.length} · {formatSize(photos[selectedIndex].size)}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Zoom controls — hidden on very small screens */}
                <div className="hidden sm:flex items-center gap-1">
                  <button onClick={e => { e.stopPropagation(); setZoom(z => Math.max(z - 0.5, 0.5)) }} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"><ZoomOut className="h-4 w-4 text-white" /></button>
                  <span className="text-white text-xs min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
                  <button onClick={e => { e.stopPropagation(); setZoom(z => Math.min(z + 0.5, 5)) }} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"><ZoomIn className="h-4 w-4 text-white" /></button>
                </div>
                <button onClick={e => { e.stopPropagation(); handleDownload(photos[selectedIndex]) }} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"><Download className="h-4 w-4 sm:h-5 sm:w-5 text-white" /></button>
                <button onClick={close} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"><X className="h-4 w-4 sm:h-5 sm:w-5 text-white" /></button>
              </div>
            </div>
          </div>

          {/* Prev button */}
          {photos.length > 1 && (
            <button onClick={e => { e.stopPropagation(); prev() }} className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 p-2 sm:p-3 bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10">
              <ChevronLeft className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
            </button>
          )}

          {/* Image */}
          <div
            className="relative w-full h-full flex items-center justify-center p-12 sm:p-20"
            onClick={e => e.stopPropagation()}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
          >
            <img
              src={getPhotoUrl(photos[selectedIndex])}
              alt={photos[selectedIndex].name}
              className="max-w-full max-h-full object-contain select-none"
              style={{ transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`, transition: isDragging ? 'none' : 'transform 0.2s ease-out' }}
              draggable={false}
              onError={() => handleImageError(photos[selectedIndex].id)}
            />
          </div>

          {/* Next button */}
          {photos.length > 1 && (
            <button onClick={e => { e.stopPropagation(); next() }} className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 p-2 sm:p-3 bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10">
              <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
            </button>
          )}

          {/* Thumbnail strip */}
          {photos.length > 1 && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent z-10" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))' }}>
              <div className="overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                <div className="flex gap-1.5 sm:gap-2 justify-center px-3 py-3">
                  {photos.map((photo, index) => {
                    const hasError = imageErrors.has(photo.id)
                    return (
                      <button
                        key={photo.id}
                        onClick={e => { e.stopPropagation(); if (!hasError) setSelectedIndex(index) }}
                        className={`flex-shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-lg overflow-hidden transition-all ${index === selectedIndex ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
                        disabled={hasError}
                      >
                        {!hasError ? (
                          <img src={getPhotoUrl(photo)} alt={photo.name} className="w-full h-full object-cover" onError={() => handleImageError(photo.id)} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-700"><AlertCircle className="h-4 w-4 sm:h-6 sm:w-6 text-gray-400" /></div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Keyboard hint — hidden on mobile */}
              <p className="hidden sm:block text-white/50 text-xs text-center pb-2">← → navegar · +/- zoom · Esc fechar</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}