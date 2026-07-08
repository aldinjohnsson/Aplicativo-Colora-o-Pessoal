// src/lib/licenseStatus.ts
export interface LicenseStatus {
  expired: boolean
  daysRemaining: number | null // null = sem data de expiração (licença aberta)
}

export function getLicenseStatus(
  licenseActive: boolean,
  licenseExpiresAt: string | null
): LicenseStatus {
  if (!licenseActive) return { expired: true, daysRemaining: 0 }
  if (!licenseExpiresAt) return { expired: false, daysRemaining: null }

  const msRemaining = new Date(licenseExpiresAt).getTime() - Date.now()
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24))

  return { expired: msRemaining < 0, daysRemaining }
}
