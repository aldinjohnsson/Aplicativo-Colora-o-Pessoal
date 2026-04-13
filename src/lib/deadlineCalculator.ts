// src/lib/deadlineCalculator.ts

// ============================================================
// FERIADOS NACIONAIS BRASILEIROS
// ============================================================

/**
 * Calcula a data da Páscoa para um ano (algoritmo de Meeus/Jones/Butcher)
 */
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

/**
 * Retorna todos os feriados nacionais brasileiros de um ano
 */
function getBrazilianHolidays(year: number): Date[] {
  const easter = getEasterDate(year)

  const addDays = (date: Date, days: number): Date => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    return d
  }

  return [
    // Feriados fixos
    new Date(year, 0, 1),    // Confraternização Universal
    new Date(year, 3, 21),   // Tiradentes
    new Date(year, 4, 1),    // Dia do Trabalho
    new Date(year, 8, 7),    // Independência
    new Date(year, 9, 12),   // Nossa Senhora Aparecida
    new Date(year, 10, 2),   // Finados
    new Date(year, 10, 15),  // Proclamação da República
    new Date(year, 10, 20),  // Dia da Consciência Negra
    new Date(year, 11, 25),  // Natal

    // Feriados móveis (baseados na Páscoa)
    addDays(easter, -48),    // Segunda de Carnaval
    addDays(easter, -47),    // Terça de Carnaval
    addDays(easter, -2),     // Sexta-feira Santa
    easter,                  // Páscoa
    addDays(easter, 60),     // Corpus Christi
  ]
}

/**
 * Normaliza uma data para meia-noite (ignora horário)
 */
function normalize(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Verifica se uma data é feriado nacional
 */
function isHoliday(date: Date): boolean {
  const d = normalize(date)
  const holidays = getBrazilianHolidays(d.getFullYear())
  return holidays.some(h => normalize(h).getTime() === d.getTime())
}

/**
 * Verifica se uma data é dia útil (segunda a sexta, não feriado)
 */
function isBusinessDay(date: Date): boolean {
  const day = date.getDay()
  if (day === 0 || day === 6) return false // Domingo ou Sábado
  return !isHoliday(date)
}

// ============================================================
// CÁLCULO DO PRAZO
// ============================================================

/**
 * Calcula a data de entrega com base nas regras:
 * - Se finalizado após 12h (meio-dia), começa a contar a partir do próximo dia útil
 * - Se finalizado antes/até 12h, começa a contar a partir do próprio dia (se útil)
 * - Conta apenas dias úteis (seg-sex, sem feriados nacionais)
 *
 * @param sentAt - Data/hora em que as fotos foram finalizadas
 * @param businessDays - Quantidade de dias úteis do plano
 * @returns Data de entrega
 */
export function calculateDeadline(sentAt: Date, businessDays: number): Date {
  const d = new Date(sentAt)

  // Regra: se depois das 12h, pula para o próximo dia
  if (d.getHours() >= 12) {
    d.setDate(d.getDate() + 1)
  }

  // Garantir que estamos em um dia útil para começar a contagem
  d.setHours(0, 0, 0, 0)
  while (!isBusinessDay(d)) {
    d.setDate(d.getDate() + 1)
  }

  // Contar os dias úteis
  let counted = 0
  while (counted < businessDays) {
    d.setDate(d.getDate() + 1)
    if (isBusinessDay(d)) {
      counted++
    }
  }

  return d
}

// ============================================================
// UTILIDADES DE EXIBIÇÃO
// ============================================================

/**
 * Calcula quantos dias úteis faltam até uma data
 */
export function businessDaysUntil(targetDate: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = normalize(targetDate)

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
 * Formata a data do prazo de forma legível
 * Ex: "Segunda-feira, 21 de abril de 2026"
 */
export function formatDeadlineDate(date: Date): string {
  const weekdays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

  const d = normalize(date)
  return `${weekdays[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`
}

/**
 * Verifica se o prazo está atrasado
 */
export function isDeadlineOverdue(deadlineDate: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return normalize(deadlineDate).getTime() < today.getTime()
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
