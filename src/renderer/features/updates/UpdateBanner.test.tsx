import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/app'
import { UpdateBanner } from './UpdateBanner'

let push: (s: UpdateState) => void
let install: ReturnType<typeof vi.fn>

function setup(initial: UpdateState): void {
  install = vi.fn(async () => true)
  ;(window as unknown as { claudrift: unknown }).claudrift = {
    update: {
      getState: vi.fn(async () => initial),
      check: vi.fn(),
      install,
      onState: vi.fn((cb: (s: UpdateState) => void) => {
        push = cb
        return () => {}
      })
    }
  }
  render(<UpdateBanner />)
}

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('UpdateBanner', () => {
  it('renders nothing for disabled, idle, uptodate and error states', async () => {
    setup({ kind: 'uptodate' })
    await act(async () => {})
    expect(screen.queryByTestId('update-banner')).toBeNull()
    act(() => push({ kind: 'error', message: 'x' }))
    expect(screen.queryByTestId('update-banner')).toBeNull()
  })

  it('shows download progress, then Restart to update which calls install', async () => {
    setup({ kind: 'downloading', version: '0.6.0', percent: 42 })
    expect((await screen.findByTestId('update-banner-text')).textContent).toBe('Update v0.6.0 downloading 42%')
    expect(screen.queryByTestId('update-banner-install')).toBeNull()
    act(() => push({ kind: 'ready', version: '0.6.0' }))
    await userEvent.click(screen.getByRole('button', { name: 'Restart to update' }))
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('opens a modal when ready, and Later collapses it to the strip with Restart still there', async () => {
    setup({ kind: 'ready', version: '0.6.0' })
    expect(await screen.findByTestId('update-modal')).toBeTruthy()
    expect(screen.queryByTestId('update-banner')).toBeNull()
    await userEvent.click(screen.getByTestId('update-modal-later'))
    await waitFor(() => expect(screen.queryByTestId('update-modal')).toBeNull())
    expect(screen.getByTestId('update-banner-text').textContent).toBe('Update v0.6.0 is ready')
    await userEvent.click(screen.getByRole('button', { name: 'Restart to update' }))
    expect(install).toHaveBeenCalledTimes(1)
    act(() => push({ kind: 'ready', version: '0.7.0' }))
    expect(await screen.findByTestId('update-modal')).toBeTruthy()
  })

  it('dismisses per version and shows again for a newer one', async () => {
    setup({ kind: 'ready', version: '0.6.0' })
    await userEvent.click(await screen.findByTestId('update-modal-later'))
    await userEvent.click(await screen.findByTestId('update-banner-dismiss'))
    expect(screen.queryByTestId('update-banner')).toBeNull()
    expect(window.localStorage.getItem('claudrift.update.dismissed')).toBe('0.6.0')
    act(() => push({ kind: 'downloading', version: '0.6.0', percent: 100 }))
    expect(screen.queryByTestId('update-banner')).toBeNull()
    act(() => push({ kind: 'ready', version: '0.7.0' }))
    await waitFor(() => expect(screen.getByTestId('update-modal').textContent).toContain('v0.7.0'))
  })
})
