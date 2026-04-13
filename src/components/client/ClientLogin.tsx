// src/components/client/ClientLogin.tsx
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Palette, Mail, Calendar, LogIn, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export function ClientLogin() {
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !birthDate) {
      setError('Preencha o e-mail e a data de nascimento.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { data, error: rpcError } = await supabase.rpc('get_client_token_by_credentials', {
        p_email: email.trim().toLowerCase(),
        p_birth_date: birthDate, // formato YYYY-MM-DD (input type="date")
      })

      if (rpcError) throw rpcError
      if (data?.error) {
        setError(data.error)
        return
      }

      navigate(`/c/${data.token}`)
    } catch (err: any) {
      setError('Erro ao acessar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-rose-400 to-pink-500 rounded-2xl mb-4 shadow-lg">
            <Palette className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">MS Colors</h1>
          <p className="text-gray-500 mt-1">Acesse seu portal de análise</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Entrar</h2>
          <p className="text-sm text-gray-500 mb-6">
            Use o e-mail cadastrado e sua data de nascimento como senha.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="seu@email.com"
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Data de Nascimento <span className="text-gray-400 font-normal">(sua senha)</span>
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="date"
                  value={birthDate}
                  onChange={e => setBirthDate(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-rose-400 to-pink-500 text-white py-2.5 rounded-xl font-medium hover:from-rose-500 hover:to-pink-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading
                ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                : <><LogIn className="h-4 w-4" /> Acessar</>
              }
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-6">
            Não consegue acessar? Entre em contato com a consultora.
          </p>
        </div>
      </div>
    </div>
  )
}
