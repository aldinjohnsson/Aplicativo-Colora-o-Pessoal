// src/components/admin/documents/lib/pdfFonts.ts
//
// Carregamento das 6 famílias suportadas via pacotes npm @fontsource/*.
// O Vite resolve os imports `?url` para URLs estáticas bundladas, zero
// dependência de CDN externo.
//
// Para adicionar uma família nova:
//   1. npm install @fontsource/<nome>
//   2. Adicione um bloco em FONT_URLS abaixo com os 4 imports
//   3. Acrescente o nome em SupportedFont (types.ts)

import type { PDFDocument, PDFFont } from 'pdf-lib'
import type { SupportedFont } from '../types'

// ─── Inter ─────────────────────────────────────────────────────────────
import interRegular    from '@fontsource/inter/files/inter-latin-400-normal.woff?url'
import interBold       from '@fontsource/inter/files/inter-latin-700-normal.woff?url'
import interItalic     from '@fontsource/inter/files/inter-latin-400-italic.woff?url'
import interBoldItalic from '@fontsource/inter/files/inter-latin-700-italic.woff?url'

// ─── Roboto ───────────────────────────────────────────────────────────
import robotoRegular    from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url'
import robotoBold       from '@fontsource/roboto/files/roboto-latin-700-normal.woff?url'
import robotoItalic     from '@fontsource/roboto/files/roboto-latin-400-italic.woff?url'
import robotoBoldItalic from '@fontsource/roboto/files/roboto-latin-700-italic.woff?url'

// ─── Open Sans ────────────────────────────────────────────────────────
import openSansRegular    from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff?url'
import openSansBold       from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url'
import openSansItalic     from '@fontsource/open-sans/files/open-sans-latin-400-italic.woff?url'
import openSansBoldItalic from '@fontsource/open-sans/files/open-sans-latin-700-italic.woff?url'

// ─── Montserrat ──────────────────────────────────────────────────────
import montserratRegular    from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff?url'
import montserratBold       from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff?url'
import montserratItalic     from '@fontsource/montserrat/files/montserrat-latin-400-italic.woff?url'
import montserratBoldItalic from '@fontsource/montserrat/files/montserrat-latin-700-italic.woff?url'

// ─── Poppins ─────────────────────────────────────────────────────────
import poppinsRegular    from '@fontsource/poppins/files/poppins-latin-400-normal.woff?url'
import poppinsBold       from '@fontsource/poppins/files/poppins-latin-700-normal.woff?url'
import poppinsItalic     from '@fontsource/poppins/files/poppins-latin-400-italic.woff?url'
import poppinsBoldItalic from '@fontsource/poppins/files/poppins-latin-700-italic.woff?url'

// ─── Raleway ─────────────────────────────────────────────────────────
import ralewayRegular    from '@fontsource/raleway/files/raleway-latin-400-normal.woff?url'
import ralewayBold       from '@fontsource/raleway/files/raleway-latin-700-normal.woff?url'
import ralewayItalic     from '@fontsource/raleway/files/raleway-latin-400-italic.woff?url'
import ralewayBoldItalic from '@fontsource/raleway/files/raleway-latin-700-italic.woff?url'

// IMPORTANTE: por que .woff e não .ttf?
//   O pacote @fontsource moderno distribui .woff e .woff2. O pdf-lib via
//   fontkit aceita .ttf, .otf e .woff (descomprime), mas NÃO aceita .woff2
//   (pelo menos sem polyfill extra). Usar .woff é compatível e disponível
//   em todas as 6 famílias desta lista.

export type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic'

type FamilyUrlMap = Record<FontVariant, string>

const FONT_URLS: Record<SupportedFont, FamilyUrlMap> = {
  'Inter': {
    regular: interRegular, bold: interBold,
    italic: interItalic,   boldItalic: interBoldItalic,
  },
  'Roboto': {
    regular: robotoRegular, bold: robotoBold,
    italic: robotoItalic,   boldItalic: robotoBoldItalic,
  },
  'Open Sans': {
    regular: openSansRegular, bold: openSansBold,
    italic: openSansItalic,   boldItalic: openSansBoldItalic,
  },
  'Montserrat': {
    regular: montserratRegular, bold: montserratBold,
    italic: montserratItalic,   boldItalic: montserratBoldItalic,
  },
  'Poppins': {
    regular: poppinsRegular, bold: poppinsBold,
    italic: poppinsItalic,   boldItalic: poppinsBoldItalic,
  },
  'Raleway': {
    regular: ralewayRegular, bold: ralewayBold,
    italic: ralewayItalic,   boldItalic: ralewayBoldItalic,
  },
}

// Cache de bytes entre sessões da página (a URL servida pelo Vite fica em
// memória do browser via HTTP cache também)
const bytesCache: Record<string, ArrayBuffer> = {}

async function fetchFontBytes(family: SupportedFont, variant: FontVariant): Promise<ArrayBuffer> {
  const key = `${family}__${variant}`
  if (bytesCache[key]) return bytesCache[key]

  const url = FONT_URLS[family][variant]
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Falha ao carregar fonte "${family}" (${variant}): HTTP ${res.status}`)
  }
  const buf = await res.arrayBuffer()
  bytesCache[key] = buf
  return buf
}

/**
 * Registry de fontes embutidas em um PDFDocument específico.
 * Cada PDFDocument precisa dos seus próprios PDFFont — embed é por-documento.
 */
export class FontRegistry {
  private pdf: PDFDocument
  private cache: Record<string, PDFFont> = {}
  private fallbackFamily: SupportedFont = 'Inter'

  constructor(pdf: PDFDocument) {
    this.pdf = pdf
  }

  async get(family: SupportedFont | string, bold: boolean, italic: boolean): Promise<PDFFont> {
    // Se família pedida não existe no mapa, cai pra Inter
    const resolvedFamily: SupportedFont =
      FONT_URLS[family as SupportedFont]
        ? (family as SupportedFont)
        : this.fallbackFamily

    const variant: FontVariant =
      bold && italic ? 'boldItalic' :
      bold           ? 'bold' :
      italic         ? 'italic' :
                       'regular'

    const key = `${resolvedFamily}__${variant}`
    if (this.cache[key]) return this.cache[key]

    const bytes = await fetchFontBytes(resolvedFamily, variant)
    const font = await this.pdf.embedFont(bytes, { subset: true })
    this.cache[key] = font
    return font
  }
}