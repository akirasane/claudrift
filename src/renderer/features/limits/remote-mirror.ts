import * as React from 'react'
import type { HistorySessionInfo } from '@shared/events'
import type { RemoteState } from '@shared/remote'
import { toast } from '@/components/ui'
import { useWorkspaceStore } from '@/stores/workspace-store'

const POLL_MS = 3000
/** Clock slack between this app and the transcript file's mtime. */
const SLACK_MS = 2000

/** Sessions of the remote project that were written since Remote Control started. */
export function pickRemoteSessions(list: HistorySessionInfo[], startedAt: number): HistorySessionInfo[] {
  return list.filter((s) => s.lastModified >= startedAt - SLACK_MS)
}

/**
 * While Remote Control runs, mirror its sessions as read-only tabs: new transcripts open a tab (without taking
 * focus), changed transcripts refresh. Unverified live: assumes the remote session writes a local transcript.
 */
export function useRemoteMirror(s: RemoteState): void {
  const active = s.status === 'on' || s.status === 'starting'
  const { cwd, startedAt } = s
  React.useEffect(() => {
    if (!active || !cwd || !startedAt) return
    const seen = new Map<string, number>()
    let alive = true
    let busy = false
    const tick = async (): Promise<void> => {
      if (busy || !window.claudrift?.history) return
      busy = true
      try {
        const rows = pickRemoteSessions(await window.claudrift.history.list({ cwd }), startedAt)
        for (const row of rows) {
          if (!alive) return
          if (seen.get(row.sessionId) === row.lastModified) continue
          seen.set(row.sessionId, row.lastModified)
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
