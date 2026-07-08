// src/hooks/useLicenseGuard.ts
//
// Fecha o buraco de "licença vencida mas o usuário nunca desloga":
// como o app é uma SPA, o JWT continua válido em memória mesmo depois
// que a licença vence, e nada re-checava isso enquanto a aba ficasse
// aberta. Este hook:
//
//   1. Reconsulta a licença a cada CHECK_INTERVAL_MS e sempre que a
//      aba volta a ficar visível (usuário deixou aberto e voltou).
//   2. Se a licença venceu/foi desativada, chama onExpired (logout).
//   3. Se faltam poucos dias pra vencer, expõe `warnDaysLeft` pra
//      renderizar um banner de aviso.
//
// super_admin nunca é afetado (adminService já trata isso).

import { useEffect, useRef, useState, useCallback } from 'react'
import { adminService } from '../lib/services'
import { getLicenseStatus } from '../lib/licenseStatus'

const CHECK_INTERVAL_MS = 2 * 60 * 1000 // 2 min
const WARN_DAYS_BEFORE = 5

export function useLicenseGuard(onExpired: () => void) {
  const [warnDaysLeft, setWarnDaysLeft] = useState<number | null>(null)

  // Ref pra sempre chamar a versão mais recente de onExpired sem precisar
  // recriar o interval a cada render (handleLogout não vem memoizado).
  const onExpiredRef = useRef(onExpired)
  useEffect(() => { onExpiredRef.current = onExpired }, [onExpired])

  const check = useCallback(async () => {
    // getSession() já faz o check completo (inativa/vencida) e desloga
    // silenciosamente no Supabase se necessário — aqui só reagimos.
    const user = await adminService.getSession()
    if (!user) {
      onExpiredRef.current()
      return
    }

    const admin = await adminService.getCurrentAdmin()
    if (!admin || admin.role === 'super_admin') {
      setWarnDaysLeft(null)
      return
    }

    const { daysRemaining } = getLicenseStatus(admin.license_active, admin.license_expires_at)
    setWarnDaysLeft(
      daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= WARN_DAYS_BEFORE
        ? daysRemaining
        : null
    )
  }, [])

  useEffect(() => {
    check() // checagem inicial ao montar o dashboard

    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }

    const interval = setInterval(check, CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [check])

  return { warnDaysLeft }
}
