import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistorySessionInfo } from '@shared/events'
import { DeleteSessionDialog } from './DeleteSessionDialog'

const session: HistorySessionInfo = { sessionId: 's1', title: 'Fix login', cwd: 'C:\proj', lastModified: 1 }
let history: { delete: ReturnType<typeof vi.fn>; summarize: ReturnType<typeof vi.fn>; saveSummary: ReturnType<typeof vi.fn> }
let onDeleted: ReturnType<typeof vi.fn>
let onClose: ReturnType<typeof vi.fn>

beforeEach(() => {
  history = {
    delete: vi.fn(async () => {}),
    summarize: vi.fn(async () => '- decided X'),
    saveSummary: vi.fn(async () => 'C:\proj\CLAUDE.md')
  }
  ;(window as unknown as { claudrift: unknown }).claudrift = { history }
  onDeleted = vi.fn()
  onClose = vi.fn()
  render(<DeleteSessionDialog session={session} onClose={onClose} onDeleted={onDeleted} />)
})
afterEach(cleanup)

describe('DeleteSessionDialog', () => {
  it('summarizes, lets the user edit, saves to memory, then deletes', async () => {
    await userEvent.click(await screen.findByTestId('summarize-continue'))
    const box = (await screen.findByTestId('summary-text')) as HTMLTextAreaElement
    expect(box.value).toBe('- decided X')
    await userEvent.type(box, '\n- and Y')
    await userEvent.click(screen.getByTestId('save-and-delete'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(session))
    expect(history.saveSummary).toHaveBeenCalledWith({ cwd: 'C:\proj', title: 'Fix login', summary: '- decided X\n- and Y' })
    expect(history.delete).toHaveBeenCalledWith({ sessionId: 's1', cwd: 'C:\proj' })
    expect(history.saveSummary.mock.invocationCallOrder[0]!).toBeLessThan(history.delete.mock.invocationCallOrder[0]!)
  })

  it('unchecking the summary deletes straight away without any model call', async () => {
    await userEvent.click(await screen.findByTestId('keep-summary'))
    await userEvent.click(screen.getByTestId('delete-confirm'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(history.summarize).not.toHaveBeenCalled()
    expect(history.saveSummary).not.toHaveBeenCalled()
  })

  it('a failed summary shows the error and still allows deleting without it', async () => {
    history.summarize.mockRejectedValueOnce(new Error('offline'))
    await userEvent.click(await screen.findByTestId('summarize-continue'))
    expect((await screen.findByTestId('delete-error')).textContent).toContain('offline')
    expect(history.delete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('delete-without-summary'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(history.saveSummary).not.toHaveBeenCalled()
  })

  it('does not delete when the memory save fails', async () => {
    history.saveSummary.mockRejectedValueOnce(new Error('read-only folder'))
    await userEvent.click(await screen.findByTestId('summarize-continue'))
    await userEvent.click(await screen.findByTestId('save-and-delete'))
    expect((await screen.findByTestId('delete-error')).textContent).toContain('read-only folder')
    expect(history.delete).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
