// src/components/client/ClientLogin.tsx
import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Palette, Mail, Calendar, LogIn, AlertCircle, CheckCircle2, Clock, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { LanguageProvider, useTranslation } from '../../lib/i18n'
import { LanguageSwitcher } from './LanguageSwitcher'
import { clientThemeVars } from '../../lib/clientTheme'

interface ClientCandidate {
  token: string
  name: string
  status: string
  plan_name: string | null
  created_at: string
}

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
  const location = useLocation()
  const navState = location.state as { email?: string; adminId?: string | null } | null
  const prefilledEmail = navState?.email || ''
  const scopedAdminId = navState?.adminId || null
  const [email, setEmail] = useState(prefilledEmail)
  const [birthDate, setBirthDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [candidates, setCandidates] = useState<ClientCandidate[] | null>(null)
  const navigate = useNavigate()
  const birthDateRef = React.useRef<HTMLInputElement>(null)

  // Veio do "Fazer login" no cadastro (e-mail já preenchido) — só falta a
  // "senha" (data de nascimento), então já foca direto nela.
  React.useEffect(() => {
    if (prefilledEmail) birthDateRef.current?.focus()
  }, [prefilledEmail])

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
        p_admin_id: scopedAdminId,
      })

      if (rpcError) throw rpcError
      if (data?.error) {
        // Mensagem vem do backend — mantida como veio (normalmente já é curta e neutra).
        setError(data.error)
        return
      }

      const list: ClientCandidate[] = data?.clients || []
      if (list.length === 0) {
        setError(t('login.errorGeneric'))
        return
      }

      // Só uma análise pra esse e-mail+nascimento — entra direto, como sempre foi.
      if (list.length === 1) {
        navigate(`/c/${list[0].token}`)
        return
      }

      // Mais de uma análise (cliente repetiu com o mesmo e-mail) — mostra a
      // tela de escolha em vez de entrar automaticamente em qualquer uma.
      setCandidates(list)
    } catch (err: any) {
      setError(t('login.errorGeneric'))
    } finally {
      setLoading(false)
    }
  }

  // ── Tela de escolha: mais de uma análise encontrada ────────────────
  if (candidates) {
    return (
      <div
        className="min-h-screen bg-gradient-to-br from-[var(--client-bg)] to-white flex items-center justify-center p-4"
        style={clientThemeVars() as React.CSSProperties}
      >
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-[var(--client-accent-light)] to-[var(--client-accent)] rounded-2xl mb-4 shadow-lg">
              <Palette className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Suas análises</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Encontramos mais de uma análise com esse e-mail. Escolha qual quer acessar.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden">
            {candidates.map(c => {
              const isCompleted = c.status === 'completed'
              return (
                <button
                  key={c.token}
                  type="button"
                  onClick={() => navigate(`/c/${c.token}`)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                    isCompleted ? 'bg-green-100' : 'bg-amber-100'
                  }`}>
                    {isCompleted
                      ? <CheckCircle2 className="h-4.5 w-4.5 text-green-600" />
                      : <Clock className="h-4.5 w-4.5 text-amber-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {c.plan_name || 'Análise de coloração'}
                    </p>
                    <p className={`text-xs mt-0.5 ${isCompleted ? 'text-green-600' : 'text-amber-600'}`}>
                      {isCompleted ? 'Concluída — ver resultado' : 'Em andamento'}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => { setCandidates(null); setError('') }}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 mt-4 transition-colors"
          >
            ← Voltar
          </button>
        </div>
      </div>
    )
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
                  ref={birthDateRef}
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