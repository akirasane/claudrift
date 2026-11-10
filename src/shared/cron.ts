// Standard 5-field cron: minute hour day-of-month month day-of-week. Supports *, lists (1,5), ranges (1-5) and steps (*/15, 1-10/2).
// Day-of-week is 0-6 (Sunday = 0; 7 also means Sunday). Month is 1-12. Evaluated in local time.
// As in classic cron, when both day-of-month and day-of-week are restricted a day matches if EITHER matches.

export interface CronSpec {
  minutes: ReadonlySet<number>
  hours: ReadonlySet<number>
  daysOfMonth: ReadonlySet<number>
  months: ReadonlySet<number>
  daysOfWeek: ReadonlySet<number>
  domAny: boolean
  dowAny: boolean
}

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 }
] as const

function parseField(src: string, f: (typeof FIELDS)[number]): Set<number> | string {
  const out = new Set<number>()
  const num = (s: string): number | undefined => (/^\d{1,2}$/.test(s) ? Number(s) : undefined)
  for (const part of src.split(',')) {
    const [range = '', step, ...extra] = part.split('/')
    if (extra.length) return `Bad ${f.name} field "${src}".`
    let stepN = 1
    if (step !== undefined) {
      const n = num(step)
      if (n === undefined || n < 1) return `Bad step in ${f.name} field "${src}".`
      stepN = n
    }
    let lo: number
    let hi: number
    if (range === '*') {
      lo = f.min
      hi = f.name === 'day of week' ? 6 : f.max
    } else {
      const [a = '', b, ...rest] = range.split('-')
      const na = num(a)
      if (rest.length || na === undefined) return `Bad ${f.name} field "${src}".`
      lo = na
      if (b === undefined) hi = step !== undefined ? f.max : na
      else {
        const nb = num(b)
        if (nb === undefined) return `Bad ${f.name} field "${src}".`
        hi = nb
      }
    }
    if (lo < f.min || hi > f.max || lo > hi) return `${f.name[0]!.toUpperCase()}${f.name.slice(1)} must be ${f.min}-${f.max} (got "${part}").`
    for (let v = lo; v <= hi; v += stepN) out.add(f.name === 'day of week' && v === 7 ? 0 : v)
  }
  return out
}

/** Parses a 5-field cron expression, or returns a message that says what is wrong. */
export function parseCron(expr: string): CronSpec | string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5 || parts[0] === '') return 'Use 5 fields: minute hour day-of-month month day-of-week, e.g. */15 9-17 * * 1-5.'
  const sets: Set<number>[] = []
  for (let i = 0; i < 5; i++) {
    const r = parseField(parts[i]!, FIELDS[i]!)
    if (typeof r === 'string') return r
    sets.push(r)
  }
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>]
  return { minutes, hours, daysOfMonth, months, daysOfWeek, domAny: parts[2]!.startsWith('*'), dowAny: parts[4]!.startsWith('*') }
}

/** Null when `expr` is valid, else the error message. */
export function cronError(expr: string): string | null {
  const r = parseCron(expr)
  return typeof r === 'string' ? r : null
}

function dayMatches(c: CronSpec, d: Date): boolean {
  if (!c.months.has(d.getMonth() + 1)) return false
  const dom = c.daysOfMonth.has(d.getDate())
  const dow = c.daysOfWeek.has(d.getDay())
  if (c.domAny && c.dowAny) return true
  if (c.domAny) return dow
  if (c.dowAny) return dom
  return dom || dow
}

const MAX_DAYS = 366 * 8 // covers Feb 29 schedules

/** First minute strictly after `from` (ms) that matches, in local time, or undefined when none within ~8 years. */
export function nextCronAfter(expr: string, from: number): number | undefined {
  const c = parseCron(expr)
  if (typeof c === 'string') return undefined
  const hours = [...c.hours].sort((a, b) => a - b)
  const minutes = [...c.minutes].sort((a, b) => a - b)
  const start = new Date(from)
  for (let i = 0; i < MAX_DAYS; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    if (!dayMatches(c, day)) continue
    for (const h of hours) {
      for (const m of minutes) {
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
        // A wall-clock time skipped by a DST change shifts to another hour: not a real match.
        if (t.getHours() !== h || t.getMinutes() !== m) continue
        if (t.getTime() > from) return t.getTime()
      }
    }
  }
  return undefined
}
