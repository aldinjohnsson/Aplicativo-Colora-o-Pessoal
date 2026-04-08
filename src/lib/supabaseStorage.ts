// src/lib/supabaseStorage.ts - VERSÃO CORRIGIDA
import { supabase } from './supabase'

export interface ClientInfo {
  fullName: string
  email: string
  phone: string
}

export interface StoredPhoto {
  id: string
  clientId: string
  photoName: string
  photoType: string
  photoSize: number
  storagePath: string
  uploadedAt: string
  url?: string
}

export interface StoredAttachment {
  id: string
  clientId: string
  attachmentName: string
  attachmentType: string
  attachmentSize: number
  storagePath: string
  uploadedAt: string
  url?: string
}

export interface UploadProgress {
  fileName: string
  progress: number
  total: number
  uploaded: number
}

const BUCKET_NAME = 'client-files'

class SupabaseStorageService {
  /**
   * Gera um ID único para o cliente
   */
  generateClientId(email: string): string {
    const timestamp = Date.now()
    const emailHash = email.toLowerCase().replace(/[^a-z0-9]/g, '')
    return `${emailHash}_${timestamp}`
  }

  /**
   * Salva os dados completos do cliente no Supabase
   */
  async saveClientData(data: {
    clientInfo: ClientInfo
    contractData: any
    formData: any
    formAttachments: File[]
    photos: File[]
  }, onProgress?: (progress: UploadProgress) => void): Promise<string> {
    try {
      console.log('🚀 Iniciando salvamento no Supabase...')
      console.log('📋 Dados do cliente:', {
        nome: data.clientInfo.fullName,
        email: data.clientInfo.email,
        fotos: data.photos.length,
        anexos: data.formAttachments.length
      })

      const clientId = this.generateClientId(data.clientInfo.email)
      console.log('🆔 Client ID gerado:', clientId)
      
      // 1. Salvar dados do cliente na tabela
      console.log('💾 Salvando dados do cliente na tabela...')

      const { data: insertedData, error: clientError } = await supabase
        .from('client_data')
        .insert({
          client_id: clientId,
          full_name: data.clientInfo.fullName,
          email: data.clientInfo.email.toLowerCase(),
          phone: data.clientInfo.phone,
          contract_data: data.contractData,
          form_data: data.formData,
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .select()

      if (clientError) {
        console.error('❌ Erro ao salvar cliente:', clientError)
        throw new Error(`Erro ao salvar dados do cliente: ${clientError.message}`)
      }

      console.log('✅ Cliente salvo com sucesso!')

      // 2. Upload de fotos
      if (data.photos.length > 0) {
        console.log(`📸 Iniciando upload de ${data.photos.length} fotos...`)
        await this.uploadPhotos(clientId, data.photos, onProgress)
        console.log('✅ Fotos enviadas com sucesso!')

        // Verificar fotos salvas
        const { data: verifyPhotos } = await supabase
          .from('client_photos')
          .select('count')
          .eq('client_id', clientId)

        console.log('🔍 Fotos salvas no banco:', verifyPhotos)
      } else {
        console.log('⚠️ Nenhuma foto para fazer upload')
      }

      // 3. Upload de anexos do formulário
      if (data.formAttachments.length > 0) {
        console.log(`📎 Iniciando upload de ${data.formAttachments.length} anexos...`)
        await this.uploadAttachments(clientId, data.formAttachments, onProgress)
        console.log('✅ Anexos enviados com sucesso!')
      }

      console.log('🎉 Salvamento completo no Supabase!')
      return clientId
    } catch (error: any) {
      console.error('❌ ERRO COMPLETO ao salvar no Supabase:', error)
      
      let errorMessage = 'Erro ao salvar dados no servidor.'
      
      if (error.message?.includes('client_data')) {
        errorMessage = 'Erro ao salvar informações do cliente. Verifique se a tabela "client_data" existe no banco de dados.'
      } else if (error.message?.includes('client_photos')) {
        errorMessage = 'Erro ao salvar fotos. Verifique se a tabela "client_photos" existe no banco de dados.'
      } else if (error.message?.includes('client_attachments')) {
        errorMessage = 'Erro ao salvar anexos. Verifique se a tabela "client_attachments" existe no banco de dados.'
      } else if (error.message?.includes('storage')) {
        errorMessage = 'Erro ao fazer upload dos arquivos. Verifique as permissões do bucket "client-files".'
      }
      
      throw new Error(errorMessage + '\n\nDetalhes técnicos: ' + error.message)
    }
  }

  /**
   * Upload de fotos para o Supabase Storage
   */
  private async uploadPhotos(
    clientId: string,
    photos: File[],
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    const total = photos.length
    const uploadedHashes = new Set<string>()

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]
      const fileHash = `${photo.name}_${photo.size}_${photo.type}`

      if (uploadedHashes.has(fileHash)) {
        console.log(`⚠️ Arquivo duplicado detectado e ignorado:`, photo.name)
        continue
      }

      uploadedHashes.add(fileHash)
      const timestamp = Date.now() + Math.random()
      const fileName = `${Math.floor(timestamp)}_${photo.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const storagePath = `${clientId}/photos/${fileName}`

      console.log(`📤 Uploading foto ${i + 1}/${total}:`, {
        nome: photo.name,
        tamanho: `${(photo.size / 1024 / 1024).toFixed(2)} MB`,
        tipo: photo.type,
        path: storagePath
      })

      try {
        const { error: uploadError } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, photo, {
            contentType: photo.type,
            upsert: false,
            cacheControl: '3600'
          })

        if (uploadError) {
          console.error(`❌ Erro ao fazer upload da foto ${photo.name}:`, uploadError)
          throw new Error(`Erro ao fazer upload de ${photo.name}: ${uploadError.message}`)
        }

        console.log(`✅ Upload concluído:`, storagePath)

        // Verificar se já existe antes de inserir
        const { data: existingPhotos } = await supabase
          .from('client_photos')
          .select('id')
          .eq('storage_path', storagePath)
          .maybeSingle()

        if (!existingPhotos) {
          const { error: metadataError } = await supabase
            .from('client_photos')
            .insert({
              client_id: clientId,
              photo_name: photo.name,
              photo_type: photo.type,
              photo_size: photo.size,
              storage_path: storagePath
            })

          if (metadataError) {
            console.error(`❌ Erro ao salvar metadados da foto ${photo.name}:`, metadataError)
            throw new Error(`Erro ao salvar metadados de ${photo.name}: ${metadataError.message}`)
          }

          console.log(`✅ Metadados salvos para:`, photo.name)
        } else {
          console.log(`⚠️ Foto já existe no banco:`, storagePath)
        }

        if (onProgress) {
          onProgress({
            fileName: photo.name,
            progress: ((i + 1) / total) * 100,
            total,
            uploaded: i + 1
          })
        }
      } catch (error) {
        console.error(`❌ ERRO ao processar foto ${photo.name}:`, error)
        throw error
      }
    }
  }

  /**
   * Upload de anexos para o Supabase Storage
   */
  private async uploadAttachments(
    clientId: string,
    attachments: File[],
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    const total = attachments.length
    const uploadedHashes = new Set<string>()

    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i]
      const fileHash = `${attachment.name}_${attachment.size}_${attachment.type}`

      if (uploadedHashes.has(fileHash)) {
        console.log(`⚠️ Arquivo duplicado detectado e ignorado:`, attachment.name)
        continue
      }

      uploadedHashes.add(fileHash)
      const timestamp = Date.now() + Math.random()
      const fileName = `${Math.floor(timestamp)}_${attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const storagePath = `${clientId}/attachments/${fileName}`

      console.log(`📤 Uploading anexo ${i + 1}/${total}:`, attachment.name)

      try {
        const { error: uploadError } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, attachment, {
            contentType: attachment.type,
            upsert: false
          })

        if (uploadError) {
          console.error(`❌ Erro ao fazer upload do anexo:`, uploadError)
          throw new Error(`Erro ao fazer upload de ${attachment.name}: ${uploadError.message}`)
        }

        // Verificar se já existe
        const { data: existingAttachment } = await supabase
          .from('client_attachments')
          .select('id')
          .eq('storage_path', storagePath)
          .maybeSingle()

        if (!existingAttachment) {
          const { error: metadataError } = await supabase
            .from('client_attachments')
            .insert({
              client_id: clientId,
              attachment_name: attachment.name,
              attachment_type: attachment.type,
              attachment_size: attachment.size,
              storage_path: storagePath
            })

          if (metadataError) {
            console.error(`❌ Erro ao salvar metadados do anexo:`, metadataError)
            throw new Error(`Erro ao salvar metadados de ${attachment.name}: ${metadataError.message}`)
          }
        }

        if (onProgress) {
          onProgress({
            fileName: attachment.name,
            progress: ((i + 1) / total) * 100,
            total,
            uploaded: i + 1
          })
        }
      } catch (error) {
        console.error(`❌ ERRO ao processar anexo:`, error)
        throw error
      }
    }
  }

  /**
   * Busca todos os clientes
   */
  async getAllClients(): Promise<any[]> {
    try {
      console.log('🔍 Buscando todos os clientes...')
      
      const { data, error } = await supabase
        .from('client_data')
        .select('*')
        .order('completed_at', { ascending: false })

      if (error) {
        console.error('❌ Erro ao buscar clientes:', error)
        throw error
      }

      console.log(`✅ ${data?.length || 0} clientes encontrados`)
      return data || []
    } catch (error) {
      console.error('❌ Erro ao buscar clientes:', error)
      return []
    }
  }

  /**
   * Busca um cliente específico
   */
  async getClientData(clientId: string): Promise<any | null> {
    try {
      console.log('🔍 Buscando dados do cliente:', clientId)
      
      const { data, error } = await supabase
        .from('client_data')
        .select('*')
        .eq('client_id', clientId)
        .single()

      if (error) {
        console.error('❌ Erro ao buscar cliente:', error)
        return null
      }

      console.log('✅ Dados do cliente encontrados')
      return data
    } catch (error) {
      console.error('❌ Erro ao buscar dados do cliente:', error)
      return null
    }
  }

  /**
   * 🔥 CORREÇÃO: Busca fotos de um cliente COM DOWNLOAD dos blobs
   */
  async getClientPhotos(clientId: string): Promise<StoredPhoto[]> {
    try {
      console.log('🔍 Buscando fotos para client_id:', clientId)

      const { data, error } = await supabase
        .from('client_photos')
        .select('*')
        .eq('client_id', clientId)
        .order('uploaded_at', { ascending: true })

      if (error) {
        console.error('❌ Erro ao buscar fotos do banco:', error)
        return []
      }

      console.log(`✅ Query retornou ${data?.length || 0} fotos`)

      if (!data || data.length === 0) {
        console.warn('⚠️ Nenhuma foto encontrada no banco para:', clientId)
        return []
      }

      console.log('📸 Fotos encontradas:', data.map(p => ({ id: p.id, name: p.photo_name })))

      // ✅ CORREÇÃO: Gerar URLs públicas
      const photosWithUrls = (data || []).map((photo) => {
        const { data: urlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(photo.storage_path)

        return {
          id: photo.id,
          clientId: photo.client_id,
          photoName: photo.photo_name,
          photoType: photo.photo_type,
          photoSize: photo.photo_size,
          storagePath: photo.storage_path,
          uploadedAt: photo.uploaded_at,
          url: urlData?.publicUrl || ''
        }
      })

      console.log('✅ URLs geradas com sucesso')
      return photosWithUrls
    } catch (error) {
      console.error('❌ Erro ao buscar fotos do cliente:', error)
      return []
    }
  }

  /**
   * Busca anexos de um cliente
   */
  async getClientAttachments(clientId: string): Promise<StoredAttachment[]> {
    try {
      console.log('🔍 Buscando anexos do cliente:', clientId)
      
      const { data, error } = await supabase
        .from('client_attachments')
        .select('*')
        .eq('client_id', clientId)
        .order('uploaded_at', { ascending: true })

      if (error) throw error

      console.log(`✅ ${data?.length || 0} anexos encontrados`)

      const attachmentsWithUrls = (data || []).map((attachment) => {
        const { data: urlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(attachment.storage_path)

        return {
          id: attachment.id,
          clientId: attachment.client_id,
          attachmentName: attachment.attachment_name,
          attachmentType: attachment.attachment_type,
          attachmentSize: attachment.attachment_size,
          storagePath: attachment.storage_path,
          uploadedAt: attachment.uploaded_at,
          url: urlData?.publicUrl || ''
        }
      })

      return attachmentsWithUrls
    } catch (error) {
      console.error('❌ Erro ao buscar anexos do cliente:', error)
      return []
    }
  }

  /**
   * 🔥 CORREÇÃO: Download de uma foto específica como Blob
   */
  async downloadPhoto(storagePath: string): Promise<Blob | null> {
    try {
      console.log('⬇️ Baixando foto:', storagePath)
      
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(storagePath)

      if (error) {
        console.error('❌ Erro ao fazer download:', error)
        throw error
      }

      console.log('✅ Download concluído')
      return data
    } catch (error) {
      console.error('❌ Erro ao fazer download da foto:', error)
      return null
    }
  }

  /**
   * 🔥 CORREÇÃO: Download de todas as fotos de um cliente como arquivos File
   */
  async downloadClientPhotos(clientId: string): Promise<File[]> {
    try {
      console.log('⬇️ Baixando todas as fotos do cliente:', clientId)
      
      const photos = await this.getClientPhotos(clientId)
      console.log(`📸 ${photos.length} fotos encontradas para download`)
      
      const files: File[] = []

      for (const photo of photos) {
        console.log(`⬇️ Baixando foto: ${photo.photoName}`)
        const blob = await this.downloadPhoto(photo.storagePath)
        
        if (blob) {
          const file = new File([blob], photo.photoName, { type: photo.photoType })
          files.push(file)
          console.log(`✅ Foto baixada: ${photo.photoName} (${(blob.size / 1024).toFixed(2)} KB)`)
        } else {
          console.error(`❌ Falha ao baixar foto: ${photo.photoName}`)
        }
      }

      console.log(`✅ ${files.length} fotos baixadas com sucesso`)
      return files
    } catch (error) {
      console.error('❌ Erro ao fazer download das fotos do cliente:', error)
      return []
    }
  }

  /**
   * Download de todos os anexos de um cliente como arquivos File
   */
  async downloadClientAttachments(clientId: string): Promise<File[]> {
    try {
      const attachments = await this.getClientAttachments(clientId)
      const files: File[] = []

      for (const attachment of attachments) {
        const blob = await this.downloadPhoto(attachment.storagePath)
        if (blob) {
          const file = new File([blob], attachment.attachmentName, { 
            type: attachment.attachmentType 
          })
          files.push(file)
        }
      }

      return files
    } catch (error) {
      console.error('❌ Erro ao fazer download dos anexos do cliente:', error)
      return []
    }
  }

  /**
   * Deleta um cliente e todos os seus arquivos
   */
  async deleteClient(clientId: string): Promise<void> {
    try {
      console.log('🗑️ Deletando cliente:', clientId)
      
      // 1. Buscar todos os arquivos do cliente
      const photos = await this.getClientPhotos(clientId)
      const attachments = await this.getClientAttachments(clientId)

      // 2. Deletar arquivos do storage
      const filesToDelete = [
        ...photos.map(p => p.storagePath),
        ...attachments.map(a => a.storagePath)
      ]

      if (filesToDelete.length > 0) {
        console.log(`🗑️ Deletando ${filesToDelete.length} arquivos...`)
        const { error: storageError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove(filesToDelete)

        if (storageError) console.error('❌ Erro ao deletar arquivos:', storageError)
      }

      // 3. Deletar cliente do banco (cascade vai deletar fotos e anexos)
      const { error: deleteError } = await supabase
        .from('client_data')
        .delete()
        .eq('client_id', clientId)

      if (deleteError) throw deleteError

      console.log('✅ Cliente deletado com sucesso!')
    } catch (error) {
      console.error('❌ Erro ao deletar cliente:', error)
      throw error
    }
  }

  /**
   * Obtém estatísticas gerais
   */
  async getStats() {
    try {
      const { data: clients, error } = await supabase
        .from('client_data')
        .select('client_id')

      if (error) throw error

      const clientIds = clients?.map(c => c.client_id) || []
      
      let totalPhotos = 0
      let totalAttachments = 0

      for (const clientId of clientIds) {
        const photos = await this.getClientPhotos(clientId)
        const attachments = await this.getClientAttachments(clientId)
        totalPhotos += photos.length
        totalAttachments += attachments.length
      }

      return {
        totalClients: clients?.length || 0,
        totalPhotos,
        totalAttachments,
        totalDocuments: (clients?.length || 0) * 2
      }
    } catch (error) {
      console.error('❌ Erro ao obter estatísticas:', error)
      return {
        totalClients: 0,
        totalPhotos: 0,
        totalAttachments: 0,
        totalDocuments: 0
      }
    }
  }

  /**
   * Busca cliente por email
   */
  async getClientByEmail(email: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('client_data')
        .select('*')
        .eq('email', email.toLowerCase())
        .single()

      if (error) throw error
      return data
    } catch (error) {
      console.error('❌ Erro ao buscar cliente por email:', error)
      return null
    }
  }
}

// Exportar instância singleton
export const supabaseStorage = new SupabaseStorageService()