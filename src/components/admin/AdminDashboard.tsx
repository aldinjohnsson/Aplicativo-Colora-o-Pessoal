// src/components/admin/AdminDashboard.tsx
import React, { useState } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { Users, Layers, LogOut, Palette, Menu, X, Settings, FolderOpen } from 'lucide-react'
import { adminService } from '../../lib/services'
import { ClientsManager } from './ClientsManager'
import { PlansManager } from './PlansManager'
import { FoldersManager } from './FoldersManager'
import SettingsEditor from './SettingsEditor'

interface Props {
  onLogout: () => void
}

export function AdminDashboard({ onLogout }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()

  const handleLogout = async () => {
    await adminService.logout()
    onLogout()
    navigate('/admin/login')
  }

  const navItems = [
    { to: '/admin/clients', label: 'Clientes', icon: Users },
    { to: '/admin/plans', label: 'Planos', icon: Layers },
    { to: '/admin/folders', label: 'Pastas IA', icon: FolderOpen },
    { to: '/admin/settings', label: 'Configurações', icon: Settings },
  ]

  const NavItems = () => (
    <>
      {navItems.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-rose-50 text-rose-600'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`
          }
        >
          <Icon className="h-5 w-5 flex-shrink-0" />
          {label}
        </NavLink>
      ))}
    </>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-gray-200 fixed inset-y-0">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
          <div className="w-8 h-8 bg-gradient-to-br from-rose-400 to-pink-500 rounded-lg flex items-center justify-center">
            <Palette className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-gray-900">MS Colors</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItems />
        </nav>

        <div className="px-3 py-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2.5 w-full rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LogOut className="h-5 w-5" />
            Sair
          </button>
        </div>
      </aside>

      {/* Header mobile */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-rose-400 to-pink-500 rounded-lg flex items-center justify-center">
            <Palette className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-gray-900">MS Colors</span>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="text-gray-600">
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-20 bg-black/40" onClick={() => setMobileOpen(false)}>
          <div className="bg-white w-60 h-full" onClick={e => e.stopPropagation()}>
            <div className="px-3 pt-16 pb-4 space-y-1">
              <NavItems />
            </div>
            <div className="px-3 border-t border-gray-100 pt-4">
              <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-2.5 w-full rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">
                <LogOut className="h-5 w-5" />
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 lg:ml-60 pt-14 lg:pt-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <Routes>
            <Route path="clients/*" element={<ClientsManager />} />
            <Route path="plans/*" element={<PlansManager />} />
            <Route path="folders" element={<FoldersManager />} />
            <Route path="settings" element={<SettingsEditor />} />
            <Route index element={<Navigate to="clients" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}