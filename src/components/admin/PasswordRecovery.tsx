// src/components/admin/PasswordRecovery.tsx
import React, { useEffect, useState } from 'react'
import { SupabaseClient } from '@supabase/supabase-js'
import { adminService } from '../../lib/services'

interface PasswordRecoveryProps {
  onBackToLogin: () => void
  supabase: SupabaseClient
}

type Step = 'request' | 'reset' | 'done'

export function PasswordRecovery({ onBackToLogin, supabase }: PasswordRecoveryProps) {
  const [step, setStep] = useState<Step>('request')

  // E-mail
  const [email, setEmail]           = useState('')
  const [emailSent, setEmailSent]   = useState(false)

  // Nova senha
  const [password, setPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Detecta sessão de recuperação (link do e-mail)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setStep('reset')
        setError(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  // ── Passo 1: solicitar o e-mail ──────────────────────────────────────────
  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await adminService.requestPasswordReset(email.trim())
      setEmailSent(true)
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar e-mail de recuperação.')
    } finally {
      setLoading(false)
    }
  }

  // ── Passo 2: definir nova senha ──────────────────────────────────────────
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

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
      await adminService.updatePassword(password)
      setStep('done')
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar senha.')
    } finally {
      setLoading(false)
    }
  }

  // ── Layout compartilhado ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">

          {/* Header */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-50 mb-4">
              {step === 'done' ? (
                <svg className="w-6 h-6 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              )}
            </div>

            <h1 className="text-xl font-semibold text-gray-900">
              {step === 'request' && 'Recuperar senha'}
              {step === 'reset'   && 'Criar nova senha'}
              {step === 'done'    && 'Senha atualizada!'}
            </h1>

            <p className="mt-1 text-sm text-gray-500">
              {step === 'request' && !emailSent && 'Digite seu e-mail para receber o link de recuperação.'}
              {step === 'request' && emailSent  && `Enviamos um link para ${email}. Verifique sua caixa de entrada.`}
              {step === 'reset'   && 'Escolha uma senha segura com pelo menos 8 caracteres.'}
              {step === 'done'    && 'Sua senha foi alterada com sucesso. Você já pode entrar.'}
            </p>
          </div>

          {/* ── Passo 1: formulário de e-mail ─────────────────────────── */}
          {step === 'request' && !emailSent && (
            <form onSubmit={handleRequestReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-mail
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Enviando…' : 'Enviar link de recuperação'}
              </button>
            </form>
          )}

          {/* ── Passo 1 concluído: e-mail enviado ─────────────────────── */}
          {step === 'request' && emailSent && (
            <button
              onClick={() => { setEmailSent(false); setEmail('') }}
              className="w-full py-2.5 border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              Usar outro e-mail
            </button>
          )}

          {/* ── Passo 2: nova senha ────────────────────────────────────── */}
          {step === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nova senha
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirmar senha
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Salvando…' : 'Salvar nova senha'}
              </button>
            </form>
          )}

          {/* ── Passo 3: concluído ────────────────────────────────────── */}
          {step === 'done' && (
            <button
              onClick={onBackToLogin}
              className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Ir para o login
            </button>
          )}

          {/* Voltar ao login (sempre visível exceto na tela de sucesso) */}
          {step !== 'done' && (
            <button
              onClick={onBackToLogin}
              className="mt-4 w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              ← Voltar ao login
            </button>
          )}
        </div>
      </div>
    </div>
  )
}