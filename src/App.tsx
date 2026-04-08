import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ClientDashboard } from './components/client/ClientDashboard'
import { AdminDashboard } from './components/admin/AdminDashboard'
import DocumentViewer from './components/documents/DocumentViewer'

function App() {
  // Simular um usuÃ¡rio cliente para desenvolvimento
  // VocÃª pode alterar para 'admin' se quiser testar o painel administrativo
  const mockUserRole = 'client' // ou 'admin'

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            mockUserRole === 'admin' ? (
              <Navigate to="/admin" replace />
            ) : (
              <Navigate to="/client" replace />
            )
          }
        />
        <Route
          path="/client"
          element={<ClientDashboard />}
        />
        <Route
          path="/admin"
          element={<AdminDashboard />}
        />
        <Route
          path="/documents/:token"
          element={<DocumentViewer />}
        />
      </Routes>
    </Router>
  )
}

export default App