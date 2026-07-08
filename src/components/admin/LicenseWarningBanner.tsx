// src/components/admin/LicenseWarningBanner.tsx
import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  daysLeft: number
}

export function LicenseWarningBanner({ daysLeft }: Props) {
  const msg =
    daysLeft === 0
      ? 'Sua licença vence hoje. Renove para evitar a interrupção do acesso.'
      : `Sua licença vence em ${daysLeft} dia${daysLeft > 1 ? 's' : ''}. Entre em contato para renovar.`

  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-2 text-sm text-center"
      style={{
        background: '#fef3c7',
        borderBottom: '1px solid #fde68a',
        color: '#92400e',
        flexShrink: 0,
      }}
    >
      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
      <span>{msg}</span>
    </div>
  )
}
