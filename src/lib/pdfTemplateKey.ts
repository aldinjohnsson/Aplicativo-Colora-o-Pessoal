// src/lib/pdfTemplateKey.ts
//
// Chave (admin_content.type) do PDF modelo do dossiê por idioma.
// pt-BR continua sendo o row legado 'pdf_template' (nada muda pra quem já
// tem template); os demais idiomas viram 'pdf_template:<código>'.
// Arquivo separado pra o SettingsEditor não precisar importar o
// templatePDFGenerator (e o pdf-lib junto) só por causa disso.

export const PDF_TEMPLATE_LANGUAGES = [
  { code: 'pt-BR', flag: '🇧🇷', label: 'Português' },
  { code: 'en-US', flag: '🇺🇸', label: 'English' },
  { code: 'es-ES', flag: '🇪🇸', label: 'Español' },
  { code: 'fr-FR', flag: '🇫🇷', label: 'Français' },
  { code: 'it-IT', flag: '🇮🇹', label: 'Italiano' },
  { code: 'de-DE', flag: '🇩🇪', label: 'Deutsch' },
] as const

export const PDF_TEMPLATE_DEFAULT_LANG = 'pt-BR'
export const PDF_TEMPLATE_BASE_TYPE = 'pdf_template'
export const PDF_TEMPLATE_LANG_PREFIX = 'pdf_template:'

export function pdfTemplateType(language?: string | null): string {
  return !language || language === PDF_TEMPLATE_DEFAULT_LANG
    ? PDF_TEMPLATE_BASE_TYPE
    : `${PDF_TEMPLATE_LANG_PREFIX}${language}`
}
