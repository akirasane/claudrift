import * as React from 'react'
import type { HistorySessionInfo } from '@shared/events'
import type { RemoteState } from '@shared/remote'
import { toast } from '@/components/ui'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

const POLL_MS = 3000
/** Clock slack between this app and the transcript file's mtime. */
const SLACK_MS = 2000
const MIRROR_PREFIX = 'remote-'

/**
 * Sessions of the remote project that were written since Remote Control started, minus `exclude`
 * (sessions the app itself owns: see ownSessionIds).
 */
export function pickRemoteSessions(list: HistorySessionInfo[], startedAt: number, exclude: ReadonlySet<string> = new Set()): HistorySessionInfo[] {
  return list.filter((s) => s.lastModified >= startedAt - SLACK_MS && !exclude.has(s.sessionId))
}

/**
 * SDK session ids that are NOT remote: chats open as a normal tab (live or restored from history) and scheduled runs.
 * Scheduled runs record their session id on the run as soon as the session starts (ScheduleService), so the persisted
 * schedule list is the source of truth; they never get a tab, so they are not visible from the tab list.
 */
export async function ownSessionIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const t of useWorkspaceStore.getState().tabs) {
    if (t.sessionId && !t.convId.startsWith(MIRROR_PREFIX)) ids.add(t.sessionId)
  }
  for (const [convId, c] of Object.entries(useChatStore.getState().convs)) {
    if (convId.startsWith(MIRROR_PREFIX) || c.mirror) continue
    const id = c.meta.sessionId ?? c.resumeSessionId
    if (id) ids.add(id)
  }
  try {
    const tasks = (await window.claudrift?.schedule?.list()) ?? []
    for (const task of tasks) for (const r of task.runs) if (r.sessionId) ids.add(r.sessionId)
  } catch {
    /* schedule list unavailable: mirror what the history shows */
  }
  return ids
}

/**
 * While Remote Control runs, mirror its sessions as read-only tabs: new transcripts open a tab (without taking
 * focus), changed transcripts refresh. A mirror tab the user closes stays closed until the next Remote Control run.
 * Unverified live: assumes the remote session writes a local transcript.
 */
export function useRemoteMirror(s: RemoteState): void {
  const active = s.status === 'on' || s.status === 'starting'
  const { cwd, startedAt } = s
  React.useEffect(() => {
    if (!active || !cwd || !startedAt) return
    // sessionId -> "lastModified:fileSize" last loaded. Unchanged: no reload.
    const seen = new Map<string, string>()
    const dismissed = new Set<string>()
    let alive = true
    let busy = false
    const tick = async (): Promise<void> => {
      if (busy || !window.claudrift?.history) return
      busy = true
      try {
        // A mirrored session whose tab is gone was closed by the user.
        const tabs = useWorkspaceStore.getState().tabs
        for (const id of seen.keys()) {
          if (!dismissed.has(id) && !tabs.some((t) => t.convId === `${MIRROR_PREFIX}${id}`)) dismissed.add(id)
        }
        const own = await ownSessionIds()
        const rows = pickRemoteSessions(await window.claudrift.history.list({ cwd }), startedAt, own)
        for (const row of rows) {
          if (!alive) return
          if (dismissed.has(row.sessionId)) continue
          const key = `${row.lastModified}:${row.fileSize ?? 0}`
          if (seen.get(row.sessionId) === key) continue
          seen.set(row.sessionId, key)
          const isNew = await useWorkspaceStore.getState().mirrorSession(row)
          if (isNew) toast('Remote session mirrored', { description: `${row.title} (read-only; reply from claude.ai/code or the phone app)` })
        }
      } catch {
        /* history not readable this round: try again */
      } finally {
        busy = false
      }
    }
    void tick()
    const id = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [active, cwd, startedAt])
}
