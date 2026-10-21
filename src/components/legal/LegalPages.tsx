// src/components/legal/LegalPages.tsx
import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Palette } from 'lucide-react'
import { clientThemeVars } from '../../lib/clientTheme'
import {
  LEGAL_UPDATED_AT,
  TERMS_SECTIONS,
  CLIENT_TERMS_ORDER,
  CONSULTANT_TERMS_ORDER,
  PRIVACY_SECTIONS,
  type LegalSection,
} from '../../lib/legalContent'

// ── Rotas (use estas constantes em App.tsx e nos links) ────────────────
export const LEGAL_ROUTES = {
  termsClient: '/termos/cliente',
  termsConsultant: '/termos/consultor',
  privacy: '/privacidade',
} as const

// ── **negrito** inline ─────────────────────────────────────────────────
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>
  )
}

// ── Corpo: blocos separados por linha em branco; "- " vira lista ───────
function renderBody(rawBody: string, n: number) {
  const body = rawBody.replace(/\{n\}/g, String(n))
  return body.split(/\n\s*\n/).map((block, i) => {
    const lines = block.split('\n')
    if (lines.every(l => l.trim().startsWith('- '))) {
      return (
        <ul key={i} className="list-disc pl-5 space-y-1 text-gray-700">
          {lines.map((l, j) => <li key={j}>{renderInline(l.trim().slice(2))}</li>)}
        </ul>
      )
    }
    return (
      <p key={i} className="text-gray-700 whitespace-pre-line">
        {renderInline(block)}
      </p>
    )
  })
}

// ── Layout comum ───────────────────────────────────────────────────────
function LegalLayout({ title, subtitle, sections, otherLinks }: {
  title: string
  subtitle: string
  sections: LegalSection[]
  otherLinks: { to: string; label: string }[]
}) {
  const navigate = useNavigate()

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-[var(--client-bg)] to-white"
      style={clientThemeVars() as React.CSSProperties}
    >
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-[var(--client-accent-light)] to-[var(--client-accent)] rounded-xl flex items-center justify-center shadow">
            <Palette className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{title}</h1>
        </div>
        <p className="text-sm text-gray-500 mb-1">{subtitle}</p>
        <p className="text-xs text-gray-400 mb-8">Última atualização: {LEGAL_UPDATED_AT}</p>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-8 space-y-8">
          {sections.map((s, i) => (
            <section key={i} className="space-y-3 text-sm leading-relaxed">
              <h2 className="text-base font-semibold text-gray-900">
                {i + 1}. {s.title}
              </h2>
              {renderBody(s.body, i + 1)}
            </section>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-6 text-xs text-gray-400">
          {otherLinks.map(l => (
            <Link key={l.to} to={l.to} className="hover:text-gray-600 underline underline-offset-2">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Páginas ────────────────────────────────────────────────────────────
export function TermsClientPage() {
  return (
    <LegalLayout
      title="Termos de Uso — Cliente"
      subtitle="Regras para quem acessa a área do cliente da plataforma MS Color IA."
      sections={CLIENT_TERMS_ORDER.map(k => TERMS_SECTIONS[k])}
      otherLinks={[
        { to: LEGAL_ROUTES.privacy, label: 'Política de Privacidade' },
        { to: LEGAL_ROUTES.termsConsultant, label: 'Termos para consultores' },
      ]}
    />
  )
}

export function TermsConsultantPage() {
  return (
    <LegalLayout
      title="Termos de Uso — Consultor"
      subtitle="Regras para consultores que contratam e utilizam a plataforma MS Color IA."
      sections={CONSULTANT_TERMS_ORDER.map(k => TERMS_SECTIONS[k])}
      otherLinks={[
        { to: LEGAL_ROUTES.privacy, label: 'Política de Privacidade' },
        { to: LEGAL_ROUTES.termsClient, label: 'Termos para clientes' },
      ]}
    />
  )
}

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Política de Privacidade"
      subtitle="Como a MS Color IA trata dados pessoais (LGPD)."
      sections={PRIVACY_SECTIONS}
      otherLinks={[
        { to: LEGAL_ROUTES.termsClient, label: 'Termos para clientes' },
        { to: LEGAL_ROUTES.termsConsultant, label: 'Termos para consultores' },
      ]}
    />
  )
}

// ── Links de rodapé (login, planos, cadastro) ──────────────────────────
// audience="client"     → tela de login/cadastro do cliente
// audience="consultant" → abaixo de cada plano / login do admin
export function LegalLinks({ audience, className = '' }: {
  audience: 'client' | 'consultant'
  className?: string
}) {
  const terms = audience === 'client' ? LEGAL_ROUTES.termsClient : LEGAL_ROUTES.termsConsultant
  return (
    <p className={`text-xs text-gray-400 text-center ${className}`}>
      Ao continuar, você concorda com os{' '}
      <Link to={terms} target="_blank" rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-gray-600">
        Termos de Uso
      </Link>{' '}
      e a{' '}
      <Link to={LEGAL_ROUTES.privacy} target="_blank" rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-gray-600">
        Política de Privacidade
      </Link>.
    </p>
  )
}