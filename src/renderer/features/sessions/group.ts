import type { HistorySessionInfo } from '@shared/events'

export interface SessionGroup {
  label: string
  items: HistorySessionInfo[]
}

const DAY = 86_400_000

/** Today / Yesterday / Previous 7 days / Previous 30 days / Older, keeping the incoming (newest first) order. */
export function groupByDay(sessions: HistorySessionInfo[], now = Date.now()): SessionGroup[] {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const t0 = startOfToday.getTime()
  const buckets: SessionGroup[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Previous 30 days', items: [] },
    { label: 'Older', items: [] }
  ]
  for (const s of sessions) {
    const t = s.lastModified
    const i = t >= t0 ? 0 : t >= t0 - DAY ? 1 : t >= t0 - 7 * DAY ? 2 : t >= t0 - 30 * DAY ? 3 : 4
    buckets[i]!.items.push(s)
  }
  return buckets.filter((b) => b.items.length > 0)
}

/** Case-insensitive match on title, first prompt or branch. */
export function filterSessions(sessions: HistorySessionInfo[], query: string): HistorySessionInfo[] {
  const q = query.trim().toLowerCase()
  if (!q) return sessions
  return sessions.filter((s) => [s.title, s.firstPrompt, s.gitBranch].some((x) => x?.toLowerCase().includes(q)))
}
