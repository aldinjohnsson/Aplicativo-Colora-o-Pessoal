// supabase/functions/cleanup-orphaned-storage/index.ts
//
// Apaga do Supabase Storage os arquivos ÓRFÃOS do bucket `client-photos`
// (nenhuma linha em `client_photos` aponta mais pra eles — cliente ou foto
// já foram excluídas). Diferente de um DELETE direto em `storage.objects`
// (que só apaga o metadado e mantém o arquivo físico ocupando espaço), essa
// rota usa a API de Storage — apaga metadado + blob de verdade, o que
// efetivamente libera a cota.
//
// ════════════════════════════════════════════════════════════════════════
// USO
// ════════════════════════════════════════════════════════════════════════
//   GET  /functions/v1/cleanup-orphaned-storage?dry_run=1
//        → só LISTA o que seria apagado (nada é removido), com contagem e
//          tamanho total. Sempre rode isso primeiro.
//
//   GET  /functions/v1/cleanup-orphaned-storage
//        → apaga de verdade, em lotes de 100.
//
//   Header obrigatório: x-cleanup-token: <valor da secret CLEANUP_SECRET,
//   a mesma já usada na rota /cleanup do drive>
//
// Deploy:
//   supabase functions deploy cleanup-orphaned-storage
// ════════════════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function adminSb(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const BUCKET = 'client-photos'
const BATCH_SIZE = 100

// Acha os paths órfãos: estão no Storage mas nenhuma linha de
// `client_photos` tem esse storage_path. Mesma lógica dos SELECTs de
// diagnóstico que já rodamos — só que aqui devolve os `name` prontos pra
// mandar pro storage.remove().
async function findOrphanedPaths(sb: SupabaseClient): Promise<{ path: string; size: number }[]> {
  // storage.objects não tem uma API de "list all" paginada simples via
  // client-js pra milhares de linhas — usamos SQL direto via rpc auxiliar
  // não existe por padrão, então fazemos via .schema('storage').from('objects').
  const orphaned: { path: string; size: number }[] = []
  const PAGE = 1000
  let from = 0

  while (true) {
    const { data: objects, error } = await sb
      .schema('storage')
      .from('objects')
      .select('name, metadata')
      .eq('bucket_id', BUCKET)
      .range(from, from + PAGE - 1)

    if (error) throw error
    if (!objects || objects.length === 0) break

    const names = objects.map((o: any) => o.name)

    const { data: matched, error: matchErr } = await sb
      .from('client_photos')
      .select('storage_path')
      .in('storage_path', names)

    if (matchErr) throw matchErr
    const matchedSet = new Set((matched || []).map((m: any) => m.storage_path))

    for (const o of objects) {
      if (!matchedSet.has(o.name)) {
        orphaned.push({ path: o.name, size: Number(o.metadata?.size || 0) })
      }
    }

    if (objects.length < PAGE) break
    from += PAGE
  }

  return orphaned
}

Deno.serve(async (req: Request) => {
  const token = req.headers.get('x-cleanup-token')
  if (!token || token !== env('CLEANUP_SECRET')) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dry_run') === '1'

  const sb = adminSb()

  try {
    const orphaned = await findOrphanedPaths(sb)
    const totalSize = orphaned.reduce((sum, o) => sum + o.size, 0)

    if (dryRun) {
      return new Response(JSON.stringify({
        dry_run: true,
        would_delete_count: orphaned.length,
        would_delete_size_mb: Math.round(totalSize / 1024 / 1024),
        sample: orphaned.slice(0, 20).map(o => o.path),
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    let deleted = 0
    const errors: string[] = []

    for (let i = 0; i < orphaned.length; i += BATCH_SIZE) {
      const batch = orphaned.slice(i, i + BATCH_SIZE).map(o => o.path)
      const { error } = await sb.storage.from(BUCKET).remove(batch)
      if (error) {
        errors.push(`lote ${i / BATCH_SIZE}: ${error.message}`)
      } else {
        deleted += batch.length
      }
    }

    return new Response(JSON.stringify({
      dry_run: false,
      deleted_count: deleted,
      freed_size_mb: Math.round(totalSize / 1024 / 1024),
      errors,
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Erro interno' }), { status: 500 })
  }
})
