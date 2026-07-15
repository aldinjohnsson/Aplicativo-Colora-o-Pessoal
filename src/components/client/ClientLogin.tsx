// src/components/client/ClientLogin.tsx
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Palette, Mail, Calendar, LogIn, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { LanguageProvider, useTranslation } from '../../lib/i18n'
import { LanguageSwitcher } from './LanguageSwitcher'
import { clientThemeVars } from '../../lib/clientTheme'

// A tela de login é acessada ANTES de existir qualquer token de cliente —
// por isso o LanguageProvider aqui não recebe persistKey (usa uma chave
// genérica no localStorage, compartilhada entre visitas nesta tela) nem
// fallbackLanguage (não há admin/plano conhecido neste ponto ainda).
//
// ⚠️ Sem este wrapper, `useTranslation()` (chamado logo abaixo em
// ClientLoginInner) lança um erro porque não existe LanguageProvider
// ancestral — mesmo tipo de crash de tela branca que já aconteceu no
// ClientSignup.tsx com o SignatureCanvas.
export function ClientLogin() {
  return (
    <LanguageProvider>
      <ClientLoginInner />
    </LanguageProvider>
  )
}

function ClientLoginInner() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !birthDate) {
      setError(t('login.errorMissingFields'))
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
        // Mensagem vem do backend — mantida como veio (normalmente já é curta e neutra).
        setError(data.error)
        return
      }

      navigate(`/c/${data.token}`)
    } catch (err: any) {
      setError(t('login.errorGeneric'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-[var(--client-bg)] to-white flex items-center justify-center p-4"
      style={clientThemeVars() as React.CSSProperties}
    >
      <div className="w-full max-w-md">
        {/* Seletor de idioma — antes do login o cliente ainda não tem token nem
            preferência salva no banco, então o LanguageProvider aqui de cima usa
            só localStorage genérico + idioma do navegador como ponto de partida. */}
        <div className="flex justify-end mb-3">
          <LanguageSwitcher />
        </div>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-[var(--client-accent-light)] to-[var(--client-accent)] rounded-2xl mb-4 shadow-lg">
            <Palette className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('login.title')}</h1>
          <p className="text-gray-500 mt-1">{t('login.subtitle')}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">{t('login.heading')}</h2>
          <p className="text-sm text-gray-500 mb-6">
            {t('login.instructions')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.emailLabel')}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder={t('login.emailPlaceholder')}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--client-accent)] focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('login.birthDateLabel')} <span className="text-gray-400 font-normal">{t('login.birthDatePasswordHint')}</span>
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="date"
                  value={birthDate}
                  onChange={e => setBirthDate(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--client-accent)] focus:border-transparent"
                />
              </div>
              {/* O placeholder nativo do <input type="date"> segue o idioma do
                  sistema operacional em alguns navegadores — essa legenda
                  garante que o formato esperado sempre apareça certo. */}
              <p className="text-xs text-gray-400 mt-1">{t('signup.birthDateFormatHint')}</p>
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
              className="w-full bg-gradient-to-r from-[var(--client-accent-light)] to-[var(--client-accent)] text-white py-2.5 rounded-xl font-medium hover:from-[var(--client-accent)] hover:to-[var(--client-accent-dark)] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading
                ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                : <><LogIn className="h-4 w-4" /> {t('login.submit')}</>
              }
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-6">
            {t('common.contactConsultant')}
          </p>
        </div>
      </div>
    </div>
  )
}