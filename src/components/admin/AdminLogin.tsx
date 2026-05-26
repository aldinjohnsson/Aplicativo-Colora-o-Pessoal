// src/components/admin/AdminLogin.tsx
import React, { useState } from 'react'
import { Palette, Eye, EyeOff, ArrowLeft, Mail, CheckCircle2 } from 'lucide-react'
import { adminService } from '../../lib/services'

interface Props {
  onLogin: (user: any) => void
}

type View = 'login' | 'forgot' | 'forgot-sent'

export function AdminLogin({ onLogin }: Props) {
  const [view, setView] = useState<View>('login')

  // Login
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Esqueci senha
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')

  // ── Login ──────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const user = await adminService.login(email, password)
      onLogin(user)
    } catch (err: any) {
      setError(err.message || 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  // ── Recuperação de senha ───────────────────────────────────────────
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotLoading(true)
    setForgotError('')
    try {
      await adminService.requestPasswordReset(forgotEmail.trim().toLowerCase())
      setView('forgot-sent')
    } catch (err: any) {
      setForgotError(err.message || 'Erro ao enviar e-mail de recuperação')
    } finally {
      setForgotLoading(false)
    }
  }

  // ── Shared layout wrapper ─────────────────────────────────────────
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-rose-400 to-pink-500 rounded-2xl mb-4 shadow-lg">
            <Palette className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">MS Colors</h1>
          <p className="text-gray-500 mt-1">Painel Administrativo</p>
        </div>
        {children}
      </div>
    </div>
  )

  // ── View: Login ───────────────────────────────────────────────────
  if (view === 'login') {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">Entrar</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="admin@exemplo.com"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Esqueci minha senha */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email) // pré-preenche com o e-mail já digitado
                  setForgotError('')
                  setView('forgot')
                }}
                className="text-sm text-rose-500 hover:text-rose-600 font-medium transition-colors"
              >
                Esqueci minha senha
              </button>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-2.5 rounded-lg font-medium hover:from-rose-500 hover:to-pink-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading
                ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                : 'Entrar'
              }
            </button>
          </form>
        </div>
      </Shell>
    )
  }

  // ── View: Esqueci senha ───────────────────────────────────────────
  if (view === 'forgot') {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <button
            type="button"
            onClick={() => setView('login')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao login
          </button>

          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Mail className="h-5 w-5 text-rose-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800 leading-tight">Recuperar senha</h2>
              <p className="text-sm text-gray-500">Enviaremos um link para seu e-mail</p>
            </div>
          </div>

          <form onSubmit={handleForgot} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail da conta</label>
              <input
                type="email"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                required
                autoFocus
                placeholder="admin@exemplo.com"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent"
              />
            </div>

            {forgotError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm text-red-700">{forgotError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={forgotLoading}
              className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-2.5 rounded-lg font-medium hover:from-rose-500 hover:to-pink-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {forgotLoading
                ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                : 'Enviar link de recuperação'
              }
            </button>
          </form>
        </div>
      </Shell>
    )
  }

  // ── View: Enviado com sucesso ──────────────────────────────────────
  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="h-7 w-7 text-green-500" />
        </div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">E-mail enviado!</h2>
        <p className="text-sm text-gray-500 mb-1">
          Se <span className="font-medium text-gray-700">{forgotEmail}</span> estiver cadastrado,
          você receberá um link para redefinir sua senha.
        </p>
        <p className="text-xs text-gray-400 mb-6">Verifique também a pasta de spam.</p>
        <button
          type="button"
          onClick={() => setView('login')}
          className="text-sm text-rose-500 hover:text-rose-600 font-medium transition-colors"
        >
          Voltar ao login
        </button>
      </div>
    </Shell>
  )
}