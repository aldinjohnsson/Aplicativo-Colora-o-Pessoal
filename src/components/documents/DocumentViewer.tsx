import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, Lock, Eye } from 'lucide-react'

const Card = ({ children }: any) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
    {children}
  </div>
)

const CardHeader = ({ children }: any) => (
  <div className="px-6 py-4 border-b border-gray-200">
    {children}
  </div>
)

const CardContent = ({ children }: any) => (
  <div className="px-6 py-4">
    {children}
  </div>
)

const Button = ({ children, onClick, className = '' }: any) => {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${className}`}
    >
      {children}
    </button>
  )
}

const Input = ({ value, onChange, placeholder, type = 'text', className = '' }: any) => (
  <input
    type={type}
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    className={`block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${className}`}
  />
)

export default function DocumentViewer() {
  const { token } = useParams<{ token: string }>()
  const [password, setPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [error, setError] = useState('')

  const handleAuthenticate = () => {
    // Simulação de autenticação
    if (password === 'demo123') {
      setAuthenticated(true)
      setError('')
    } else {
      setError('Senha incorreta. Tente novamente.')
    }
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Card>
            <CardHeader>
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
                  <Lock className="h-6 w-6 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900">Acesso aos Documentos</h2>
                <p className="text-gray-600 mt-2">Token: {token}</p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Senha de Acesso
                  </label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e: any) => setPassword(e.target.value)}
                    placeholder="Digite a senha"
                    onKeyPress={(e: any) => e.key === 'Enter' && handleAuthenticate()}
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                <Button onClick={handleAuthenticate} className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  Acessar Documentos
                </Button>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs text-blue-800">
                    <strong>Dica de teste:</strong> Use a senha "demo123"
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <FileText className="h-6 w-6 text-blue-600" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Documentos do Cliente</h2>
                <p className="text-gray-600">Token: {token}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium text-green-900 mb-2">✓ Acesso Autorizado</h3>
                <p className="text-sm text-green-700">
                  Você tem acesso aos documentos deste cliente.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-gray-900">Contrato Digital</h4>
                      <p className="text-sm text-gray-500">Assinado em: 15/01/2024</p>
                    </div>
                    <Button onClick={() => alert('Visualizando contrato...')}>
                      Ver Documento
                    </Button>
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-gray-900">Formulário de Análise</h4>
                      <p className="text-sm text-gray-500">Preenchido em: 15/01/2024</p>
                    </div>
                    <Button onClick={() => alert('Visualizando formulário...')}>
                      Ver Documento
                    </Button>
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-gray-900">Fotos para Análise</h4>
                      <p className="text-sm text-gray-500">5 fotos enviadas</p>
                    </div>
                    <Button onClick={() => alert('Visualizando fotos...')}>
                      Ver Fotos
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}