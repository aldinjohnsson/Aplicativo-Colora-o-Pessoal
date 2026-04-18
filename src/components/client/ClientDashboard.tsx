import React, { useState, useEffect, useRef } from 'react'
import { ProgressIndicator } from './ProgressIndicator'
import { ContractStep } from './steps/ContractStep'
import { FormStep } from './steps/FormStep'
import { PhotoStep } from './steps/PhotoStep'
import { FinalStep } from './steps/FinalStep'
import { Button } from '../ui/Button'
import { Card, CardContent } from '../ui/Card'
import {
  CheckCircle, Palette, Settings, FileText, ClipboardList,
  Download, Package, X
} from 'lucide-react'
import { clientDataStorage } from '../../lib/clientDataStorage'

export function ClientDashboard() {
  const [currentStep, setCurrentStep] = useState(1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())
  const [allCompleted, setAllCompleted] = useState(false)
  const [showAdminToggle, setShowAdminToggle] = useState(true)
  const [clickCount, setClickCount] = useState(0)

  const [clientName, setClientName] = useState('')
  const [contractData, setContractData] = useState<any>(null)
  const [formData, setFormData] = useState<any>(null)
  const [formAttachments, setFormAttachments] = useState<File[]>([])
  const [photos, setPhotos] = useState<File[]>([])

  const photosRef = useRef<File[]>([])
  const formAttachmentsRef = useRef<File[]>([])
  const contractDataRef = useRef<any>(null)
  const formDataRef = useRef<any>(null)

  useEffect(() => { photosRef.current = photos }, [photos])
  useEffect(() => { formAttachmentsRef.current = formAttachments }, [formAttachments])
  useEffect(() => { contractDataRef.current = contractData }, [contractData])
  useEffect(() => { formDataRef.current = formData }, [formData])

  const handleStepComplete = async (step: number, data?: any) => {
    switch (step) {
      case 1:
        const contractInfo = data || { accepted: true, timestamp: new Date().toISOString() }
        setContractData(contractInfo)
        contractDataRef.current = contractInfo
        if (contractInfo.clientInfo?.fullName) setClientName(contractInfo.clientInfo.fullName)
        break
      case 2:
        const newFormData = data?.formData || {}
        const newFormAttachments = data?.attachments || []
        setFormData(newFormData)
        setFormAttachments(newFormAttachments)
        formDataRef.current = newFormData
        formAttachmentsRef.current = newFormAttachments
        break
      case 3:
        let photosData: File[] = []
        if (Array.isArray(data)) photosData = data
        else if (data?.photos) photosData = data.photos
        setPhotos(photosData)
        photosRef.current = photosData
        break
      case 4:
        const currentContract = contractDataRef.current
        const currentPhotos = photosRef.current
        const currentFormData = formDataRef.current
        const currentAttachments = formAttachmentsRef.current
        if (!currentPhotos?.length) { alert('ERRO: Nenhuma foto detectada.'); return }
        if (currentContract?.clientInfo) {
          try {
            await clientDataStorage.saveClientData({
              clientInfo: currentContract.clientInfo,
              contractData: currentContract,
              formData: currentFormData || {},
              formAttachments: currentAttachments || [],
              photos: currentPhotos || []
            })
          } catch (error) { alert(`Erro ao salvar dados: ${error}`); return }
        }
        break
    }

    setCompletedSteps(prev => new Set([...prev, step]))
    if (step < 4) setCurrentStep(step + 1)
    else setAllCompleted(true)
  }

  const handleDownload = async (type: 'contract' | 'form' | 'photos') => {
    try {
      if (type === 'contract') {
        const { generateContractPDF } = await import('../../lib/contractPDFGenerator')
        const blob = await generateContractPDF(contractData.title || 'CONTRATO', contractData.sections || [], contractData.clientInfo, contractData.timestamp)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `${clientName}_Contrato.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      } else if (type === 'form') {
        const { generateFormPDF } = await import('../../lib/formPDFGenerator')
        const formConfig = JSON.parse(localStorage.getItem('admin-form-config') || 'null')
        const blob = await generateFormPDF(contractData.clientInfo.fullName, contractData.clientInfo.email, contractData.clientInfo.phone, formData, formConfig, new Date().toISOString(), formAttachments)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `${clientName}_Formulario.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      } else {
        if (!photos.length) { alert('Nenhuma foto para baixar.'); return }
        const JSZip = (await import('jszip')).default
        const zip = new JSZip()
        const folder = zip.folder('Fotos')
        for (const photo of photos) folder?.file(photo.name, photo)
        const blob = await zip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `${clientName}_Fotos.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      }
    } catch (err) { alert('Erro ao baixar. Tente novamente.') }
  }

  const steps = [
    { id: 1, title: 'Contrato', description: 'Leia e aceite os termos', completed: completedSteps.has(1), current: currentStep === 1, locked: false },
    { id: 2, title: 'Formulário', description: 'Preencha suas informações', completed: completedSteps.has(2), current: currentStep === 2, locked: !completedSteps.has(1) },
    { id: 3, title: 'Fotos', description: 'Envie suas fotos', completed: completedSteps.has(3), current: currentStep === 3, locked: !completedSteps.has(2) },
    { id: 4, title: 'Finalização', description: 'Revise e conclua', completed: completedSteps.has(4), current: currentStep === 4, locked: !completedSteps.has(3) },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-3 sm:px-6">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Palette className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-semibold text-gray-900 leading-tight">Portal do Cliente</h1>
                <p className="text-xs text-gray-500 hidden sm:block">Análise de Coloração Pessoal</p>
              </div>
            </div>
            {showAdminToggle && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => window.location.href = '/admin'}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs sm:text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Painel Admin</span>
                </button>
                <button
                  onClick={() => setShowAdminToggle(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        <ProgressIndicator steps={steps} />

        {/* Step Content */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
          {currentStep === 1 && <ContractStep onComplete={d => handleStepComplete(1, d)} />}
          {currentStep === 2 && <FormStep onComplete={d => handleStepComplete(2, d)} />}
          {currentStep === 3 && <PhotoStep onComplete={d => handleStepComplete(3, d)} />}
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

        {/* Completion */}
        {allCompleted && (
          <Card className="mt-4 sm:mt-6 bg-gradient-to-r from-green-50 to-blue-50 border-green-200">
            <CardContent className="text-center py-8 sm:py-12 px-4 sm:px-6">
              <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-green-100 rounded-full mb-3 sm:mb-4">
                <CheckCircle className="h-7 w-7 sm:h-8 sm:w-8 text-green-600" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Processo Concluído!</h2>
              <p className="text-sm text-gray-600 mb-5 sm:mb-6 max-w-md mx-auto">
                Obrigado por completar todas as etapas. Em breve entraremos em contato com os resultados.
              </p>

              {/* Download actions — stack on mobile */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center max-w-xl mx-auto">
                <Button onClick={() => handleDownload('contract')} variant="outline" className="flex-1 text-sm">
                  <FileText className="h-4 w-4 mr-2" /> Baixar Contrato
                </Button>
                <Button onClick={() => handleDownload('form')} variant="outline" className="flex-1 text-sm">
                  <ClipboardList className="h-4 w-4 mr-2" /> Baixar Formulário
                </Button>
                {photos.length > 0 && (
                  <Button onClick={() => handleDownload('photos')} variant="outline" className="flex-1 text-sm">
                    <Package className="h-4 w-4 mr-2" /> Baixar Fotos
                  </Button>
                )}
              </div>

              <div className="mt-5 p-4 bg-blue-50 rounded-lg border border-blue-200 text-left max-w-xl mx-auto">
                <p className="text-sm text-blue-800">
                  <strong>Próximos Passos:</strong> Nossa equipe irá analisar suas informações e fotos.
                  Você receberá o resultado completo em até 5 dias úteis no e-mail cadastrado.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Hidden admin toggle */}
      {!showAdminToggle && (
        <div
          onClick={() => {
            setClickCount(prev => {
              const n = prev + 1
              if (n >= 5) { setShowAdminToggle(true); return 0 }
              return n
            })
          }}
          className="fixed bottom-4 right-4 w-10 h-10 sm:w-12 sm:h-12 bg-gray-100 hover:bg-gray-200 rounded-full cursor-pointer flex items-center justify-center shadow-lg transition-all hover:scale-110"
        >
          <Settings className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
        </div>
      )}
    </div>
  )
}