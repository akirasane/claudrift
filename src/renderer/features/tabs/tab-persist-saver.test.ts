import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { parseTabs, serializeTabs } from './tab-persist'

const CWD = 'C:\\fixture\\alpha'
const now = Date.now()
const tab = (convId: string, sessionId?: string) => ({ convId, cwd: CWD, sessionId, openedAt: now, lastActiveAt: now })

beforeEach(() => {
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, savers: {} })
  useWorkspaceStore.setState({ tabs: [], activeConvId: undefined })
})

describe('tab saver persistence', () => {
  it('serializes explicit saver choices (true and false) and omits unset ones', () => {
    const out = serializeTabs([tab('a', 's1'), tab('b', 's2'), tab('c', 's3')], undefined, {}, { a: true, b: false })
    expect(out.tabs.map((t) => t.saver)).toEqual([true, false, undefined])
    expect('saver' in out.tabs[2]!).toBe(false)
  })

  it('round-trips and stays compatible with entries saved before savers existed', () => {
    const raw = JSON.stringify(serializeTabs([tab('a', 's1')], undefined, {}, { a: false }))
    expect(parseTabs(raw)!.tabs[0]!.saver).toBe(false)
    const old = JSON.stringify({ tabs: [{ convId: 'hist-s1', cwd: CWD, sessionId: 's1' }] })
    expect(parseTabs(old)!.tabs[0]).toEqual({ convId: 'hist-s1', cwd: CWD, sessionId: 's1' })
    const bad = JSON.stringify({ tabs: [{ convId: 'hist-s1', cwd: CWD, sessionId: 's1', saver: 'yes' }] })
    expect(parseTabs(bad)!.tabs[0]!.saver).toBeUndefined()
  })

  it('restoreTabs seeds the saver choice', () => {
    useWorkspaceStore.getState().restoreTabs({
      tabs: [
        { convId: 'hist-s1', cwd: CWD, sessionId: 's1', saver: false },
        { convId: 'hist-s2', cwd: CWD, sessionId: 's2' }
      ]
    })
    expect(useChatStore.getState().savers).toEqual({ 'hist-s1': false })
  })
})
