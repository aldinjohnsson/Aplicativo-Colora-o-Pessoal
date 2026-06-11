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

    // 2. Supabase Storage: NÃO limpamos mais. Todas as fotos/arquivos novos
    // vivem no Google Drive do admin (a limpeza do Drive é feita pelo edge
    // `drive` — rota /cleanup — e pela exclusão da pasta da cliente).
    // O RPC acima continua removendo os REGISTROS do banco normalmente.
    const storageCleanupSuccess = true
    const storagePaths: string[] = dbResult?.storage_paths ?? []

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

// ─── Verifica inconsistências (opcional, para diagnóstico) ───────────────────
export async function checkOrphanedFiles() {
  const { data, error } = await supabase.from('orphaned_files_check').select('*')
  if (error) {
    console.error('Erro ao verificar arquivos órfãos:', error)
    return null
  }
  return data
}