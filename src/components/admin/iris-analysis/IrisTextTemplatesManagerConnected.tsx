// src/components/admin/iris-analysis/IrisTextTemplatesManagerConnected.tsx
//
// Wrapper autônomo: carrega os templates de iris_text_templates do Supabase
// e delega o CRUD para IrisTextTemplatesManager.
//
// Onde usar: qualquer página de configuração global do sistema admin.
// Ex: coloque dentro de um painel de configurações ao lado de outros managers.
//
//   import { IrisTextTemplatesManagerConnected } from './iris-analysis/IrisTextTemplatesManagerConnected'
//   ...
//   <IrisTextTemplatesManagerConnected />

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { adminService } from '../../../lib/services'
import { IrisTextTemplatesManager } from './IrisTextTemplatesManager'
import type { FontFamily, IrisTextTemplate } from './types'

type TemplatePayload = {
  name: string; title: string; body: string
  fontFamily: FontFamily; textColor: string; bgColor: string
  titleSize: number; bodySize: number
}

export function IrisTextTemplatesManagerConnected() {
  const [templates, setTemplates] = useState<IrisTextTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await adminService.listIrisTextTemplates()
      // A tabela usa snake_case; mapeia para o type IrisTextTemplate (camelCase)
      setTemplates(
        (rows as any[]).map(r => ({
          id: r.id,
          name: r.name,
          title: r.title,
          body: r.body,
          fontFamily: r.font_family as FontFamily,
          textColor: r.text_color,
          bgColor: r.bg_color,
          titleSize: r.title_size,
          bodySize: r.body_size,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }))
      )
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar templates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (data: TemplatePayload) => {
    await adminService.createIrisTextTemplate({
      name: data.name,
      title: data.title,
      body: data.body,
      font_family: data.fontFamily,
      text_color: data.textColor,
      bg_color: data.bgColor,
      title_size: data.titleSize,
      body_size: data.bodySize,
    })
    await load()
  }

  const handleUpdate = async (id: string, data: TemplatePayload) => {
    await adminService.updateIrisTextTemplate(id, {
      name: data.name,
      title: data.title,
      body: data.body,
      font_family: data.fontFamily,
      text_color: data.textColor,
      bg_color: data.bgColor,
      title_size: data.titleSize,
      body_size: data.bodySize,
    })
    await load()
  }

  const handleDelete = async (id: string) => {
    await adminService.deleteIrisTextTemplate(id)
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-neutral-500 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando textos padrão…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm text-red-700 font-medium">Erro ao carregar</p>
          <p className="text-xs text-red-600 mt-0.5">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 text-xs text-red-700 underline"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  return (
    <IrisTextTemplatesManager
      templates={templates}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
    />
  )
}
