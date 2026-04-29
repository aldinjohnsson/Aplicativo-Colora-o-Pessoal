// src/services/cleanupService.ts

import { supabase } from '../lib/supabase'

interface CleanupResult {
  success: boolean
  client_id: string
  photos_deleted: number
  attachments_deleted: number
  storage_paths: string[]
  storage_cleanup_success: boolean
  errors: string[]
}

export async function cleanClientFiles(clientId: string): Promise<CleanupResult> {
  const errors: string[] = []

  try {
    console.log(`🧹 Iniciando limpeza completa para cliente: ${clientId}`)

    // 1. Executar função SQL para deletar registros e obter paths
    const { data: dbResult, error: dbError } = await supabase
      .rpc('clean_client_files', { p_client_id: clientId })

    if (dbError) {
      console.warn('⚠️ Erro ao limpar registros do banco (pode não existir):', dbError)
      // Não interrompe — continua para limpar o storage de qualquer forma
    } else {
      console.log('✅ Registros do banco deletados:', dbResult)
    }

    // 2. Limpar arquivos explícitos do storage (paths vindos do banco)
    let storageCleanupSuccess = true
    const storagePaths: string[] = dbResult?.storage_paths ?? []

    if (storagePaths.length > 0) {
      console.log(`🗑️ Limpando ${storagePaths.length} arquivos explícitos do storage...`)

      for (const path of storagePaths) {
        if (!path) continue
        try {
          const bucket = path.includes('attachments/') ? 'client-attachments' : 'client-photos'
          const { error: storageError } = await supabase.storage.from(bucket).remove([path])
          if (storageError) {
            console.warn(`⚠️ Erro ao deletar ${path}:`, storageError)
            errors.push(`Storage (${path}): ${storageError.message}`)
            storageCleanupSuccess = false
          } else {
            console.log(`✅ Arquivo deletado: ${path}`)
          }
        } catch (err) {
          console.warn(`⚠️ Exceção ao deletar ${path}:`, err)
          errors.push(`Storage (${path}): ${err}`)
          storageCleanupSuccess = false
        }
      }
    }

    // 3. Limpeza recursiva da pasta completa do cliente nos dois buckets
    // Isso garante que subpastas como /form/ também sejam deletadas
    const buckets = ['client-photos', 'client-attachments']
    for (const bucket of buckets) {
      try {
        await deleteFolderRecursive(bucket, clientId)
        console.log(`✅ Pasta ${bucket}/${clientId} limpa recursivamente`)
      } catch (err) {
        console.warn(`⚠️ Erro ao limpar pasta recursiva ${bucket}/${clientId}:`, err)
        // Não adiciona ao errors — limpeza extra, não crítica
      }
    }

    const result: CleanupResult = {
      success: errors.length === 0,
      client_id: clientId,
      photos_deleted: dbResult?.photos_deleted ?? 0,
      attachments_deleted: dbResult?.attachments_deleted ?? 0,
      storage_paths: storagePaths,
      storage_cleanup_success: storageCleanupSuccess,
      errors,
    }

    console.log('🎉 Limpeza concluída:', result)
    return result
  } catch (error) {
    console.error('❌ Erro na limpeza:', error)
    return {
      success: false,
      client_id: clientId,
      photos_deleted: 0,
      attachments_deleted: 0,
      storage_paths: [],
      storage_cleanup_success: false,
      errors: [String(error)],
    }
  }
}

// ─── Recursivo: lista tudo dentro de um path e deleta ────────────────────────
// Isso resolve o problema da pasta /form/ que fica dentro de client-photos/{clientId}/
async function deleteFolderRecursive(bucket: string, path: string): Promise<void> {
  try {
    const { data: items, error } = await supabase.storage.from(bucket).list(path, {
      limit: 1000,
      offset: 0,
    })

    if (error || !items || items.length === 0) return

    // Supabase: itens com metadata !== null são arquivos; sem metadata (ou id null) são pastas
    const files = items.filter(item => item.id != null)
    const folders = items.filter(item => item.id == null)

    // Deleta arquivos deste nível
    if (files.length > 0) {
      const filePaths = files.map(f => `${path}/${f.name}`)
      const { error: removeError } = await supabase.storage.from(bucket).remove(filePaths)
      if (removeError) {
        console.warn(`⚠️ Erro ao remover arquivos em ${bucket}/${path}:`, removeError)
      } else {
        console.log(`🗑️ ${filePaths.length} arquivo(s) removido(s) de ${bucket}/${path}`)
      }
    }

    // Entra em cada subpasta recursivamente (ex: /form/, /attachments/)
    for (const folder of folders) {
      await deleteFolderRecursive(bucket, `${path}/${folder.name}`)
    }
  } catch (err) {
    console.warn(`⚠️ Erro ao processar ${bucket}/${path}:`, err)
  }
}

// ─── Verifica inconsistências (opcional, para diagnóstico) ───────────────────
export async function checkOrphanedFiles() {
  const { data, error } = await supabase.from('orphaned_files_check').select('*')
  if (error) {
    console.error('Erro ao verificar arquivos órfãos:', error)
    return null
  }
  return data
}