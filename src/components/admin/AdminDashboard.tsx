// src/components/admin/AdminDashboard.tsx
import React, { useState, useEffect, useRef } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Users, Layers, LogOut, Palette, Settings, FolderOpen, Menu, X, ChevronRight } from 'lucide-react'
import { adminService } from '../../lib/services'
import { ClientsManager } from './ClientsManager'
import { PlansManager } from './PlansManager'
import { FoldersManager } from './FoldersManager'
import SettingsEditor from './SettingsEditor'

interface Props {
  onLogout: () => void
}

const NAV_ITEMS = [
  { to: '/admin/clients', label: 'Clientes', icon: Users, description: 'Gerenciar clientes' },
  { to: '/admin/plans', label: 'Planos', icon: Layers, description: 'Planos e pacotes' },
  { to: '/admin/folders', label: 'Pastas IA', icon: FolderOpen, description: 'Pastas de análise IA' },
  { to: '/admin/settings', label: 'Configurações', icon: Settings, description: 'Ajustes do sistema' },
]

// Global nav context so ClientsManager can trigger the drawer
export const NavContext = React.createContext<{ openNav: () => void }>({ openNav: () => {} })

export function AdminDashboard({ onLogout }: Props) {
  const [navOpen, setNavOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const drawerRef = useRef<HTMLDivElement>(null)

  // Close on route change
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  // Close on outside click
  useEffect(() => {
    if (!navOpen) return
    const h = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) setNavOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [navOpen])

  // Escape key
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  const handleLogout = async () => {
    await adminService.logout()
    onLogout()
    navigate('/admin/login')
  }

  const isClientsRoute = location.pathname.startsWith('/admin/clients')

  return (
    <NavContext.Provider value={{ openNav: () => setNavOpen(true) }}>
      <div className="min-h-screen bg-gray-100 flex flex-col">

        {/* ── Global Nav Drawer Overlay ── */}
        {navOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            style={{ transition: 'opacity 0.2s' }}
          />
        )}

        {/* ── Nav Drawer ── */}
        <div
          ref={drawerRef}
          className="fixed left-0 top-0 bottom-0 z-50 flex flex-col"
          style={{
            width: 280,
            background: '#1a1a2e',
            transform: navOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: navOpen ? '4px 0 32px rgba(0,0,0,0.4)' : 'none',
          }}
        >
          {/* Drawer header */}
          <div style={{
            padding: '20px 20px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36,
                background: 'linear-gradient(135deg, #e91e63, #ff6090)',
                borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(233,30,99,0.4)',
              }}>
                <Palette size={18} color="white" />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>MS Colors</p>
                <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Painel Admin</p>
              </div>
            </div>
            <button
              onClick={() => setNavOpen(false)}
              style={{
                background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8,
                color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: 6, display: 'flex',
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: '12px 12px 0' }}>
            {NAV_ITEMS.map(({ to, label, icon: Icon, description }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setNavOpen(false)}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 12px', borderRadius: 10, marginBottom: 2,
                  textDecoration: 'none', transition: 'background 0.15s',
                  background: isActive ? 'rgba(233,30,99,0.2)' : 'transparent',
                  border: isActive ? '1px solid rgba(233,30,99,0.3)' : '1px solid transparent',
                })}
              >
                {({ isActive }) => (
                  <>
                    <div style={{
                      width: 34, height: 34, borderRadius: 8, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: isActive ? 'rgba(233,30,99,0.3)' : 'rgba(255,255,255,0.06)',
                    }}>
                      <Icon size={17} color={isActive ? '#ff6090' : 'rgba(255,255,255,0.5)'} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: isActive ? 700 : 500, color: isActive ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                        {label}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{description}</p>
                    </div>
                    {isActive && <ChevronRight size={14} color="rgba(233,30,99,0.7)" />}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Logout */}
          <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              onClick={handleLogout}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <LogOut size={17} color="rgba(255,255,255,0.4)" />
              </div>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>Sair</span>
            </button>
          </div>
        </div>

        {/* ── Non-kanban top bar (hidden on clients route since ClientsManager is fixed) ── */}
        {!isClientsRoute && (
          <header style={{
            height: 52, background: '#1a1a2e', display: 'flex', alignItems: 'center',
            padding: '0 16px', gap: 12, position: 'sticky', top: 0, zIndex: 40,
            boxShadow: '0 1px 8px rgba(0,0,0,0.3)',
          }}>
            <button
              onClick={() => setNavOpen(true)}
              style={{
                background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8,
                padding: '7px 9px', cursor: 'pointer', display: 'flex', color: 'rgba(255,255,255,0.8)',
              }}
            >
              <Menu size={18} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 28, height: 28, background: 'linear-gradient(135deg, #e91e63, #ff6090)',
                borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Palette size={14} color="white" />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>MS Colors</span>
            </div>

            {/* Inline nav for non-kanban pages */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 8 }}>
              {NAV_ITEMS.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  style={({ isActive }) => ({
                    padding: '5px 10px', borderRadius: 6, fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.45)',
                    background: isActive ? 'rgba(233,30,99,0.25)' : 'transparent',
                    textDecoration: 'none', transition: 'all 0.15s',
                  })}
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </header>
        )}

        {/* ── Main content ── */}
        <main className={isClientsRoute ? '' : 'flex-1'}>
          <Routes>
            <Route path="clients/*" element={<ClientsManager onOpenNav={() => setNavOpen(true)} />} />
            <Route path="plans/*" element={
              <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                <PlansManager />
              </div>
            } />
            <Route path="folders" element={
              <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                <FoldersManager />
              </div>
            } />
            <Route path="settings" element={
              <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                <SettingsEditor />
              </div>
            } />
            <Route index element={<Navigate to="clients" replace />} />
          </Routes>
        </main>
      </div>
    </NavContext.Provider>
  )
}