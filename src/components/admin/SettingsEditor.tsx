import React, { useState, useEffect } from 'react'
import { Save, Phone, CheckCircle, AlertCircle, ExternalLink, FolderOpen, FileText, Mail, Upload, Trash2, Eye } from 'lucide-react'
import { TagsManager } from './TagsManager'
import { supabase } from '../../lib/supabase'

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
  pdfTemplateUrl: string   // URL do PDF modelo
  // ── E-mail ──
  adminEmail: string      // e-mail da consultora para receber notificações
  resendApiKey: string    // chave da API Resend para envio de e-mails
  fromEmail: string       // e-mail remetente (ex: noreply@seudominio.com)
}

// Serviço de storage — salva no localStorage E no Supabase
const settingsStorageService = {
  async saveSettings(data: AppSettings) {
    try {
      const jsonData = JSON.stringify(data)
      localStorage.setItem('app-settings', jsonData)

      // Salvar no Supabase para que a Edge Function consiga ler
      await supabase.from('admin_content').upsert(
        { type: 'settings', content: data as any, updated_at: new Date().toISOString() },
        { onConflict: 'type' }
      )

      return { success: true }
    } catch (error) {
      console.error('Erro ao salvar configurações:', error)
      throw error
    }
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
      adminEmail: '',
      resendApiKey: '',
      fromEmail: '',
    }

    try {
      // Tentar buscar do Supabase primeiro
      const { data } = await supabase
        .from('admin_content')
        .select('content')
        .eq('type', 'settings')
        .maybeSingle()

      if (data?.content) {
        return { ...defaults, ...(data.content as AppSettings) }
      }

      // Fallback para localStorage
      const local = localStorage.getItem('app-settings')
      if (local) return { ...defaults, ...JSON.parse(local) }

      return defaults
    } catch (error) {
      console.error('Erro ao carregar configurações:', error)
      const local = localStorage.getItem('app-settings')
      if (local) {
        try { return { ...defaults, ...JSON.parse(local) } } catch {}
      }
      return defaults
    }
  }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
  (window as any).settingsStorageService = settingsStorageService
}

const Button = ({ children, onClick, loading, disabled, variant = 'primary', className = '' }: any) => {
  const baseStyles = "inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed",
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500"
  }
  
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseStyles} ${variants[variant]} ${className}`}
    >
      {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />}
      {children}
    </button>
  )
}

const Card = ({ children }: any) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200">{children}</div>
)

const CardHeader = ({ children }: any) => (
  <div className="px-6 py-4 border-b border-gray-200">{children}</div>
)

const CardContent = ({ children }: any) => (
  <div className="px-6 py-4">{children}</div>
)

const Input = ({ value, onChange, placeholder, label, type = 'text', helperText }: any) => (
  <div className="space-y-1">
    {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    />
    {helperText && <p className="text-xs text-gray-500">{helperText}</p>}
  </div>
)

const Checkbox = ({ id, checked, onChange, label, description }: any) => (
  <div className="flex items-start space-x-3">
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={onChange}
      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
    />
    <div className="flex-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700 cursor-pointer">
        {label}
      </label>
      {description && (
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      )}
    </div>
  </div>
)

// ── PDF Template Section ────────────────────────────────────────────────────

function PdfTemplateSection({ currentUrl, onSave }: { currentUrl: string; onSave: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || file.type !== 'application/pdf') return
    e.target.value = ''
    setUploading(true)
    try {
      const path = `pdf-templates/modelo_${Date.now()}.pdf`
      const { error } = await supabase.storage.from('client-photos').upload(path, file, { contentType: 'application/pdf', upsert: true })
      if (error) throw error
      const url = supabase.storage.from('client-photos').getPublicUrl(path).data.publicUrl
      onSave(url)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err: any) {
      alert('Erro ao enviar: ' + err.message)
      setStatus('error')
    } finally { setUploading(false) }
  }

  const handleDelete = async () => {
    if (!confirm('Remover o PDF modelo?')) return
    onSave('')
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-fuchsia-50 to-pink-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-fuchsia-500 to-pink-500 rounded-xl flex items-center justify-center">
            <FileText className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">PDF Modelo de Estilo</h2>
            <p className="text-sm text-gray-500">Faça upload de um PDF de referência para o layout desejado</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-gray-600">
          Envie um PDF de exemplo com o layout que você quer que o PDF gerado siga. Ele ficará disponível como referência visual para você e sua equipe.
        </p>

        {currentUrl ? (
          <div className="flex items-center gap-3 bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-4">
            <div className="w-10 h-10 bg-fuchsia-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText className="h-5 w-5 text-fuchsia-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">PDF modelo carregado</p>
              <p className="text-xs text-gray-500 truncate">{currentUrl}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <a href={currentUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-fuchsia-600 text-white rounded-lg text-xs font-medium hover:bg-fuchsia-700">
                <Eye className="h-3.5 w-3.5" /> Ver PDF
              </a>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                {uploading ? 'Enviando...' : 'Trocar'}
                <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
              <button onClick={handleDelete}
                className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <label className={`flex flex-col items-center gap-3 border-2 border-dashed border-fuchsia-200 rounded-xl p-8 cursor-pointer hover:bg-fuchsia-50 transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
            <div className="w-12 h-12 bg-fuchsia-100 rounded-xl flex items-center justify-center">
              {uploading
                ? <div className="animate-spin h-6 w-6 border-2 border-fuchsia-500 border-t-transparent rounded-full" />
                : <Upload className="h-6 w-6 text-fuchsia-500" />}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">{uploading ? 'Enviando PDF...' : 'Clique para enviar o PDF modelo'}</p>
              <p className="text-xs text-gray-400 mt-1">Somente arquivos .pdf</p>
            </div>
            <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        )}

        {status === 'saved' && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" /> PDF modelo salvo com sucesso!
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-xs text-blue-800">
            💡 O PDF modelo é uma referência visual. O gerador de PDF da IA segue automaticamente o layout em 2 colunas com seções por categoria (Cabelo, Maquiagem, Roupas, Acessórios).
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SettingsEditor() {
  const [settings, setSettings] = useState<AppSettings>({
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
    adminEmail: '',
    resendApiKey: '',
    fromEmail: '',
  })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const loadedSettings = await settingsStorageService.getSettings()
      setSettings(loadedSettings)
    } catch (error) {
      console.error('Erro ao carregar configurações:', error)
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
    } catch (error) {
      console.error('Erro ao salvar:', error)
      setMessage({ type: 'error', text: 'Erro ao salvar configurações' })
    } finally {
      setSaving(false)
    }
  }

  const formatPhoneNumber = (value: string) => {
    const numbers = value.replace(/\D/g, '')
    return numbers.slice(0, 13)
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value)
    setSettings({ ...settings, whatsappNumber: formatted })
  }

  const getWhatsAppLink = () => {
    if (!settings.whatsappNumber) return '#'
    return `https://wa.me/${settings.whatsappNumber}`
  }

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Carregando configurações...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Configurações do Sistema</h2>
          <p className="text-gray-600">Configure integrações, PDFs, armazenamento e redirecionamento</p>
        </div>
        <Button onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4 mr-2" />
          Salvar
        </Button>
      </div>

      {/* Mensagens */}
      {message && (
        <div className={`rounded-lg p-4 ${
          message.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-center">
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            )}
            <p className={`text-sm ${message.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
              {message.text}
            </p>
          </div>
        </div>
      )}

      {/* Geração de PDF */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <FileText className="h-5 w-5 text-red-600" />
            <h3 className="text-lg font-medium text-gray-900">Geração de PDF</h3>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Checkbox
            id="enable-pdf"
            checked={settings.enablePdfGeneration}
            onChange={(e: any) => setSettings({ ...settings, enablePdfGeneration: e.target.checked })}
            label="Ativar geração automática de PDFs"
            description="Converte contrato e formulário em PDF automaticamente"
          />

          {settings.enablePdfGeneration && (
            <div className="ml-7 space-y-3 pl-4 border-l-2 border-blue-200">
              <Checkbox
                id="save-contract-pdf"
                checked={settings.saveContractAsPdf}
                onChange={(e: any) => setSettings({ ...settings, saveContractAsPdf: e.target.checked })}
                label="Salvar contrato como PDF"
                description="Gera PDF do contrato assinado pelo cliente"
              />

              <Checkbox
                id="save-form-pdf"
                checked={settings.saveFormAsPdf}
                onChange={(e: any) => setSettings({ ...settings, saveFormAsPdf: e.target.checked })}
                label="Salvar formulário como PDF"
                description="Gera PDF com as respostas do formulário"
              />
            </div>
          )}

          {settings.enablePdfGeneration && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>📄 PDFs Gerados:</strong>
              </p>
              <ul className="text-sm text-blue-700 mt-2 space-y-1 list-disc list-inside">
                {settings.saveContractAsPdf && <li>Contrato assinado em PDF</li>}
                {settings.saveFormAsPdf && <li>Formulário preenchido em PDF</li>}
                <li>Todos os PDFs são salvos no Google Drive configurado</li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Google Drive */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <FolderOpen className="h-5 w-5 text-yellow-600" />
            <h3 className="text-lg font-medium text-gray-900">Google Drive</h3>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={settings.googleDriveFolderId}
            onChange={(e: any) => setSettings({ ...settings, googleDriveFolderId: e.target.value })}
            placeholder="1A2B3C4D5E6F7G8H9I0J"
            label="ID da Pasta Principal do Google Drive"
            helperText="Pasta raiz onde serão criadas subpastas para cada cliente"
          />

          <Input
            value={settings.googleDriveAttachmentsFolder}
            onChange={(e: any) => setSettings({ ...settings, googleDriveAttachmentsFolder: e.target.value })}
            placeholder="1A2B3C4D5E6F7G8H9I0J"
            label="ID da Pasta de Anexos (Opcional)"
            helperText="Pasta específica para salvar fotos e anexos. Deixe vazio para usar subpasta automática"
          />

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800 mb-2">
              <strong>Como obter o ID da pasta:</strong>
            </p>
            <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
              <li>Acesse o Google Drive e crie/abra a pasta desejada</li>
              <li>Copie o ID da URL: drive.google.com/drive/folders/<strong>[ID_AQUI]</strong></li>
              <li>Cole o ID no campo acima</li>
            </ol>
          </div>

          {settings.googleDriveFolderId && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800 mb-2">
                <FolderOpen className="inline h-4 w-4 mr-1" />
                <strong>Estrutura de pastas configurada:</strong>
              </p>
              <div className="text-sm text-green-700 ml-5 space-y-1 font-mono">
                <div>📁 Pasta Principal</div>
                <div className="ml-4">└─ 📁 Cliente_Nome_Data</div>
                <div className="ml-8">├─ 📄 contrato.pdf {settings.saveContractAsPdf && '✓'}</div>
                <div className="ml-8">├─ 📄 formulario.pdf {settings.saveFormAsPdf && '✓'}</div>
                <div className="ml-8">└─ 📁 fotos/</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* WhatsApp */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Phone className="h-5 w-5 text-green-600" />
            <h3 className="text-lg font-medium text-gray-900">WhatsApp</h3>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={settings.whatsappNumber}
            onChange={handlePhoneChange}
            placeholder="5541999999999"
            label="Número do WhatsApp (com DDI e DDD)"
            helperText="Exemplo: 5541999999999 (Brasil: 55, DDD: 41, Número: 999999999)"
          />

          {settings.whatsappNumber && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800 mb-2">
                <strong>Número configurado:</strong> +{settings.whatsappNumber}
              </p>
              <a
                href={getWhatsAppLink()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm text-green-700 hover:text-green-900"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Testar número no WhatsApp
              </a>
            </div>
          )}

          <Checkbox
            id="enable-whatsapp"
            checked={settings.enableWhatsAppNotification}
            onChange={(e: any) => setSettings({ ...settings, enableWhatsAppNotification: e.target.checked })}
            label="Enviar notificação via WhatsApp quando cliente finalizar"
          />

          {settings.enableWhatsAppNotification && (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Mensagem de Notificação
              </label>
              <textarea
                value={settings.notificationMessage}
                onChange={(e) => setSettings({ ...settings, notificationMessage: e.target.value })}
                rows={3}
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Digite a mensagem que será enviada..."
              />
              <p className="text-xs text-gray-500">
                Enviada automaticamente via WhatsApp quando o cliente finalizar
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Redirecionamento */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <ExternalLink className="h-5 w-5 text-purple-600" />
            <h3 className="text-lg font-medium text-gray-900">Redirecionamento Pós-Finalização</h3>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={settings.redirectUrl}
            onChange={(e: any) => setSettings({ ...settings, redirectUrl: e.target.value })}
            placeholder="https://seusite.com/obrigado"
            label="URL de Redirecionamento"
            helperText="Após finalizar, o cliente será redirecionado para esta URL"
          />

          {settings.redirectUrl && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <p className="text-sm text-purple-800 mb-2">
                <ExternalLink className="inline h-4 w-4 mr-1" />
                <strong>Redirecionamento configurado:</strong>
              </p>
              <p className="text-sm text-purple-700">
                Após o envio, redirecionamento automático para:
              </p>
              <a
                href={settings.redirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm text-purple-700 hover:text-purple-900 mt-2 font-mono bg-white px-2 py-1 rounded border border-purple-300 break-all"
              >
                {settings.redirectUrl}
                <ExternalLink className="h-3 w-3 ml-1 flex-shrink-0" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── E-mail (Resend) ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-cyan-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Envio de E-mails</h2>
              <p className="text-sm text-gray-500">Configure para enviar contratos assinados por e-mail</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seu e-mail (para receber notificações)
            </label>
            <input
              type="email"
              value={settings.adminEmail}
              onChange={e => setSettings({ ...settings, adminEmail: e.target.value })}
              placeholder="marilia@mscolors.com.br"
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
              Deve ser um domínio verificado no Resend. Para testes use <span className="font-mono">onboarding@resend.dev</span>.
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
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent font-mono"
              />
              {settings.resendApiKey && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">✓ Configurada</span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
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
              <p className="text-sm text-green-800 font-medium mb-1">✅ E-mail configurado</p>
              <p className="text-sm text-green-700">
                Contratos assinados serão enviados para a cliente e uma cópia para <strong>{settings.adminEmail}</strong>.
              </p>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm text-amber-800">
                ⚠️ Sem e-mail configurado, contratos não serão enviados por e-mail. O restante do fluxo funciona normalmente.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── 4. Seção Gemini adicionada ─────────────────────────────────────── */}
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
              <p className="text-sm text-gray-500">Configure a IA de estilo para suas clientes</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Chave da API */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chave da API Gemini (Google AI Studio)
            </label>
            <div className="relative">
              <input
                type="password"
                value={settings.geminiApiKey}
                onChange={e => setSettings({ ...settings, geminiApiKey: e.target.value })}
                placeholder="AIza..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent font-mono"
              />
              {settings.geminiApiKey && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">✓ Configurada</span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
              Obtenha sua chave gratuita em{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-600 hover:underline font-medium"
              >
                aistudio.google.com
              </a>
            </p>
          </div>

          {/* Recursos habilitados */}
          <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-violet-800">Com a IA ativada, suas clientes poderão:</p>
            <ul className="space-y-1.5">
              {[
                'Conversar com uma consultora de estilo personalizada',
                'Enviar fotos e visualizar como ficariam com novos cabelos',
                'Receber sugestões de maquiagem para seu tom de pele',
                'Descobrir combinações de roupas e acessórios ideais',
                'Baixar as imagens geradas pela IA',
              ].map((item, i) => (
                <li key={i} className="text-sm text-violet-700 flex items-start gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Instrução por cliente */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-medium text-amber-800 mb-1">⚙️ Para cada cliente:</p>
            <p className="text-sm text-amber-700">
              Após salvar a chave, acesse o perfil de cada cliente e configure o{' '}
              <strong>prompt de IA personalizado</strong> com o perfil de coloração, tons de pele, cabelo e preferências dela.
            </p>
          </div>
        </div>
      </div>

      {/* Tags de Informação IA */}
      <TagsManager />

      {/* ── PDF Modelo ─────────────────────────────────────────── */}
      <PdfTemplateSection
        currentUrl={settings.pdfTemplateUrl}
        onSave={(url) => {
          const updated = { ...settings, pdfTemplateUrl: url }
          setSettings(updated)
          settingsStorageService.saveSettings(updated)
        }}
      />

      {/* Resumo */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-medium text-gray-900">Resumo das Configurações</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">Geração de PDF</span>
              {settings.enablePdfGeneration ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-gray-400" />
              )}
            </div>
            
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">Google Drive</span>
              {settings.googleDriveFolderId ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-gray-400" />
              )}
            </div>
            
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">WhatsApp</span>
              {settings.whatsappNumber ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-gray-400" />
              )}
            </div>
            
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">Redirecionamento</span>
              {settings.redirectUrl ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-gray-400" />
              )}
            </div>

            {/* ── 4b. Card de status Gemini no Resumo ── */}
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">IA Gemini</span>
              {settings.geminiApiKey ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-gray-400" />
              )}
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">E-mail (Resend)</span>
              {settings.resendApiKey && settings.adminEmail ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-gray-400" />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fluxo */}
      <Card>
        <CardContent className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800 font-semibold mb-2">
            ℹ️ Fluxo Completo:
          </p>
          <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
            <li>Cliente preenche contrato e formulário</li>
            <li>Sistema gera PDFs (se ativado)</li>
            <li>Fotos e PDFs são enviados para o Google Drive</li>
            <li>Notificação é enviada via WhatsApp (se ativado)</li>
            <li>Cliente é redirecionado para URL configurada (se definida)</li>
            <li>Cliente acessa a consultora de estilo IA no portal (se Gemini configurado)</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}