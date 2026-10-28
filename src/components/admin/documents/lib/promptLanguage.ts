// src/components/admin/documents/lib/promptLanguage.ts
//
// Seletor de idioma pra geração de imagem por IA (Composições IA e
// Geração IA standalone).
//
// O `partPrompt` cadastrado pelo admin sempre vem em português e NÃO é
// alterado. Quando o admin escolhe outro idioma, envolvemos o prompt com:
//
//   1. Regra de idioma no INÍCIO (traduzir TUDO antes de desenhar).
//   2. Glossário PT -> idioma com os títulos, rótulos e frases fixas mais
//      comuns dos guias (ex.: "SUA PALETA, SUA ESSÊNCIA" -> "TU PALETA,
//      TU ESENCIA"). Isso resolve o caso do espanhol: por ser muito parecido
//      com o português, o modelo de imagem copiava os títulos em português.
//      Com a tradução pronta ele não precisa "adivinhar".
//   3. Lista de sinais de português proibidos (ã, õ, ç, ê, "SUA"...).
//   4. Lembrete final.
//
// As instruções são em inglês de propósito: o modelo de imagem segue
// instruções em inglês de forma mais consistente.

export interface LanguageOption {
  code: string   // código salvo/enviado (ex: 'pt', 'en')
  label: string  // exibido no seletor pro admin (ex: 'Português')
}

// 'pt' é o padrão — não precisa de instrução extra.
export const AI_IMAGE_LANGUAGES: LanguageOption[] = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
]

const LANGUAGE_NAME_FOR_MODEL: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  de: 'German',
}

// Ordem de cada linha do glossário (mesma em todos os idiomas):
// 0  GUIA DE COLORAÇÃO PESSOAL
// 1  SUA PALETA, SUA ESSÊNCIA
// 2  PARTE (+ "Suas Cores", "Maquiagem", "Cabelos")
// 3  CARACTERÍSTICAS
// 4  Subtom / Temperatura / Intensidade / Profundidade
// 5  Neutra Fria / Alta / Escura
// 6  CARTELA DE CORES
// 7  Cores que valorizam / Cores que me apagam
// 8  Metais ideais / Pedras que valorizam / Maquiagem ideal / Neutros ideais
// 9  Contraste pessoal
// 10 ESTAMPAS: HARMONIA COM SEU CONTRASTE / DICA DE OURO
// 11 CORES QUE HARMONIZAM / NÃO HARMONIZAM
// 12 RESUMO DA SUA HARMONIA / Sua cartela / Seu resultado
// 13 Inverno Escuro / Outono / Primavera / Verão (nomes das cartelas)
// 14 Melhores tons de cabelos / Loiros / Ruivos / Grisalhos / Dicas
const GLOSSARY: Record<string, string[]> = {
  es: [
    'GUIA DE COLORAÇÃO PESSOAL = GUÍA DE COLORACIÓN PERSONAL',
    'SUA PALETA, SUA ESSÊNCIA = TU PALETA, TU ESENCIA',
    'PARTE 02 / Suas Cores = PARTE 02 / Tus Colores ; Maquiagem = Maquillaje ; Cabelos = Cabello',
    'CARACTERÍSTICAS = CARACTERÍSTICAS',
    'Subtom = Subtono ; Temperatura = Temperatura ; Intensidade = Intensidad ; Profundidade = Profundidad',
    'Neutra Fria = Neutra Fría ; Alta = Alta ; Escura = Oscura ; Média = Media',
    'CARTELA DE CORES = CARTA DE COLORES',
    'Cores que valorizam = Colores que favorecen ; Cores que me apagam = Colores que me apagan',
    'Metais ideais = Metales ideales ; Pedras que valorizam = Piedras que favorecen ; Maquiagem ideal = Maquillaje ideal ; Neutros ideais = Neutros ideales',
    'Contraste pessoal = Contraste personal ; Médio Alto = Medio Alto ; Muito Alto = Muy Alto ; Baixo = Bajo',
    'ESTAMPAS: HARMONIA COM SEU CONTRASTE = ESTAMPADOS: ARMONÍA CON TU CONTRASTE ; DICA DE OURO = CONSEJO DE ORO',
    'CORES QUE HARMONIZAM = COLORES QUE ARMONIZAN ; CORES QUE NÃO HARMONIZAM = COLORES QUE NO ARMONIZAN',
    'RESUMO DA SUA HARMONIA = RESUMEN DE TU ARMONÍA ; Sua cartela = Tu carta ; Seu resultado = Tu resultado ; Sua essência = Tu esencia',
    'Inverno Escuro = Invierno Oscuro ; Inverno Frio = Invierno Frío ; Verão = Verano ; Outono = Otoño ; Primavera = Primavera ; Claro = Claro ; Suave = Suave',
    'MELHORES TONS DE CABELOS = MEJORES TONOS DE CABELLO ; Loiros = Rubios ; Ruivos = Pelirrojos ; Moreno Iluminado = Moreno Iluminado ; Grisalhos = Canas ; Dicas = Consejos ; Cores que evitar = Colores que evitar',
    'Preto = Negro ; Branco = Blanco ; Cinza = Gris ; Vinho = Vino ; Ameixa = Ciruela ; Azul Marinho = Azul Marino ; Verde = Verde ; Prata = Plata ; Ouro = Oro ; Grafite = Grafito ; Chumbo = Plomo',
    'Floral = Floral ; Listras = Rayas ; Xadrez = Cuadros ; Poás = Lunares ; Geométrica = Geométrica ; Abstrata = Abstracta',
  ],
  en: [
    'GUIA DE COLORAÇÃO PESSOAL = PERSONAL COLOR ANALYSIS GUIDE',
    'SUA PALETA, SUA ESSÊNCIA = YOUR PALETTE, YOUR ESSENCE',
    'PARTE 02 / Suas Cores = PART 02 / Your Colors ; Maquiagem = Makeup ; Cabelos = Hair',
    'CARACTERÍSTICAS = CHARACTERISTICS',
    'Subtom = Undertone ; Temperatura = Temperature ; Intensidade = Intensity ; Profundidade = Depth',
    'Neutra Fria = Cool Neutral ; Alta = High ; Escura = Dark ; Média = Medium',
    'CARTELA DE CORES = COLOR PALETTE',
    'Cores que valorizam = Colors that flatter ; Cores que me apagam = Colors that wash me out',
    'Metais ideais = Ideal metals ; Pedras que valorizam = Flattering stones ; Maquiagem ideal = Ideal makeup ; Neutros ideais = Ideal neutrals',
    'Contraste pessoal = Personal contrast ; Médio Alto = Medium High ; Muito Alto = Very High ; Baixo = Low',
    'ESTAMPAS: HARMONIA COM SEU CONTRASTE = PRINTS: HARMONY WITH YOUR CONTRAST ; DICA DE OURO = GOLDEN TIP',
    'CORES QUE HARMONIZAM = COLORS THAT HARMONIZE ; CORES QUE NÃO HARMONIZAM = COLORS THAT DO NOT HARMONIZE',
    'RESUMO DA SUA HARMONIA = YOUR HARMONY SUMMARY ; Sua cartela = Your palette ; Seu resultado = Your result ; Sua essência = Your essence',
    'Inverno Escuro = Deep Winter ; Verão = Summer ; Outono = Autumn ; Primavera = Spring',
    'MELHORES TONS DE CABELOS = BEST HAIR SHADES ; Loiros = Blondes ; Ruivos = Redheads ; Grisalhos = Gray hair ; Dicas = Tips ; Cores que evitar = Colors to avoid',
    'Preto = Black ; Branco = White ; Cinza = Gray ; Vinho = Wine ; Ameixa = Plum ; Azul Marinho = Navy ; Prata = Silver ; Ouro = Gold ; Grafite = Graphite ; Chumbo = Lead gray',
    'Listras = Stripes ; Xadrez = Plaid ; Poás = Polka dots',
  ],
  fr: [
    'GUIA DE COLORAÇÃO PESSOAL = GUIDE DE COLORIMÉTRIE PERSONNELLE',
    'SUA PALETA, SUA ESSÊNCIA = VOTRE PALETTE, VOTRE ESSENCE',
    'PARTE 02 / Suas Cores = PARTIE 02 / Vos Couleurs ; Maquiagem = Maquillage ; Cabelos = Cheveux',
    'CARACTERÍSTICAS = CARACTÉRISTIQUES',
    'Subtom = Sous-ton ; Temperatura = Température ; Intensidade = Intensité ; Profundidade = Profondeur',
    'Neutra Fria = Neutre Froid ; Alta = Élevée ; Escura = Foncée ; Média = Moyenne',
    'CARTELA DE CORES = NUANCIER',
    'Cores que valorizam = Couleurs qui vous subliment ; Cores que me apagam = Couleurs qui me ternissent',
    'Metais ideais = Métaux idéaux ; Pedras que valorizam = Pierres qui subliment ; Maquiagem ideal = Maquillage idéal ; Neutros ideais = Neutres idéaux',
    'Contraste pessoal = Contraste personnel ; Médio Alto = Moyen Élevé ; Muito Alto = Très Élevé ; Baixo = Faible',
    'ESTAMPAS: HARMONIA COM SEU CONTRASTE = IMPRIMÉS : HARMONIE AVEC VOTRE CONTRASTE ; DICA DE OURO = CONSEIL EN OR',
    'CORES QUE HARMONIZAM = COULEURS QUI HARMONISENT ; CORES QUE NÃO HARMONIZAM = COULEURS QUI NE HARMONISENT PAS',
    'RESUMO DA SUA HARMONIA = RÉSUMÉ DE VOTRE HARMONIE ; Sua cartela = Votre nuancier ; Seu resultado = Votre résultat ; Sua essência = Votre essence',
    'Inverno Escuro = Hiver Profond ; Verão = Été ; Outono = Automne ; Primavera = Printemps',
    'MELHORES TONS DE CABELOS = MEILLEURES NUANCES DE CHEVEUX ; Loiros = Blonds ; Ruivos = Roux ; Grisalhos = Cheveux gris ; Dicas = Conseils ; Cores que evitar = Couleurs à éviter',
    'Preto = Noir ; Branco = Blanc ; Cinza = Gris ; Vinho = Bordeaux ; Ameixa = Prune ; Azul Marinho = Bleu marine ; Prata = Argent ; Ouro = Or ; Grafite = Graphite',
    'Listras = Rayures ; Xadrez = Carreaux ; Poás = Pois',
  ],
  it: [
    'GUIA DE COLORAÇÃO PESSOAL = GUIDA ALLA COLORIMETRIA PERSONALE',
    'SUA PALETA, SUA ESSÊNCIA = LA TUA PALETTE, LA TUA ESSENZA',
    'PARTE 02 / Suas Cores = PARTE 02 / I Tuoi Colori ; Maquiagem = Trucco ; Cabelos = Capelli',
    'CARACTERÍSTICAS = CARATTERISTICHE',
    'Subtom = Sottotono ; Temperatura = Temperatura ; Intensidade = Intensità ; Profundidade = Profondità',
    'Neutra Fria = Neutro Freddo ; Alta = Alta ; Escura = Scura ; Média = Media',
    'CARTELA DE CORES = CARTELLA COLORI',
    'Cores que valorizam = Colori che valorizzano ; Cores que me apagam = Colori che mi spengono',
    'Metais ideais = Metalli ideali ; Pedras que valorizam = Pietre che valorizzano ; Maquiagem ideal = Trucco ideale ; Neutros ideais = Neutri ideali',
    'Contraste pessoal = Contrasto personale ; Médio Alto = Medio Alto ; Muito Alto = Molto Alto ; Baixo = Basso',
    'ESTAMPAS: HARMONIA COM SEU CONTRASTE = STAMPE: ARMONIA CON IL TUO CONTRASTO ; DICA DE OURO = CONSIGLIO D\'ORO',
    'CORES QUE HARMONIZAM = COLORI CHE ARMONIZZANO ; CORES QUE NÃO HARMONIZAM = COLORI CHE NON ARMONIZZANO',
    'RESUMO DA SUA HARMONIA = RIEPILOGO DELLA TUA ARMONIA ; Sua cartela = La tua cartella ; Seu resultado = Il tuo risultato ; Sua essência = La tua essenza',
    'Inverno Escuro = Inverno Scuro ; Verão = Estate ; Outono = Autunno ; Primavera = Primavera',
    'MELHORES TONS DE CABELOS = I MIGLIORI TONI DI CAPELLI ; Loiros = Biondi ; Ruivos = Rossi ; Grisalhos = Capelli grigi ; Dicas = Consigli ; Cores que evitar = Colori da evitare',
    'Preto = Nero ; Branco = Bianco ; Cinza = Grigio ; Vinho = Vino ; Ameixa = Prugna ; Azul Marinho = Blu navy ; Prata = Argento ; Ouro = Oro ; Grafite = Grafite',
    'Listras = Righe ; Xadrez = Quadri ; Poás = Pois',
  ],
  de: [
    'GUIA DE COLORAÇÃO PESSOAL = LEITFADEN ZUR PERSÖNLICHEN FARBBERATUNG',
    'SUA PALETA, SUA ESSÊNCIA = DEINE PALETTE, DEINE ESSENZ',
    'PARTE 02 / Suas Cores = TEIL 02 / Deine Farben ; Maquiagem = Make-up ; Cabelos = Haare',
    'CARACTERÍSTICAS = MERKMALE',
    'Subtom = Unterton ; Temperatura = Temperatur ; Intensidade = Intensität ; Profundidade = Tiefe',
    'Neutra Fria = Kühl-Neutral ; Alta = Hoch ; Escura = Dunkel ; Média = Mittel',
    'CARTELA DE CORES = FARBPALETTE',
    'Cores que valorizam = Farben, die schmeicheln ; Cores que me apagam = Farben, die mich blass machen',
    'Metais ideais = Ideale Metalle ; Pedras que valorizam = Edelsteine, die schmeicheln ; Maquiagem ideal = Ideales Make-up ; Neutros ideais = Ideale Neutraltöne',
    'Contraste pessoal = Persönlicher Kontrast ; Médio Alto = Mittel-Hoch ; Muito Alto = Sehr Hoch ; Baixo = Niedrig',
    'ESTAMPAS: HARMONIA COM SEU CONTRASTE = MUSTER: HARMONIE MIT DEINEM KONTRAST ; DICA DE OURO = GOLDENER TIPP',
    'CORES QUE HARMONIZAM = FARBEN, DIE HARMONIEREN ; CORES QUE NÃO HARMONIZAM = FARBEN, DIE NICHT HARMONIEREN',
    'RESUMO DA SUA HARMONIA = ZUSAMMENFASSUNG DEINER HARMONIE ; Sua cartela = Deine Palette ; Seu resultado = Dein Ergebnis ; Sua essência = Deine Essenz',
    'Inverno Escuro = Dunkler Winter ; Verão = Sommer ; Outono = Herbst ; Primavera = Frühling',
    'MELHORES TONS DE CABELOS = BESTE HAARFARBEN ; Loiros = Blond ; Ruivos = Rot ; Grisalhos = Graue Haare ; Dicas = Tipps ; Cores que evitar = Zu vermeidende Farben',
    'Preto = Schwarz ; Branco = Weiß ; Cinza = Grau ; Vinho = Weinrot ; Ameixa = Pflaume ; Azul Marinho = Marineblau ; Prata = Silber ; Ouro = Gold ; Grafite = Graphit',
    'Listras = Streifen ; Xadrez = Karo ; Poás = Punkte',
  ],
}

// Sinais de português que NÃO podem aparecer escritos na imagem.
const PT_TELLTALES =
  'the words "SUA", "SEU", "SUAS", "ESSÊNCIA", "CORES", "DICAS", "PARTE", "COM", "QUE", "NÃO", "PARA", ' +
  'and the letters/diacritics ã, õ, ç, ê, â, ô'

/**
 * Envolve o prompt já resolvido (depois de `substitutePromptVars`) com
 * regra de idioma + glossário no início e lembrete no fim.
 *
 * Se `languageCode` for 'pt', vazio, ou desconhecido, devolve o prompt
 * sem alteração.
 */
export function applyLanguageInstruction(prompt: string, languageCode: string): string {
  if (!prompt) return prompt
  if (!languageCode || languageCode === 'pt') return prompt

  const name = LANGUAGE_NAME_FOR_MODEL[languageCode]
  if (!name) return prompt

  const glossary = (GLOSSARY[languageCode] || []).map(l => `- ${l}`).join('\n')

  // Spanish/Italian/French are close to Portuguese, so the model tends to
  // copy Portuguese titles. Add an extra, explicit warning for them.
  const closeLangWarning = ['es', 'it', 'fr'].includes(languageCode)
    ? `WARNING: ${name} looks similar to Portuguese, and the text below is written in Portuguese. ` +
      `Do NOT copy any Portuguese title, subtitle, heading, label or caption into the image, ` +
      `even if it "looks almost right" in ${name}. Every single one must be rewritten in correct ${name}. ` +
      `Pay special attention to the main title and the subtitle (tagline) under it. `
    : ''

  const leadIn =
    `LANGUAGE RULE (read first, applies to everything below): the scene description below is written in Portuguese, ` +
    `but the FINAL IMAGE must contain text ONLY in ${name}. ` +
    `Before drawing, translate every piece of text that will appear in the image to ${name}: ` +
    `main title, subtitle/tagline, "PART xx" tags, section headings, labels, captions, quoted phrases, ` +
    `tips, summaries, footers and motivational messages. ` +
    `${closeLangWarning}` +
    `Never render ${PT_TELLTALES} anywhere in the image.\n\n` +
    `MANDATORY TRANSLATIONS (use exactly these when the text appears; translate anything not listed in the same spirit):\n` +
    `${glossary}\n\n` +
    `--- SCENE DESCRIPTION (Portuguese, translate all visible text) ---\n`

  const reminder =
    `\n--- END OF SCENE DESCRIPTION ---\n\n` +
    `FINAL REMINDER: all text rendered in the image, including the main title and the subtitle under it, ` +
    `must be in ${name}. No Portuguese words or Portuguese accents (ã, õ, ç, ê) may appear anywhere in the final image.`

  return `${leadIn}${prompt}${reminder}`
}