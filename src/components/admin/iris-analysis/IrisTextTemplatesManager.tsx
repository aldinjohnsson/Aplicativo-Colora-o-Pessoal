// src/components/admin/iris-analysis/IrisTextTemplatesManager.tsx
import { useState } from 'react'
import { FontFamily, IrisTextTemplate } from './types'
import { IrisTextTemplateFormDialog } from './IrisTextTemplateFormDialog'

interface Props {
  templates: IrisTextTemplate[]
  onCreate: (data: {
    name: string
    title: string
    body: string
    fontFamily: FontFamily
    textColor: string
    bgColor: string
    titleSize: number
    bodySize: number
  }) => Promise<void> | void
  onUpdate: (
    id: string,
    data: {
      name: string
      title: string
      body: string
      fontFamily: FontFamily
      textColor: string
      bgColor: string
      titleSize: number
      bodySize: number
    },
  ) => Promise<void> | void
  onDelete: (id: string) => Promise<void> | void
}

export function IrisTextTemplatesManager({ templates, onCreate, onUpdate, onDelete }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<IrisTextTemplate | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (t: IrisTextTemplate) => {
    setEditing(t)
    setFormOpen(true)
  }

  const handleSubmit = async (data: Parameters<Props['onCreate']>[0]) => {
    if (editing) await onUpdate(editing.id, data)
    else await onCreate(data)
  }

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return
    await onDelete(confirmDeleteId)
    setConfirmDeleteId(null)
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Textos padrão · Análise da Íris</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Textos pré-prontos que aparecem como opção dentro da ferramenta de análise.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Novo texto
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-10 text-center">
          <p className="text-sm text-neutral-500">
            Nenhum texto padrão cadastrado ainda. Clique em <strong>Novo texto</strong> pra começar.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {templates.map(t => (
            <li key={t.id} className="flex items-start gap-3 py-3">
              {/* mini swatch das cores */}
              <div
                className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-neutral-200"
                style={{ background: t.bgColor }}
                title="Cor de fundo"
              >
                <span
                  className="text-xs font-bold"
                  style={{ color: t.textColor, fontFamily: t.fontFamily }}
                >
                  Aa
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-neutral-900">{t.name}</div>
                <div className="truncate text-xs text-neutral-500">{t.title}</div>
                <div className="mt-1 line-clamp-2 text-xs text-neutral-600">{t.body}</div>
              </div>

              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label="Editar"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(t.id)}
                  className="rounded-md p-1.5 text-neutral-500 hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Excluir"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <IrisTextTemplateFormDialog
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
      />

      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-neutral-900">Excluir este texto?</h3>
            <p className="mt-1 text-sm text-neutral-500">
              Essa ação não pode ser desfeita.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}