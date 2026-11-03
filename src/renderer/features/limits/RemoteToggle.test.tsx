import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteState } from '@shared/remote'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { RemoteToggle } from './RemoteToggle'

const start = vi.fn()
const stop = vi.fn()
const trust = vi.fn()
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
  trust.mockResolvedValue({ ok: true })
  stop.mockImplementation(async () => (state = { status: 'off', log: [] }))
  ;(window as unknown as { claudrift: unknown }).claudrift = {
    remote: {
      getState: async () => state,
      start,
      stop,
      trust,
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
    expect(screen.queryByTestId('trust-dialog')).toBeNull()
  })

  it('trust dialog: cancel does nothing', async () => {
    render(<RemoteToggle />)
    await screen.findByTestId('status-remote')
    act(() => push({ status: 'error', message: 'Error: Workspace not trusted', needsTrust: true, cwd: 'C:/proj', log: [] }))
    expect(await screen.findByText('Trust this folder?')).toBeInTheDocument()
    expect(screen.getByTestId('trust-path')).toHaveTextContent('C:/proj')
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByTestId('trust-dialog')).toBeNull())
    expect(trust).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('trust dialog: confirm trusts then starts; REMOTE click reopens it', async () => {
    render(<RemoteToggle />)
    await screen.findByTestId('status-remote')
    state = { status: 'error', message: 'Error: Workspace not trusted', needsTrust: true, cwd: 'C:/proj', log: [] }
    act(() => push(state))
    fireEvent.click(await screen.findByText('Cancel'))
    await waitFor(() => expect(screen.queryByTestId('trust-dialog')).toBeNull())
    fireEvent.click(screen.getByTestId('status-remote'))
    fireEvent.click(await screen.findByTestId('trust-confirm'))
    await waitFor(() => expect(start).toHaveBeenCalledWith({ cwd: 'C:/proj' }))
    expect(trust).toHaveBeenCalledWith({ cwd: 'C:/proj' })
    expect(trust.mock.invocationCallOrder[0]!).toBeLessThan(start.mock.invocationCallOrder[0]!)
    expect(stop).not.toHaveBeenCalled()
  })
})
