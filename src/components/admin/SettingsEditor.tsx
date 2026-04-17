import React, { useState, useEffect } from 'react'
import { Save, CheckCircle, AlertCircle, FileText, Upload, Trash2, Mail } from 'lucide-react'
import { TagsManager } from './TagsManager'
import { PhotoTypesManager } from './PhotoTypesManager'
import { supabase } from '../../lib/supabase'

// ── Tipo de estilo do PDF ───────────────────────────────────────────────────

type PdfFontFamily = 'Helvetica' | 'Times' | 'Courier'

interface PdfStyleConfig {
  headerFont?: PdfFontFamily
  headerSize?: number
  headerColor?: string

  bodyFont?: PdfFontFamily
  bodySize?: number
  bodyColor?: string

  accentColor?: string
}

const PDF_STYLE_DEFAULTS: Required<PdfStyleConfig> = {
  headerFont:  'Helvetica',
  headerSize:  8.5,
  headerColor: '#77304F',

  bodyFont:    'Helvetica',
  bodySize:    7.5,
  bodyColor:   '#645859',

  accentColor: '#87485E',
}

interface AppSettings {
  whatsappNumber: string
  googleDriveFolderId: string
  enableWhatsAppNotification: boolean
  notificationMessage: string
  redirectUrl: string
  enablePdfGeneration: boolean
  saveContractAsPdf: boolean
  saveFormAsPdf: boolean
  googleDriveAttachmentsFolder: string
  geminiApiKey: string
  pdfTemplateUrl: string
  pdfTemplateBase64?: string
  pdfTemplateFileName?: string
  pdfStyle?: PdfStyleConfig
  adminEmail: string
  resendApiKey: string
  fromEmail: string
}

// Serviço de storage — salva no localStorage E no Supabase
const settingsStorageService = {
  async saveSettings(data: AppSettings) {
    // ── 1. localStorage: salvar sem o base64 do template (pode ser vários MB)
    try {
      const { pdfTemplateBase64: _omit, ...rest } = data
      localStorage.setItem('app-settings', JSON.stringify(rest))
    } catch {
      // QuotaExceededError — ignora; Supabase é a fonte de verdade
    }

    // ── 2. Supabase: separar o template em linha própria p/ não estourar payload
    const { pdfTemplateBase64, ...settingsWithoutTemplate } = data

    // 2a. Salvar configurações (sem base64)
    const { data: existing, error: selError } = await supabase
      .from('admin_content')
      .select('id')
      .eq('type', 'settings')
      .maybeSingle()

    if (selError) throw new Error(selError.message)

    if (existing?.id) {
      const { error } = await supabase
        .from('admin_content')
        .update({ content: settingsWithoutTemplate as any })
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase
        .from('admin_content')
        .upsert(
          { type: 'settings', content: settingsWithoutTemplate as any },
          { onConflict: 'type' }
        )
      if (error) throw new Error(error.message)
    }

    // 2b. Salvar template PDF em linha separada (só quando há base64)
    if (pdfTemplateBase64) {
      const { data: existingTpl } = await supabase
        .from('admin_content')
        .select('id')
        .eq('type', 'pdf_template')
        .maybeSingle()

      const tplPayload = {
        pdfTemplateBase64,
        pdfTemplateFileName: data.pdfTemplateFileName ?? '',
      }

      if (existingTpl?.id) {
        const { error } = await supabase
          .from('admin_content')
          .update({ content: tplPayload as any })
          .eq('id', existingTpl.id)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase
          .from('admin_content')
          .upsert(
            { type: 'pdf_template', content: tplPayload as any },
            { onConflict: 'type' }
          )
        if (error) throw new Error(error.message)
      }
    }

    return { success: true }
  },

  async getSettings(): Promise<AppSettings> {
    const defaults: AppSettings = {
      whatsappNumber: '',
      googleDriveFolderId: '',
      enableWhatsAppNotification: true,
      notificationMessage: 'Olá! Finalizei todas as etapas da análise de coloração pessoal. Aguardo o retorno! 🎨',
      redirectUrl: '',
      enablePdfGeneration: true,
      saveContractAsPdf: true,
      saveFormAsPdf: true,
      googleDriveAttachmentsFolder: '',
      geminiApiKey: '',
      pdfTemplateUrl: '',
      pdfTemplateBase64: '',
      pdfTemplateFileName: '',
      pdfStyle: PDF_STYLE_DEFAULTS,
      adminEmail: '',
      resendApiKey: '',
      fromEmail: '',
    }

    try {
      // Carregar configurações principais
      const { data: settingsRow } = await supabase
        .from('admin_content')
        .select('content')
        .eq('type', 'settings')
        .maybeSingle()

      // Carregar template PDF (linha separada)
      const { data: tplRow } = await supabase
        .from('admin_content')
        .select('content')
        .eq('type', 'pdf_template')
        .maybeSingle()

      const tplContent = tplRow?.content as { pdfTemplateBase64?: string; pdfTemplateFileName?: string } | null

      const merged: AppSettings = {
        ...defaults,
        ...(settingsRow?.content as AppSettings ?? {}),
        // Template vem da linha dedicada se existir, senão do campo legado na settings
        pdfTemplateBase64:  tplContent?.pdfTemplateBase64  ?? (settingsRow?.content as any)?.pdfTemplateBase64  ?? '',
        pdfTemplateFileName: tplContent?.pdfTemplateFileName ?? (settingsRow?.content as any)?.pdfTemplateFileName ?? '',
      }

      return merged
    } catch (error) {
      console.error('Erro ao carregar configurações:', error)
      try {
        const local = localStorage.getItem('app-settings')
        if (local) return { ...defaults, ...JSON.parse(local) }
      } catch {}
      return defaults
    }
  }
}

if (typeof window !== 'undefined') {
  (window as any).settingsStorageService = settingsStorageService
}

// ── PDF Modelo ──────────────────────────────────────────────────────────────

function PdfTemplateSection({
  currentFileName,
  onSave,
}: {
  currentFileName: string
  onSave: (base64: string, fileName: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || file.type !== 'application/pdf') return
    e.target.value = ''
    setSaving(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      onSave(base64, file.name)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err: any) {
      alert('Erro ao processar PDF: ' + err.message)
      setStatus('error')
    } finally { setSaving(false) }
  }

  const handleDelete = () => {
    if (!confirm('Remover o PDF modelo?')) return
    onSave('', '')
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-fuchsia-50 to-pink-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-fuchsia-500 to-pink-500 rounded-xl flex items-center justify-center">
            <FileText className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">PDF Modelo</h2>
            <p className="text-sm text-gray-500">Template modelo para geração de dossiês</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-gray-500">
          Envie seu modelo de PDF para gerar automaticamente o dossiê capilar pela IA.
        </p>

        {currentFileName ? (
          <div className="flex items-center gap-3 bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-4">
            <div className="w-10 h-10 bg-fuchsia-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText className="h-5 w-5 text-fuchsia-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">PDF modelo carregado</p>
              <p className="text-xs text-gray-500 truncate">{currentFileName}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 cursor-pointer transition-colors">
                <Upload className="h-3.5 w-3.5" />
                {saving ? 'Salvando...' : 'Trocar'}
                <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={saving} />
              </label>
              <button
                onClick={handleDelete}
                className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <label className={`flex flex-col items-center gap-3 border-2 border-dashed border-fuchsia-200 rounded-xl p-8 cursor-pointer hover:bg-fuchsia-50 transition-colors ${saving ? 'opacity-60 pointer-events-none' : ''}`}>
            <div className="w-12 h-12 bg-fuchsia-100 rounded-xl flex items-center justify-center">
              {saving
                ? <div className="animate-spin h-6 w-6 border-2 border-fuchsia-500 border-t-transparent rounded-full" />
                : <Upload className="h-6 w-6 text-fuchsia-500" />}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">{saving ? 'Salvando PDF no banco...' : 'Clique para enviar o PDF modelo'}</p>
              <p className="text-xs text-gray-400 mt-1">Somente arquivos .pdf</p>
            </div>
            <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={saving} />
          </label>
        )}

        {status === 'saved' && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" /> PDF modelo salvo com sucesso!
          </div>
        )}
      </div>
    </div>
  )
}



// ── Settings Editor ─────────────────────────────────────────────────────────

export default function SettingsEditor() {
  const [settings, setSettings] = useState<AppSettings>({
    whatsappNumber: '',
    googleDriveFolderId: '',
    enableWhatsAppNotification: true,
    notificationMessage: '',
    redirectUrl: '',
    enablePdfGeneration: true,
    saveContractAsPdf: true,
    saveFormAsPdf: true,
    googleDriveAttachmentsFolder: '',
    geminiApiKey: '',
    pdfTemplateUrl: '',
    pdfStyle: PDF_STYLE_DEFAULTS,
    adminEmail: '',
    resendApiKey: '',
    fromEmail: '',
  })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const loaded = await settingsStorageService.getSettings()
      setSettings(loaded)
    } catch {
      setMessage({ type: 'error', text: 'Erro ao carregar configurações' })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await settingsStorageService.saveSettings(settings)
      setMessage({ type: 'success', text: 'Configurações salvas com sucesso!' })
      setTimeout(() => setMessage(null), 5000)
    } catch {
      setMessage({ type: 'error', text: 'Erro ao salvar configurações' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-400 mx-auto" />
          <p className="text-sm text-gray-500">Carregando configurações...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto px-4 py-6">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Configurações</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gerencie integrações, tipos de fotos e templates</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving
            ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            : <Save className="h-4 w-4" />}
          Salvar
        </button>
      </div>

      {/* Feedback */}
      {message && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {message.type === 'success'
            ? <CheckCircle className="h-4 w-4 shrink-0" />
            : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
        </div>
      )}

      {/* ── Assistente de IA Gemini ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-purple-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/>
                <path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/>
                <path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Assistente de IA Gemini</h2>
              <p className="text-sm text-gray-500">Configure a IA para suas clientes</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chave da API Gemini
            </label>
            <div className="relative">
              <input
                type="password"
                value={settings.geminiApiKey}
                onChange={e => setSettings({ ...settings, geminiApiKey: e.target.value })}
                placeholder="AIza..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent font-mono pr-28"
              />
              {settings.geminiApiKey && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                  ✓ Configurada
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              Obtenha sua chave gratuita em{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
                className="text-violet-600 hover:underline font-medium">
                aistudio.google.com
              </a>
            </p>
          </div>

          {settings.geminiApiKey && (
            <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
              <p className="text-sm text-violet-700">
                ✓ IA ativada — suas clientes poderão conversar com a consultora de coloração pessoal e receber sugestões personalizadas.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── E-mail (Resend) ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-cyan-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Envio de E-mails</h2>
              <p className="text-sm text-gray-500">Contratos assinados enviados por e-mail</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seu e-mail (para receber notificações)
            </label>
            <input
              type="email"
              value={settings.adminEmail}
              onChange={e => setSettings({ ...settings, adminEmail: e.target.value })}
              placeholder="voce@seudominio.com.br"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Você receberá uma cópia do contrato toda vez que uma cliente assinar.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              E-mail remetente
            </label>
            <input
              type="email"
              value={settings.fromEmail}
              onChange={e => setSettings({ ...settings, fromEmail: e.target.value })}
              placeholder="noreply@seudominio.com.br"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Deve ser um domínio verificado no Resend. Para testes use{' '}
              <span className="font-mono">onboarding@resend.dev</span>.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chave da API Resend
            </label>
            <div className="relative">
              <input
                type="password"
                value={settings.resendApiKey}
                onChange={e => setSettings({ ...settings, resendApiKey: e.target.value })}
                placeholder="re_..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent font-mono pr-28"
              />
              {settings.resendApiKey && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                  ✓ Configurada
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              Crie sua conta grátis em{' '}
              <a href="https://resend.com" target="_blank" rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-medium">
                resend.com
              </a>
              {' '}· Plano gratuito inclui 3.000 e-mails/mês.
            </p>
          </div>

          {settings.resendApiKey && settings.adminEmail ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-sm text-green-700">
                ✓ E-mail configurado — contratos serão enviados para a cliente e uma cópia para <strong>{settings.adminEmail}</strong>.
              </p>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm text-amber-700">
                ⚠️ Sem e-mail configurado, contratos não serão enviados por e-mail.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Tipos de fotos */}
      <PhotoTypesManager />

      {/* Tags de Informação IA */}
      <TagsManager />

      {/* PDF Modelo */}
      <PdfTemplateSection
        currentFileName={settings.pdfTemplateFileName || ''}
        onSave={(base64, fileName) => {
          const updated = { ...settings, pdfTemplateBase64: base64, pdfTemplateFileName: fileName }
          setSettings(updated)
          settingsStorageService.saveSettings(updated)
        }}
      />

    </div>
  )
}