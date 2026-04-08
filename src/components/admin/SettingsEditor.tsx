import React, { useState, useEffect } from 'react'
import { Save, Phone, CheckCircle, AlertCircle, ExternalLink, FolderOpen, FileText } from 'lucide-react'

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
}

// Serviço de storage
const settingsStorageService = {
  async saveSettings(data: AppSettings) {
    try {
      const jsonData = JSON.stringify(data)
      
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          await (window as any).storage.set('app-settings', jsonData, true)
        } catch (e) {
          localStorage.setItem('app-settings', jsonData)
        }
      } else {
        localStorage.setItem('app-settings', jsonData)
      }
      
      return { success: true }
    } catch (error) {
      console.error('Erro ao salvar configurações:', error)
      throw error
    }
  },

  async getSettings(): Promise<AppSettings> {
    try {
      let jsonData: string | null = null
      
      if (typeof window !== 'undefined' && (window as any).storage) {
        try {
          const result = await (window as any).storage.get('app-settings', true)
          if (result && result.value) {
            jsonData = result.value
          }
        } catch (e) {
          jsonData = localStorage.getItem('app-settings')
        }
      } else {
        jsonData = localStorage.getItem('app-settings')
      }
      
      if (jsonData) {
        return JSON.parse(jsonData)
      }
      
      return {
        whatsappNumber: '',
        googleDriveFolderId: '',
        enableWhatsAppNotification: true,
        notificationMessage: 'Olá! Finalizei todas as etapas da análise de coloração pessoal. Aguardo o retorno! 🎨',
        redirectUrl: '',
        enablePdfGeneration: true,
        saveContractAsPdf: true,
        saveFormAsPdf: true,
        googleDriveAttachmentsFolder: ''
      }
    } catch (error) {
      console.error('Erro ao carregar configurações:', error)
      return {
        whatsappNumber: '',
        googleDriveFolderId: '',
        enableWhatsAppNotification: true,
        notificationMessage: 'Olá! Finalizei todas as etapas. Aguardo retorno! 🎨',
        redirectUrl: '',
        enablePdfGeneration: true,
        saveContractAsPdf: true,
        saveFormAsPdf: true,
        googleDriveAttachmentsFolder: ''
      }
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
    googleDriveAttachmentsFolder: ''
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
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}