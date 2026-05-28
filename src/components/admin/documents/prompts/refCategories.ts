// src/components/admin/documents/prompts/refCategories.ts
// Constante compartilhada — evita import circular entre AiImagePromptsManager e AIPromptConfig

export const REF_CATEGORIES: { value: string; label: string; emoji: string }[] = [
  { value: 'cabelo',    label: 'Cabelo',       emoji: '✂️' },
  { value: 'roupa',     label: 'Roupas / Look', emoji: '👗' },
  { value: 'maquiagem', label: 'Maquiagem',     emoji: '💄' },
  { value: 'acessorio', label: 'Acessórios',    emoji: '💍' },
]
