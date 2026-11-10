import { dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { ExportMarkdownSchema, IpcChannels } from '../../shared/ipc'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface ExportIpcDeps {
  showSaveDialog?: (defaultPath: string) => Promise<{ canceled: boolean; filePath?: string }>
  writeFile?: (path: string, content: string) => Promise<void>
}

/** A file name Windows accepts, always ending in .md. */
export function markdownFileName(name: string): string {
  const base = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim()
  return `${base || 'conversation'}.md`
}

export function registerExportIpc(deps: ExportIpcDeps = {}): Disposer {
  const show =
    deps.showSaveDialog ??
    ((defaultPath: string) =>
      dialog.showSaveDialog({ defaultPath, filters: [{ name: 'Markdown', extensions: ['md'] }] }))
  const write = deps.writeFile ?? ((path: string, content: string) => writeFile(path, content, 'utf8'))
  ipcMain.handle(IpcChannels.exportMarkdown, async (_e, raw: unknown): Promise<string | null> => {
    const a = ExportMarkdownSchema.parse(raw)
    const r = await show(markdownFileName(a.defaultName))
    if (r.canceled || !r.filePath) return null
    await write(r.filePath, a.content)
    return r.filePath
  })
  return removeHandlers(IpcChannels.exportMarkdown)
}
