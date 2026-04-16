// src/components/admin/CategoryTypeModal.tsx
//
// Modal reutilizável para selecionar o "Tipo de Foto" ao criar ou editar uma categoria.
// Integra com o photoTypesService para carregar os tipos dinamicamente.
//
// USO (no editor de pastas):
//   import { CategoryTypeModal } from './CategoryTypeModal'
//
//   const [typeModalOpen, setTypeModalOpen] = useState(false)
//   const [pendingCategoryName, setPendingCategoryName] = useState('')
//
//   // Ao clicar em "+ Categoria":
//   const handleAddCategoryClick = () => {
//     setPendingCategoryName('')
//     setTypeModalOpen(true)
//   }
//
//   // Callback do modal:
//   const handleTypeSelected = (typeId: string, typeName: string) => {
//     setTypeModalOpen(false)
//     addCategory({ typeId, typeName })
//   }
//
//   <CategoryTypeModal
//     open={typeModalOpen}
//     onSelect={handleTypeSelected}
//     onCancel={() => setTypeModalOpen(false)}
//   />

import React, { useState, useEffect } from 'react'
import { X, Check, Loader2 } from 'lucide-react'
import { photoTypesService, PhotoType } from './PhotoTypesManager'

interface CategoryTypeModalProps {
  open: boolean
  /** Chamado com (typeId, typeName) quando o usuário seleciona e confirma */
  onSelect: (typeId: string, typeName: string) => void
  /** Chamado quando o usuário cancela — o chamador deve usar 'geral' como fallback */
  onCancel: () => void
  /** TypeId pré-selecionado (para modo edição) */
  currentTypeId?: string
  title?: string
}

export function CategoryTypeModal({
  open,
  onSelect,
  onCancel,
  currentTypeId,
  title = 'Qual tipo de foto esta categoria usa?',
}: CategoryTypeModalProps) {
  const [types, setTypes] = useState<PhotoType[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string>(currentTypeId || '')

  // Sincroniza seleção quando o modal abre
  useEffect(() => {
    if (open) {
      setSelected(currentTypeId || '')
      loadTypes()
    }
  }, [open, currentTypeId])

  const loadTypes = async () => {
    setLoading(true)
    try {
      const data = await photoTypesService.getAll()
      setTypes(data)
      // Se não houver pré-seleção, marca 'geral' como padrão
      if (!currentTypeId) {
        const geralId = data.find(t => t.id === 'geral')?.id || data[data.length - 1]?.id || ''
        setSelected(geralId)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = () => {
    const type = types.find(t => t.id === selected)
    if (!type) return
    onSelect(type.id, type.name)
  }

  const handleCancel = () => {
    // Cancela → chama onCancel; o chamador decide se usa 'geral' ou descarta
    onCancel()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white flex items-center justify-between">
          <p className="font-semibold text-sm">Nova Categoria</p>
          <button
            onClick={handleCancel}
            className="p-1 rounded-lg hover:bg-white/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-700 font-medium">{title}</p>
          <p className="text-xs text-gray-400">
            A IA usará a foto de referência do tipo selecionado para gerar imagens nesta categoria.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {types.map(type => {
                const isSelected = selected === type.id
                return (
                  <button
                    key={type.id}
                    onClick={() => setSelected(type.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                      isSelected
                        ? 'border-violet-500 bg-violet-50'
                        : 'border-gray-200 bg-white hover:border-violet-200 hover:bg-violet-50/50'
                    }`}
                  >
                    {/* Ícone colorido do type */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                      style={{
                        backgroundColor: type.color + '25',
                        border: `2px solid ${type.color}50`,
                      }}
                    >
                      {type.icon}
                    </div>

                    {/* Nome */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{type.name}</p>
                    </div>

                    {/* Check */}
                    {isSelected && (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: type.color }}
                      >
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    )}
                  </button>
                )
              })}

              {types.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">
                  Nenhum tipo configurado.{' '}
                  <span className="text-violet-500">
                    Acesse Configurações → Tipos de Foto.
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Info sobre cancelar */}
          <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
            💡 Cancelar usará o tipo <strong>Geral</strong> como padrão.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={handleCancel}
            className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancelar (usar Geral)
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || loading}
            className="flex-1 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            <Check className="h-4 w-4" />
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook auxiliar para carregar tipos dinamicamente num select inline
// (use no Tipo dropdown dentro da categoria já criada)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect as _useEffect, useState as _useState } from 'react'

export function usePhotoTypes() {
  const [types, setTypes] = useState<PhotoType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    photoTypesService.getAll().then(data => {
      setTypes(data)
      setLoading(false)
    })
  }, [])

  return { types, loading }
}