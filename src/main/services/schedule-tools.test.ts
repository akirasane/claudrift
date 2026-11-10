import { describe, expect, it } from 'vitest'
import { parseWhen } from './schedule-tools'

describe('parseWhen cron', () => {
  it('builds a cron when', () => {
    expect(parseWhen({ when_type: 'cron', cron: ' */15 9-17 * * 1-5 ' })).toEqual({ type: 'cron', expr: '*/15 9-17 * * 1-5' })
  })
  it('returns a readable error for a missing or bad expression', () => {
    expect(parseWhen({ when_type: 'cron' })).toMatch(/pass `cron`/)
    expect(parseWhen({ when_type: 'cron', cron: '61 * * * *' })).toMatch(/Minute must be 0-59/)
  })
  it('keeps the other types working', () => {
    expect(parseWhen({ when_type: 'interval', every_minutes: 5 })).toEqual({ type: 'interval', everyMinutes: 5 })
  })
})
