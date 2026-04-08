import React, { useState, useRef } from 'react'
import { DocumentUploader } from "../DocumentUploader";
import { DocumentFolder } from '../../lib/documentStorage'

interface FinalStepProps {
  clientName: string
  contractData: any
  formData: any
  formAttachments: File[]
  photos: File[]
  onComplete: () => void
}

export function FinalStep({
  clientName,
  contractData,
  formData,
  formAttachments,
  photos,
  onComplete
}: FinalStepProps) {
  const [documentFolder, setDocumentFolder] = useState<DocumentFolder | null>(null)
  
  // 🔥 CORREÇÃO: Usar ref para garantir que onComplete só é chamado uma vez
  const completedRef = useRef(false)

  const handleDocumentComplete = (folder: DocumentFolder) => {
    // 🛡️ PROTEÇÃO: Só chamar onComplete uma vez
    if (!completedRef.current) {
      completedRef.current = true
      console.log('✅ FinalStep: Upload concluído, chamando onComplete...')
      setDocumentFolder(folder)
      onComplete()
    } else {
      console.log('⚠️ FinalStep: onComplete já foi chamado, ignorando...')
    }
  }

  // ✅ VALIDAÇÃO: Verificar se recebeu fotos
  console.log('📸 FinalStep - Fotos recebidas:', photos?.length || 0)

  return (
    <div>
      {/* Aviso se não tiver fotos */}
      {(!photos || photos.length === 0) && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800 font-medium">
            ⚠️ AVISO: Nenhuma foto foi recebida!
          </p>
          <p className="text-xs text-red-700 mt-1">
            Por favor, volte ao passo anterior e envie suas fotos.
          </p>
        </div>
      )}

      {/* Debug info em desenvolvimento */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-xs text-yellow-800">
            <strong>🔍 Debug FinalStep:</strong>
          </p>
          <p className="text-xs text-yellow-700">
            - Fotos recebidas: {photos?.length || 0}
          </p>
          <p className="text-xs text-yellow-700">
            - Cliente: {clientName}
          </p>
          <p className="text-xs text-yellow-700">
            - Email: {contractData?.clientInfo?.email}
          </p>
        </div>
      )}

      <DocumentUploader
        clientName={clientName}
        contractData={contractData}
        formData={formData}
        formAttachments={formAttachments}
        photos={photos}
        onComplete={handleDocumentComplete}
      />
    </div>
  )
}