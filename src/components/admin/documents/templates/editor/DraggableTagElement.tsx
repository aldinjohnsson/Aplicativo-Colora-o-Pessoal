// src/components/admin/documents/templates/editor/DraggableTagElement.tsx
//
// Representação visual de um DocumentTemplateElement sobre uma página do PDF.
// Envolto em react-rnd para permitir arrastar e redimensionar.
//
// Coordenadas e tamanhos são trocados entre pt (banco) e px (editor):
//   px = pt * zoom
//
// PREVIEW WYSIWYG: para tags de texto, renderizamos `{{slug}}` aplicando a
// mesma fontFamily/size/cor/alinhamento configurados — assim o usuário vê
// no editor exatamente como o texto vai sair no PDF (aproximação muito
// próxima — pequenas diferenças sub-pixel entre browser e pdf-lib são
// inevitáveis).
//
// Para tags de imagem, mostramos um placeholder com badge do modo de
// ajuste ('Cobrir' / 'Conter') pra deixar claro o que foi escolhido.

import React from 'react'
import { Rnd } from 'react-rnd'
import { Image as ImageIcon, X } from 'lucide-react'
import type { DocumentTag, DocumentTemplateElement, ElementStyle } from '../../types'

interface Props {
  element: DocumentTemplateElement
  tag: DocumentTag | undefined     // undefined = tag deletada (órfão)
  zoom: number                      // 1 = escala real (1pt = 1px)
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Pick<DocumentTemplateElement,
    'x_pt' | 'y_pt' | 'width_pt' | 'height_pt'
  >>) => void
  onDelete: () => void
}

export function DraggableTagElement({
  element, tag, zoom, selected, onSelect, onChange, onDelete,
}: Props) {
  const isImage = tag?.type === 'image'

  // Defaults de tamanho
  const fallbackW = isImage ? 180 : 180
  const fallbackH = isImage ? 180 : 40
  const wPt = element.width_pt ?? fallbackW
  const hPt = element.height_pt ?? fallbackH

  // pt → px
  const xPx = element.x_pt * zoom
  const yPx = element.y_pt * zoom
  const wPx = wPt * zoom
  const hPx = hPt * zoom

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete()
  }

  return (
    <Rnd
      size={{ width: wPx, height: hPx }}
      position={{ x: xPx, y: yPx }}
      onDragStart={() => onSelect()}
      onResizeStart={() => onSelect()}
      onDragStop={(_, d) => {
        onChange({ x_pt: d.x / zoom, y_pt: d.y / zoom })
      }}
      onResizeStop={(_, __, ref, ___, position) => {
        onChange({
          width_pt: parseFloat(ref.style.width) / zoom,
          height_pt: parseFloat(ref.style.height) / zoom,
          x_pt: position.x / zoom,
          y_pt: position.y / zoom,
        })
      }}
      bounds="parent"
      enableResizing={{
        top: true, right: true, bottom: true, left: true,
        topRight: true, bottomRight: true, bottomLeft: true, topLeft: true,
      }}
      className={`group ${selected ? 'z-20' : 'z-10'}`}
      style={{ pointerEvents: 'auto' }}
    >
      <div
        onMouseDown={onSelect}
        className={`relative w-full h-full transition-colors ${
          selected
            ? 'ring-2 ring-rose-500 bg-rose-50/20'
            : 'ring-1 ring-rose-300/60 hover:ring-rose-400 hover:bg-rose-50/10'
        }`}
        style={{ boxSizing: 'border-box' }}
      >
        {isImage ? (
          <ImagePreview tag={tag} style={element.style as ElementStyle} />
        ) : (
          <TextPreview tag={tag} style={element.style as ElementStyle} zoom={zoom} />
        )}

        {/* Botão excluir (só quando selecionado) */}
        {selected && (
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={handleDelete}
            title="Remover elemento"
            className="absolute -top-3 -right-3 h-6 w-6 rounded-full bg-red-500 text-white shadow-md hover:bg-red-600 flex items-center justify-center z-30"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Label flutuante com nome da tag (só quando selecionado) */}
        {selected && tag && (
          <div className="absolute -top-5 left-0 text-[10px] font-medium text-rose-600 bg-white px-1.5 py-0.5 rounded shadow-sm border border-rose-200 whitespace-nowrap pointer-events-none">
            {tag.name}
          </div>
        )}
      </div>
    </Rnd>
  )
}

// ─── Preview de texto ─────────────────────────────────────────────────

function TextPreview({
  tag, style, zoom,
}: { tag: DocumentTag | undefined; style: ElementStyle | undefined; zoom: number }) {
  const s = style || {}

  // Defaults espelhando os defaults de generatePdf.ts
  const fontFamily   = s.fontFamily ?? 'Inter'
  const fontSizePt   = s.fontSize ?? 14
  const lineHeight   = s.lineHeight ?? 1.3
  const letterSpacingPt = s.letterSpacing ?? 0
  const align        = s.align ?? 'left'
  const verticalAlign= s.verticalAlign ?? 'top'
  const color        = s.color ?? '#111827'
  const bold         = !!s.bold
  const italic       = !!s.italic
  const transform    = s.textTransform ?? 'none'

  const justify =
    verticalAlign === 'middle' ? 'center' :
    verticalAlign === 'bottom' ? 'flex-end' :
    'flex-start'

  // texto preview: {{slug}} (placeholder; ainda não temos cliente no editor)
  const previewText = tag ? `{{${tag.slug}}}` : '(tag removida)'

  return (
    <div
      className="w-full h-full overflow-hidden select-none pointer-events-none flex"
      style={{
        // empurra o conteúdo verticalmente conforme verticalAlign
        flexDirection: 'column',
        justifyContent: justify,
      }}
    >
      <div
        style={{
          fontFamily: `"${fontFamily}", sans-serif`,
          fontSize: `${fontSizePt * zoom}px`,
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? 'italic' : 'normal',
          color,
          textAlign: align as any,
          lineHeight,
          letterSpacing: `${letterSpacingPt * zoom}px`,
          textTransform: transform as any,
          width: '100%',
          // Mantém quebras suaves; oculta o que escapa do retângulo.
          // Não usamos -webkit-line-clamp pra não esconder linhas de
          // antemão — overflow:hidden no pai já basta.
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {previewText}
      </div>
    </div>
  )
}

// ─── Preview de imagem ────────────────────────────────────────────────

function ImagePreview({
  tag, style,
}: { tag: DocumentTag | undefined; style: ElementStyle | undefined }) {
  const fit = style?.objectFit ?? 'cover'
  const fitLabel = fit === 'cover' ? 'Cobrir' : 'Conter'

  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-rose-500/80 select-none pointer-events-none px-2 text-center overflow-hidden">
      <ImageIcon className="h-5 w-5 mb-1" />
      <p className="text-[10px] font-medium truncate max-w-full">
        {tag ? tag.name : '(tag removida)'}
      </p>
      <p className="text-[9px] text-rose-400/80 mt-0.5">
        {fitLabel}
      </p>
    </div>
  )
}