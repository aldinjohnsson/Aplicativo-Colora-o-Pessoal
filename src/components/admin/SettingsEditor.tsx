import React, { useState, useEffect } from 'react'
import { Save, CheckCircle, AlertCircle, FileText, Upload, Trash2, Mail, HelpCircle, X, ExternalLink, Image as ImageIcon, Sparkles, Loader2, Shield } from 'lucide-react'
import { TagsManager } from './TagsManager'
import { PhotoTypesManager } from './PhotoTypesManager'
import { DriveConnectionSection } from './DriveConnectionSection'
import { supabase } from '../../lib/supabase'
import { useTheme } from '../../lib/theme'
import { adminService, AdminUser } from '../../lib/services'

// ── Modal de instrução de API Key ────────────────────────────────────────────

interface ApiKeyStep { text: string; highlight?: boolean }

interface ApiKeyHelpModalProps {
  title: string
  subtitle: string
  steps: ApiKeyStep[]
  url: string
  urlLabel: string
  accentColor: string
  onClose: () => void
}

function ApiKeyHelpModal({ title, subtitle, steps, url, urlLabel, accentColor, onClose }: ApiKeyHelpModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3"
          style={{ background: `${accentColor}10` }}>
          <div>
            <p className="font-semibold text-gray-900 text-base">{title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5 flex-shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
                style={{ background: accentColor }}
              >
                {i + 1}
              </div>
              <p className={`text-sm leading-relaxed ${step.highlight ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                {step.text}
              </p>
            </div>
          ))}
        </div>

        <div className="px-5 pb-5">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: accentColor }}
          >
            <ExternalLink className="h-4 w-4" />
            {urlLabel}
          </a>
        </div>
      </div>
    </div>
  )
}

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
  openaiApiKey: string
  pdfTemplateUrl: string
  pdfTemplateBase64?: string
  pdfTemplateFileName?: string
  pdfStyle?: PdfStyleConfig
  adminEmail: string
  resendApiKey: string
  fromEmail: string
  emailDisplayName: string  // Nome que aparece como remetente nos e-mails enviados às clientes
  logoStoragePath?: string

  aiCompositionCoverBase64?:   string
  aiCompositionCoverFileName?: string
  aiCompositionFinalBase64?:   string
  aiCompositionFinalFileName?: string
}

// ── Helpers de admin_content ────────────────────────────────────────────────

async function saveOrUpdate(type: string, content: Record<string, any>, adminId: string) {
  const { data: existing, error: selectErr } = await supabase
    .from('admin_content')
    .select('id')
    .eq('admin_id', adminId)
    .eq('type', type)
    .maybeSingle()

  if (selectErr) throw new Error(selectErr.message)

  if (existing) {
    const { error } = await supabase
      .from('admin_content')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('admin_id', adminId)
      .eq('type', type)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('admin_content')
      .insert({ admin_id: adminId, type, content })
    if (error) throw new Error(error.message)
  }
}

async function deleteRow(type: string, adminId: string) {
  const { error } = await supabase
    .from('admin_content')
    .delete()
    .eq('admin_id', adminId)
    .eq('type', type)
  if (error) throw new Error(error.message)
}

const settingsStorageService = {
  async saveSettings(data: AppSettings) {
    try {
      const {
        pdfTemplateBase64:        _omit1,
        aiCompositionCoverBase64: _omit2,
        aiCompositionFinalBase64: _omit3,
        ...rest
      } = data
      localStorage.setItem('app-settings', JSON.stringify(rest))
    } catch {}

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Sessão expirada. Faça login novamente.')

    const {
      pdfTemplateBase64,
      aiCompositionCoverBase64,
      aiCompositionFinalBase64,
      ...settingsWithoutBlobs
    } = data

    await saveOrUpdate('settings', settingsWithoutBlobs as any, user.id)

    if (pdfTemplateBase64) {
      await saveOrUpdate('pdf_template', {
        pdfTemplateBase64,
        pdfTemplateFileName: data.pdfTemplateFileName ?? '',
      } as any, user.id)
    }

    if (aiCompositionCoverBase64) {
      await saveOrUpdate('ai_composition_cover', {
        pdfBase64: aiCompositionCoverBase64,
        fileName:  data.aiCompositionCoverFileName ?? '',
      } as any, user.id)
    }

    if (aiCompositionFinalBase64) {
      await saveOrUpdate('ai_composition_final', {
        pdfBase64: aiCompositionFinalBase64,
        fileName:  data.aiCompositionFinalFileName ?? '',
      } as any, user.id)
    }

    return { success: true }
  },

  async saveAiCompositionBranding(slot: 'cover' | 'final', base64: string, fileName: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Sessão expirada. Faça login novamente.')
    const type = slot === 'cover' ? 'ai_composition_cover' : 'ai_composition_final'
    await saveOrUpdate(type, { pdfBase64: base64, fileName }, user.id)
  },

  async deleteAiCompositionBranding(slot: 'cover' | 'final') {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Sessão expirada')
    const type = slot === 'cover' ? 'ai_composition_cover' : 'ai_composition_final'
    await deleteRow(type, user.id)
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
      openaiApiKey: '',
      pdfTemplateUrl: '',
      pdfTemplateBase64: '',
      pdfTemplateFileName: '',
      pdfStyle: PDF_STYLE_DEFAULTS,
      adminEmail: '',
      resendApiKey: '',
      fromEmail: '',
      emailDisplayName: '',
      logoStoragePath: '',
      aiCompositionCoverBase64:   '',
      aiCompositionCoverFileName: '',
      aiCompositionFinalBase64:   '',
      aiCompositionFinalFileName: '',
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const adminId = user?.id

      const [
        { data: settingsRow },
        { data: tplRow },
        { data: coverRow },
        { data: finalRow },
      ] = await Promise.all([
        supabase.from('admin_content').select('content').eq('admin_id', adminId ?? '').eq('type', 'settings').maybeSingle(),
        supabase.from('admin_content').select('content').eq('admin_id', adminId ?? '').eq('type', 'pdf_template').maybeSingle(),
        supabase.from('admin_content').select('content').eq('admin_id', adminId ?? '').eq('type', 'ai_composition_cover').maybeSingle(),
        supabase.from('admin_content').select('content').eq('admin_id', adminId ?? '').eq('type', 'ai_composition_final').maybeSingle(),
      ])

      const tplContent   = tplRow?.content   as { pdfTemplateBase64?: string; pdfTemplateFileName?: string } | null
      const coverContent = coverRow?.content as { pdfBase64?: string; fileName?: string } | null
      const finalContent = finalRow?.content as { pdfBase64?: string; fileName?: string } | null

      return {
        ...defaults,
        ...(settingsRow?.content as AppSettings ?? {}),
        pdfTemplateBase64:   tplContent?.pdfTemplateBase64   ?? (settingsRow?.content as any)?.pdfTemplateBase64   ?? '',
        pdfTemplateFileName: tplContent?.pdfTemplateFileName ?? (settingsRow?.content as any)?.pdfTemplateFileName ?? '',
        aiCompositionCoverBase64:   coverContent?.pdfBase64 ?? '',
        aiCompositionCoverFileName: coverContent?.fileName  ?? '',
        aiCompositionFinalBase64:   finalContent?.pdfBase64 ?? '',
        aiCompositionFinalFileName: finalContent?.fileName  ?? '',
      }
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

// ═══════════════════════════════════════════════════════════════════════════
//   Componentes extraídos (reusados entre as views full e chat_admin)
// ═══════════════════════════════════════════════════════════════════════════

// ── Logo da marca ────────────────────────────────────────────────────────────

const LOGO_BUCKET = 'admin-logos'

function LogoSection({
  currentPath, onSave, onRemove,
}: {
  currentPath: string
  onSave: (path: string) => void
  onRemove: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const { theme } = useTheme()

  useEffect(() => {
    if (!currentPath) { setPreviewUrl(null); return }
    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(currentPath)
    setPreviewUrl(data.publicUrl)
  }, [currentPath])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    e.target.value = ''
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada')
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase() || '.png'
      const path = `${user.id}/logo${ext}`
      const { error } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true })
      if (error) throw error
      onSave(path)
    } catch (err: any) {
      alert('Erro ao salvar logo: ' + err.message)
    } finally { setSaving(false) }
  }

  const handleRemove = async () => {
    if (!confirm('Remover o logo?')) return
    if (currentPath) {
      await supabase.storage.from(LOGO_BUCKET).remove([currentPath]).catch(() => {})
    }
    onRemove()
  }

  return (
    <div className="rounded-2xl shadow-sm overflow-hidden" style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
      <div
        className="px-3 sm:px-6 py-3 sm:py-4"
        style={{ borderBottom: `1px solid ${theme.border}`, background: `linear-gradient(to right, color-mix(in srgb, #f43f5e 12%, ${theme.surface2}), color-mix(in srgb, #f43f5e 6%, ${theme.surface2}))` }}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f43f5e, #ec4899)' }}>
            <ImageIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: theme.text }}>Logo da sua marca</h2>
            <p className="text-sm" style={{ color: theme.text2 }}>
              Usado automaticamente na tag{' '}
              <code className="px-1 rounded text-xs font-mono" style={{ background: theme.surface }}>{'{{Logo}}'}</code>
              {' '}dos documentos gerados
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        {previewUrl ? (
          <div className="flex items-center gap-4">
            <div
              className="h-16 w-32 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
              style={{ border: `1px solid ${theme.border}`, background: theme.surface2 }}
            >
              <img src={previewUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="flex gap-2">
              <label
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                style={{ border: `1px solid ${theme.border}`, color: theme.text2, background: theme.surface }}
              >
                <Upload className="h-3.5 w-3.5" />
                {saving ? 'Salvando...' : 'Trocar'}
                <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={saving} />
              </label>
              <button
                onClick={handleRemove}
                className="p-1.5 rounded-lg transition-colors"
                style={{ background: 'color-mix(in srgb, #ef4444 15%, transparent)', color: '#ef4444' }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <label
            className={`flex flex-col items-center gap-3 rounded-xl p-8 cursor-pointer transition-colors ${saving ? 'opacity-60 pointer-events-none' : ''}`}
            style={{ border: `2px dashed color-mix(in srgb, #f43f5e 40%, ${theme.border})` }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, #f43f5e 15%, ${theme.surface2})` }}>
              {saving
                ? <div className="animate-spin h-6 w-6 rounded-full" style={{ border: '2px solid #f43f5e', borderTopColor: 'transparent' }} />
                : <Upload className="h-6 w-6" style={{ color: '#f43f5e' }} />}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: theme.text }}>
                {saving ? 'Salvando logo...' : 'Clique para enviar seu logo'}
              </p>
              <p className="text-xs mt-1" style={{ color: theme.text3 }}>PNG, JPG ou SVG · Fundo transparente recomendado</p>
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={saving} />
          </label>
        )}
      </div>
    </div>
  )
}

// ── Card de chave Gemini (reusado por full e chat_admin) ────────────────

function GeminiKeyCard({
  value, onChange, onHelp, contextLabel,
}: {
  value: string
  onChange: (v: string) => void
  onHelp: () => void
  // Texto contextual de rodapé. Difere entre admin (genérico) e
  // chat_admin (deixa claro que a chave é dele e ele paga pela uso).
  contextLabel?: string
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-purple-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/>
              <path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/>
              <path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Chave da IA Gemini</h2>
            <p className="text-sm text-gray-500">Necessária para o chat MS Color IA funcionar</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-700">Chave da API Gemini</label>
            <button
              type="button"
              onClick={onHelp}
              className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Como obter?
            </button>
          </div>
          <div className="relative">
            <input
              type="password"
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder="AIza..."
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent font-mono pr-28"
            />
            {value && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                ✓ Configurada
              </span>
            )}
          </div>
        </div>

        {value && (
          <div className="bg-violet-50 border border-violet-100 rounded-xl p-3">
            <p className="text-sm text-violet-700">
              {contextLabel || '✓ IA ativada — suas clientes poderão conversar com a consultora de coloração pessoal.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── PDF Modelo (reusado) ────────────────────────────────────────────────────

function PdfTemplateSection({
  currentFileName, onSave,
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

  const { theme } = useTheme()

  return (
    <div className="rounded-2xl shadow-sm overflow-hidden" style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
      <div className="px-3 sm:px-6 py-3 sm:py-4" style={{ borderBottom: `1px solid ${theme.border}`, background: `linear-gradient(to right, color-mix(in srgb, #d946ef 12%, ${theme.surface2}), color-mix(in srgb, #d946ef 6%, ${theme.surface2}))` }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #d946ef, #ec4899)' }}>
            <FileText className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: theme.text }}>PDF Modelo</h2>
            <p className="text-sm" style={{ color: theme.text2 }}>Template modelo para geração de dossiês</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        <p className="text-sm" style={{ color: theme.text2 }}>
          Envie seu modelo de PDF para gerar automaticamente o dossiê capilar pela IA.
        </p>

        {currentFileName ? (
          <div className="flex items-center gap-3 rounded-xl p-4" style={{ background: `color-mix(in srgb, #d946ef 10%, ${theme.surface2})`, border: `1px solid color-mix(in srgb, #d946ef 30%, ${theme.border})` }}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, #d946ef 18%, ${theme.surface2})` }}>
              <FileText className="h-5 w-5" style={{ color: '#d946ef' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: theme.text }}>PDF modelo carregado</p>
              <p className="text-xs truncate" style={{ color: theme.text2 }}>{currentFileName}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors" style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.text2 }}>
                <Upload className="h-3.5 w-3.5" />
                {saving ? 'Salvando...' : 'Trocar'}
                <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={saving} />
              </label>
              <button
                onClick={handleDelete}
                className="p-1.5 rounded-lg transition-colors"
                style={{ background: 'color-mix(in srgb, #ef4444 15%, transparent)', color: '#ef4444' }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <label className={`flex flex-col items-center gap-3 rounded-xl p-8 cursor-pointer transition-colors ${saving ? 'opacity-60 pointer-events-none' : ''}`} style={{ border: `2px dashed color-mix(in srgb, #d946ef 40%, ${theme.border})` }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, #d946ef 15%, ${theme.surface2})` }}>
              {saving
                ? <div className="animate-spin h-6 w-6 rounded-full" style={{ border: `2px solid #d946ef`, borderTopColor: 'transparent' }} />
                : <Upload className="h-6 w-6" style={{ color: '#d946ef' }} />}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: theme.text }}>{saving ? 'Salvando PDF no banco...' : 'Clique para enviar o PDF modelo'}</p>
              <p className="text-xs mt-1" style={{ color: theme.text3 }}>Somente arquivos .pdf</p>
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

// ── Branding das Composições IA ─────────────────────────────────────────────

const AI_BRANDING_ACCENT = '#06b6d4'

function AiCompositionBrandingSection({
  coverFileName, finalFileName,
  onSaveCover, onSaveFinal, onRemoveCover, onRemoveFinal,
}: {
  coverFileName: string
  finalFileName: string
  onSaveCover:   (base64: string, fileName: string) => Promise<void>
  onSaveFinal:   (base64: string, fileName: string) => Promise<void>
  onRemoveCover: () => Promise<void>
  onRemoveFinal: () => Promise<void>
}) {
  const { theme } = useTheme()
  return (
    <div className="rounded-2xl shadow-sm overflow-hidden" style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
      <div
        className="px-3 sm:px-6 py-3 sm:py-4"
        style={{
          borderBottom: `1px solid ${theme.border}`,
          background: `linear-gradient(to right, color-mix(in srgb, ${AI_BRANDING_ACCENT} 12%, ${theme.surface2}), color-mix(in srgb, ${AI_BRANDING_ACCENT} 6%, ${theme.surface2}))`,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${AI_BRANDING_ACCENT}, #0891b2)` }}
          >
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: theme.text }}>Branding das Composições IA</h2>
            <p className="text-sm" style={{ color: theme.text2 }}>
              Capa e contracapa anexadas ao PDF gerado pela IA
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        <p className="text-sm" style={{ color: theme.text2 }}>
          Envie dois PDFs vetoriais (1 página cada). O PDF final fica:{' '}
          <strong style={{ color: theme.text }}>[Capa]</strong>
          {' + '}
          <span style={{ color: theme.text3 }}>[imagens geradas pela IA]</span>
          {' + '}
          <strong style={{ color: theme.text }}>[Contracapa]</strong>.
        </p>

        <BrandingSlot
          label="Capa (1ª página)"
          accent={AI_BRANDING_ACCENT}
          theme={theme}
          fileName={coverFileName}
          onSave={onSaveCover}
          onRemove={onRemoveCover}
        />

        <BrandingSlot
          label="Contracapa (última página)"
          accent={AI_BRANDING_ACCENT}
          theme={theme}
          fileName={finalFileName}
          onSave={onSaveFinal}
          onRemove={onRemoveFinal}
        />
      </div>
    </div>
  )
}

type SlotPhase = 'idle' | 'reading' | 'saving' | 'saved' | 'error'

function BrandingSlot({
  label, accent, theme, fileName, onSave, onRemove,
}: {
  label:    string
  accent:   string
  theme:    any
  fileName: string
  onSave:   (base64: string, fileName: string) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const [phase, setPhase]         = useState<SlotPhase>('idle')
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const [fileSizeMB, setFileSize] = useState<number>(0)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || file.type !== 'application/pdf') return
    e.target.value = ''

    setFileSize(file.size / 1024 / 1024)
    setErrorMsg(null)

    try {
      setPhase('reading')
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
        reader.readAsDataURL(file)
      })

      setPhase('saving')
      await onSave(base64, file.name)

      setPhase('saved')
      setTimeout(() => setPhase('idle'), 4000)
    } catch (err: any) {
      console.error('[BrandingSlot] save failed:', err)
      setErrorMsg(err?.message || 'Erro ao salvar PDF no banco')
      setPhase('error')
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Remover "${label.toLowerCase()}"? Composições futuras não terão mais essa página.`)) return
    setErrorMsg(null)
    setPhase('saving')
    try {
      await onRemove()
      setPhase('idle')
    } catch (err: any) {
      console.error('[BrandingSlot] delete failed:', err)
      setErrorMsg(err?.message || 'Erro ao remover')
      setPhase('error')
    }
  }

  const busy = phase === 'reading' || phase === 'saving'
  const phaseLabel =
    phase === 'reading' ? `Lendo arquivo (${fileSizeMB.toFixed(1)} MB)…`   :
    phase === 'saving'  ? `Enviando ao banco (${fileSizeMB.toFixed(1)} MB)…` :
    phase === 'saved'   ? 'Salvo no banco!' :
    'Salvando…'

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.text2 }}>
        {label}
      </p>

      {fileName && !busy && phase !== 'error' ? (
        <div className="flex items-center gap-3 rounded-xl p-4" style={{ background: `color-mix(in srgb, ${accent} 10%, ${theme.surface2})`, border: `1px solid color-mix(in srgb, ${accent} 30%, ${theme.border})` }}>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${accent} 18%, ${theme.surface2})` }}>
            <FileText className="h-5 w-5" style={{ color: accent }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: theme.text }}>PDF carregado</p>
            <p className="text-xs truncate" style={{ color: theme.text2 }}>{fileName}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors" style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.text2 }}>
              <Upload className="h-3.5 w-3.5" /> Trocar
              <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} />
            </label>
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-lg transition-colors"
              style={{ background: 'color-mix(in srgb, #ef4444 15%, transparent)', color: '#ef4444' }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <label
          className={`flex flex-col items-center gap-3 rounded-xl p-6 cursor-pointer transition-colors ${busy ? 'opacity-90 pointer-events-none' : ''}`}
          style={{ border: `2px dashed color-mix(in srgb, ${accent} 40%, ${theme.border})` }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${accent} 15%, ${theme.surface2})` }}>
            {busy
              ? <Loader2 className="h-5 w-5 animate-spin" style={{ color: accent }} />
              : <Upload className="h-5 w-5" style={{ color: accent }} />}
          </div>
          <div className="text-center">
            <p className="text-sm font-medium" style={{ color: theme.text }}>
              {busy ? phaseLabel : (fileName ? `Substituir "${fileName}"` : 'Clique para enviar o PDF')}
            </p>
            <p className="text-xs mt-1" style={{ color: theme.text3 }}>
              {busy
                ? 'NÃO saia desta tela até o save completar'
                : '1 página · vetorial · até 20 MB'}
            </p>
          </div>
          <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={busy} />
        </label>
      )}

      {phase === 'saved' && (
        <div className="flex items-center gap-2 text-xs text-green-600 font-medium">
          <CheckCircle className="h-3.5 w-3.5" /> {phaseLabel}
        </div>
      )}

      {phase === 'error' && errorMsg && (
        <div className="flex items-start gap-2 rounded-lg p-2 text-xs" style={{ background: 'color-mix(in srgb, #ef4444 10%, transparent)', color: '#b91c1c' }}>
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Falha ao salvar — tente de novo</p>
            <p className="opacity-80 break-words mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//   SettingsEditor — render condicional por role
// ═══════════════════════════════════════════════════════════════════════════
//
// Três views diferentes baseadas no role do usuário logado:
//
//   • super_admin → tudo (Drive, Gemini, OpenAI, Email, PhotoTypes, Tags, Logo,
//                   PDF Modelo, AI Composition Branding, modais de ajuda)
//   • admin       → tudo EXCETO PhotoTypes/Tags (essas são só do super)
//   • chat_admin  → SOMENTE Chave Gemini + PDF Modelo (configuração mínima
//                   pro MS Color IA standalone funcionar)

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
    openaiApiKey: '',
    pdfTemplateUrl: '',
    pdfStyle: PDF_STYLE_DEFAULTS,
    adminEmail: '',
    resendApiKey: '',
    fromEmail: '',
    emailDisplayName: '',
    logoStoragePath: '',
    aiCompositionCoverBase64:   '',
    aiCompositionCoverFileName: '',
    aiCompositionFinalBase64:   '',
    aiCompositionFinalFileName: '',
  })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [userRole, setUserRole] = useState<AdminUser['role'] | null>(null)
  const [showGeminiHelp, setShowGeminiHelp] = useState(false)
  const [showOpenAIHelp, setShowOpenAIHelp] = useState(false)

  // Configuração global de e-mail — apenas super_admin edita.
  // Armazenada em admin_content (type='global_email_settings') do super_admin.
  // Todos os admins (salões) usam essa config como fallback automático.
  const [globalEmail, setGlobalEmail] = useState<{ resendApiKey: string; fromEmail: string }>({
    resendApiKey: '',
    fromEmail: '',
  })

  useEffect(() => {
    loadSettings()
    adminService.getCurrentAdmin().then(a => setUserRole(a?.role ?? null))
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const loaded = await settingsStorageService.getSettings()
      setSettings(loaded)

      // Carrega config global de e-mail (só super_admin precisa, mas é seguro
      // tentar ler — RLS bloqueia se não for super_admin). A query é barata.
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: meRow } = await supabase
          .from('admins')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()

        if (meRow?.role === 'super_admin') {
          const { data: globalRow } = await supabase
            .from('admin_content')
            .select('content')
            .eq('admin_id', user.id)
            .eq('type', 'global_email_settings')
            .maybeSingle()

          if (globalRow?.content) {
            const c = globalRow.content as any
            setGlobalEmail({
              resendApiKey: c.resendApiKey || '',
              fromEmail:    c.fromEmail    || '',
            })
          }
        }
      }
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

      // Super admin: salva também a config global compartilhada.
      if (userRole === 'super_admin') {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await saveOrUpdate('global_email_settings', {
            resendApiKey: globalEmail.resendApiKey,
            fromEmail:    globalEmail.fromEmail,
          }, user.id)
        }
      }

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

  // ═══════════════════════════════════════════════════════════════════
  // VIEW 1 — chat_admin: configuração mínima
  // ═══════════════════════════════════════════════════════════════════
  if (userRole === 'chat_admin') {
    return (
      <div className="space-y-4 sm:space-y-6 max-w-3xl mx-auto px-4 py-6">

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base sm:text-xl font-semibold text-gray-900">Configurações</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Sua chave Gemini e o template do PDF que o chat gera
            </p>
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

        {/* Aviso de primeiro uso, se ainda não configurou */}
        {!settings.geminiApiKey && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm text-amber-800 font-medium">⚠️ Configure sua chave Gemini para usar o chat</p>
            <p className="text-xs text-amber-700 mt-1">
              Sem a chave, o chat MS Color IA não funciona. Clique em "Como obter?" abaixo se ainda não tem uma.
            </p>
          </div>
        )}

        <GeminiKeyCard
          value={settings.geminiApiKey}
          onChange={v => setSettings({ ...settings, geminiApiKey: v })}
          onHelp={() => setShowGeminiHelp(true)}
          contextLabel="✓ Chave configurada. O uso é cobrado direto no seu Google Cloud — você tem controle total da sua conta."
        />

        <PdfTemplateSection
          currentFileName={settings.pdfTemplateFileName || ''}
          onSave={(base64, fileName) => {
            const updated = { ...settings, pdfTemplateBase64: base64, pdfTemplateFileName: fileName }
            setSettings(updated)
            settingsStorageService.saveSettings(updated)
          }}
        />

        {showGeminiHelp && (
          <ApiKeyHelpModal
            title="Como obter a chave Gemini"
            subtitle="Gratuita · Google AI Studio"
            accentColor="#7c3aed"
            url="https://aistudio.google.com/apikey"
            urlLabel="Abrir Google AI Studio"
            onClose={() => setShowGeminiHelp(false)}
            steps={[
              { text: 'Acesse o Google AI Studio pelo botão abaixo' },
              { text: 'Faça login com sua conta Google' },
              { text: 'Clique em "Create API key" no menu lateral esquerdo' },
              { text: 'Selecione um projeto existente ou crie um novo' },
              { text: 'Copie a chave gerada e cole no campo acima', highlight: true },
            ]}
          />
        )}

      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIEW 2 — admin / super_admin: configuração completa
  // ═══════════════════════════════════════════════════════════════════
  const isSuperAdmin = userRole === 'super_admin'

  return (
    <div className="space-y-4 sm:space-y-6 max-w-3xl mx-auto px-4 py-6">

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base sm:text-xl font-semibold text-gray-900">Configurações</h1>
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

      <DriveConnectionSection />

      <GeminiKeyCard
        value={settings.geminiApiKey}
        onChange={v => setSettings({ ...settings, geminiApiKey: v })}
        onHelp={() => setShowGeminiHelp(true)}
      />

      {/* ── OpenAI ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-fuchsia-50 to-rose-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-fuchsia-500 to-rose-500 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Geração de Imagem OpenAI</h2>
              <p className="text-sm text-gray-500">Para tags de documento do tipo "Gerada por IA"</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Chave da API OpenAI</label>
              <button
                type="button"
                onClick={() => setShowOpenAIHelp(true)}
                className="inline-flex items-center gap-1 text-xs text-fuchsia-600 hover:text-fuchsia-800 font-medium"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Como obter?
              </button>
            </div>
            <div className="relative">
              <input
                type="password"
                value={settings.openaiApiKey}
                onChange={e => setSettings({ ...settings, openaiApiKey: e.target.value })}
                placeholder="sk-proj-... ou sk-..."
                autoComplete="off"
                spellCheck={false}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:border-transparent font-mono pr-28"
              />
              {settings.openaiApiKey && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                  ✓ Configurada
                </span>
              )}
            </div>
          </div>

          {settings.openaiApiKey && (
            <div className="bg-fuchsia-50 border border-fuchsia-100 rounded-xl p-3">
              <p className="text-sm text-fuchsia-700">
                ✓ Geração de imagem ativada. Cada imagem gerada usa créditos da sua conta OpenAI.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── E-mail: notificações pro admin ────────────────────────────────
        *
        * Esta seção mostra apenas o e-mail onde o admin (salão) quer
        * receber as cópias dos contratos. A chave Resend + domínio
        * remetente vêm da configuração GLOBAL gerida pelo super_admin
        * (seção abaixo, visível só pra ele) — o admin não precisa ter
        * conta Resend própria nem domínio verificado.
        */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-cyan-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Notificações por E-mail</h2>
              <p className="text-sm text-gray-500">Onde você quer receber a cópia dos contratos assinados</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome que aparece como remetente</label>
            <input
              type="text"
              value={settings.emailDisplayName}
              onChange={e => setSettings({ ...settings, emailDisplayName: e.target.value })}
              placeholder="Ex: Marília Color, Salão da Fulana, Studio X..."
              maxLength={80}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Esse nome aparece na caixa de entrada da sua cliente como remetente do e-mail.
              {settings.emailDisplayName && (
                <span className="block mt-1 font-mono text-gray-600">
                  Prévia: <strong>{settings.emailDisplayName}</strong> &lt;contato@...&gt;
                </span>
              )}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Seu e-mail (para receber notificações)</label>
            <input
              type="email"
              value={settings.adminEmail}
              onChange={e => setSettings({ ...settings, adminEmail: e.target.value })}
              placeholder="voce@seuemail.com"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Você recebe uma cópia toda vez que uma cliente assina o contrato.
              {!isSuperAdmin && ' Pode ser qualquer e-mail (Gmail, Outlook, etc).'}
            </p>
          </div>

          {settings.adminEmail ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-sm text-green-700">
                ✓ Notificações ativas — cópia dos contratos será enviada para <strong>{settings.adminEmail}</strong>.
              </p>
              {!isSuperAdmin && (
                <p className="text-xs text-green-600 mt-1.5">
                  As clientes recebem o contrato pelo domínio oficial do MS Colors.
                </p>
              )}
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm text-amber-700">⚠️ Preencha seu e-mail para receber a cópia dos contratos assinados.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Config GLOBAL de e-mail (só super_admin) ────────────────────────
        *
        * Configuração única e compartilhada que serve TODOS os admins
        * (salões) do sistema. Armazenada em admin_content type=
        * 'global_email_settings' vinculada ao user_id do super_admin.
        *
        * A edge function `send-contract-email` usa essa chave/domínio
        * pra enviar e-mails em nome de cada salão, com o NOME DO SALÃO
        * (admins.nome) como display name no header From.
        */}
      {isSuperAdmin && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-purple-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-500 rounded-xl flex items-center justify-center">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Configuração Global de E-mail</h2>
                <p className="text-sm text-gray-500">Chave Resend e domínio compartilhados por TODOS os salões</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="bg-violet-50 border border-violet-100 rounded-xl p-3">
              <p className="text-xs text-violet-700 leading-relaxed">
                ℹ️ Esta configuração é usada por <strong>todos os admins (salões)</strong> do sistema.
                Os e-mails saem do seu domínio com o <strong>nome do salão</strong> como remetente
                (ex: <span className="font-mono">"Salão da Fulana &lt;{globalEmail.fromEmail || 'contato@seudominio.com.br'}&gt;"</span>),
                mas cada admin recebe a cópia no e-mail dele.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail remetente global</label>
              <input
                type="email"
                value={globalEmail.fromEmail}
                onChange={e => setGlobalEmail({ ...globalEmail, fromEmail: e.target.value })}
                placeholder="contato@mariliasantoscolor.com.br"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1.5">
                Domínio verificado no Resend. Para testes: <span className="font-mono">onboarding@resend.dev</span>.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Chave da API Resend (global)</label>
              <div className="relative">
                <input
                  type="password"
                  value={globalEmail.resendApiKey}
                  onChange={e => setGlobalEmail({ ...globalEmail, resendApiKey: e.target.value })}
                  placeholder="re_..."
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent font-mono pr-28"
                />
                {globalEmail.resendApiKey && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                    ✓ Configurada
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                Sua conta em{' '}
                <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline font-medium">resend.com</a>
                {' '}· 3.000 e-mails/mês no plano free.
              </p>
            </div>

            {globalEmail.resendApiKey && globalEmail.fromEmail ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-sm text-green-700">
                  ✓ Configuração global ativa — todos os admins enviam e-mails usando esta conta.
                </p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm text-amber-700">
                  ⚠️ Sem configuração global, <strong>nenhum admin</strong> consegue enviar e-mails.
                  Preencha os dois campos acima.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {isSuperAdmin && <PhotoTypesManager />}
      {isSuperAdmin && <TagsManager />}

      <LogoSection
        currentPath={settings.logoStoragePath || ''}
        onSave={(path) => {
          const updated = { ...settings, logoStoragePath: path }
          setSettings(updated)
          settingsStorageService.saveSettings(updated)
        }}
        onRemove={() => {
          const updated = { ...settings, logoStoragePath: '' }
          setSettings(updated)
          settingsStorageService.saveSettings(updated)
        }}
      />

      <PdfTemplateSection
        currentFileName={settings.pdfTemplateFileName || ''}
        onSave={(base64, fileName) => {
          const updated = { ...settings, pdfTemplateBase64: base64, pdfTemplateFileName: fileName }
          setSettings(updated)
          settingsStorageService.saveSettings(updated)
        }}
      />

      <AiCompositionBrandingSection
        coverFileName={settings.aiCompositionCoverFileName || ''}
        finalFileName={settings.aiCompositionFinalFileName || ''}
        onSaveCover={async (base64, fileName) => {
          await settingsStorageService.saveAiCompositionBranding('cover', base64, fileName)
          setSettings(prev => ({
            ...prev,
            aiCompositionCoverBase64:   base64,
            aiCompositionCoverFileName: fileName,
          }))
        }}
        onSaveFinal={async (base64, fileName) => {
          await settingsStorageService.saveAiCompositionBranding('final', base64, fileName)
          setSettings(prev => ({
            ...prev,
            aiCompositionFinalBase64:   base64,
            aiCompositionFinalFileName: fileName,
          }))
        }}
        onRemoveCover={async () => {
          await settingsStorageService.deleteAiCompositionBranding('cover')
          setSettings(prev => ({
            ...prev,
            aiCompositionCoverBase64:   '',
            aiCompositionCoverFileName: '',
          }))
        }}
        onRemoveFinal={async () => {
          await settingsStorageService.deleteAiCompositionBranding('final')
          setSettings(prev => ({
            ...prev,
            aiCompositionFinalBase64:   '',
            aiCompositionFinalFileName: '',
          }))
        }}
      />

      {showGeminiHelp && (
        <ApiKeyHelpModal
          title="Como obter a chave Gemini"
          subtitle="Gratuita · Google AI Studio"
          accentColor="#7c3aed"
          url="https://aistudio.google.com/apikey"
          urlLabel="Abrir Google AI Studio"
          onClose={() => setShowGeminiHelp(false)}
          steps={[
            { text: 'Acesse o Google AI Studio pelo botão abaixo' },
            { text: 'Faça login com sua conta Google' },
            { text: 'Clique em "Create API key" no menu lateral esquerdo' },
            { text: 'Selecione um projeto existente ou crie um novo' },
            { text: 'Copie a chave gerada e cole no campo acima', highlight: true },
          ]}
        />
      )}

      {showOpenAIHelp && (
        <ApiKeyHelpModal
          title="Como obter a chave OpenAI"
          subtitle="Requer conta com créditos · platform.openai.com"
          accentColor="#c026d3"
          url="https://platform.openai.com/api-keys"
          urlLabel="Abrir OpenAI Platform"
          onClose={() => setShowOpenAIHelp(false)}
          steps={[
            { text: 'Acesse a OpenAI Platform pelo botão abaixo' },
            { text: 'Faça login ou crie sua conta' },
            { text: 'No menu lateral, clique em "API keys"' },
            { text: 'Clique em "Create new secret key" e dê um nome' },
            { text: 'Copie a chave imediatamente, ela não será exibida novamente', highlight: true },
            { text: 'Certifique-se de ter créditos em Billing → Overview para as chamadas funcionarem' },
          ]}
        />
      )}

    </div>
  )
}