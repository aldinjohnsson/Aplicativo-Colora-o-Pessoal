import React, { useState, useEffect } from 'react'
import {
  Users,
  Image,
  Download,
  Trash2,
  Eye,
  Search,
  FileText,
  Calendar,
  Mail,
  Phone,
  RefreshCw,
  AlertCircle,
  X
} from 'lucide-react'
import { supabaseStorage } from '../../lib/supabaseStorage'
import { PhotoGallery } from '../PhotoGallery'

interface Client {
  client_id: string
  full_name: string
  email: string
  phone: string
  contract_data: any
  form_data: any
  status: string
  completed_at: string
  created_at: string
}

export function AdminClientsView() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clientPhotos, setClientPhotos] = useState<any[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [stats, setStats] = useState({
    totalClients: 0,
    totalPhotos: 0,
    totalAttachments: 0,
    totalDocuments: 0
  })

  useEffect(() => {
    loadClients()
    loadStats()
  }, [])

  const loadClients = async () => {
    setLoading(true)
    try {
      const data = await supabaseStorage.getAllClients()
      setClients(data)
      console.log('✅ Clientes carregados:', data.length)
    } catch (error) {
      console.error('❌ Erro ao carregar clientes:', error)
      alert('Erro ao carregar clientes. Verifique o console.')
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const statsData = await supabaseStorage.getStats()
      setStats(statsData)
    } catch (error) {
      console.error('❌ Erro ao carregar estatísticas:', error)
    }
  }

  const handleViewClient = async (client: Client) => {
    setSelectedClient(client)
    setLoadingPhotos(true)
    try {
      console.log('🔍 Carregando fotos para cliente:', client.client_id)
      const photos = await supabaseStorage.getClientPhotos(client.client_id)
      console.log('📸 Fotos recuperadas:', photos)
      console.log('📊 Quantidade de fotos:', photos?.length || 0)
      if (photos && photos.length > 0) {
        console.log('🖼️ Primeira foto:', photos[0])
      }
      setClientPhotos(photos || [])
    } catch (error) {
      console.error('❌ Erro ao carregar fotos:', error)
      setClientPhotos([])
    } finally {
      setLoadingPhotos(false)
    }
  }

  const handleDeleteClient = async (client: Client) => {
    const confirmed = window.confirm(
      `Tem certeza que deseja excluir o cliente "${client.full_name}"?\n\n` +
      'Esta ação irá remover:\n' +
      '- Todos os dados do cliente\n' +
      '- Todas as fotos enviadas\n' +
      '- Todos os anexos\n' +
      '- O contrato e formulário\n\n' +
      'Esta ação não pode ser desfeita!'
    )

    if (!confirmed) return

    try {
      await supabaseStorage.deleteClient(client.client_id)
      alert('Cliente excluído com sucesso!')
      loadClients()
      loadStats()
      if (selectedClient?.client_id === client.client_id) {
        setSelectedClient(null)
      }
    } catch (error) {
      console.error('❌ Erro ao excluir cliente:', error)
      alert('Erro ao excluir cliente. Verifique o console.')
    }
  }

  const handleDownloadPhotos = async (client: Client) => {
    try {
      console.log('⬇️ Baixando fotos do cliente:', client.client_id)
      
      const photos = await supabaseStorage.downloadClientPhotos(client.client_id)
      
      if (photos.length === 0) {
        alert('Nenhuma foto encontrada para este cliente.')
        return
      }

      // Criar ZIP com as fotos
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      
      const folder = zip.folder(`${client.full_name.replace(/\s+/g, '_')}_Fotos`)
      
      photos.forEach((photo, index) => {
        folder?.file(photo.name, photo)
      })

      const blob = await zip.generateAsync({ type: 'blob' })
      
      // Download
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${client.full_name.replace(/\s+/g, '_')}_Fotos.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      console.log('✅ Download concluído!')
    } catch (error) {
      console.error('❌ Erro ao baixar fotos:', error)
      alert('Erro ao baixar fotos. Verifique o console.')
    }
  }

  const filteredClients = clients.filter(client =>
    client.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.phone.includes(searchTerm)
  )

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Carregando clientes...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-6">
            <div>
              <h1 className="text-xl sm:text-3xl font-bold text-gray-900">Clientes e Arquivos</h1>
              <p className="text-gray-600 mt-1">Gerencie todos os clientes e seus documentos</p>
            </div>
            <button
              onClick={() => {
                loadClients()
                loadStats()
              }}
              className="inline-flex items-center px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Atualizar
            </button>
          </div>

          {/* Estatísticas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total de Clientes</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{stats.totalClients}</p>
                </div>
                <Users className="h-8 w-8 text-blue-600" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total de Fotos</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{stats.totalPhotos}</p>
                </div>
                <Image className="h-8 w-8 text-purple-600" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total de Anexos</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{stats.totalAttachments}</p>
                </div>
                <FileText className="h-8 w-8 text-green-600" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total de Documentos</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{stats.totalDocuments}</p>
                </div>
                <FileText className="h-8 w-8 text-orange-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Barra de Busca */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nome, email ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Lista de Clientes */}
        {filteredClients.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">
              {searchTerm ? 'Nenhum cliente encontrado com esse termo de busca.' : 'Nenhum cliente cadastrado ainda.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredClients.map((client) => (
              <div
                key={client.client_id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      {client.full_name}
                    </h3>
                    
                    <div className="grid grid-cols-1 gap-2 text-sm text-gray-600">
                      <div className="flex items-center">
                        <Mail className="h-4 w-4 mr-2 text-gray-400" />
                        {client.email}
                      </div>
                      <div className="flex items-center">
                        <Phone className="h-4 w-4 mr-2 text-gray-400" />
                        {client.phone}
                      </div>
                      <div className="flex items-center">
                        <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                        {formatDate(client.completed_at || client.created_at)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center flex flex-wrap gap-2 mt-2 sm:mt-0 sm:ml-4">
                    <button
                      onClick={() => handleViewClient(client)}
                      className="inline-flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                      title="Ver detalhes"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Ver
                    </button>

                    <button
                      onClick={() => handleDownloadPhotos(client)}
                      className="inline-flex items-center px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                      title="Baixar fotos"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Fotos
                    </button>

                    <button
                      onClick={() => handleDeleteClient(client)}
                      className="inline-flex items-center px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                      title="Excluir cliente"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de Detalhes do Cliente */}
        {selectedClient && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
            <div className="bg-white rounded-t-2xl sm:rounded-lg w-full sm:max-w-6xl max-h-[95dvh] sm:max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 p-3 sm:p-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg sm:text-2xl font-bold text-gray-900">{selectedClient.full_name}</h2>
                  <p className="text-gray-600">{selectedClient.email}</p>
                </div>
                <button
                  onClick={() => setSelectedClient(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
                {/* Informações do Cliente */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Informações do Cliente</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-600">Telefone:</span>
                      <span className="ml-2 text-gray-900">{selectedClient.phone}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Data de Cadastro:</span>
                      <span className="ml-2 text-gray-900">{formatDate(selectedClient.created_at)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Status:</span>
                      <span className="ml-2 text-green-600 font-medium">{selectedClient.status}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Finalizado em:</span>
                      <span className="ml-2 text-gray-900">{formatDate(selectedClient.completed_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Fotos */}
                {loadingPhotos ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
                    <p className="text-gray-600">Carregando fotos...</p>
                  </div>
                ) : clientPhotos && clientPhotos.length > 0 ? (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-3">
                      Fotos ({clientPhotos.length})
                    </h3>
                    <PhotoGallery
                      photos={clientPhotos.map((photo: any) => ({
                        id: photo.id || `photo-${Math.random()}`,
                        name: photo.photo_name || 'Foto',
                        blob: new Blob(),
                        size: photo.photo_size || 0,
                        url: photo.url || ''
                      }))}
                    />
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Image className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                    <p>Nenhuma foto encontrada para este cliente.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}