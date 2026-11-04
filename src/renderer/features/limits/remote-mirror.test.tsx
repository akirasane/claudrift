import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistorySessionInfo } from '@shared/events'
import type { RemoteState } from '@shared/remote'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { pickRemoteSessions, useRemoteMirror } from './remote-mirror'

const row = (id: string, lastModified: number): HistorySessionInfo => ({ sessionId: id, title: `t-${id}`, cwd: 'C:\\proj', lastModified })

function Probe({ s }: { s: RemoteState }): null {
  useRemoteMirror(s)
  return null
}

describe('pickRemoteSessions', () => {
  it('keeps only sessions written since the remote run started (2s slack)', () => {
    const out = pickRemoteSessions([row('old', 1000), row('edge', 9000), row('new', 20000)], 10000)
    expect(out.map((r) => r.sessionId)).toEqual(['edge', 'new'])
  })
})

describe('useRemoteMirror', () => {
  let list: ReturnType<typeof vi.fn>
  let load: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    list = vi.fn(async () => [row('s1', 20000)])
    load = vi.fn(async () => [{ t: 'user_message', text: 'hello from phone' }])
    ;(window as unknown as { claudrift: unknown }).claudrift = { history: { list, load } }
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens a read-only mirror tab for a new remote session and refreshes it when it changes', async () => {
    const s: RemoteState = { status: 'on', cwd: 'C:\\proj', startedAt: 10000, log: [] }
    render(<Probe s={s} />)
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)))
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.sessionId === 's1')
    expect(tab?.title).toBe('Remote: t-s1')
    expect(useChatStore.getState().convs['remote-s1']?.mirror).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => void vi.advanceTimersByTime(3000))
    expect(load).toHaveBeenCalledTimes(1) // unchanged lastModified: no reload
    list.mockResolvedValue([row('s1', 25000)])
    await act(async () => void vi.advanceTimersByTime(3000))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does nothing while Remote Control is off', async () => {
    render(<Probe s={{ status: 'off', log: [] }} />)
    await act(async () => void vi.advanceTimersByTime(6000))
    expect(list).not.toHaveBeenCalled()
  })
})
