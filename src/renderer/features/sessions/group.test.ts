import { describe, expect, it } from 'vitest'
import type { HistorySessionInfo } from '@shared/events'
import { filterSessions, groupByDay } from './group'

const NOW = new Date(2026, 5, 15, 15, 0, 0).getTime()
const day = 86_400_000
const s = (id: string, ago: number, extra: Partial<HistorySessionInfo> = {}): HistorySessionInfo => ({
  sessionId: id,
  title: `title ${id}`,
  cwd: 'C:\p',
  lastModified: NOW - ago,
  ...extra
})

describe('groupByDay', () => {
  it('buckets by calendar day and drops empty groups', () => {
    const g = groupByDay([s('a', 1000), s('b', 20 * 3600_000), s('c', 3 * day), s('d', 20 * day), s('e', 90 * day)], NOW)
    expect(g.map((x) => [x.label, x.items.map((i) => i.sessionId)])).toEqual([
      ['Today', ['a']],
      ['Yesterday', ['b']],
      ['Previous 7 days', ['c']],
      ['Previous 30 days', ['d']],
      ['Older', ['e']]
    ])
    expect(groupByDay([s('a', 1000)], NOW).map((x) => x.label)).toEqual(['Today'])
  })
})

describe('filterSessions', () => {
  it('matches title, first prompt and branch, ignoring case and blanks', () => {
    const list = [s('a', 0, { title: 'Fix Login' }), s('b', 0, { firstPrompt: 'refactor api' }), s('c', 0, { gitBranch: 'feature/x' })]
    expect(filterSessions(list, 'login').map((x) => x.sessionId)).toEqual(['a'])
    expect(filterSessions(list, 'API').map((x) => x.sessionId)).toEqual(['b'])
    expect(filterSessions(list, 'FEATURE').map((x) => x.sessionId)).toEqual(['c'])
    expect(filterSessions(list, '  ')).toHaveLength(3)
  })
})
