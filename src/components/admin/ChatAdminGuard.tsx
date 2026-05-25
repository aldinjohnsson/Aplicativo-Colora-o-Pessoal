// src/components/admin/ChatAdminGuard.tsx
//
// Wrapper de rota que bloqueia chat_admin de acessar rotas restritas
// (clientes, planos, documentos, painel de admins). Se o usuário for
// chat_admin, redireciona pra /admin/ms-color-ia. Se for admin ou
// super_admin, renderiza o children normalmente.
//
// Uso:
//   <Route path="/admin/clients/*"
//     element={<ChatAdminGuard><ClientsManager /></ChatAdminGuard>} />
//
// Por que existe um guard separado em vez de só esconder do menu:
//   • Segurança em profundidade — alguém pode chegar na URL direto
//     (link salvo, autocomplete do navegador, etc.)
//   • Defesa contra bypass de UI — mesmo se a sidebar for adulterada
//     no DevTools, o guard ainda redireciona
//
// Performance: faz 1 chamada `getCurrentAdmin()` no mount. Em produção,
// o resultado é cacheado pelo browser via PostgREST + RLS num intervalo
// curto. Se quiser otimizar mais, mova o role pra um Context provider
// no AdminDashboard e leia daqui via useContext.

import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { adminService, AdminUser } from '../../lib/services'

interface ChatAdminGuardProps {
  children: React.ReactNode
  /**
   * Pra onde redirecionar chat_admins. Default `/admin/ms-color-ia`.
   * Customize se quiser direcionar pra um endpoint diferente em
   * algum caso específico.
   */
  redirectTo?: string
}

export function ChatAdminGuard({
  children,
  redirectTo = '/admin/ms-color-ia',
}: ChatAdminGuardProps) {
  // 'loading' = ainda buscando; AdminUser['role'] = role resolvida;
  // null = falha em buscar (sessão expirou, etc.)
  const [role, setRole] = useState<AdminUser['role'] | 'loading' | null>('loading')

  useEffect(() => {
    let cancelled = false
    adminService.getCurrentAdmin()
      .then(a => { if (!cancelled) setRole(a?.role ?? null) })
      .catch(() => { if (!cancelled) setRole(null) })
    return () => { cancelled = true }
  }, [])

  // Aguardando: mostra spinner discreto (não bloqueia toda a tela).
  // Idealmente esse delay é < 200ms se o getCurrentAdmin estiver
  // cacheado na sessão. Em fresh load pode demorar 500ms-1s.
  if (role === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-fuchsia-500" />
      </div>
    )
  }

  // Sessão inválida — deixa o router pai (App.tsx) lidar redirecionando
  // pra login. Aqui só renderizamos o children — o getSession do App.tsx
  // já deve ter limpado o adminUser.
  if (role === null) {
    return <>{children}</>
  }

  // O bloqueio: chat_admin não passa.
  if (role === 'chat_admin') {
    return <Navigate to={redirectTo} replace />
  }

  // admin e super_admin: passam normalmente.
  return <>{children}</>
}
