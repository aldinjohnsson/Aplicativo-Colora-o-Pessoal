// src/App.tsx
import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AdminLogin } from './components/admin/AdminLogin'
import { AdminDashboard } from './components/admin/AdminDashboard'
import { ClientPortal } from './components/client/ClientPortal'
import { ClientLogin } from './components/client/ClientLogin'
import { adminService } from './lib/services'
import { ClientSignup } from './components/client/ClientSignup'

function App() {
  const [adminUser, setAdminUser] = useState<any>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    adminService.getSession().then(user => {
      setAdminUser(user)
      setCheckingAuth(false)
    })
  }, [])

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" />
      </div>
    )
  }

  return (
    <Router>
      <Routes>
        
        {/* Portal do cliente via token (link direto) */}
        <Route path="/c/:token" element={<ClientPortal />} />

        {/* Login do cliente (email + data de nascimento) */}
        <Route path="/acesso" element={<ClientLogin />} />

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
          path="/admin/*"
          element={
            adminUser
              ? <AdminDashboard onLogout={() => setAdminUser(null)} />
              : <Navigate to="/admin/login" replace />
          }
        />

        {/* Raiz → login do cliente */}
        <Route path="/" element={<Navigate to="/acesso" replace />} />

        <Route path="*" element={
          <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-800 mb-2">Página não encontrada</h1>
              <p className="text-gray-500">Verifique o link de acesso.</p>
            </div>
          </div>
        } />
      </Routes>
    </Router>
  )
}

export default App