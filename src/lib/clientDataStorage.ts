// src/lib/clientDataStorage.ts
import { supabaseStorage } from './supabaseStorage'

export interface ClientInfo {
  fullName: string
  email: string
  phone: string
}

export interface ClientData {
  id: string
  clientInfo: ClientInfo
  contractData: any
  formData: any
  formAttachments: File[]
  photos: File[]
  createdAt: string
  completedAt: string
  status: 'completed' | 'in_progress'
}

export interface StoredClientData {
  id: string
  clientInfo: ClientInfo
  contractData: any
  formData: any
  formAttachmentNames: string[]
  photoNames: string[]
  createdAt: string
  completedAt: string
  status: 'completed' | 'in_progress'
}

class ClientDataStorage {
  private storageKey = 'clients-data'
  private useSupabase = true // Flag para controlar se usa Supabase ou localStorage
  
  /**
   * Gera um ID único para o cliente baseado em email e timestamp
   */
  generateClientId(email: string): string {
    return supabaseStorage.generateClientId(email)
  }

  /**
   * Salva os dados completos do cliente
   * Tenta usar Supabase primeiro, com fallback para localStorage
   */
  async saveClientData(
    data: Omit<ClientData, 'id' | 'createdAt' | 'completedAt' | 'status'>,
    onProgress?: (progress: any) => void
  ): Promise<string> {
    try {
      // Tentar salvar no Supabase primeiro
      if (this.useSupabase) {
        try {
          const clientId = await supabaseStorage.saveClientData(
            {
              clientInfo: data.clientInfo,
              contractData: data.contractData,
              formData: data.formData,
              formAttachments: data.formAttachments,
              photos: data.photos
            },
            onProgress
          )
          
          console.log('✅ Dados salvos no Supabase com sucesso!')
          return clientId
        } catch (supabaseError) {
          console.error('❌ Erro ao salvar no Supabase, usando fallback para localStorage:', supabaseError)
          // Continuar para o fallback
        }
      }

      // Fallback: salvar no localStorage
      return await this.saveToLocalStorage(data)
    } catch (error) {
      console.error('Erro ao salvar dados do cliente:', error)
      throw error
    }
  }

  /**
   * Salva no localStorage (método original)
   */
  private async saveToLocalStorage(
    data: Omit<ClientData, 'id' | 'createdAt' | 'completedAt' | 'status'>
  ): Promise<string> {
    const clientId = this.generateClientId(data.clientInfo.email)
    
    const clientData: StoredClientData = {
      id: clientId,
      clientInfo: data.clientInfo,
      contractData: data.contractData,
      formData: data.formData,
      formAttachmentNames: data.formAttachments.map(f => f.name),
      photoNames: data.photos.map(f => f.name),
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'completed'
    }

    // Salvar dados estruturados
    await this.saveToStorage(`client-${clientId}`, JSON.stringify(clientData))
    
    // Salvar arquivos
    await this.saveClientFiles(clientId, data.formAttachments, data.photos)
    
    // Adicionar à lista de clientes
    await this.addToClientsList(clientId)
    
    console.log('✅ Dados salvos no localStorage com sucesso!')
    return clientId
  }

  /**
   * Salva arquivos do cliente (fotos e anexos) - localStorage
   */
  private async saveClientFiles(clientId: string, attachments: File[], photos: File[]): Promise<void> {
    try {
      // Converter arquivos para base64 para armazenamento
      const attachmentsData = await Promise.all(
        attachments.map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          data: await this.fileToBase64(file)
        }))
      )

      const photosData = await Promise.all(
        photos.map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          data: await this.fileToBase64(file)
        }))
      )

      await this.saveToStorage(`client-${clientId}-attachments`, JSON.stringify(attachmentsData))
      await this.saveToStorage(`client-${clientId}-photos`, JSON.stringify(photosData))
    } catch (error) {
      console.error('Erro ao salvar arquivos:', error)
    }
  }

  /**
   * Converte File para base64
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1]) // Remove o prefixo data:...;base64,
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  /**
   * Converte base64 de volta para File
   */
  private base64ToFile(base64: string, filename: string, type: string): File {
    const byteString = atob(base64)
    const ab = new ArrayBuffer(byteString.length)
    const ia = new Uint8Array(ab)
    
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i)
    }
    
    const blob = new Blob([ab], { type })
    return new File([blob], filename, { type })
  }

  /**
   * Adiciona cliente à lista geral
   */
  private async addToClientsList(clientId: string): Promise<void> {
    try {
      const listJson = await this.getFromStorage(this.storageKey)
      const list: string[] = listJson ? JSON.parse(listJson) : []
      
      if (!list.includes(clientId)) {
        list.push(clientId)
        await this.saveToStorage(this.storageKey, JSON.stringify(list))
      }
    } catch (error) {
      console.error('Erro ao adicionar cliente à lista:', error)
    }
  }

  /**
   * Busca todos os clientes
   * Tenta Supabase primeiro, depois localStorage
   */
  async getAllClients(): Promise<StoredClientData[]> {
    try {
      // Tentar buscar do Supabase primeiro
      if (this.useSupabase) {
        try {
          const supabaseClients = await supabaseStorage.getAllClients()
          
          if (supabaseClients && supabaseClients.length > 0) {
            return supabaseClients.map(client => ({
              id: client.client_id,
              clientInfo: {
                fullName: client.full_name,
                email: client.email,
                phone: client.phone
              },
              contractData: client.contract_data,
              formData: client.form_data,
              formAttachmentNames: [], // Será preenchido quando necessário
              photoNames: [], // Será preenchido quando necessário
              createdAt: client.created_at,
              completedAt: client.completed_at,
              status: client.status
            }))
          }
        } catch (supabaseError) {
          console.error('Erro ao buscar do Supabase, tentando localStorage:', supabaseError)
        }
      }

      // Fallback: buscar do localStorage
      return await this.getAllClientsFromLocalStorage()
    } catch (error) {
      console.error('Erro ao buscar clientes:', error)
      return []
    }
  }

  /**
   * Busca todos os clientes do localStorage
   */
  private async getAllClientsFromLocalStorage(): Promise<StoredClientData[]> {
    const listJson = await this.getFromStorage(this.storageKey)
    const list: string[] = listJson ? JSON.parse(listJson) : []
    
    const clients: StoredClientData[] = []
    
    for (const clientId of list) {
      const clientJson = await this.getFromStorage(`client-${clientId}`)
      if (clientJson) {
        clients.push(JSON.parse(clientJson))
      }
    }
    
    // Ordenar por data de conclusão (mais recente primeiro)
    return clients.sort((a, b) => 
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    )
  }

  /**
   * Busca um cliente específico por ID
   */
  async getClientById(clientId: string): Promise<StoredClientData | null> {
    try {
      // Tentar buscar do Supabase primeiro
      if (this.useSupabase) {
        try {
          const client = await supabaseStorage.getClientById(clientId)
          
          if (client) {
            return {
              id: client.client_id,
              clientInfo: {
                fullName: client.full_name,
                email: client.email,
                phone: client.phone
              },
              contractData: client.contract_data,
              formData: client.form_data,
              formAttachmentNames: [],
              photoNames: [],
              createdAt: client.created_at,
              completedAt: client.completed_at,
              status: client.status
            }
          }
        } catch (supabaseError) {
          console.error('Erro ao buscar do Supabase:', supabaseError)
        }
      }

      // Fallback: buscar do localStorage
      const clientJson = await this.getFromStorage(`client-${clientId}`)
      return clientJson ? JSON.parse(clientJson) : null
    } catch (error) {
      console.error('Erro ao buscar cliente:', error)
      return null
    }
  }

  /**
   * Busca arquivos de um cliente
   */
  async getClientFiles(clientId: string): Promise<{
    attachments: File[]
    photos: File[]
  }> {
    try {
      // Tentar buscar do Supabase primeiro
      if (this.useSupabase) {
        try {
          const [photos, attachments] = await Promise.all([
            supabaseStorage.downloadClientPhotos(clientId),
            supabaseStorage.downloadClientAttachments(clientId)
          ])
          
          if (photos.length > 0 || attachments.length > 0) {
            return { attachments, photos }
          }
        } catch (supabaseError) {
          console.error('Erro ao buscar arquivos do Supabase:', supabaseError)
        }
      }

      // Fallback: buscar do localStorage
      return await this.getClientFilesFromLocalStorage(clientId)
    } catch (error) {
      console.error('Erro ao buscar arquivos do cliente:', error)
      return { attachments: [], photos: [] }
    }
  }

  /**
   * Busca arquivos do localStorage
   */
  private async getClientFilesFromLocalStorage(clientId: string): Promise<{
    attachments: File[]
    photos: File[]
  }> {
    const attachmentsJson = await this.getFromStorage(`client-${clientId}-attachments`)
    const photosJson = await this.getFromStorage(`client-${clientId}-photos`)
    
    const attachmentsData = attachmentsJson ? JSON.parse(attachmentsJson) : []
    const photosData = photosJson ? JSON.parse(photosJson) : []
    
    const attachments = attachmentsData.map((data: any) => 
      this.base64ToFile(data.data, data.name, data.type)
    )
    
    const photos = photosData.map((data: any) => 
      this.base64ToFile(data.data, data.name, data.type)
    )
    
    return { attachments, photos }
  }

  /**
   * Busca cliente por email
   */
  async getClientByEmail(email: string): Promise<StoredClientData | null> {
    try {
      // Tentar buscar do Supabase primeiro
      if (this.useSupabase) {
        try {
          const client = await supabaseStorage.getClientByEmail(email)
          
          if (client) {
            return {
              id: client.client_id,
              clientInfo: {
                fullName: client.full_name,
                email: client.email,
                phone: client.phone
              },
              contractData: client.contract_data,
              formData: client.form_data,
              formAttachmentNames: [],
              photoNames: [],
              createdAt: client.created_at,
              completedAt: client.completed_at,
              status: client.status
            }
          }
        } catch (supabaseError) {
          console.error('Erro ao buscar do Supabase:', supabaseError)
        }
      }

      // Fallback: buscar do localStorage
      const clients = await this.getAllClientsFromLocalStorage()
      return clients.find(c => c.clientInfo.email.toLowerCase() === email.toLowerCase()) || null
    } catch (error) {
      console.error('Erro ao buscar cliente por email:', error)
      return null
    }
  }

  /**
   * Salva no storage (com fallback)
   */
  private async saveToStorage(key: string, value: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          await (window as any).storage.set(key, value, true)
          return
        } catch (e) {
          // Fallback para localStorage
        }
      }
      localStorage.setItem(key, value)
    } catch (error) {
      console.error('Erro ao salvar no storage:', error)
      throw error
    }
  }

  /**
   * Busca do storage (com fallback)
   */
  private async getFromStorage(key: string): Promise<string | null> {
    try {
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          const result = await (window as any).storage.get(key, true)
          if (result && result.value) {
            return result.value
          }
        } catch (e) {
          // Fallback para localStorage
        }
      }
      return localStorage.getItem(key)
    } catch (error) {
      console.error('Erro ao buscar do storage:', error)
      return null
    }
  }

  /**
   * Limpa dados de um cliente
   */
  async deleteClient(clientId: string): Promise<void> {
    try {
      // Tentar deletar do Supabase primeiro
      if (this.useSupabase) {
        try {
          await supabaseStorage.deleteClient(clientId)
          console.log('✅ Cliente deletado do Supabase')
          return
        } catch (supabaseError) {
          console.error('Erro ao deletar do Supabase:', supabaseError)
        }
      }

      // Fallback: deletar do localStorage
      await this.deleteClientFromLocalStorage(clientId)
    } catch (error) {
      console.error('Erro ao deletar cliente:', error)
      throw error
    }
  }

  /**
   * Deleta cliente do localStorage
   */
  private async deleteClientFromLocalStorage(clientId: string): Promise<void> {
    // Remover da lista
    const listJson = await this.getFromStorage(this.storageKey)
    const list: string[] = listJson ? JSON.parse(listJson) : []
    const newList = list.filter(id => id !== clientId)
    await this.saveToStorage(this.storageKey, JSON.stringify(newList))
    
    // Remover dados
    if (typeof window !== 'undefined' && (window as any).storage) {
      try {
        await (window as any).storage.delete(`client-${clientId}`, true)
        await (window as any).storage.delete(`client-${clientId}-attachments`, true)
        await (window as any).storage.delete(`client-${clientId}-photos`, true)
      } catch (e) {
        localStorage.removeItem(`client-${clientId}`)
        localStorage.removeItem(`client-${clientId}-attachments`)
        localStorage.removeItem(`client-${clientId}-photos`)
      }
    } else {
      localStorage.removeItem(`client-${clientId}`)
      localStorage.removeItem(`client-${clientId}-attachments`)
      localStorage.removeItem(`client-${clientId}-photos`)
    }
  }

  /**
   * Obtém estatísticas
   */
  async getStats() {
    try {
      // Tentar buscar do Supabase primeiro
      if (this.useSupabase) {
        try {
          return await supabaseStorage.getStats()
        } catch (supabaseError) {
          console.error('Erro ao buscar stats do Supabase:', supabaseError)
        }
      }

      // Fallback: calcular do localStorage
      const clients = await this.getAllClientsFromLocalStorage()
      
      let totalPhotos = 0
      let totalAttachments = 0
      
      for (const client of clients) {
        totalPhotos += client.photoNames.length
        totalAttachments += client.formAttachmentNames.length
      }
      
      return {
        totalClients: clients.length,
        totalDocuments: clients.length * 2, // Contrato + Formulário
        totalPhotos,
        totalAttachments
      }
    } catch (error) {
      console.error('Erro ao obter estatísticas:', error)
      return {
        totalClients: 0,
        totalDocuments: 0,
        totalPhotos: 0,
        totalAttachments: 0
      }
    }
  }
}

// Exportar instância singleton
export const clientDataStorage = new ClientDataStorage()