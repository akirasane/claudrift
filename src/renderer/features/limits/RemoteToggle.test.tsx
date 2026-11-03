import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteState } from '@shared/remote'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { RemoteToggle } from './RemoteToggle'

const start = vi.fn()
const stop = vi.fn()
let state: RemoteState
let push: (s: RemoteState) => void = () => {}

beforeAll(() => {
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', RO)
})

beforeEach(() => {
  vi.clearAllMocks()
  state = { status: 'off', log: [] }
  useWorkspaceStore.setState({ cwd: 'C:\proj' })
  start.mockImplementation(async () => (state = { status: 'starting', log: [] }))
  stop.mockImplementation(async () => (state = { status: 'off', log: [] }))
  ;(window as unknown as { claudrift: unknown }).claudrift = {
    remote: {
      getState: async () => state,
      start,
      stop,
      onState: (cb: (s: RemoteState) => void) => {
        push = cb
        return () => {}
      }
    }
  }
})

describe('RemoteToggle', () => {
  it('starts in the active project cwd and stops again', async () => {
    render(<RemoteToggle />)
    const b = await screen.findByTestId('status-remote')
    expect(b).toHaveTextContent('OFF')
    fireEvent.click(b)
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'C:\proj' })))
    act(() => push({ status: 'on', url: 'https://claude.ai/code/x', log: [] }))
    await waitFor(() => expect(screen.getByTestId('status-remote')).toHaveTextContent('ON'))
    expect(screen.getByTestId('remote-copy')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('status-remote'))
    await waitFor(() => expect(stop).toHaveBeenCalled())
  })

  it('shows ERR on an error state', async () => {
    render(<RemoteToggle />)
    await screen.findByTestId('status-remote')
    act(() => push({ status: 'error', message: 'Workspace not trusted', log: [] }))
    await waitFor(() => expect(screen.getByTestId('status-remote')).toHaveTextContent('ERR'))
  })
})
