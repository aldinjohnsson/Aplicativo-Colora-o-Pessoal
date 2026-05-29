// src/components/admin/iris-analysis/IrisTextTemplateFormDialog.tsx
import { useEffect, useState } from 'react'
import { AVAILABLE_FONTS, FontFamily, IrisTextTemplate } from './types'

interface Props {
  open: boolean
  /** Quando definido, está em modo edição. Quando null, modo criação. */
  initial: IrisTextTemplate | null
  onClose: () => void
  onSubmit: (data: {
    name: string
    title: string
    body: string
    fontFamily: FontFamily
    textColor: string
    bgColor: string
    titleSize: number
    bodySize: number
  }) => Promise<void> | void
}

const EMPTY = {
  name: '',
  title: 'ANÁLISE DA ÍRIS',
  body: '',
  fontFamily: 'Playfair Display' as FontFamily,
  textColor: '#2b2b2b',
  bgColor: '#f7f3ee',
  titleSize: 28,
  bodySize: 18,
}

export function IrisTextTemplateFormDialog({ open, initial, onClose, onSubmit }: Props) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setForm({
        name: initial.name,
        title: initial.title,
        body: initial.body,
        fontFamily: initial.fontFamily,
        textColor: initial.textColor,
        bgColor: initial.bgColor,
        titleSize: initial.titleSize,
        bodySize: initial.bodySize,
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, initial])

  if (!open) return null

  const valid = form.name.trim().length > 0 && form.body.trim().length > 0

  const handleSubmit = async () => {
    if (!valid) return
    setSaving(true)
    try {
      await onSubmit(form)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            {initial ? 'Editar texto padrão' : 'Novo texto padrão'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <Field label="Nome do template">
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Íris neutra castanha média"
              className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400"
            />
          </Field>

          <Field label="Título">
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400"
            />
          </Field>

          <Field label="Corpo">
            <textarea
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              rows={6}
              className="block w-full resize-y rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400"
            />
          </Field>

          <Field label="Fonte">
            <select
              value={form.fontFamily}
              onChange={e => setForm(f => ({ ...f, fontFamily: e.target.value as FontFamily }))}
              className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400"
            >
              {AVAILABLE_FONTS.map(f => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cor do texto">
              <div className="flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1.5">
                <input
                  type="color"
                  value={form.textColor}
                  onChange={e => setForm(f => ({ ...f, textColor: e.target.value }))}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={form.textColor}
                  onChange={e => setForm(f => ({ ...f, textColor: e.target.value }))}
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                />
              </div>
            </Field>

            <Field label="Cor do fundo">
              <div className="flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1.5">
                <input
                  type="color"
                  value={form.bgColor}
                  onChange={e => setForm(f => ({ ...f, bgColor: e.target.value }))}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={form.bgColor}
                  onChange={e => setForm(f => ({ ...f, bgColor: e.target.value }))}
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                />
              </div>
            </Field>

            <Field label="Tamanho do título (px)">
              <input
                type="number"
                min={18}
                max={56}
                value={form.titleSize}
                onChange={e => setForm(f => ({ ...f, titleSize: parseInt(e.target.value) || 0 }))}
                className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Tamanho do corpo (px)">
              <input
                type="number"
                min={12}
                max={28}
                value={form.bodySize}
                onChange={e => setForm(f => ({ ...f, bodySize: parseInt(e.target.value) || 0 }))}
                className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </Field>
          </div>

          {/* Mini preview do card */}
          <Field label="Pré-visualização">
            <div
              className="rounded-xl px-5 py-4 border"
              style={{ background: form.bgColor, borderColor: '#e5e7eb' }}
            >
              <p
                className="font-bold leading-tight mb-2 truncate"
                style={{
                  color: form.textColor,
                  fontFamily: form.fontFamily,
                  fontSize: Math.min(form.titleSize, 22),
                }}
              >
                {form.title || 'ANÁLISE DA ÍRIS'}
              </p>
              <p
                className="leading-snug line-clamp-3"
                style={{
                  color: form.textColor,
                  fontFamily: form.fontFamily,
                  fontSize: Math.min(form.bodySize, 14),
                  opacity: 0.85,
                }}
              >
                {form.body || 'Prévia do texto aparece aqui…'}
              </p>
            </div>
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || saving}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      {children}
    </div>
  )
}