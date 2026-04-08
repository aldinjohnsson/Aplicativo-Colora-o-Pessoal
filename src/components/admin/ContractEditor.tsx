import React, { useState, useEffect } from 'react'
import { Save, Eye, Plus, Trash2, GripVertical, AlertCircle, CheckCircle } from 'lucide-react'

interface ContractSection {
  id: string
  title: string
  content: string
  order: number
}

// Serviço de armazenamento do contrato com fallback para localStorage
const contractStorageService = {
  async saveContract(data: { title: string; sections: ContractSection[] }) {
    try {
      const contractData = {
        title: data.title,
        sections: data.sections,
        lastUpdated: new Date().toISOString()
      }
      
      const jsonData = JSON.stringify(contractData)
      
      // Tentar usar window.storage primeiro, depois fallback para localStorage
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          await (window as any).storage.set('admin-contract', jsonData, true)
        } catch (e) {
          // Fallback para localStorage
          localStorage.setItem('admin-contract', jsonData)
        }
      } else {
        // Usar localStorage diretamente
        localStorage.setItem('admin-contract', jsonData)
      }
      
      return { success: true }
    } catch (error) {
      console.error('Erro ao salvar contrato:', error)
      throw error
    }
  },

  async getContract() {
    try {
      let jsonData: string | null = null
      
      // Tentar usar window.storage primeiro, depois fallback para localStorage
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          const result = await (window as any).storage.get('admin-contract', true)
          if (result && result.value) {
            jsonData = result.value
          }
        } catch (e) {
          // Fallback para localStorage
          jsonData = localStorage.getItem('admin-contract')
        }
      } else {
        // Usar localStorage diretamente
        jsonData = localStorage.getItem('admin-contract')
      }
      
      if (jsonData) {
        const data = JSON.parse(jsonData)
        return data
      }
      
      // Retornar contrato padrão se não houver nada salvo
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
      // Retornar padrão em caso de erro
      return {
        title: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ANÁLISE DE COLORAÇÃO PESSOAL',
        sections: [
          {
            id: '1',
            title: '1. OBJETO',
            content: 'Este contrato tem por objeto a prestação de serviços de análise de coloração pessoal.',
            order: 1
          }
        ],
        lastUpdated: new Date().toISOString()
      }
    }
  }
}

// Exportar para uso em outros componentes
if (typeof window !== 'undefined') {
  (window as any).contractStorageService = contractStorageService
}

// Componentes UI
const Button = ({ children, onClick, loading, disabled, variant = 'primary', size = 'md', className = '' }: any) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed",
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500"
  }
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm"
  }
  
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />}
      {children}
    </button>
  )
}

const Card = ({ children, className = '' }: any) => (
  <div className={`bg-white rounded-lg shadow-sm border border-gray-200 ${className}`}>
    {children}
  </div>
)

const CardHeader = ({ children }: any) => (
  <div className="px-6 py-4 border-b border-gray-200">
    {children}
  </div>
)

const CardContent = ({ children, className = '' }: any) => (
  <div className={`px-6 py-4 ${className}`}>
    {children}
  </div>
)

const Input = ({ value, onChange, placeholder, className = '' }: any) => (
  <input
    type="text"
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    className={`block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${className}`}
  />
)

export function ContractEditor() {
  const [contractTitle, setContractTitle] = useState('')
  const [sections, setSections] = useState<ContractSection[]>([])
  const [previewMode, setPreviewMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [draggedItem, setDraggedItem] = useState<string | null>(null)

  useEffect(() => {
    loadContract()
  }, [])

  const loadContract = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const contract = await contractStorageService.getContract()
      setContractTitle(contract.title || '')
      setSections(contract.sections || [])
    } catch (err) {
      console.error('Erro ao carregar contrato:', err)
      setMessage({ type: 'error', text: 'Erro ao carregar contrato. Usando valores padrão.' })
      // Usar valores padrão
      setSections([
        {
          id: '1',
          title: '1. OBJETO',
          content: 'Este contrato tem por objeto a prestação de serviços de análise de coloração pessoal.',
          order: 1
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  const addSection = () => {
    const newSection: ContractSection = {
      id: Date.now().toString(),
      title: `${sections.length + 1}. NOVA SEÇÃO`,
      content: 'Conteúdo da nova seção...',
      order: sections.length + 1
    }
    setSections([...sections, newSection])
  }

  const updateSection = (id: string, field: 'title' | 'content', value: string) => {
    setSections(sections.map(section => 
      section.id === id ? { ...section, [field]: value } : section
    ))
  }

  const deleteSection = (id: string) => {
    if (sections.length <= 1) {
      setMessage({ type: 'error', text: 'O contrato deve ter pelo menos uma seção.' })
      return
    }
    setSections(sections.filter(section => section.id !== id))
  }

  const handleDragStart = (id: string) => {
    setDraggedItem(id)
  }

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    if (draggedItem && draggedItem !== id) {
      const draggedIndex = sections.findIndex(s => s.id === draggedItem)
      const targetIndex = sections.findIndex(s => s.id === id)
      
      const newSections = [...sections]
      const [removed] = newSections.splice(draggedIndex, 1)
      newSections.splice(targetIndex, 0, removed)
      
      setSections(newSections.map((s, i) => ({ ...s, order: i + 1 })))
    }
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
  }

  const saveContract = async () => {
    if (!contractTitle.trim()) {
      setMessage({ type: 'error', text: 'O título do contrato não pode estar vazio.' })
      return
    }

    if (sections.length === 0) {
      setMessage({ type: 'error', text: 'O contrato deve ter pelo menos uma seção.' })
      return
    }

    setSaving(true)
    setMessage(null)
    
    try {
      await contractStorageService.saveContract({
        title: contractTitle,
        sections: sections
      })
      
      setMessage({ type: 'success', text: 'Contrato salvo com sucesso! As alterações já estão disponíveis para os clientes.' })
      
      // Limpar mensagem após 5 segundos
      setTimeout(() => setMessage(null), 5000)
    } catch (error) {
      console.error('Erro ao salvar:', error)
      setMessage({ type: 'error', text: 'Erro ao salvar contrato. Tente novamente.' })
    } finally {
      setSaving(false)
    }
  }

  const renderPreview = () => (
    <div className="bg-white rounded-lg p-8 border border-gray-200">
      <h1 className="text-2xl font-bold text-center mb-8">{contractTitle}</h1>
      
      <div className="space-y-6">
        {sections.sort((a, b) => a.order - b.order).map(section => (
          <div key={section.id}>
            <h3 className="text-lg font-semibold mb-2">{section.title}</h3>
            <div className="text-gray-700 whitespace-pre-wrap">{section.content}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <p className="text-sm text-gray-600 italic">
          Ao aceitar este contrato, o cliente declara estar ciente e de acordo com todos os termos apresentados.
        </p>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Carregando contrato...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (previewMode) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Visualização do Contrato</h2>
          <Button variant="outline" onClick={() => setPreviewMode(false)}>
            Voltar à Edição
          </Button>
        </div>
        {renderPreview()}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Editor de Contrato</h2>
          <p className="text-gray-600">Configure o texto do contrato que será apresentado aos clientes</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => setPreviewMode(true)}>
            <Eye className="h-4 w-4 mr-2" />
            Visualizar
          </Button>
          <Button onClick={saveContract} loading={saving} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            Salvar Alterações
          </Button>
        </div>
      </div>

      {/* Mensagens de feedback */}
      {message && (
        <div className={`rounded-lg p-4 ${
          message.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-center">
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            )}
            <p className={`text-sm ${message.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
              {message.text}
            </p>
          </div>
        </div>
      )}

      {/* Título do Contrato */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-medium text-gray-900">Título do Contrato</h3>
        </CardHeader>
        <CardContent>
          <Input
            value={contractTitle}
            onChange={(e: any) => setContractTitle(e.target.value)}
            placeholder="Digite o título do contrato"
          />
        </CardContent>
      </Card>

      {/* Seções do Contrato */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Seções do Contrato</h3>
            <Button onClick={addSection} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Seção
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sections.sort((a, b) => a.order - b.order).map((section) => (
              <div
                key={section.id}
                draggable
                onDragStart={() => handleDragStart(section.id)}
                onDragOver={(e) => handleDragOver(e, section.id)}
                onDragEnd={handleDragEnd}
                className={`bg-gray-50 rounded-lg p-4 border-2 ${
                  draggedItem === section.id ? 'border-blue-400 opacity-50' : 'border-gray-200'
                } transition-all cursor-move`}
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-2">
                    <GripVertical className="h-5 w-5 text-gray-400" />
                  </div>
                  
                  <div className="flex-1 space-y-3">
                    <Input
                      value={section.title}
                      onChange={(e: any) => updateSection(section.id, 'title', e.target.value)}
                      placeholder="Título da seção"
                      className="font-medium"
                    />
                    
                    <textarea
                      value={section.content}
                      onChange={(e) => updateSection(section.id, 'content', e.target.value)}
                      placeholder="Conteúdo da seção"
                      rows={4}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <button
                    onClick={() => deleteSection(section.id)}
                    className="text-red-500 hover:text-red-700 mt-2 transition-colors"
                    title="Deletar seção"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}

            {sections.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>Nenhuma seção adicionada ainda.</p>
                <p className="text-sm mt-2">Clique em "Adicionar Seção" para começar.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rodapé de Informações */}
      <Card>
        <CardContent className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            <strong>Dicas:</strong>
          </p>
          <ul className="text-sm text-blue-700 mt-2 space-y-1 list-disc list-inside">
            <li>Arraste as seções para reordená-las</li>
            <li>Use quebras de linha para criar listas ou parágrafos</li>
            <li>Visualize antes de salvar para conferir a formatação</li>
            <li>As alterações ficam disponíveis imediatamente para os clientes após salvar</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}