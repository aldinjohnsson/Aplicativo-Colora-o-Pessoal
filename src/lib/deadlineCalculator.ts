// src/lib/deadlineCalculator.ts

// ============================================================
// FERIADOS NACIONAIS BRASILEIROS
// ============================================================

function getEasterDate(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function getBrazilianHolidays(year: number): Date[] {
  const easter = getEasterDate(year)
  const addDays = (date: Date, days: number): Date => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    return d
  }
  return [
    new Date(year, 0, 1),
    new Date(year, 3, 21),
    new Date(year, 4, 1),
    new Date(year, 8, 7),
    new Date(year, 9, 12),
    new Date(year, 10, 2),
    new Date(year, 10, 15),
    new Date(year, 10, 20),
    new Date(year, 11, 25),
    addDays(easter, -48),
    addDays(easter, -47),
    addDays(easter, -2),
    easter,
    addDays(easter, 60),
  ]
}

/**
 * Normaliza uma data para meia-noite LOCAL (ignora horário).
 * IMPORTANTE: nunca use `new Date("YYYY-MM-DD")` diretamente — isso é UTC.
 * Use `parseLocalDate` para strings.
 */
function normalize(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Converte uma string "YYYY-MM-DD" em Date no horário LOCAL (meio-dia),
 * evitando o bug de timezone onde `new Date("YYYY-MM-DD")` vira o dia anterior
 * em fusos negativos como BRT (UTC-3).
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  // Usamos meio-dia (12:00) para garantir que setHours(0,0,0,0) caia no dia certo
  const d = new Date(year, month - 1, day, 12, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return d
}

function isHoliday(date: Date): boolean {
  const d = normalize(date)
  const holidays = getBrazilianHolidays(d.getFullYear())
  return holidays.some(h => normalize(h).getTime() === d.getTime())
}

function isBusinessDay(date: Date): boolean {
  const day = date.getDay()
  if (day === 0 || day === 6) return false
  return !isHoliday(date)
}

/**
 * Avança para o próximo dia útil (se o dia atual não for útil).
 */
function nextBusinessDay(date: Date): Date {
  const d = normalize(date)
  while (!isBusinessDay(d)) {
    d.setDate(d.getDate() + 1)
  }
  return d
}

// ============================================================
// CÁLCULO DO PRAZO
// ============================================================

/**
 * Calcula a data de entrega.
 *
 * Regras:
 * - Enviado ANTES das 12h → começa a contar a partir do próprio dia (se útil)
 * - Enviado A PARTIR das 12h → começa a contar a partir do próximo dia útil
 * - Conta apenas dias úteis (seg-sex, sem feriados nacionais)
 * - A data de entrega NUNCA cai em feriado, sábado ou domingo
 *
 * @param sentAt - Momento em que as fotos foram aprovadas
 * @param businessDays - Quantidade de dias úteis do plano
 */
export function calculateDeadline(sentAt: Date, businessDays: number): Date {
  const d = new Date(sentAt)

  // Se enviado a partir das 12h, pula para o dia seguinte
  if (d.getHours() >= 12) {
    d.setDate(d.getDate() + 1)
  }

  // Garante que começamos em um dia útil
  d.setHours(0, 0, 0, 0)
  while (!isBusinessDay(d)) {
    d.setDate(d.getDate() + 1)
  }

  // O dia inicial (amanhã se >= 12h, hoje se < 12h) conta como dia 1.
  // Então contamos até businessDays a partir dele.
  let counted = 1
  while (counted < businessDays) {
    d.setDate(d.getDate() + 1)
    if (isBusinessDay(d)) {
      counted++
    }
  }

  // Garantia extra: entrega nunca cai em não-útil
  // (já deve ser dia útil pelo loop acima, mas por segurança)
  while (!isBusinessDay(d)) {
    d.setDate(d.getDate() + 1)
  }

  return d
}

/**
 * Formata a data do prazo para armazenamento no banco como "YYYY-MM-DD"
 * usando a data LOCAL (evita bug de UTC).
 */
export function formatDateForDB(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ============================================================
// UTILIDADES DE EXIBIÇÃO
// ============================================================

/**
 * Quantos dias CORRIDOS faltam até uma data.
 * Aceita Date ou string "YYYY-MM-DD".
 * Retorna 0 se a data já passou.
 */
export function calendarDaysUntil(targetDateOrStr: Date | string): number {
  const today = normalize(new Date())
  const target = typeof targetDateOrStr === 'string'
    ? parseLocalDate(targetDateOrStr)
    : normalize(targetDateOrStr)

  if (target.getTime() <= today.getTime()) return 0

  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

/**
 * Quantos dias ÚTEIS faltam até uma data.
 * Aceita Date ou string "YYYY-MM-DD".
 * Retorna 0 se a data já passou.
 */
export function businessDaysUntil(targetDateOrStr: Date | string): number {
  const today = normalize(new Date())
  const target = typeof targetDateOrStr === 'string'
    ? parseLocalDate(targetDateOrStr)
    : normalize(targetDateOrStr)

  if (target.getTime() <= today.getTime()) return 0

  let count = 0
  const d = new Date(today)
  while (d < target) {
    d.setDate(d.getDate() + 1)
    if (isBusinessDay(d)) count++
  }
  return count
}

/**
 * Formata a data do prazo de forma legível.
 * Aceita Date ou string "YYYY-MM-DD".
 * Ex: "Segunda-feira, 21 de abril de 2026"
 */
export function formatDeadlineDate(dateOrStr: Date | string): string {
  const weekdays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

  const d = typeof dateOrStr === 'string'
    ? parseLocalDate(dateOrStr)
    : normalize(dateOrStr)

  return `${weekdays[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`
}

/**
 * Verifica se o prazo está atrasado.
 * Aceita Date ou string "YYYY-MM-DD".
 */
export function isDeadlineOverdue(dateOrStr: Date | string): boolean {
  const today = normalize(new Date())
  const target = typeof dateOrStr === 'string'
    ? parseLocalDate(dateOrStr)
    : normalize(dateOrStr)
  return target.getTime() < today.getTime()
}

/**
 * Retorna os feriados de um ano (para exibição/debug)
 */
export function getHolidaysForYear(year: number): Array<{ date: Date; name: string }> {
  const easter = getEasterDate(year)
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
  return [
    { date: new Date(year, 0, 1), name: 'Confraternização Universal' },
    { date: addDays(easter, -48), name: 'Segunda de Carnaval' },
    { date: addDays(easter, -47), name: 'Terça de Carnaval' },
    { date: addDays(easter, -2), name: 'Sexta-feira Santa' },
    { date: easter, name: 'Páscoa' },
    { date: new Date(year, 3, 21), name: 'Tiradentes' },
    { date: new Date(year, 4, 1), name: 'Dia do Trabalho' },
    { date: addDays(easter, 60), name: 'Corpus Christi' },
    { date: new Date(year, 8, 7), name: 'Independência do Brasil' },
    { date: new Date(year, 9, 12), name: 'Nossa Senhora Aparecida' },
    { date: new Date(year, 10, 2), name: 'Finados' },
    { date: new Date(year, 10, 15), name: 'Proclamação da República' },
    { date: new Date(year, 10, 20), name: 'Dia da Consciência Negra' },
    { date: new Date(year, 11, 25), name: 'Natal' },
  ]
}