import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistorySessionInfo } from '@shared/events'
import type { RemoteState } from '@shared/remote'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { pickRemoteSessions, useRemoteMirror } from './remote-mirror'

const row = (id: string, lastModified: number, fileSize?: number): HistorySessionInfo => ({
  sessionId: id,
  title: `t-${id}`,
  cwd: 'C:\\proj',
  lastModified,
  ...(fileSize !== undefined ? { fileSize } : {})
})

function Probe({ s }: { s: RemoteState }): null {
  useRemoteMirror(s)
  return null
}

describe('pickRemoteSessions', () => {
  it('keeps only sessions written since the remote run started (2s slack)', () => {
    const out = pickRemoteSessions([row('old', 1000), row('edge', 9000), row('new', 20000)], 10000)
    expect(out.map((r) => r.sessionId)).toEqual(['edge', 'new'])
  })
  it('drops sessions the app owns', () => {
    const out = pickRemoteSessions([row('mine', 20000), row('remote', 20000)], 10000, new Set(['mine']))
    expect(out.map((r) => r.sessionId)).toEqual(['remote'])
  })
})

describe('useRemoteMirror', () => {
  let list: ReturnType<typeof vi.fn>
  let load: ReturnType<typeof vi.fn>
  let scheduleList: ReturnType<typeof vi.fn>
  const s: RemoteState = { status: 'on', cwd: 'C:\\proj', startedAt: 10000, log: [] }
  const tick = async (ms: number): Promise<void> => {
    await act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
  }
  beforeEach(() => {
    vi.useFakeTimers()
    useWorkspaceStore.setState({ tabs: [], unread: {} })
    useChatStore.setState({ convs: {} })
    list = vi.fn(async () => [row('s1', 20000)])
    load = vi.fn(async () => [{ t: 'user_message', text: 'hello from phone' }])
    scheduleList = vi.fn(async () => [])
    ;(window as unknown as { claudrift: unknown }).claudrift = { history: { list, load }, schedule: { list: scheduleList } }
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens a read-only mirror tab for a new remote session and refreshes it when it changes', async () => {
    render(<Probe s={s} />)
    await tick(10)
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.sessionId === 's1')
    expect(tab?.title).toBe('Remote: t-s1')
    expect(useChatStore.getState().convs['remote-s1']?.mirror).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
    await tick(3000)
    expect(load).toHaveBeenCalledTimes(1) // unchanged lastModified: no reload
    list.mockResolvedValue([row('s1', 25000)])
    await tick(3000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reloads when only the file size changed, not when nothing changed', async () => {
    list.mockResolvedValue([row('s1', 20000, 100)])
    render(<Probe s={s} />)
    await tick(10)
    await tick(3000)
    expect(load).toHaveBeenCalledTimes(1)
    list.mockResolvedValue([row('s1', 20000, 250)])
    await tick(3000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not mirror a session already open as a normal tab or conversation', async () => {
    useWorkspaceStore.setState({ tabs: [{ convId: 'hist-s1', cwd: 'C:\\proj', sessionId: 's1', openedAt: 1, lastActiveAt: 1 }] })
    list.mockResolvedValue([row('s1', 20000), row('s2', 20000), row('s3', 20000)])
    useChatStore.getState().createConv({ convId: 'c-live', cwd: 'C:\\proj', resumeSessionId: 's2' })
    render(<Probe s={s} />)
    await tick(10)
    expect(useChatStore.getState().convs['remote-s1']).toBeUndefined()
    expect(useChatStore.getState().convs['remote-s2']).toBeUndefined()
    expect(useChatStore.getState().convs['remote-s3']?.mirror).toBe(true)
  })

  it('does not mirror scheduled runs', async () => {
    scheduleList.mockResolvedValue([{ id: 't', runs: [{ id: 'r', status: 'running', startedAt: 1, sessionId: 's1' }] }])
    list.mockResolvedValue([row('s1', 20000), row('s2', 20000)])
    render(<Probe s={s} />)
    await tick(10)
    expect(useChatStore.getState().convs['remote-s1']).toBeUndefined()
    expect(useChatStore.getState().convs['remote-s2']?.mirror).toBe(true)
  })

  it('a mirror tab the user closed does not reopen when the session changes', async () => {
    render(<Probe s={s} />)
    await tick(10)
    expect(useWorkspaceStore.getState().tabs.some((t) => t.convId === 'remote-s1')).toBe(true)
    await act(async () => void (await useWorkspaceStore.getState().closeTab('remote-s1')))
    list.mockResolvedValue([row('s1', 30000)])
    await tick(3000)
    expect(useWorkspaceStore.getState().tabs.some((t) => t.convId === 'remote-s1')).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does nothing while Remote Control is off', async () => {
    render(<Probe s={{ status: 'off', log: [] }} />)
    await act(async () => void vi.advanceTimersByTime(6000))
    expect(list).not.toHaveBeenCalled()
  })
})
