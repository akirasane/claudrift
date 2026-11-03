import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeCliStatus } from '@shared/claude-cli'
import { ClaudeCliSection } from './ClaudeCliSection'

const base: ClaudeCliStatus = {
  active: { path: 'C:\\claude.exe', version: '2.1.0', source: 'user' },
  bundledCliVersion: '2.0.5',
  sdkPinned: '0.2.9',
  latestCli: '2.2.0',
  latestSdk: '0.3.0',
  cliUpdateAvailable: true,
  sdkUpdateAvailable: true,
  activeSessions: 0,
  canUpdate: true
}

function setup(status: ClaudeCliStatus) {
  const api = {
    status: vi.fn(async () => status),
    update: vi.fn(async () => ({ ok: true, message: 'Claude Code is now 2.2.0.', output: ['done'] }))
  }
  ;(window as unknown as { claudrift: unknown }).claudrift = { claudeCli: api }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ClaudeCliSection />
    </QueryClientProvider>
  )
  return api
}

afterEach(cleanup)

describe('ClaudeCliSection', () => {
  it('shows versions, SDK notice, and updates a user CLI', async () => {
    const api = setup(base)
    expect(await screen.findByTestId('cli-active')).toHaveTextContent('2.1.0 (user)')
    expect(screen.getByTestId('cli-latest')).toHaveTextContent('2.2.0')
    expect(screen.getByTestId('sdk-newer')).toBeTruthy()
    await userEvent.click(screen.getByTestId('cli-update'))
    expect(api.update).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('cli-update-result')).toHaveTextContent('now 2.2.0')
  })

  it('disables update while sessions run', async () => {
    setup({ ...base, activeSessions: 1, canUpdate: false })
    const btn = await screen.findByTestId('cli-update')
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('cli-update-hint')).toHaveTextContent('Stop running sessions')
  })

  it('explains the bundled case, hides update, shows unknown latest', async () => {
    setup({
      active: { source: 'bundled', version: '2.0.5' },
      bundledCliVersion: '2.0.5',
      cliUpdateAvailable: false,
      sdkUpdateAvailable: false,
      activeSessions: 0,
      canUpdate: false
    })
    expect(await screen.findByTestId('cli-bundled-note')).toHaveTextContent('npm i -g @anthropic-ai/claude-code')
    expect(screen.queryByTestId('cli-update')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('cli-latest')).toHaveTextContent('unknown'))
  })
})
