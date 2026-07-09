import React, { useState, useRef } from 'react'
import { DocumentUploader } from "../DocumentUploader";
import { DocumentFolder } from '../../lib/documentStorage'
import { AlertCircle, CheckCircle, Camera, FileText, Loader2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

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
  const { t } = useTranslation()
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

  const hasPhotos = photos && photos.length > 0
  const hasFormAttachments = formAttachments && formAttachments.length > 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-3 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header Mobile-Friendly */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2 sm:mb-3">
            {t('finalStep.heading')}
          </h1>
          <p className="text-sm sm:text-base text-gray-600">
            {t('finalStep.processingFor')} <span className="font-semibold text-indigo-600">{clientName}</span>
          </p>
        </div>

        {/* Status Cards - Responsivo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
          {/* Card de Fotos */}
          <div className={`rounded-xl sm:rounded-2xl p-4 sm:p-5 border-2 transition-all ${
            hasPhotos 
              ? 'bg-green-50 border-green-200 shadow-sm' 
              : 'bg-red-50 border-red-200 shadow-sm'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`flex-shrink-0 p-2 rounded-lg ${
                hasPhotos ? 'bg-green-100' : 'bg-red-100'
              }`}>
                <Camera className={`w-5 h-5 sm:w-6 sm:h-6 ${
                  hasPhotos ? 'text-green-600' : 'text-red-600'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm sm:text-base font-semibold text-gray-900 mb-1">
                  {t('finalStep.photosCardTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-gray-600 break-words">
                  {hasPhotos
                    ? t('finalStep.photosSent', { count: photos.length })
                    : t('finalStep.photosNone')}
                </p>
              </div>
              {hasPhotos ? (
                <CheckCircle className="flex-shrink-0 w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="flex-shrink-0 w-5 h-5 text-red-600" />
              )}
            </div>
          </div>

          {/* Card de Anexos */}
          <div className={`rounded-xl sm:rounded-2xl p-4 sm:p-5 border-2 transition-all ${
            hasFormAttachments 
              ? 'bg-blue-50 border-blue-200 shadow-sm' 
              : 'bg-gray-50 border-gray-200 shadow-sm'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`flex-shrink-0 p-2 rounded-lg ${
                hasFormAttachments ? 'bg-blue-100' : 'bg-gray-100'
              }`}>
                <FileText className={`w-5 h-5 sm:w-6 sm:h-6 ${
                  hasFormAttachments ? 'text-blue-600' : 'text-gray-400'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm sm:text-base font-semibold text-gray-900 mb-1">
                  {t('finalStep.attachmentsCardTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-gray-600 break-words">
                  {hasFormAttachments
                    ? t('finalStep.attachments', { count: formAttachments.length })
                    : t('finalStep.attachmentsNone')}
                </p>
              </div>
              {hasFormAttachments && (
                <CheckCircle className="flex-shrink-0 w-5 h-5 text-blue-600" />
              )}
            </div>
          </div>
        </div>

        {/* Aviso se não tiver fotos - Mobile Optimized */}
        {!hasPhotos && (
          <div className="mb-4 sm:mb-6 rounded-xl sm:rounded-2xl p-4 sm:p-5 bg-red-50 border-2 border-red-200 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 text-red-600 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-red-900 mb-1 sm:mb-2">
                  {t('finalStep.warningTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-red-800 leading-relaxed">
                  {t('finalStep.warningBody')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Debug info em desenvolvimento — mantido em PT-BR, é interno e não aparece em produção */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mb-4 sm:mb-6 rounded-xl sm:rounded-2xl p-4 sm:p-5 bg-yellow-50 border-2 border-yellow-200 shadow-sm">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-shrink-0 p-2 bg-yellow-100 rounded-lg">
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-600 animate-spin" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-yellow-900">
                🔍 Debug FinalStep
              </h3>
            </div>
            <div className="space-y-1.5 pl-0 sm:pl-11">
              <DebugItem label="Fotos recebidas" value={photos?.length || 0} />
              <DebugItem label="Cliente" value={clientName} />
              <DebugItem label="Email" value={contractData?.clientInfo?.email || 'N/A'} />
              <DebugItem label="Anexos do formulário" value={formAttachments?.length || 0} />
            </div>
          </div>
        )}

        {/* Document Uploader Container - Mobile Optimized */}
        <div className="rounded-xl sm:rounded-2xl bg-white shadow-lg border border-gray-200 overflow-hidden">
          <DocumentUploader
            clientName={clientName}
            contractData={contractData}
            formData={formData}
            formAttachments={formAttachments}
            photos={photos}
            onComplete={handleDocumentComplete}
          />
        </div>

        {/* Info adicional no rodapé - Mobile */}
        <div className="mt-4 sm:mt-6 text-center">
          <p className="text-xs sm:text-sm text-gray-500">
            {t('finalStep.footerNote')}
          </p>
        </div>
      </div>
    </div>
  )
}

// Componente auxiliar para itens de debug
function DebugItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs sm:text-sm">
      <span className="font-medium text-yellow-900">{label}:</span>
      <span className="text-yellow-800 break-all">{value}</span>
    </div>
  )
}