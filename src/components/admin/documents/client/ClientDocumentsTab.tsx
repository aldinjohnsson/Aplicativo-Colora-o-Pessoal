// src/components/admin/documents/client/ClientDocumentsTab.tsx
//
// Aba "Documentos" dentro do detalhe do cliente (ClientsManager > ClientDetail).
//
// Composta por dois blocos empilhados:
//   1. ClientTagValuesPanel  — preenche os valores das tags deste cliente
//   2. Lista de documentos gerados + botão "Gerar documento" (Fase 5 ativa)

import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText, Plus, Download, ExternalLink,
  Inbox, AlertCircle, Trash2, Loader2,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import type { ClientGeneratedDocument, DocumentTemplate } from '../types'
import { ClientTagValuesPanel } from './ClientTagValuesPanel'
import { GenerateDocumentDialog } from '../generate/GenerateDocumentDialog'
import { supabase } from '../../../../lib/supabase'

// ── Btn ────────────────────────────────────────────────────────────────

const Btn = ({
  children, onClick, variant = 'primary', size = 'md',
  loading = false, disabled = false, className = '',
}: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost:   'text-gray-600 hover:bg-gray-100',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]} ${className}`}
    >
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ─── Confirm delete modal ─────────────────────────────────────────────

function ConfirmDeleteModal({
  title, message, onConfirm, onCancel, busy,
}: {
  title: string; message: string
  onConfirm: () => void; onCancel: () => void
  busy?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="font-semibold text-gray-900">{title}</p>
          <p className="text-sm text-gray-500 mt-1">{message}</p>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end">
          <Btn variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Btn>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
            Excluir
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────

interface Props {
  clientId: string
}

// ─── Component ────────────────────────────────────────────────────────

export function ClientDocumentsTab({ clientId }: Props) {
  const navigate = useNavigate()

  const [clientName, setClientName] = useState<string>('')
  const [docs, setDocs] = useState<ClientGeneratedDocument[]>([])
  const [templates, setTemplates] = useState<DocumentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [showGenerate, setShowGenerate] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ClientGeneratedDocument | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [d, t, clientRes] = await Promise.all([
        documentsService.listGeneratedForClient(clientId),
        documentsService.listTemplates(),
        supabase.from('clients').select('full_name').eq('id', clientId).single(),
      ])
      setDocs(d)
      setTemplates(t)
      setClientName((clientRes.data as any)?.full_name || '')
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar documentos')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { loadAll() }, [loadAll])

  const hasTemplates = templates.length > 0

  const handleGenerated = (doc: ClientGeneratedDocument) => {
    setDocs(prev => [doc, ...prev])
  }

  const handleDownload = async (doc: ClientGeneratedDocument) => {
    setDownloadingId(doc.id)
    try {
      const blob = await documentsService.downloadGeneratedDoc(doc.storage_path)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.file_name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e?.message || 'Erro ao baixar documento')
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await documentsService.deleteGeneratedDocument(pendingDelete)
      setDocs(prev => prev.filter(d => d.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (e: any) {
      alert(e?.message || 'Erro ao excluir documento')
    } finally {
      setDeleting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-3xl">
      {/* ═══ Bloco 1: valores das tags ═══ */}
      <ClientTagValuesPanel clientId={clientId} />

      {/* ═══ Bloco 2: documentos gerados ═══ */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="h-4 w-4 text-rose-500" />
              Documentos gerados
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {hasTemplates
                ? `${templates.length} template${templates.length !== 1 ? 's' : ''} disponíve${templates.length !== 1 ? 'is' : 'l'} para geração`
                : 'Nenhum template disponível'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Btn variant="outline" size="sm" onClick={() => navigate('/admin/documents')}>
              <ExternalLink className="h-3.5 w-3.5" /> Gerenciar tags e templates
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              onClick={() => setShowGenerate(true)}
              disabled={!hasTemplates}
            >
              <Plus className="h-3.5 w-3.5" /> Gerar documento
            </Btn>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 text-rose-400 animate-spin" />
            </div>
          ) : docs.length === 0 ? (
            <div className="border border-dashed border-gray-300 rounded-xl p-8 text-center">
              <Inbox className="h-5 w-5 text-gray-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-700">Nenhum documento gerado</p>
              <p className="text-xs text-gray-500 mt-1">
                Preencha as tags acima, escolha um template e clique em "Gerar documento".
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map(doc => {
                const templateName = templates.find(t => t.id === doc.template_id)?.name
                return (
                  <div key={doc.id} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center flex-shrink-0">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{doc.file_name}</p>
                      <p className="text-xs text-gray-500">
                        {templateName ? `${templateName} · ` : ''}
                        Gerado em {new Date(doc.generated_at).toLocaleString('pt-BR')}
                        {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)} KB` : ''}
                      </p>
                    </div>
                    <Btn
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(doc)}
                      loading={downloadingId === doc.id}
                    >
                      <Download className="h-3.5 w-3.5" /> Baixar
                    </Btn>
                    <button
                      onClick={() => setPendingDelete(doc)}
                      title="Excluir"
                      className="p-2 rounded-lg text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Modais */}
      {showGenerate && (
        <GenerateDocumentDialog
          clientId={clientId}
          clientName={clientName || 'Cliente'}
          onClose={() => setShowGenerate(false)}
          onGenerated={handleGenerated}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteModal
          title="Excluir documento?"
          message={`"${pendingDelete.file_name}" será removido permanentemente. Esta ação não pode ser desfeita.`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
          busy={deleting}
        />
      )}
    </div>
  )
}