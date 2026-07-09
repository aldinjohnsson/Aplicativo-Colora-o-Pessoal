// src/components/admin/documents/lib/promptLanguage.ts
//
// Seletor de idioma pra geração de imagem por IA (Composições IA e
// Geração IA standalone).
//
// O `partPrompt` cadastrado pelo admin sempre vem em português. Quando
// o admin escolhe um idioma diferente de "pt" no seletor, envolvemos o
// prompt com uma instrução explícita — repetida no INÍCIO e no FINAL —
// pedindo pro modelo gerar TODO texto/rótulo/palavra escrita na imagem
// nesse idioma. O prompt em si (a descrição da cena) continua em
// português — só o texto que aparece desenhado na imagem final muda de
// idioma.
//
// Por que repetir no início e no fim: modelos de geração de imagem às
// vezes "perdem" instruções que aparecem só no final de prompts longos.
// Reforçar no início (antes de qualquer coisa) e no final (como último
// lembrete) reduz a chance de algum texto sair em português.
//
// A instrução é escrita em inglês de propósito: modelos de geração de
// imagem (gpt-image-1) seguem instruções em inglês de forma mais
// consistente, independente do idioma do restante do prompt.

export interface LanguageOption {
  code: string   // código salvo/enviado (ex: 'pt', 'en')
  label: string  // exibido no seletor pro admin (ex: 'Português')
}

// 'pt' é o padrão — não precisa de instrução extra, pois os prompts já
// são cadastrados em português.
export const AI_IMAGE_LANGUAGES: LanguageOption[] = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
]

// Nome do idioma em inglês, pra instrução ficar clara pro modelo.
const LANGUAGE_NAME_FOR_MODEL: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  de: 'German',
}

/**
 * Envolve o prompt já resolvido (depois de `substitutePromptVars`) com
 * instruções de idioma no início e no fim, garantindo que TODO texto
 * gerado dentro da imagem saia no idioma escolhido — sem exceções.
 *
 * Se `languageCode` for 'pt', vazio, ou desconhecido, devolve o prompt
 * sem alteração.
 */
export function applyLanguageInstruction(prompt: string, languageCode: string): string {
  if (!prompt) return prompt
  if (!languageCode || languageCode === 'pt') return prompt

  const name = LANGUAGE_NAME_FOR_MODEL[languageCode]
  if (!name) return prompt

  const leadIn =
    `LANGUAGE RULE (read first, apply to everything below): ` +
    `Every single word of text that appears written inside the generated ` +
    `image — labels, captions, titles, numbers with units, any lettering ` +
    `at all — must be in ${name}. Do not render any Portuguese text ` +
    `anywhere in the image. If the scene description below implies text ` +
    `in Portuguese, translate it to ${name} before drawing it.\n\n`

  const reminder =
    `\n\nFINAL REMINDER: All text rendered in the image must be in ${name}. ` +
    `No Portuguese words should appear written anywhere in the final image.`

  return `${leadIn}${prompt}${reminder}`
}