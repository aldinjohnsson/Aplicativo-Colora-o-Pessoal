import React, { useState, useEffect, useRef } from 'react'
import { ProgressIndicator } from './ProgressIndicator'
import { ContractStep } from './steps/ContractStep'
import { FormStep } from './steps/FormStep'
import { PhotoStep } from './steps/PhotoStep'
import { FinalStep } from './steps/FinalStep'
import { Button } from '../ui/Button'
import { Card, CardContent, CardHeader } from '../ui/Card'
import { CheckCircle, Palette, Settings, FileText, ClipboardList, Download, Eye, Package, X } from 'lucide-react'
import { clientDataStorage } from '../../lib/clientDataStorage'

export function ClientDashboard() {
  const [currentStep, setCurrentStep] = useState(1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())
  const [allCompleted, setAllCompleted] = useState(false)
  const [showAdminToggle, setShowAdminToggle] = useState(true)
  const [showContractPreview, setShowContractPreview] = useState(false)
  const [showFormPreview, setShowFormPreview] = useState(false)
  const [clickCount, setClickCount] = useState(0)
  
  // Dados coletados durante o processo
  const [clientName, setClientName] = useState('')
  const [contractData, setContractData] = useState<any>(null)
  const [formData, setFormData] = useState<any>(null)
  const [formAttachments, setFormAttachments] = useState<File[]>([])
  const [photos, setPhotos] = useState<File[]>([])

  // Usar refs para manter os dados mais recentes sempre acessíveis
  const photosRef = useRef<File[]>([])
  const formAttachmentsRef = useRef<File[]>([])
  const contractDataRef = useRef<any>(null)
  const formDataRef = useRef<any>(null)

  // Sincronizar refs com states
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => {
    formAttachmentsRef.current = formAttachments
  }, [formAttachments])

  useEffect(() => {
    contractDataRef.current = contractData
  }, [contractData])

  useEffect(() => {
    formDataRef.current = formData
  }, [formData])

  const handleStepComplete = async (step: number, data?: any) => {
    console.log(`\n========== STEP ${step} COMPLETE ==========`)
    console.log('📦 Data recebida:', data)
    console.log('📦 Tipo de data:', Array.isArray(data) ? 'Array' : typeof data)
    
    // Salvar dados específicos de cada etapa
    switch (step) {
      case 1:
        const contractInfo = data || { accepted: true, timestamp: new Date().toISOString() }
        setContractData(contractInfo)
        contractDataRef.current = contractInfo
        
        if (contractInfo.clientInfo && contractInfo.clientInfo.fullName) {
          setClientName(contractInfo.clientInfo.fullName)
        }
        
        console.log('✅ Step 1 - Contrato salvo')
        break
        
      case 2:
        const newFormData = data?.formData || {}
        const newFormAttachments = data?.attachments || []
        
        setFormData(newFormData)
        setFormAttachments(newFormAttachments)
        formDataRef.current = newFormData
        formAttachmentsRef.current = newFormAttachments
        
        console.log('✅ Step 2 - Formulário salvo')
        console.log('📎 Anexos salvos:', newFormAttachments.length)
        break
        
      case 3:
        // 🔧 FIX CRÍTICO: PhotoStep retorna o array diretamente, não {photos: []}
        let photosData: File[] = []
        
        if (Array.isArray(data)) {
          // Se data é um array, use ele diretamente
          photosData = data
          console.log('✅ Recebido array de fotos diretamente')
        } else if (data && data.photos) {
          // Se data é um objeto com propriedade photos
          photosData = data.photos
          console.log('✅ Recebido objeto com propriedade photos')
        } else if (data) {
          console.warn('⚠️ Formato de dados desconhecido para fotos:', data)
        }
        
        // Atualizar tanto o estado quanto a ref IMEDIATAMENTE
        setPhotos(photosData)
        photosRef.current = photosData
        
        console.log('✅ Step 3 - Fotos salvas')
        console.log('📸 Fotos no array:', photosData.length)
        console.log('📸 Fotos no state:', photosData.length)
        console.log('📸 Fotos na ref:', photosRef.current.length)
        console.log('📸 Detalhes das fotos:', photosData.slice(0, 3).map((p: File) => ({
          name: p.name,
          size: p.size,
          type: p.type
        })))
        
        // Verificação adicional
        if (photosData.length === 0) {
          console.error('❌ ERRO CRÍTICO: Nenhuma foto foi salva no Step 3!')
          console.error('   Data recebida:', data)
        }
        break
        
      case 4:
        console.log('========== STEP 4: SALVANDO TUDO ==========')
        
        // Usar refs para garantir que temos os dados mais recentes
        const currentContract = contractDataRef.current
        const currentPhotos = photosRef.current
        const currentFormData = formDataRef.current
        const currentAttachments = formAttachmentsRef.current
        
        console.log('💾 Dados para salvar:')
        console.log('  - Contrato:', currentContract ? '✓' : '✗')
        console.log('  - Formulário:', currentFormData ? '✓' : '✗')
        console.log('  - Fotos:', currentPhotos?.length || 0)
        console.log('  - Anexos:', currentAttachments?.length || 0)
        
        // Validação crítica antes de salvar
        if (!currentPhotos || currentPhotos.length === 0) {
          console.error('❌ ERRO CRÍTICO: Tentando salvar sem fotos!')
          console.error('   State photos:', photos?.length || 0)
          console.error('   Ref photos:', photosRef.current?.length || 0)
          alert('ERRO: Nenhuma foto detectada. Por favor, volte ao passo 3 e envie as fotos novamente.')
          return
        }
        
        if (currentContract && currentContract.clientInfo) {
          try {
            const clientId = await clientDataStorage.saveClientData({
              clientInfo: currentContract.clientInfo,
              contractData: currentContract,
              formData: currentFormData || {},
              formAttachments: currentAttachments || [],
              photos: currentPhotos || []
            })
            
            console.log('✅ Dados salvos com sucesso! ID:', clientId)
            console.log('📸 Total de fotos enviadas:', currentPhotos?.length || 0)
            
            // Verificar imediatamente se as fotos foram salvas corretamente
            try {
              const recovered = await clientDataStorage.getClientFiles(clientId)
              console.log('🔍 Verificação pós-salvamento:')
              console.log('  - Fotos recuperadas:', recovered.photos?.length || 0)
              console.log('  - Anexos recuperados:', recovered.attachments?.length || 0)
              
              if (recovered.photos?.length !== currentPhotos?.length) {
                console.error('❌ ERRO: Número de fotos não bate!')
                console.error(`   Enviado: ${currentPhotos?.length || 0}`)
                console.error(`   Recuperado: ${recovered.photos?.length || 0}`)
              } else {
                console.log('✅ Fotos verificadas com sucesso!')
              }
            } catch (verifyError) {
              console.error('❌ Erro ao verificar fotos:', verifyError)
            }
            
            console.log('==========================================')
          } catch (error) {
            console.error('❌ Erro ao salvar dados do cliente:', error)
            alert(`Erro ao salvar dados: ${error}`)
          }
        } else {
          console.error('❌ ERRO: Dados do contrato não disponíveis!')
          alert('ERRO: Informações do contrato não encontradas.')
        }
        break
    }

    setCompletedSteps(prev => new Set([...prev, step]))
    
    if (step < 4) {
      setCurrentStep(step + 1)
    } else {
      setAllCompleted(true)
    }
  }

  const handleDownloadContract = async () => {
    try {
      const { generateContractPDF } = await import('../../lib/contractPDFGenerator')
      const pdfBlob = await generateContractPDF(
        contractData.title || 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
        contractData.sections || [],
        contractData.clientInfo,
        contractData.timestamp
      )

      const url = URL.createObjectURL(pdfBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${clientName.replace(/\s+/g, '_')}_Contrato.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao baixar contrato:', error)
      alert('Erro ao baixar contrato. Tente novamente.')
    }
  }

  const handleDownloadForm = async () => {
    try {
      const { generateFormPDF } = await import('../../lib/formPDFGenerator')

      let formConfig = null
      try {
        if (typeof window !== 'undefined' && (window as any).storage) {
          const result = await (window as any).storage.get('admin-form-config', true)
          if (result && result.value) {
            formConfig = JSON.parse(result.value)
          }
        } else {
          const stored = localStorage.getItem('admin-form-config')
          if (stored) {
            formConfig = JSON.parse(stored)
          }
        }
      } catch (error) {
        console.error('Erro ao carregar config do formulário:', error)
      }

      const pdfBlob = await generateFormPDF(
        contractData.clientInfo.fullName,
        contractData.clientInfo.email,
        contractData.clientInfo.phone,
        formData,
        formConfig,
        new Date().toISOString(),
        formAttachments
      )

      const url = URL.createObjectURL(pdfBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${clientName.replace(/\s+/g, '_')}_Formulario.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao baixar formulário:', error)
      alert('Erro ao baixar formulário. Tente novamente.')
    }
  }

  const handleDownloadPhotos = async () => {
    try {
      if (!photos || photos.length === 0) {
        alert('Nenhuma foto para baixar.')
        return
      }

      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const folder = zip.folder('Fotos')

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i]
        folder?.file(photo.name, photo)
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${clientName.replace(/\s+/g, '_')}_Fotos.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao baixar fotos:', error)
      alert('Erro ao baixar fotos. Tente novamente.')
    }
  }

  const steps = [
    {
      id: 1,
      title: 'Contrato',
      description: 'Leia e aceite os termos',
      completed: completedSteps.has(1),
      current: currentStep === 1,
      locked: false
    },
    {
      id: 2,
      title: 'Formulário',
      description: 'Preencha suas informações',
      completed: completedSteps.has(2),
      current: currentStep === 2,
      locked: !completedSteps.has(1)
    },
    {
      id: 3,
      title: 'Fotos',
      description: 'Envie suas fotos',
      completed: completedSteps.has(3),
      current: currentStep === 3,
      locked: !completedSteps.has(2)
    },
    {
      id: 4,
      title: 'Finalização',
      description: 'Revise e conclua',
      completed: completedSteps.has(4),
      current: currentStep === 4,
      locked: !completedSteps.has(3)
    }
  ]

  const goToAdmin = () => {
    window.location.href = '/admin'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center mr-3">
                <Palette className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Portal do Cliente</h1>
                <p className="text-sm text-gray-500">Análise de Coloração Pessoal</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {showAdminToggle && (
                <>
                  <Button variant="ghost" onClick={goToAdmin} size="sm">
                    <Settings className="h-4 w-4 mr-2" />
                    Painel Admin
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setShowAdminToggle(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Progress Indicator */}
        <ProgressIndicator steps={steps} />

        {/* Step Content */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {currentStep === 1 && (
            <ContractStep onComplete={(data) => handleStepComplete(1, data)} />
          )}
          
          {currentStep === 2 && (
            <FormStep onComplete={(data) => handleStepComplete(2, data)} />
          )}
          
          {currentStep === 3 && (
            <PhotoStep onComplete={(data) => handleStepComplete(3, data)} />
          )}
          
          {currentStep === 4 && (
            <FinalStep
              clientName={clientName}
              contractData={contractData}
              formData={formData}
              formAttachments={formAttachments}
              photos={photos}
              onComplete={() => handleStepComplete(4)}
            />
          )}
        </div>

        {/* Completion Message */}
        {allCompleted && (
          <Card className="mt-6 bg-gradient-to-r from-green-50 to-blue-50 border-green-200">
            <CardContent className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Processo Concluído!</h2>
              <p className="text-gray-600 mb-6">
                Obrigado por completar todas as etapas. Em breve entraremos em contato com os resultados da sua análise.
              </p>
              
              {/* Quick Actions */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-2xl mx-auto">
                <Button
                  onClick={handleDownloadContract}
                  variant="outline"
                  className="flex-1"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Baixar Contrato
                </Button>
                <Button
                  onClick={handleDownloadForm}
                  variant="outline"
                  className="flex-1"
                >
                  <ClipboardList className="h-4 w-4 mr-2" />
                  Baixar Formulário
                </Button>
                {photos.length > 0 && (
                  <Button
                    onClick={handleDownloadPhotos}
                    variant="outline"
                    className="flex-1"
                  >
                    <Package className="h-4 w-4 mr-2" />
                    Baixar Fotos
                  </Button>
                )}
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-800">
                  <strong>Próximos Passos:</strong> Nossa equipe irá analisar suas informações e fotos. 
                  Você receberá o resultado completo em até 5 dias úteis no e-mail cadastrado.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Admin Access */}
      {!showAdminToggle && (
        <div
          onClick={() => {
            setClickCount(prev => {
              const newCount = prev + 1
              if (newCount >= 5) {
                setShowAdminToggle(true)
                return 0
              }
              return newCount
            })
          }}
          className="fixed bottom-4 right-4 w-12 h-12 bg-gray-100 hover:bg-gray-200 rounded-full cursor-pointer flex items-center justify-center shadow-lg transition-all hover:scale-110"
          title="Clique 5x para mostrar acesso admin"
        >
          <Settings className="h-5 w-5 text-gray-400" />
        </div>
      )}
    </div>
  )
}