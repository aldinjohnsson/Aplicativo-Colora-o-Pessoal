import React, { useState, useEffect } from 'react'
import { FileText, Check, User, Mail, Phone } from 'lucide-react'

interface ContractSection {
  id: string
  title: string
  content: string
  order: number
}

interface ClientInfo {
  fullName: string
  email: string
  phone: string
}

// Serviço para carregar o contrato do storage com fallback para localStorage
const contractStorageService = {
  async getContract() {
    try {
      let jsonData: string | null = null
      
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          const result = await (window as any).storage.get('admin-contract', true)
          if (result && result.value) {
            jsonData = result.value
          }
        } catch (e) {
          jsonData = localStorage.getItem('admin-contract')
        }
      } else {
        jsonData = localStorage.getItem('admin-contract')
      }
      
      if (jsonData) {
        const data = JSON.parse(jsonData)
        return data
      }
      
      return {
        title: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ANÁLISE DE COLORAÇÃO PESSOAL',
        sections: [
          {
            id: '1',
            title: '1. OBJETO',
            content: 'Este contrato tem por objeto a prestação de serviços de análise de coloração pessoal, incluindo avaliação de características físicas e recomendações de paleta de cores.',
            order: 1
          },
          {
            id: '2',
            title: '2. RESPONSABILIDADES DO CLIENTE',
            content: '- Fornecer informações verdadeiras no formulário\n- Enviar fotos conforme instruções específicas\n- Seguir as orientações para melhor resultado da análise',
            order: 2
          },
          {
            id: '3',
            title: '3. RESPONSABILIDADES DA PRESTADORA',
            content: '- Realizar análise profissional baseada nas informações e fotos fornecidas\n- Entregar relatório completo com paleta de cores personalizada\n- Manter confidencialidade das informações do cliente',
            order: 3
          },
          {
            id: '4',
            title: '4. PRAZO',
            content: 'O prazo para entrega da análise é de até 5 dias úteis após o recebimento de todas as informações necessárias.',
            order: 4
          },
          {
            id: '5',
            title: '5. POLÍTICA DE PRIVACIDADE',
            content: 'Todas as informações e imagens fornecidas serão utilizadas exclusivamente para a análise contratada e mantidas em sigilo.',
            order: 5
          }
        ],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      console.error('Erro ao carregar contrato:', error)
      return {
        title: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
        sections: [],
        lastUpdated: new Date().toISOString()
      }
    }
  }
}

// Componentes UI
const Button = ({ children, onClick, loading, disabled, className = '' }: any) => {
  const baseStyles = "inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
  
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseStyles} bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />}
      {children}
    </button>
  )
}

const Card = ({ children }: any) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
    {children}
  </div>
)

const CardHeader = ({ children }: any) => (
  <div className="px-6 py-4 border-b border-gray-200">
    {children}
  </div>
)

const CardContent = ({ children }: any) => (
  <div className="px-6 py-4">
    {children}
  </div>
)

const Input = ({ label, icon: Icon, error, ...props }: any) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-2">
      {label}
    </label>
    <div className="relative">
      {Icon && (
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Icon className="h-5 w-5 text-gray-400" />
        </div>
      )}
      <input
        {...props}
        className={`block w-full ${Icon ? 'pl-10' : 'pl-3'} pr-3 py-2 border ${
          error ? 'border-red-300' : 'border-gray-300'
        } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
      />
    </div>
    {error && (
      <p className="mt-1 text-sm text-red-600">{error}</p>
    )}
  </div>
)

export function ContractStep({ onComplete }: { onComplete: (data: any) => void }) {
  const [contractTitle, setContractTitle] = useState('')
  const [contractSections, setContractSections] = useState<ContractSection[]>([])
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingContract, setLoadingContract] = useState(true)
  
  // Informações do cliente
  const [clientInfo, setClientInfo] = useState<ClientInfo>({
    fullName: '',
    email: '',
    phone: ''
  })
  
  const [errors, setErrors] = useState<Partial<ClientInfo>>({})

  useEffect(() => {
    fetchContract()
  }, [])

  const fetchContract = async () => {
    setLoadingContract(true)
    try {
      const contract = await contractStorageService.getContract()
      setContractTitle(contract.title)
      setContractSections(contract.sections.sort((a: any, b: any) => a.order - b.order))
    } catch (error) {
      console.error('Erro ao carregar contrato:', error)
    } finally {
      setLoadingContract(false)
    }
  }

  const validateForm = () => {
    const newErrors: Partial<ClientInfo> = {}

    if (!clientInfo.fullName.trim()) {
      newErrors.fullName = 'Nome completo é obrigatório'
    } else if (clientInfo.fullName.trim().split(' ').length < 2) {
      newErrors.fullName = 'Por favor, informe nome e sobrenome'
    }

    if (!clientInfo.email.trim()) {
      newErrors.email = 'E-mail é obrigatório'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientInfo.email)) {
      newErrors.email = 'E-mail inválido'
    }

    if (!clientInfo.phone.trim()) {
      newErrors.phone = 'Telefone é obrigatório'
    } else if (!/^\(?[1-9]{2}\)?\s?9?[0-9]{4}-?[0-9]{4}$/.test(clientInfo.phone.replace(/\s/g, ''))) {
      newErrors.phone = 'Telefone inválido (ex: (11) 99999-9999)'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleAgree = async () => {
    if (!validateForm()) {
      alert('Por favor, preencha todos os campos obrigatórios corretamente.')
      return
    }

    if (!agreed) {
      alert('Por favor, aceite os termos do contrato para continuar.')
      return
    }
    
    setLoading(true)
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const contractData = {
        title: contractTitle,
        sections: contractSections,
        accepted: true,
        timestamp: new Date().toISOString(),
        clientInfo: {
          fullName: clientInfo.fullName.trim(),
          email: clientInfo.email.trim().toLowerCase(),
          phone: clientInfo.phone.trim()
        }
      }
      
      onComplete(contractData)
    } catch (error) {
      console.error('Error accepting contract:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '')
    if (numbers.length <= 2) return numbers
    if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`
    if (numbers.length <= 10) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value)
    setClientInfo({ ...clientInfo, phone: formatted })
  }

  if (loadingContract) {
    return (
      <Card>
        <CardContent>
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Carregando contrato...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Informações do Cliente */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <User className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Identificação do Cliente</h2>
              <p className="text-gray-600">Preencha seus dados para identificação</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Input
              label="Nome Completo *"
              icon={User}
              type="text"
              placeholder="Ex: Maria Silva Santos"
              value={clientInfo.fullName}
              onChange={(e: any) => setClientInfo({ ...clientInfo, fullName: e.target.value })}
              error={errors.fullName}
            />

            <Input
              label="E-mail *"
              icon={Mail}
              type="email"
              placeholder="Ex: maria.silva@email.com"
              value={clientInfo.email}
              onChange={(e: any) => setClientInfo({ ...clientInfo, email: e.target.value })}
              error={errors.email}
            />

            <Input
              label="Telefone/WhatsApp *"
              icon={Phone}
              type="tel"
              placeholder="Ex: (11) 99999-9999"
              value={clientInfo.phone}
              onChange={handlePhoneChange}
              error={errors.phone}
            />

            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>Importante:</strong> Essas informações serão usadas para identificar seus documentos 
                e para que possamos entrar em contato com você sobre os resultados da análise.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contrato */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <FileText className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Termos do Contrato</h2>
              <p className="text-gray-600">Por favor, leia atentamente antes de continuar</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-50 rounded-lg p-6 max-h-96 overflow-y-auto border border-gray-200">
            <h1 className="text-xl font-bold text-center mb-6">{contractTitle}</h1>
            
            <div className="space-y-6">
              {contractSections.map((section) => (
                <div key={section.id}>
                  <h3 className="text-lg font-semibold mb-2">{section.title}</h3>
                  <div className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {section.content}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t border-gray-300">
              <p className="text-sm text-gray-600 italic">
                Ao aceitar este contrato, o cliente declara estar ciente e de acordo com todos os termos apresentados.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                id="contract-agreement"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
              />
              <label htmlFor="contract-agreement" className="text-sm text-gray-700 cursor-pointer">
                Li e concordo com todos os termos e condições apresentados neste contrato. 
                Entendo que ao prosseguir, estarei formalmente aceitando estes termos.
              </label>
            </div>

            <Button
              onClick={handleAgree}
              disabled={!agreed || !clientInfo.fullName || !clientInfo.email || !clientInfo.phone}
              loading={loading}
              className="w-full"
            >
              <Check className="h-4 w-4 mr-2" />
              Concordo e Prosseguir
            </Button>

            {(!clientInfo.fullName || !clientInfo.email || !clientInfo.phone) && (
              <p className="text-sm text-amber-600 text-center">
                ⚠️ Preencha todos os campos de identificação acima para continuar
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}