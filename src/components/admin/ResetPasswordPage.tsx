import { useState } from 'react'
import { Palette, Eye, EyeOff, CheckCircle2 } from 'lucide-react'

interface ResetPasswordPageProps {
  onSuccess: () => void
  supabase: any
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-rose-400 to-pink-500 rounded-2xl mb-4 shadow-lg">
            <Palette className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">IA Color</h1>
          <p className="text-gray-500 mt-1">Painel Administrativo</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function ResetPasswordPage({ onSuccess, supabase }: ResetPasswordPageProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
      setTimeout(() => onSuccess(), 3000)
    } catch (err: any) {
      setError(err.message || 'Erro ao redefinir senha. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-7 w-7 text-green-500" />
          </div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Senha atualizada!</h2>
          <p className="text-sm text-gray-500 mb-6">
            Sua senha foi alterada com sucesso. Você será redirecionado para o login.
          </p>
          <div className="flex items-center justify-center gap-2 text-gray-400">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />
            <span className="text-sm">Redirecionando…</span>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Criar nova senha</h2>
        <p className="text-sm text-gray-500 mb-6">Escolha uma senha segura com pelo menos 8 caracteres.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                placeholder="Mínimo 8 caracteres"
                disabled={loading}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                disabled={loading}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar senha</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              placeholder="Repita a nova senha"
              disabled={loading}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password || !confirmPassword}
            className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-2.5 rounded-lg font-medium hover:from-rose-500 hover:to-pink-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {loading
              ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
              : 'Salvar nova senha'
            }
          </button>
        </form>
      </div>
    </Shell>
  )
}