// scripts/cleanupOrphaned.ts
import { supabase } from '../lib/supabase'
import { cleanClientFiles, checkOrphanedFiles } from '../services/cleanupService'

async function cleanupAllOrphaned() {
  console.log('🔍 Verificando arquivos órfãos...')
  
  const orphaned = await checkOrphanedFiles()
  
  if (!orphaned || orphaned.length === 0) {
    console.log('✅ Nenhum arquivo órfão encontrado')
    return
  }

  console.log(`📋 Encontrados ${orphaned.length} clientes para verificar`)

  for (const client of orphaned) {
    console.log(`\n🔄 Processando: ${client.full_name} (${client.client_id})`)
    console.log(`   Fotos: ${client.photos_count}, Anexos: ${client.attachments_count}`)
    
    if (client.photos_count === 0 && client.attachments_count === 0) {
      console.log('   ⏭️ Pulando - já está limpo no banco')
      
      // Mas vamos limpar o storage por garantia
      try {
        await cleanClientFolder(client.client_id)
        console.log('   ✅ Storage verificado')
      } catch (err) {
        console.log('   ⚠️ Erro ao verificar storage:', err)
      }
      continue
    }

    try {
      const result = await cleanClientFiles(client.client_id)
      
      if (result.success) {
        console.log(`   ✅ Limpo com sucesso!`)
      } else {
        console.log(`   ⚠️ Limpeza parcial:`, result.errors)
      }
      
      // Aguardar um pouco entre clientes
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (error) {
      console.error(`   ❌ Erro:`, error)
    }
  }

  console.log('\n🎉 Limpeza concluída!')
}

// Executar
cleanupAllOrphaned()