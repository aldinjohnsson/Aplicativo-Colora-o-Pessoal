import React, { useRef, useEffect, useState, useCallback } from 'react'
import { PenLine, Trash2, CheckCircle } from 'lucide-react'

interface SignatureCanvasProps {
  onSignature: (dataUrl: string | null) => void
  /** Largura lógica do canvas (padrão 600) */
  width?: number
  /** Altura lógica do canvas (padrão 180) */
  height?: number
}

export function SignatureCanvas({ onSignature, width = 600, height = 180 }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDrawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const [confirmed, setConfirmed] = useState(false)

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Converte coordenadas de evento para coordenadas lógicas do canvas */
  const getPoint = (e: MouseEvent | Touch): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const getCtx = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    return ctx
  }

  const drawDot = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.beginPath()
    ctx.arc(x, y, 1.25, 0, Math.PI * 2)
    ctx.fillStyle = '#1e293b'
    ctx.fill()
  }

  // ─── Mouse events ────────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const ctx = getCtx()
    if (!ctx) return
    isDrawingRef.current = true
    const pt = getPoint(e)
    lastPointRef.current = pt
    drawDot(ctx, pt.x, pt.y)
    setIsEmpty(false)
    setConfirmed(false)
    onSignature(null) // invalidar assinatura anterior ao começar novo traço
  }, [onSignature])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDrawingRef.current) return
    e.preventDefault()
    const ctx = getCtx()
    if (!ctx || !lastPointRef.current) return
    const pt = getPoint(e)
    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    lastPointRef.current = pt
  }, [])

  const handleMouseUp = useCallback(() => {
    isDrawingRef.current = false
    lastPointRef.current = null
  }, [])

  // ─── Touch events ────────────────────────────────────────────────────────────

  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault()
    const ctx = getCtx()
    if (!ctx) return
    isDrawingRef.current = true
    const pt = getPoint(e.touches[0])
    lastPointRef.current = pt
    drawDot(ctx, pt.x, pt.y)
    setIsEmpty(false)
    setConfirmed(false)
    onSignature(null)
  }, [onSignature])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDrawingRef.current) return
    e.preventDefault()
    const ctx = getCtx()
    if (!ctx || !lastPointRef.current) return
    const pt = getPoint(e.touches[0])
    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    lastPointRef.current = pt
  }, [])

  const handleTouchEnd = useCallback(() => {
    isDrawingRef.current = false
    lastPointRef.current = null
  }, [])

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    canvas.addEventListener('touchend', handleTouchEnd)

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove', handleTouchMove)
      canvas.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd])

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
    setConfirmed(false)
    onSignature(null)
  }

  const confirm = () => {
    const canvas = canvasRef.current
    if (!canvas || isEmpty) return
    const dataUrl = canvas.toDataURL('image/png')
    setConfirmed(true)
    onSignature(dataUrl)
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <PenLine className="h-4 w-4 text-gray-500" />
          Assinatura <span className="text-red-500">*</span>
        </div>
        {!isEmpty && (
          <button
            type="button"
            onClick={clear}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
      </div>

      {/* Canvas wrapper */}
      <div
        ref={containerRef}
        className={`relative rounded-xl border-2 transition-colors overflow-hidden select-none
          ${confirmed
            ? 'border-green-400 bg-green-50/30'
            : isEmpty
            ? 'border-dashed border-gray-300 bg-gray-50/60 hover:border-gray-400'
            : 'border-gray-400 bg-white'
          }`}
        style={{ touchAction: 'none' }}
      >
        {/* Placeholder */}
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-400">
            <PenLine className="h-6 w-6" />
            <p className="text-xs">Assine aqui com o dedo ou mouse</p>
          </div>
        )}

        {/* Baseline */}
        <div
          className="pointer-events-none absolute"
          style={{ bottom: 36, left: 24, right: 24, borderBottom: '1px solid #d1d5db' }}
        />

        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full h-full block"
          style={{ cursor: 'crosshair', height: 160 }}
        />

        {/* Confirmed badge */}
        {confirmed && (
          <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 bg-green-100 text-green-700 text-xs font-medium px-2 py-1 rounded-full">
            <CheckCircle className="h-3.5 w-3.5" />
            Confirmada
          </div>
        )}
      </div>

      {/* Confirm button */}
      {!isEmpty && !confirmed && (
        <button
          type="button"
          onClick={confirm}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <CheckCircle className="h-4 w-4" />
          Confirmar Assinatura
        </button>
      )}

      {confirmed && (
        <p className="text-xs text-green-600 text-center">
          ✓ Assinatura registrada. Clique em "Limpar" para refazer.
        </p>
      )}

      {isEmpty && (
        <p className="text-xs text-gray-400 text-center">
          Após desenhar, clique em "Confirmar Assinatura"
        </p>
      )}
    </div>
  )
}
