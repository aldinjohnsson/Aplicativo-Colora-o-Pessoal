import React, { useState, useEffect, useRef } from 'react'
import { CheckCircle, AlertCircle, Upload, FileText, Image, Package } from 'lucide-react'
import { supabaseStorage } from '../../lib/supabaseStorage'

interface DocumentUploaderProps {
  clientName: string
  contractData: any
  formData: any
  formAttachments: File[]
  photos: File[]
  onComplete: (folder: any, blob?: Blob) => void
}

export function DocumentUploader({
  clientName,
  contractData,
  formData,
  formAttachments,
  photos,
  onComplete
}: DocumentUploaderProps) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [progress, setProgress] = useState<{
    fileName: string
    progress: number
    total: number
    uploaded: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [totalFiles, setTotalFiles] = useState(0)
  const [uploadedFiles, setUploadedFiles] = useState(0)

  // 🔥 CORREÇÃO CRÍTICA: Usar ref para evitar problemas de closure
  const hasUploadedRef = useRef(false)
  const propsRef = useRef({ photos, contractData, formData, formAttachments, clientName })

  // Atualizar ref sempre que as props mudarem
  useEffect(() => {
    propsRef.current = { photos, contractData, formData, formAttachments, clientName }
  }, [photos, contractData, formData, formAttachments, clientName])

  // ✅ CORREÇÃO: useEffect simplificado que inicia o upload
  useEffect(() => {
    console.log('=== DocumentUploader Mounted ===')
    console.log('Photos recebidas:', photos?.length || 0)
    console.log('Email:', contractData?.clientInfo?.email)
    
    // ⚠️ IMPORTANTE: Validar fotos
    if (!photos || photos.length === 0) {
      console.error('❌ ERRO: Nenhuma foto recebida!')
      setError('Nenhuma foto foi recebida. Por favor, volte e envie as fotos novamente.')
      setStatus('error')
      return
    }

    // ✅ Proteção contra duplo upload
    if (hasUploadedRef.current) {
      console.log('⚠️ Upload já iniciado anteriormente')
      return
    }

    // 🔒 Marcar como iniciado
    hasUploadedRef.current = true
    console.log('🚀 Iniciando upload em 500ms...')
    
    // Delay para garantir que o componente está montado
    const timer = setTimeout(() => {
      console.log('⏰ Timer disparado - chamando handleUpload()')
      handleUpload()
    }, 500)

    return () => {
      console.log('🧹 Limpando timer')
      clearTimeout(timer)
    }
  }, []) // Manter array vazio, usar ref para valores atuais

  const handleUpload = async () => {
    console.log('🎬 handleUpload() INICIADO')
    
    // 🔥 CORREÇÃO: Pegar valores da ref, não das props (closure problem)
    const currentProps = propsRef.current
    
    console.log('📦 Props atuais:', {
      fotos: currentProps.photos?.length,
      email: currentProps.contractData?.clientInfo?.email,
      clientName: currentProps.clientName
    })

    // ✅ VALIDAÇÃO: Verificar se tem fotos
    if (!currentProps.photos || currentProps.photos.length === 0) {
      console.error('❌ ERRO: Sem fotos no momento do upload!')
      setError('Nenhuma foto disponível. Por favor, volte e envie as fotos novamente.')
      setStatus('error')
      hasUploadedRef.current = false // Permitir retry
      return
    }

    console.log('✅ Validação passou - iniciando upload')
    setStatus('uploading')
    setError(null)
    
    const total = currentProps.photos.length + currentProps.formAttachments.length
    setTotalFiles(total)
    
    try {
      console.log('🚀 Chamando supabaseStorage.saveClientData...')

      // Preparar dados do cliente
      const clientInfo = {
        fullName: currentProps.contractData.clientInfo?.fullName || currentProps.clientName,
        email: currentProps.contractData.clientInfo?.email || '',
        phone: currentProps.contractData.clientInfo?.phone || ''
      }

      console.log('👤 Cliente info:', clientInfo)

      // Salvar tudo no Supabase
      const clientId = await supabaseStorage.saveClientData(
        {
          clientInfo,
          contractData: currentProps.contractData,
          formData: currentProps.formData,
          formAttachments: currentProps.formAttachments,
          photos: currentProps.photos
        },
        (uploadProgress) => {
          console.log('📤 Progresso:', uploadProgress)
          setProgress(uploadProgress)
          setUploadedFiles(uploadProgress.uploaded)
        }
      )

      console.log('✅ Upload concluído! Client ID:', clientId)

      setStatus('success')
      setProgress(null)
      
      // Completar com sucesso
      setTimeout(() => {
        console.log('🎉 Chamando onComplete()')
        onComplete({ id: clientId })
      }, 1500)
      
    } catch (err: any) {
      console.error('❌ ERRO no upload:', err)
      console.error('Stack:', err.stack)
      setError(err.message || 'Erro ao fazer upload dos documentos')
      setStatus('error')
      
      // Permitir retry
      hasUploadedRef.current = false
    }
  }

  const handleRetry = () => {
    console.log('🔄 Retry solicitado')
    hasUploadedRef.current = false
    setStatus('idle')
    setProgress(null)
    setUploadedFiles(0)
    setError(null)
    
    // Reiniciar upload
    setTimeout(() => {
      handleUpload()
    }, 100)
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'uploading':
        return <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      case 'success':
        return <CheckCircle className="h-12 w-12 text-green-600" />
      case 'error':
        return <AlertCircle className="h-12 w-12 text-red-600" />
      default:
        return <Upload className="h-12 w-12 text-gray-400" />
    }
  }

  const getStatusMessage = () => {
    switch (status) {
      case 'uploading':
        return progress 
          ? `Enviando: ${progress.fileName} (${progress.uploaded}/${progress.total})`
          : 'Preparando upload...'
      case 'success':
        return 'Documentos salvos com sucesso no Supabase!'
      case 'error':
        return error || 'Erro ao fazer upload'
      default:
        return 'Preparando documentos...'
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'uploading':
        return 'text-blue-600'
      case 'success':
        return 'text-green-600'
      case 'error':
        return 'text-red-600'
      default:
        return 'text-gray-600'
    }
  }

  const progressPercentage = totalFiles > 0 ? (uploadedFiles / totalFiles) * 100 : 0

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
      <div className="max-w-md mx-auto">
        {/* Ícone de Status */}
        <div className="flex justify-center mb-6">
          {getStatusIcon()}
        </div>

        {/* Mensagem de Status */}
        <div className="text-center mb-6">
          <h3 className={`text-lg font-semibold mb-2 ${getStatusColor()}`}>
            {getStatusMessage()}
          </h3>
          
          {status === 'uploading' && (
            <div className="space-y-3">
              {/* Barra de Progresso */}
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              
              {/* Contador de Arquivos */}
              <p className="text-sm text-gray-600">
                {uploadedFiles} de {totalFiles} arquivos enviados
              </p>

              {/* Detalhes do arquivo atual */}
              {progress && (
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <p className="text-xs text-blue-800 font-medium truncate">
                    📤 {progress.fileName}
                  </p>
                  <div className="mt-2 w-full bg-blue-200 rounded-full h-1.5">
                    <div 
                      className="bg-blue-600 h-1.5 rounded-full transition-all"
                      style={{ width: `${progress.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="mt-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-800 mb-1 font-medium">Detalhes do erro:</p>
                <p className="text-xs text-red-700">{error}</p>
              </div>
              <button
                onClick={handleRetry}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Upload className="h-4 w-4 mr-2" />
                Tentar Novamente
              </button>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800">
                  ✅ Todos os arquivos foram salvos com sucesso no servidor!
                </p>
              </div>
              <p className="text-sm text-gray-600">
                Redirecionando para a visualização...
              </p>
            </div>
          )}
        </div>

        {/* Resumo dos Arquivos */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Resumo do envio:</h4>
          
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center text-gray-600">
              <FileText className="h-4 w-4 mr-2" />
              Contrato
            </span>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center text-gray-600">
              <FileText className="h-4 w-4 mr-2" />
              Formulário
            </span>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center text-gray-600">
              <Image className="h-4 w-4 mr-2" />
              Fotos ({photos?.length || 0})
            </span>
            {status === 'success' ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : status === 'uploading' ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
            ) : (
              <div className="h-4 w-4 bg-gray-300 rounded-full" />
            )}
          </div>
          
          {formAttachments.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center text-gray-600">
                <Package className="h-4 w-4 mr-2" />
                Anexos ({formAttachments.length})
              </span>
              {status === 'success' ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : status === 'uploading' ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              ) : (
                <div className="h-4 w-4 bg-gray-300 rounded-full" />
              )}
            </div>
          )}
        </div>

        {/* Debug Info */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-4 p-3 bg-gray-100 rounded text-xs text-gray-600">
            <p>🔍 Upload Status:</p>
            <p>- Uploaded: {hasUploadedRef.current ? 'Sim' : 'Não'}</p>
            <p>- Email: {contractData?.clientInfo?.email}</p>
            <p>- Fotos: {photos?.length || 0}</p>
            <p>- Status: {status}</p>
          </div>
        )}
      </div>
    </div>
  )
}