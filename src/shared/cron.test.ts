import { describe, expect, it } from 'vitest'
import { cronError, nextCronAfter, parseCron } from './cron'
import { ScheduleWhenSchema, describeWhen, nextRunAfter } from './schedule'

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('parseCron', () => {
  it('expands lists, ranges and steps', () => {
    const c = parseCron('*/15 9-11 1,15 * 1-5')
    if (typeof c === 'string') throw new Error(c)
    expect([...c.minutes]).toEqual([0, 15, 30, 45])
    expect([...c.hours]).toEqual([9, 10, 11])
    expect([...c.daysOfMonth]).toEqual([1, 15])
    expect([...c.daysOfWeek]).toEqual([1, 2, 3, 4, 5])
  })
  it('treats 7 as Sunday and supports range steps', () => {
    const c = parseCron('0-30/10 * * * 7')
    if (typeof c === 'string') throw new Error(c)
    expect([...c.minutes]).toEqual([0, 10, 20, 30])
    expect([...c.daysOfWeek]).toEqual([0])
  })
  it.each(['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '*/0 * * * *', '5-1 * * * *', 'a * * * *', '1-2-3 * * * *', '*/2/3 * * * *', ', * * * *'])(
    'rejects %j',
    (expr) => {
      expect(cronError(expr)).toEqual(expect.any(String))
    }
  )
  it('accepts a valid expression', () => {
    expect(cronError('*/15 9-17 * * 1-5')).toBeNull()
  })
})

describe('nextCronAfter', () => {
  it('steps within the day, strictly after "from"', () => {
    expect(nextCronAfter('*/15 * * * *', at(2026, 1, 5, 10, 0))).toBe(at(2026, 1, 5, 10, 15))
    expect(nextCronAfter('*/15 * * * *', at(2026, 1, 5, 10, 14))).toBe(at(2026, 1, 5, 10, 15))
  })
  it('rolls over to the next hour and the next day', () => {
    expect(nextCronAfter('0 9 * * *', at(2026, 1, 5, 9, 0))).toBe(at(2026, 1, 6, 9, 0))
    expect(nextCronAfter('30 23 * * *', at(2026, 1, 5, 23, 31))).toBe(at(2026, 1, 6, 23, 30))
  })
  it('skips weekends for 1-5 (Fri 17:45 -> Mon 09:00)', () => {
    const fri = at(2026, 1, 9, 17, 45) // 2026-01-09 is a Friday
    expect(new Date(fri).getDay()).toBe(5)
    const n = nextCronAfter('*/15 9-17 * * 1-5', fri)!
    expect(n).toBe(at(2026, 1, 12, 9, 0))
    expect(new Date(n).getDay()).toBe(1)
  })
  it('rolls over month and year', () => {
    expect(nextCronAfter('0 0 1 * *', at(2026, 1, 31, 12, 0))).toBe(at(2026, 2, 1, 0, 0))
    expect(nextCronAfter('0 0 1 1 *', at(2026, 1, 1, 0, 0))).toBe(at(2027, 1, 1, 0, 0))
    expect(nextCronAfter('0 12 31 * *', at(2026, 4, 1, 0, 0))).toBe(at(2026, 5, 31, 12, 0)) // April has no 31st
  })
  it('finds Feb 29 in a leap year', () => {
    expect(nextCronAfter('0 0 29 2 *', at(2026, 3, 1, 0, 0))).toBe(at(2028, 2, 29, 0, 0))
  })
  it('matches day-of-month OR day-of-week when both are restricted', () => {
    // the 13th, or any Friday: from Mon 2026-01-05 the first hit is Fri 01-09
    expect(nextCronAfter('0 0 13 * 5', at(2026, 1, 5, 0, 0))).toBe(at(2026, 1, 9, 0, 0))
  })
  it('returns undefined for an invalid or impossible expression', () => {
    expect(nextCronAfter('nope', 0)).toBeUndefined()
    expect(nextCronAfter('0 0 31 2 *', at(2026, 1, 1))).toBeUndefined()
  })
})

describe('cron in the schedule model', () => {
  it('nextRunAfter and describeWhen handle type cron', () => {
    const when = { type: 'cron' as const, expr: '0 9 * * *' }
    expect(nextRunAfter(when, at(2026, 1, 5, 10, 0), { createdAt: 0 })).toBe(at(2026, 1, 6, 9, 0))
    expect(describeWhen(when)).toBe('Cron 0 9 * * *')
  })
  it('ScheduleWhenSchema validates the expression', () => {
    expect(ScheduleWhenSchema.safeParse({ type: 'cron', expr: ' */5 * * * * ' }).success).toBe(true)
    const bad = ScheduleWhenSchema.safeParse({ type: 'cron', expr: '99 * * * *' })
    expect(bad.success).toBe(false)
  })
})
