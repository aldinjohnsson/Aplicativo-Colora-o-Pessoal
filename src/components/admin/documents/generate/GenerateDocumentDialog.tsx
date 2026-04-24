// src/components/admin/documents/generate/GenerateDocumentDialog.tsx
//
// Fluxo de geração de PDF para um cliente específico.
//
// Passos:
//   1. Escolher o template (se houver mais de um)
//   2. Sistema valida: todas as tags usadas pelo template têm valor neste cliente?
//      → se faltar, mostra a lista e bloqueia o botão "Gerar"
//   3. Usuário clica gerar → baixa o PDF base → carimba → upload → grava histórico
//   4. Ao concluir, dispara `onGenerated` com a linha criada, e o caller
//      atualiza a lista de "Documentos gerados".

import React, { useEffect, useMemo, useState } from 'react'
import {
  X, FileText, CheckCircle2, AlertCircle, Loader2,
  Tag as TagIcon, Layers, Download,
} from 'lucide-react'
import { documentsService } from '../lib/documentsService'
import { resolveTagValues } from './resolveTagValues'
import { generatePdf, TagValueResolved } from './generatePdf'
import type {
  DocumentTemplate,
  DocumentTemplateElement,
  DocumentTag,
  ClientTagValue,
  ClientGeneratedDocument,
  DocumentMapping,
} from '../types'

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

// ─── Types ────────────────────────────────────────────────────────────

interface Props {
  clientId: string
  clientName: string
  onClose: () => void
  onGenerated: (doc: ClientGeneratedDocument) => void
}

type Stage = 'loading' | 'picking' | 'ready' | 'missing' | 'generating' | 'done' | 'error'

// ─── Component ────────────────────────────────────────────────────────

export function GenerateDocumentDialog({
  clientId, clientName, onClose, onGenerated,
}: Props) {
  const [stage, setStage] = useState<Stage>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [templates, setTemplates] = useState<DocumentTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  const [elements, setElements] = useState<DocumentTemplateElement[]>([])
  const [tags, setTags] = useState<DocumentTag[]>([])
  const [values, setValues] = useState<ClientTagValue[]>([])
  const [missing, setMissing] = useState<DocumentTag[]>([])

  const [doneDoc, setDoneDoc] = useState<ClientGeneratedDocument | null>(null)

  // ── Esc fecha ─────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ── Fetch inicial: templates ativos + valores do cliente + catálogo de tags ──
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [tpls, tagList, valList] = await Promise.all([
          documentsService.listTemplates({ includeInactive: false }),
          documentsService.listTags({ includeInactive: false }),
          documentsService.listClientTagValues(clientId),
        ])
        if (cancelled) return
        setTemplates(tpls)
        setTags(tagList)
        setValues(valList)

        if (tpls.length === 0) {
          setStage('error')
          setErrorMsg('Nenhum template ativo disponível. Crie um em Documentos → Templates.')
          return
        }
        if (tpls.length === 1) {
          setSelectedTemplateId(tpls[0].id)
        } else {
          setStage('picking')
        }
      } catch (e: any) {
        if (!cancelled) {
          setStage('error')
          setErrorMsg(e?.message || 'Erro ao carregar templates')
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [clientId])

  // ── Ao selecionar template: carrega elementos e valida ────────────
  useEffect(() => {
    if (!selectedTemplateId) return
    let cancelled = false
    async function check() {
      setStage('loading')
      setErrorMsg(null)
      try {
        const els = await documentsService.listTemplateElements(selectedTemplateId!)
        if (cancelled) return
        setElements(els)

        if (els.length === 0) {
          setStage('error')
          setErrorMsg('Este template ainda não tem tags posicionadas. Abra o editor e adicione elementos.')
          return
        }

        const { missing } = await resolveTagValues({
          elements: els, tags, values,
        })
        if (cancelled) return

        setMissing(missing)
        setStage(missing.length === 0 ? 'ready' : 'missing')
      } catch (e: any) {
        if (!cancelled) {
          setStage('error')
          setErrorMsg(e?.message || 'Erro ao carregar elementos do template')
        }
      }
    }
    check()
    return () => { cancelled = true }
  }, [selectedTemplateId, tags, values])

  const selectedTemplate = useMemo(
    () => templates.find(t => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  )

  // ── Ação: gerar o PDF ────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedTemplate) return
    setStage('generating')
    setErrorMsg(null)

    try {
      // Resolve valores + baixa imagens
      const { resolved, missing } = await resolveTagValues({
        elements, tags, values,
      })
      if (missing.length > 0) {
        // Corrida: alguém esvaziou valor; reavalia.
        setMissing(missing)
        setStage('missing')
        return
      }

      // Baixa o PDF base
      const baseBlob = await documentsService.downloadBaseTemplate(selectedTemplate.base_pdf_path)
      const baseBytes = await baseBlob.arrayBuffer()
      if (!baseBytes || baseBytes.byteLength === 0) {
        throw new Error('O PDF base está vazio no storage.')
      }

      // Gera
      const blob = await generatePdf({
        template: selectedTemplate,
        elements,
        values: resolved,
        basePdfBytes: baseBytes,
      })

      // Monta mappings pra histórico
      const mappings = buildMappings(elements, resolved)
      const fileName = buildFileName(selectedTemplate.name, clientName)

      const doc = await documentsService.saveGeneratedDocument({
        clientId, templateId: selectedTemplate.id, fileName, blob, mappings,
      })

      setDoneDoc(doc)
      setStage('done')
      onGenerated(doc)
    } catch (e: any) {
      console.error('Falha na geração', e)
      setStage('error')
      setErrorMsg(e?.message || 'Erro ao gerar o documento')
    }
  }

  // ── Ação: baixar o que foi gerado ────────────────────────────────
  const handleDownload = async () => {
    if (!doneDoc) return
    try {
      const blob = await documentsService.downloadGeneratedDoc(doneDoc.storage_path)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = doneDoc.file_name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e?.message || 'Erro ao baixar')
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="h-4 w-4 text-rose-500" /> Gerar documento
            </p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">Para: {clientName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">
          {stage === 'loading' && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 text-rose-400 animate-spin" />
            </div>
          )}

          {stage === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-700">Não foi possível continuar</p>
                <p className="text-xs text-red-600 mt-1">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* Seleção de template (>1 ativo) */}
          {(stage === 'picking' || (stage === 'ready' || stage === 'missing') && templates.length > 1) && (
            <div className="mb-5">
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                Template
              </label>
              <select
                value={selectedTemplateId ?? ''}
                onChange={e => setSelectedTemplateId(e.target.value || null)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
              >
                {!selectedTemplateId && <option value="">— Escolha um template —</option>}
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.page_count} pág.)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Resumo do template escolhido */}
          {selectedTemplate && (stage === 'ready' || stage === 'missing' || stage === 'generating') && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center flex-shrink-0">
                <Layers className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{selectedTemplate.name}</p>
                <p className="text-xs text-gray-500">
                  {selectedTemplate.page_count} página{selectedTemplate.page_count !== 1 ? 's' : ''}
                  {' · '}
                  {elements.length} elemento{elements.length !== 1 ? 's' : ''} posicionado{elements.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}

          {/* Tags em falta */}
          {stage === 'missing' && missing.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-900">
                    {missing.length} tag{missing.length !== 1 ? 's' : ''} sem valor preenchido
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Feche este diálogo e preencha os valores na seção
                    "Valores das tags para este cliente" — depois tente gerar novamente.
                  </p>
                </div>
              </div>
              <ul className="space-y-1 mt-3">
                {missing.map(t => (
                  <li key={t.id} className="flex items-center gap-2 text-sm text-amber-900">
                    <TagIcon className="h-3.5 w-3.5 text-amber-500" />
                    <span className="font-medium">{t.name}</span>
                    <span className="text-[11px] text-amber-600">
                      ({t.type === 'image' ? 'imagem' : 'texto'})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pronto pra gerar */}
          {stage === 'ready' && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-green-800">
                Todas as tags usadas neste template têm valor preenchido. Pode gerar.
              </p>
            </div>
          )}

          {/* Gerando */}
          {stage === 'generating' && (
            <div className="py-6 text-center">
              <Loader2 className="h-8 w-8 text-rose-400 animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">Gerando PDF...</p>
              <p className="text-xs text-gray-500 mt-1">
                Baixando template, embutindo fontes e carimbando os elementos.
              </p>
            </div>
          )}

          {/* Concluído */}
          {stage === 'done' && doneDoc && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-900">Documento gerado!</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    O PDF está salvo no histórico deste cliente.
                  </p>
                </div>
              </div>
              <div className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{doneDoc.file_name}</p>
                  <p className="text-xs text-gray-500">
                    {doneDoc.file_size ? `${(doneDoc.file_size / 1024).toFixed(1)} KB` : ''}
                  </p>
                </div>
                <Btn variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-3.5 w-3.5" /> Baixar
                </Btn>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
          {stage === 'done' ? (
            <Btn variant="primary" onClick={onClose}>
              Fechar
            </Btn>
          ) : (
            <>
              <Btn variant="outline" onClick={onClose} disabled={stage === 'generating'}>
                Cancelar
              </Btn>
              <Btn
                variant="primary"
                onClick={handleGenerate}
                loading={stage === 'generating'}
                disabled={
                  stage === 'loading' ||
                  stage === 'error' ||
                  stage === 'picking' ||
                  stage === 'missing' ||
                  stage === 'generating' ||
                  !selectedTemplate
                }
              >
                {stage === 'generating' ? 'Gerando...' : 'Gerar PDF'}
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

function buildMappings(
  elements: DocumentTemplateElement[],
  resolved: Record<string, TagValueResolved>,
): DocumentMapping[] {
  const seen = new Set<string>()
  const out: DocumentMapping[] = []
  for (const el of elements) {
    if (seen.has(el.tag_id)) continue
    seen.add(el.tag_id)
    const r = resolved[el.tag_id]
    if (!r) continue
    out.push({
      tag_id: el.tag_id,
      source: r.kind === 'text' ? 'manual' : 'photo_id',
      value: r.kind === 'text' ? (r.text || '') : (r.tag.name),
    })
  }
  return out
}

function buildFileName(templateName: string, clientName: string): string {
  const clean = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
     .replace(/[^a-zA-Z0-9 _-]+/g, '')
     .trim().replace(/\s+/g, '_')
     .slice(0, 40)
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  return `${clean(templateName)}_${clean(clientName)}_${stamp}.pdf`
}
