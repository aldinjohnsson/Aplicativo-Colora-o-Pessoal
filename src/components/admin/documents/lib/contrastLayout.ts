// src/components/admin/documents/lib/contrastLayout.ts
//
// Tipo e formatter da Ferramenta de Contraste — usado por:
//   • ContrastLayoutDialog.tsx (UI + save)
//   • ClientsManager.tsx        (load + preview)
//   • documentsService.ts       (expõe como variável built-in {{Contraste}})
//
// Mora em /lib/ pra que arquivos não-React (documentsService) possam
// importar sem puxar dependência de componente.

/** Estado serializável da ferramenta — gravado em clients.contrast_layout. */
export interface ContrastLayoutData {
  photoId:  string | null
  cMin:     number
  cMax:     number
  label:    string   // ex: 'alto', 'médio alto'
  zoom:     number
  yOff:     number
  savedAt?: string   // ISO timestamp (último save)
}

/** "médio alto" → "Médio Alto" */
function titleCase(s: string): string {
  return s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ')
}

/** Formato canônico do valor de contraste. Ex: "Alto (8 a 10)". */
export function formatContrastValue(label: string, cMin: number, cMax: number): string {
  return `${titleCase((label || '').trim())} (${cMin} a ${cMax})`
}
