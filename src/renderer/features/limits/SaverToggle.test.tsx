import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, type AppPrefs } from '@shared/app'
import { SaverToggle } from './SaverToggle'

const set = vi.fn()
let prefs: AppPrefs

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
  prefs = { ...DEFAULT_PREFS }
  set.mockImplementation(async (patch: Partial<AppPrefs>) => {
    prefs = { ...prefs, ...patch }
    return { prefs, hotkey: { ok: true } }
  })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = { prefs: { get: async () => prefs, set } }
})

function mount(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SaverToggle />
    </QueryClientProvider>
  )
}

describe('SaverToggle', () => {
  it('shows OFF by default and saves the switch on click', async () => {
    mount()
    const b = await screen.findByTestId('status-saver')
    expect(b).toHaveTextContent('SAVER')
    expect(b).toHaveTextContent('OFF')
    expect(b.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(b)
    await waitFor(() => expect(set).toHaveBeenCalledWith({ ultraSaver: true }))
    await waitFor(() => expect(screen.getByTestId('status-saver').getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByTestId('status-saver')).toHaveTextContent('ON')
  })

  it('turns it back off', async () => {
    prefs = { ...DEFAULT_PREFS, ultraSaver: true }
    mount()
    const b = await screen.findByTestId('status-saver')
    await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(b)
    await waitFor(() => expect(set).toHaveBeenCalledWith({ ultraSaver: false }))
  })
})
