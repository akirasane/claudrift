import { afterEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '../../shared/ipc'

const handlers = new Map<string, (e: unknown, raw?: unknown) => unknown>()
vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw?: unknown) => unknown) => void handlers.set(ch, fn),
    removeHandler: (ch: string) => void handlers.delete(ch)
  }
}))

import { markdownFileName, registerExportIpc } from './export'

const call = (raw?: unknown): any => handlers.get(IpcChannels.exportMarkdown)!({}, raw)
afterEach(() => handlers.clear())

describe('markdownFileName', () => {
  it('strips illegal characters and adds .md', () => {
    expect(markdownFileName('a/b:c*?.txt')).toBe('a-b-c--.txt.md')
    expect(markdownFileName('  ...  ')).toBe('conversation.md')
    expect(markdownFileName('Fix the bug')).toBe('Fix the bug.md')
  })
})

describe('export IPC', () => {
  it('writes the chosen file and returns its path', async () => {
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: 'C:\\out\\x.md' }))
    const writeFile = vi.fn(async () => {})
    registerExportIpc({ showSaveDialog, writeFile })
    expect(await call({ defaultName: 'My chat', content: '# hi' })).toBe('C:\\out\\x.md')
    expect(showSaveDialog).toHaveBeenCalledWith('My chat.md')
    expect(writeFile).toHaveBeenCalledWith('C:\\out\\x.md', '# hi')
  })

  it('returns null and writes nothing when cancelled', async () => {
    const writeFile = vi.fn(async () => {})
    registerExportIpc({ showSaveDialog: async () => ({ canceled: true }), writeFile })
    expect(await call({ defaultName: 'x', content: 'y' })).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('rejects invalid input', async () => {
    registerExportIpc({ showSaveDialog: async () => ({ canceled: true }), writeFile: async () => {} })
    await expect(call({ defaultName: '', content: 'y' })).rejects.toThrow()
    await expect(call({ defaultName: 'x', content: 'y', extra: 1 })).rejects.toThrow()
    await expect(call('nope')).rejects.toThrow()
  })
})
