// src/components/admin/documents/templates/editor/DraggableTagElement.tsx
//
// Representação visual de um DocumentTemplateElement sobre uma página do PDF.
// Envolto em react-rnd para permitir arrastar e redimensionar.
//
// Coordenadas e tamanhos são trocados entre pt (banco) e px (editor):
//   px = pt * zoom

import React from 'react'
import { Rnd } from 'react-rnd'
import { Image as ImageIcon, Type as TypeIcon, X } from 'lucide-react'
import type { DocumentTag, DocumentTemplateElement } from '../../types'

interface Props {
  element: DocumentTemplateElement
  tag: DocumentTag | undefined     // undefined quando a tag foi deletada (órfão)
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
  // Fallbacks de tamanho quando nunca foi definido: 180×40pt pra texto, 180×180pt pra imagem
  const fallbackW = tag?.type === 'image' ? 180 : 180
  const fallbackH = tag?.type === 'image' ? 180 : 40
  const wPt = element.width_pt ?? fallbackW
  const hPt = element.height_pt ?? fallbackH

  // Converte pt → px para display
  const xPx = element.x_pt * zoom
  const yPx = element.y_pt * zoom
  const wPx = wPt * zoom
  const hPx = hPt * zoom

  const isImage = tag?.type === 'image'

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
      style={{
        // react-rnd aplica estilos inline; display é setado internamente
        pointerEvents: 'auto',
      }}
    >
      <div
        onMouseDown={onSelect}
        className={`relative w-full h-full transition-colors ${
          selected
            ? 'ring-2 ring-rose-500 bg-rose-50/30'
            : 'ring-1 ring-rose-300/60 bg-rose-50/10 hover:ring-rose-400 hover:bg-rose-50/20'
        }`}
        style={{ boxSizing: 'border-box' }}
      >
        {/* Conteúdo visual — placeholder "{{nome_tag}}" ou ícone */}
        {isImage ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-rose-500/80 select-none pointer-events-none px-2 text-center overflow-hidden">
            <ImageIcon className="h-5 w-5 mb-1" />
            <p className="text-[10px] font-medium truncate max-w-full">
              {tag ? tag.name : '(tag removida)'}
            </p>
          </div>
        ) : (
          <div className="w-full h-full flex items-start justify-start text-rose-600 select-none pointer-events-none p-1.5 overflow-hidden">
            <div className="flex items-start gap-1 text-[11px] font-mono">
              <TypeIcon className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span className="truncate">
                {tag ? `{{${tag.slug}}}` : '(tag removida)'}
              </span>
            </div>
          </div>
        )}

        {/* Botão delete (só aparece quando selecionado) */}
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

        {/* Label no topo quando selecionado */}
        {selected && tag && (
          <div className="absolute -top-5 left-0 text-[10px] font-medium text-rose-600 bg-white px-1.5 py-0.5 rounded shadow-sm border border-rose-200 whitespace-nowrap">
            {tag.name}
          </div>
        )}
      </div>
    </Rnd>
  )
}
