import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/toaster'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { crossedCostAlert, formatCostAlert, useCostAlerts } from './use-cost-alert'

vi.mock('@/components/ui/toaster', async (orig) => ({
  ...(await orig<typeof import('@/components/ui/toaster')>()),
  toast: vi.fn()
}))

describe('crossedCostAlert', () => {
  it('is off at 0', () => {
    expect(crossedCostAlert(0, 0, 50)).toBe(false)
  })
  it('fires only when the total crosses the limit', () => {
    expect(crossedCostAlert(1, 0, 0.99)).toBe(false)
    expect(crossedCostAlert(1, 0.5, 1)).toBe(true)
    expect(crossedCostAlert(1, 0, 5)).toBe(true)
    expect(crossedCostAlert(1, 1.2, 1.5)).toBe(false)
  })
  it('ignores non-finite totals', () => {
    expect(crossedCostAlert(1, 0, Number.NaN)).toBe(false)
  })
  it('formats the message', () => {
    expect(formatCostAlert(1, 1.234)).toBe('Cost reached $1.23 (limit $1.00)')
  })
})

const result = (costUsd: number) => ({
  costUsd,
  durationMs: 1,
  turns: 1,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  isError: false
})

describe('useCostAlerts', () => {
  beforeEach(() => {
    vi.mocked(toast).mockClear()
    useChatStore.setState({ convs: {}, localToConv: {} })
    useWorkspaceStore.setState({ tabs: [], activeConvId: undefined })
    ;(window as unknown as { claudrift: unknown }).claudrift = {
      prefs: { get: vi.fn(async () => ({ costAlertUsd: 1 })), onChanged: vi.fn(() => () => {}) }
    }
  })

  it('toasts once per conversation', async () => {
    useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:\\x' })
    renderHook(() => useCostAlerts())
    await act(async () => {})
    const setCost = (n: number): void =>
      act(() => {
        useChatStore.setState((s) => ({
          convs: { ...s.convs, c1: { ...s.convs['c1']!, lastResult: result(n) } }
        }))
      })
    setCost(0.5)
    expect(toast).not.toHaveBeenCalled()
    setCost(1.4)
    expect(toast).toHaveBeenCalledTimes(1)
    setCost(2.5)
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
