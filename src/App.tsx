// src/App.tsx
import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AdminLogin } from './components/admin/AdminLogin'
import { AdminDashboard } from './components/admin/AdminDashboard'
import ResetPasswordPage from './components/admin/ResetPasswordPage'
import { ClientPortal } from './components/client/ClientPortal'
import { ClientLogin } from './components/client/ClientLogin'
import { adminService } from './lib/services'
import { supabase } from './lib/supabase'
import { ClientSignup } from './components/client/ClientSignup'
import { LandingPage } from './components/LandingPage'

// AppRoutes precisa ficar dentro de <Router> para que useNavigate funcione.
function AppRoutes() {
  const navigate = useNavigate()
  const [adminUser, setAdminUser] = useState<any>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    let settled = false

    // Watchdog: se getSession() não resolver em 8s, é sinal de que o
    // supabase-js entrou no loop de "refresh token inválido → 429 → tenta
    // de novo → 429..." (bug interno da lib, fora do nosso controle — ver
    // stack trace desse bug: _refreshAccessToken/_callRefreshToken em
    // loop). Sem essa trava, a tela de loading fica girando pra sempre e
    // o usuário fica travado fora do sistema até limpar o storage na mão.
    const watchdog = setTimeout(() => {
      if (settled) return
      console.warn('[App] getSession travou (provável loop de refresh de token) — limpando sessão local e recarregando.')
      try { indexedDB.deleteDatabase('supabase-auth') } catch {}
      try { localStorage.clear() } catch {}
      window.location.reload()
    }, 8000)

    adminService.getSession().then(user => {
      settled = true
      clearTimeout(watchdog)
      setAdminUser(user)
      setCheckingAuth(false)
    })

    return () => clearTimeout(watchdog)
  }, [])

  // Fecha o popup após redirect do OAuth do Google Drive.
  // O backend redireciona o popup para cá com ?drive_connected=1
  // para evitar COOP — mesma origem = window.close() funciona normalmente.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('drive_connected') === '1') {
      window.history.replaceState({}, '', window.location.pathname)
      window.close()
    }
  }, [])

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" />
      </div>
    )
  }

  return (
    <Routes>

      {/* ── Landing page de entrada ──
          Se já tem sessão de admin, pula a landing e vai direto pro painel
          — é o que faz "sair e voltar" (fechar o app/ícone e reabrir)
          cair de novo em /admin/clients (ou /admin/ms-color-ia, conforme
          o role) em vez de mostrar a página pública de novo. */}
      <Route path="/" element={
        adminUser ? <Navigate to="/admin" replace /> : <LandingPage />
      } />

      {/* Portal do cliente via token (link direto) */}
      <Route path="/c/:token" element={<ClientPortal />} />

      {/* Login do cliente (email + data de nascimento) */}
      <Route path="/acesso" element={<ClientLogin />} />

      {/* Cadastro via link compartilhado */}
      <Route path="/p/:shareToken" element={<ClientSignup />} />

      {/* Admin */}
      <Route
        path="/admin/login"
        element={
          adminUser
            ? <Navigate to="/admin" replace />
            : <AdminLogin onLogin={setAdminUser} />
        }
      />
      <Route
        path="/admin/reset-password"
        element={
          <ResetPasswordPage
            onSuccess={() => navigate('/admin/login')}
            supabase={supabase}
          />
        }
      />
      <Route
        path="/admin/*"
        element={
          adminUser
            ? <AdminDashboard onLogout={() => setAdminUser(null)} />
            : <Navigate to="/admin/login" replace />
        }
      />

      <Route path="*" element={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Página não encontrada</h1>
            <p className="text-gray-500">Verifique o link de acesso.</p>
          </div>
        </div>
      } />
    </Routes>
  )
}

function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  )
}

export default App