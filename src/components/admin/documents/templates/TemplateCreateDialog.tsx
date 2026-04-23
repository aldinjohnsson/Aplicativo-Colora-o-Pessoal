// src/components/admin/documents/templates/TemplateCreateDialog.tsx
//
// Modal de criação de um novo template:
//   1. Upload de um PDF (drag-drop ou file picker)
//   2. Parse instantâneo com pdfjs-dist para mostrar pré-visualização básica
//      (nº de páginas, dimensões em pt)
//   3. Campo de nome (obrigatório) + descrição (opcional) + plano (opcional)
//   4. Submit → sobe o PDF ao bucket e cria a linha em document_templates

import React, { useEffect, useRef, useState } from 'react'
import {
  X, Upload, FileText, AlertCircle, CheckCircle2, Layers,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { extractPdfMetadata, PdfBaseMetadata } from '../lib/pdfUtils'
import type { DocumentTemplate } from '../types'
import { supabase } from '../../../../lib/supabase'

// ── Btn ───────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, type = 'button', className = '',
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:   'text-gray-600 hover:bg-gray-100',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ─── Props ────────────────────────────────────────────────────────────

interface PlanLite { id: string; name: string }

interface Props {
  onClose: () => void
  onCreated: (tpl: DocumentTemplate) => void
}

// ─── Component ────────────────────────────────────────────────────────

export function TemplateCreateDialog({ onClose, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<PdfBaseMetadata | null>(null)
  const [readingPdf, setReadingPdf] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [planId, setPlanId] = useState<string>('')
  const [plans, setPlans] = useState<PlanLite[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // ── Load plans for selector ──
  useEffect(() => {
    let cancelled = false
    supabase.from('plans').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      if (!cancelled) setPlans((data || []) as PlanLite[])
    })
    return () => { cancelled = true }
  }, [])

  // ── Esc closes ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ── Read PDF metadata when file changes ──
  useEffect(() => {
    if (!file) { setMetadata(null); return }
    let cancelled = false
    setReadingPdf(true)
    setParseError(null)
    extractPdfMetadata(file)
      .then(md => { if (!cancelled) setMetadata(md) })
      .catch(e => { if (!cancelled) setParseError(e?.message || 'Não foi possível ler o PDF') })
      .finally(() => { if (!cancelled) setReadingPdf(false) })
    return () => { cancelled = true }
  }, [file])

  // Prefill nome com base no nome do arquivo (sem extensão) se estiver vazio
  useEffect(() => {
    if (file && !name.trim()) {
      const base = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
      setName(base)
      setTimeout(() => nameRef.current?.focus(), 30)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // ── File handlers ──
  const handleFileChange = (f: File | null) => {
    setParseError(null)
    setSubmitError(null)
    if (!f) { setFile(null); return }
    const isPdf = f.type.includes('pdf') || f.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { setParseError('Selecione um arquivo PDF.'); return }
    if (f.size > 25 * 1024 * 1024) { setParseError('PDF muito grande (máx. 25 MB).'); return }
    setFile(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFileChange(f)
  }

  // ── Submit ──
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setSubmitError(null)

    if (!file) { setSubmitError('Escolha um PDF.'); return }
    if (!metadata) { setSubmitError('Aguarde a leitura do PDF terminar.'); return }
    if (!name.trim()) { setSubmitError('Dê um nome para o template.'); return }

    setSubmitting(true)
    try {
      const tpl = await documentsService.createTemplate({
        name: name.trim(),
        description: description.trim() || null,
        planId: planId || null,
        file,
      })
      onCreated(tpl)
    } catch (err: any) {
      setSubmitError(err?.message || 'Erro ao criar template')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="font-semibold text-gray-900">Novo template</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Suba um PDF base. Você vai posicionar as tags em cima dele no editor.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 space-y-4 overflow-y-auto">
            {/* File picker */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={e => handleFileChange(e.target.files?.[0] || null)}
            />

            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`w-full border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  dragOver ? 'border-rose-400 bg-rose-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">Clique ou arraste um PDF</p>
                <p className="text-xs text-gray-500 mt-1">Até 25 MB · 1 ou várias páginas</p>
              </button>
            ) : (
              <div className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                <div className="h-11 w-11 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB
                    {metadata && !readingPdf && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-green-600">
                        · <CheckCircle2 className="h-3 w-3" /> {metadata.pageCount} página{metadata.pageCount !== 1 ? 's' : ''}
                        · {Math.round(metadata.pageWidthPt)}×{Math.round(metadata.pageHeightPt)} pt
                      </span>
                    )}
                    {readingPdf && <span className="ml-1.5 text-gray-400">· lendo PDF...</span>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null); setMetadata(null); setParseError(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className="text-xs text-red-600 hover:underline"
                >
                  Trocar
                </button>
              </div>
            )}

            {parseError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{parseError}</p>
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Nome <span className="text-rose-500">*</span>
              </label>
              <input
                ref={nameRef}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder='Ex: "Dossiê de Coloração — Premium"'
                maxLength={140}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Descrição <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="Para que serve este template?"
                maxLength={300}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
              />
            </div>

            {/* Plan (optional link) */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Vincular a um plano
                </span>
                <span className="text-gray-400 font-normal ml-1">(opcional)</span>
              </label>
              <select
                value={planId}
                onChange={e => setPlanId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
              >
                <option value="">— Nenhum (template global) —</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                Quando vinculado, o template pode ser reservado a clientes do plano no futuro.
              </p>
            </div>

            {submitError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{submitError}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
            <Btn variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Btn>
            <Btn
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={!file || !metadata || readingPdf || !name.trim() || submitting}
            >
              {submitting ? 'Criando...' : 'Criar template'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}
