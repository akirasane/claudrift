import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from './chat-store'

let send: ReturnType<typeof vi.fn>
let interrupt: ReturnType<typeof vi.fn>

const st = (): ReturnType<typeof useChatStore.getState> => useChatStore.getState()
const setStatus = (status: 'idle' | 'running' | 'error'): void =>
  useChatStore.setState((s) => ({ convs: { ...s.convs, c1: { ...s.convs['c1']!, status } } }))

beforeEach(() => {
  send = vi.fn(async () => {})
  interrupt = vi.fn(async () => {})
  ;(globalThis as unknown as { window: { claudrift: unknown } }).window.claudrift = { session: { send, interrupt } }
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, queues: {}, drafts: {} })
  st().createConv({ convId: 'c1', cwd: 'C:\\p', localId: 'L1' })
})

describe('message queue', () => {
  it('sends the oldest queued message when the running turn ends, then the next one', async () => {
    setStatus('running')
    st().enqueue('c1', 'first')
    st().enqueue('c1', 'second')
    expect(st().queues['c1']).toHaveLength(2)
    setStatus('idle')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![0]).toMatchObject({ localId: 'L1', text: 'first' })
    expect(st().queues['c1']?.map((m) => m.text)).toEqual(['second'])
    setStatus('running')
    setStatus('idle')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls[1]![0]).toMatchObject({ text: 'second' })
    expect(st().queues['c1']).toBeUndefined()
  })

  it('keeps the queue when the turn failed', () => {
    setStatus('running')
    st().enqueue('c1', 'later')
    setStatus('error')
    expect(send).not.toHaveBeenCalled()
    expect(st().queues['c1']).toHaveLength(1)
  })

  it('send now moves the message first, interrupts the turn, and it goes out when the turn ends', async () => {
    setStatus('running')
    st().enqueue('c1', 'a')
    st().enqueue('c1', 'b')
    const b = st().queues['c1']![1]!
    await st().sendQueuedNow('c1', b.id)
    expect(interrupt).toHaveBeenCalledWith('L1')
    expect(st().queues['c1']?.map((m) => m.text)).toEqual(['b', 'a'])
    setStatus('idle')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![0]).toMatchObject({ text: 'b' })
  })

  it('send now on an idle conversation sends at once; remove drops a message', async () => {
    st().enqueue('c1', 'x')
    const id = st().queues['c1']![0]!.id
    await st().sendQueuedNow('c1', id)
    expect(interrupt).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    st().enqueue('c1', 'y')
    st().removeQueued('c1', st().queues['c1']![0]!.id)
    expect(st().queues['c1']).toBeUndefined()
  })
})
