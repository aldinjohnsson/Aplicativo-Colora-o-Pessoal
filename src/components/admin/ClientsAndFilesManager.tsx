import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'
import { 
  User,
  Mail,
  Phone,
  Calendar,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Download,
  Eye,
  Search,
  CheckCircle,
  Circle,
  Trash2,
  Package,
  Filter,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { clientDataStorage, type StoredClientData } from '../../lib/clientDataStorage'
import jsPDF from 'jspdf'
import { generateFormPDF, downloadFormPDF } from '../../lib/formPDFGenerator'
import { PhotoGallery } from './PhotoGallery'

type DeliveryStatus = 'pending' | 'delivered'
type SortOption = 'newest' | 'oldest' | 'pending' | 'delivered'

interface ClientWithDelivery extends StoredClientData {
  deliveryStatus: DeliveryStatus
  deliveredAt?: string
}

export function ClientsAndFilesManager() {
  const [clients, setClients] = useState<ClientWithDelivery[]>([])
  const [expandedClient, setExpandedClient] = useState<string | null>(null)
  const [clientFiles, setClientFiles] = useState<{ [key: string]: { attachments: File[], photos: File[] } }>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'delivered'>('all')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    delivered: 0
  })

  useEffect(() => {
    loadClients()
  }, [])

  useEffect(() => {
    updateStats()
  }, [clients])

  const loadClients = async () => {
    setLoading(true)
    try {
      const data = await clientDataStorage.getAllClients()
      
      // Carregar status de entrega do storage
      const clientsWithDelivery = await Promise.all(
        data.map(async (client) => {
          const deliveryData = await getDeliveryStatus(client.id)
          return {
            ...client,
            deliveryStatus: deliveryData.status,
            deliveredAt: deliveryData.deliveredAt
          }
        })
      )
      
      setClients(clientsWithDelivery)
    } catch (error) {
      console.error('Erro ao carregar clientes:', error)
    } finally {
      setLoading(false)
    }
  }

  const getDeliveryStatus = async (clientId: string): Promise<{ status: DeliveryStatus, deliveredAt?: string }> => {
    try {
      const storageKey = `client-${clientId}-delivery`
      let jsonData: string | null = null
      
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          const result = await (window as any).storage.get(storageKey, true)
          if (result && result.value) {
            jsonData = result.value
          }
        } catch (e) {
          jsonData = localStorage.getItem(storageKey)
        }
      } else {
        jsonData = localStorage.getItem(storageKey)
      }
      
      if (jsonData) {
        return JSON.parse(jsonData)
      }
      
      return { status: 'pending' }
    } catch (error) {
      return { status: 'pending' }
    }
  }

  const saveDeliveryStatus = async (clientId: string, status: DeliveryStatus) => {
    try {
      const storageKey = `client-${clientId}-delivery`
      const data = {
        status,
        deliveredAt: status === 'delivered' ? new Date().toISOString() : undefined
      }
      
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          await (window as any).storage.set(storageKey, JSON.stringify(data), true)
        } catch (e) {
          localStorage.setItem(storageKey, JSON.stringify(data))
        }
      } else {
        localStorage.setItem(storageKey, JSON.stringify(data))
      }
    } catch (error) {
      console.error('Erro ao salvar status:', error)
    }
  }

  const updateStats = () => {
    setStats({
      total: clients.length,
      pending: clients.filter(c => c.deliveryStatus === 'pending').length,
      delivered: clients.filter(c => c.deliveryStatus === 'delivered').length
    })
  }

  const handleToggleExpand = async (clientId: string) => {
    if (expandedClient === clientId) {
      setExpandedClient(null)
    } else {
      setExpandedClient(clientId)
      
      // Carregar arquivos se ainda não foram carregados
      if (!clientFiles[clientId]) {
        try {
          const files = await clientDataStorage.getClientFiles(clientId)
          
          // 🔍 DEBUG - REMOVER DEPOIS DE DIAGNOSTICAR
          console.log('========== DEBUG FOTOS ==========')
          console.log('📸 Arquivos carregados:', files)
          console.log('📸 Fotos encontradas:', files?.photos)
          console.log('📸 Quantidade de fotos:', files?.photos?.length || 0)
          console.log('📎 Anexos encontrados:', files?.attachments?.length || 0)
          console.log('=================================')
          
          setClientFiles(prev => ({ ...prev, [clientId]: files }))
        } catch (error) {
          console.error('Erro ao carregar arquivos:', error)
        }
      } else {
        // 🔍 DEBUG - Arquivos já carregados
        console.log('========== DEBUG FOTOS (Cache) ==========')
        console.log('📸 Fotos (cache):', clientFiles[clientId]?.photos)
        console.log('📸 Quantidade (cache):', clientFiles[clientId]?.photos?.length || 0)
        console.log('=========================================')
      }
    }
  }

  const handleToggleDelivery = async (clientId: string) => {
    const client = clients.find(c => c.id === clientId)
    if (!client) return

    const newStatus: DeliveryStatus = client.deliveryStatus === 'pending' ? 'delivered' : 'pending'
    
    // Salvar no storage
    await saveDeliveryStatus(clientId, newStatus)
    
    // Atualizar estado local
    setClients(prev => prev.map(c => 
      c.id === clientId 
        ? { 
            ...c, 
            deliveryStatus: newStatus,
            deliveredAt: newStatus === 'delivered' ? new Date().toISOString() : undefined
          }
        : c
    ))
  }

  const handleDeleteClient = async (clientId: string, clientName: string) => {
    if (!confirm(`Tem certeza que deseja excluir o cliente "${clientName}"?\n\nTodos os dados e arquivos serão permanentemente removidos.`)) {
      return
    }

    try {
      await clientDataStorage.deleteClient(clientId)
      
      // Remover status de entrega
      const storageKey = `client-${clientId}-delivery`
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          await (window as any).storage.delete(storageKey, true)
        } catch (e) {
          localStorage.removeItem(storageKey)
        }
      } else {
        localStorage.removeItem(storageKey)
      }
      
      // Atualizar lista
      setClients(prev => prev.filter(c => c.id !== clientId))
      
      // Fechar se estava expandido
      if (expandedClient === clientId) {
        setExpandedClient(null)
      }
      
      alert('Cliente excluído com sucesso!')
    } catch (error) {
      console.error('Erro ao excluir cliente:', error)
      alert('Erro ao excluir cliente. Tente novamente.')
    }
  }

  const generateContractPDF = (client: StoredClientData): Blob => {
    const pdf = new jsPDF()
    const contractData = client.contractData
    let yPosition = 20
    const pageHeight = pdf.internal.pageSize.height
    const margin = 20
    const maxWidth = pdf.internal.pageSize.width - 2 * margin

    pdf.setFontSize(16)
    pdf.setFont('helvetica', 'bold')
    const titleLines = pdf.splitTextToSize(contractData.title || 'CONTRATO', maxWidth)
    titleLines.forEach((line: string) => {
      if (yPosition > pageHeight - margin) {
        pdf.addPage()
        yPosition = margin
      }
      pdf.text(line, margin, yPosition)
      yPosition += 8
    })

    yPosition += 10
    pdf.setFontSize(12)
    
    if (contractData.sections) {
      contractData.sections.forEach((section: any) => {
        if (yPosition > pageHeight - margin) {
          pdf.addPage()
          yPosition = margin
        }
        
        pdf.setFont('helvetica', 'bold')
        pdf.text(section.title, margin, yPosition)
        yPosition += 7

        pdf.setFont('helvetica', 'normal')
        const contentLines = pdf.splitTextToSize(section.content, maxWidth)
        contentLines.forEach((line: string) => {
          if (yPosition > pageHeight - margin) {
            pdf.addPage()
            yPosition = margin
          }
          pdf.text(line, margin, yPosition)
          yPosition += 6
        })
        yPosition += 10
      })
    }

    if (yPosition > pageHeight - 60) {
      pdf.addPage()
      yPosition = margin
    }

    yPosition += 20
    pdf.setFont('helvetica', 'bold')
    pdf.text('ACEITE DO CONTRATO', margin, yPosition)
    yPosition += 10

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.text(`Cliente: ${client.clientInfo.fullName}`, margin, yPosition)
    yPosition += 7
    pdf.text(`E-mail: ${client.clientInfo.email}`, margin, yPosition)
    yPosition += 7
    pdf.text(`Telefone: ${client.clientInfo.phone}`, margin, yPosition)
    yPosition += 7
    pdf.text(`Data de aceite: ${formatDate(contractData.timestamp)}`, margin, yPosition)
    yPosition += 7
    pdf.text('Assinatura digital: ✓ Aceito eletronicamente', margin, yPosition)

    return pdf.output('blob')
  }

  const downloadContractPDF = (client: StoredClientData) => {
    const blob = generateContractPDF(client)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${client.clientInfo.fullName.replace(/\s/g, '_')}_Contrato.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const downloadFormularioPDF = async (client: StoredClientData) => {
    try {
      // Buscar configuração do formulário
      let formConfig = null
      try {
        let jsonData: string | null = null
        
        if (typeof window !== 'undefined' && (window as any).storage) {
          try {
            const result = await (window as any).storage.get('admin-form-config', true)
            if (result && result.value) {
              jsonData = result.value
            }
          } catch (e) {
            jsonData = localStorage.getItem('admin-form-config')
          }
        } else {
          jsonData = localStorage.getItem('admin-form-config')
        }
        
        if (jsonData) {
          formConfig = JSON.parse(jsonData)
        }
      } catch (error) {
        console.error('Erro ao carregar config do formulário:', error)
      }

      downloadFormPDF(
        client.clientInfo.fullName,
        client.clientInfo.email,
        client.clientInfo.phone,
        client.formData || {},
        formConfig,
        client.completedAt
      )
    } catch (error) {
      console.error('Erro ao gerar PDF do formulário:', error)
      alert('Erro ao gerar PDF do formulário')
    }
  }

  const downloadFile = (file: File) => {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const viewFile = (file: File) => {
    const url = URL.createObjectURL(file)
    window.open(url, '_blank')
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDateShort = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  const getSortedAndFilteredClients = () => {
    let filtered = clients.filter(client => {
      const matchesSearch = 
        client.clientInfo.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.clientInfo.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.clientInfo.phone.includes(searchTerm)
      
      const matchesFilter = 
        filterStatus === 'all' || 
        client.deliveryStatus === filterStatus
      
      return matchesSearch && matchesFilter
    })

    // Ordenar
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        case 'oldest':
          return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        case 'pending':
          if (a.deliveryStatus === 'pending' && b.deliveryStatus !== 'pending') return -1
          if (a.deliveryStatus !== 'pending' && b.deliveryStatus === 'pending') return 1
          return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        case 'delivered':
          if (a.deliveryStatus === 'delivered' && b.deliveryStatus !== 'delivered') return -1
          if (a.deliveryStatus !== 'delivered' && b.deliveryStatus === 'delivered') return 1
          return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        default:
          return 0
      }
    })

    return filtered
  }

  const filteredClients = getSortedAndFilteredClients()

  if (loading) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando clientes...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Estatísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-500">Total de Clientes</p>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <User className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-500">Aguardando Entrega</p>
                <p className="text-2xl font-bold text-orange-600">{stats.pending}</p>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <Circle className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-500">Entregas Realizadas</p>
                <p className="text-2xl font-bold text-green-600">{stats.delivered}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Busca e Filtros */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Busca */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por nome, e-mail ou telefone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Filtro de Status */}
            <div className="flex items-center space-x-2">
              <Filter className="h-5 w-5 text-gray-400" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Todos</option>
                <option value="pending">Aguardando</option>
                <option value="delivered">Entregues</option>
              </select>
            </div>

            {/* Ordenação */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="newest">Mais Recentes</option>
              <option value="oldest">Mais Antigos</option>
              <option value="pending">Aguardando Primeiro</option>
              <option value="delivered">Entregues Primeiro</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Clientes */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">
            Clientes ({filteredClients.length})
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Clique em um cliente para ver os arquivos e gerenciar entregas
          </p>
        </CardHeader>
        <CardContent>
          {filteredClients.length === 0 ? (
            <div className="text-center py-12">
              <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">
                {clients.length === 0 
                  ? 'Nenhum cliente finalizou o processo ainda' 
                  : 'Nenhum cliente encontrado com esses filtros'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredClients.map((client) => {
                const isExpanded = expandedClient === client.id
                const files = clientFiles[client.id]

                return (
                  <div
                    key={client.id}
                    className="border border-gray-200 rounded-lg overflow-hidden hover:border-gray-300 transition-colors"
                  >
                    {/* Header do Cliente */}
                    <div className="bg-gray-50 p-3 sm:p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center space-x-4 flex-1">
                          {/* Checkbox de Entrega */}
                          <button
                            onClick={() => handleToggleDelivery(client.id)}
                            className="flex-shrink-0"
                          >
                            {client.deliveryStatus === 'delivered' ? (
                              <CheckCircle className="h-6 w-6 text-green-600 hover:text-green-700 transition-colors" />
                            ) : (
                              <Circle className="h-6 w-6 text-orange-500 hover:text-orange-600 transition-colors" />
                            )}
                          </button>

                          {/* Info do Cliente */}
                          <button
                            onClick={() => handleToggleExpand(client.id)}
                            className="flex items-center space-x-3 flex-1 text-left"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-gray-400" />
                            )}

                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                              <User className="h-5 w-5 text-white" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <h4 className="font-medium text-gray-900">{client.clientInfo.fullName}</h4>
                                {client.deliveryStatus === 'delivered' && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                    Entregue
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mt-1">
                                <span className="flex items-center">
                                  <Mail className="h-3 w-3 mr-1" />
                                  {client.clientInfo.email}
                                </span>
                                <span className="flex items-center">
                                  <Phone className="h-3 w-3 mr-1" />
                                  {client.clientInfo.phone}
                                </span>
                                <span className="flex items-center">
                                  <Calendar className="h-3 w-3 mr-1" />
                                  {formatDateShort(client.completedAt)}
                                </span>
                              </div>
                              {client.deliveredAt && (
                                <p className="text-xs text-green-600 mt-1">
                                  Entregue em {formatDateShort(client.deliveredAt)}
                                </p>
                              )}
                            </div>
                          </button>
                        </div>

                        {/* Botão Excluir */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClient(client.id, client.clientInfo.fullName)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Arquivos (Expandido) */}
                    {isExpanded && (
                      <div className="p-3 sm:p-4 bg-white space-y-4">
                        {/* Documentos PDF */}
                        <div>
                          <h5 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
                            <FileText className="h-4 w-4 mr-2 text-red-600" />
                            Documentos PDF
                          </h5>
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center space-x-2">
                                <FileText className="h-4 w-4 text-red-600" />
                                <span className="text-sm text-gray-700">Contrato.pdf</span>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadContractPDF(client)}
                              >
                                <Download className="h-3 w-3 mr-1" />
                                Baixar
                              </Button>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center space-x-2">
                                <FileText className="h-4 w-4 text-red-600" />
                                <span className="text-sm text-gray-700">Formulário.pdf</span>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadFormularioPDF(client)}
                              >
                                <Download className="h-3 w-3 mr-1" />
                                Baixar
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Fotos - Galeria Completa */}
                        {files && files.photos.length > 0 && (
                          <div>
                            <PhotoGallery
                              photos={files.photos.map((photo, index) => ({
                                id: `${client.id}-photo-${index}`,
                                name: photo.name,
                                blob: photo,
                                size: photo.size,
                                url: URL.createObjectURL(photo)
                              }))}
                              onDownloadAll={async () => {
                                try {
                                  const JSZip = (await import('jszip')).default
                                  const zip = new JSZip()
                                  const photosFolder = zip.folder('Fotos_Analise')

                                  if (photosFolder) {
                                    for (let i = 0; i < files.photos.length; i++) {
                                      photosFolder.file(files.photos[i].name, files.photos[i])
                                    }
                                  }

                                  const blob = await zip.generateAsync({ type: 'blob' })
                                  const url = URL.createObjectURL(blob)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = `${client.clientInfo.fullName.replace(/[^a-zA-Z0-9]/g, '_')}_Fotos.zip`
                                  document.body.appendChild(a)
                                  a.click()
                                  document.body.removeChild(a)
                                  URL.revokeObjectURL(url)
                                } catch (error) {
                                  console.error('Erro ao criar ZIP:', error)
                                }
                              }}
                            />
                          </div>
                        )}

                        {/* Anexos */}
                        {files && files.attachments.length > 0 && (
                          <div>
                            <h5 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
                              <Paperclip className="h-4 w-4 mr-2 text-purple-600" />
                              Anexos ({files.attachments.length})
                            </h5>
                            <div className="space-y-2">
                              {files.attachments.map((file, index) => (
                                <div key={index} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg">
                                  <div className="flex items-center space-x-2">
                                    <Paperclip className="h-4 w-4 text-purple-600" />
                                    <span className="text-sm text-gray-700 truncate">{file.name}</span>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => downloadFile(file)}
                                  >
                                    <Download className="h-3 w-3 mr-1" />
                                    Baixar
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}