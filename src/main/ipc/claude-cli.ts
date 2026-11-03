import { ipcMain } from 'electron'
import type { ClaudeCliStatus, ClaudeCliUpdateResult } from '../../shared/claude-cli'
import { ClaudeCliStatusArgsSchema, IpcChannels } from '../../shared/ipc'
import type { ClaudeCliService } from '../services/claude-cli-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export type ClaudeCliIpcDeps = Pick<ClaudeCliService, 'status' | 'update'>

export function registerClaudeCliIpc(deps: ClaudeCliIpcDeps): Disposer {
  ipcMain.handle(
    IpcChannels.claudeCliStatus,
    (_e, raw: unknown): Promise<ClaudeCliStatus> => deps.status(ClaudeCliStatusArgsSchema.parse(raw ?? {}).refresh === true)
  )
  ipcMain.handle(IpcChannels.claudeCliUpdate, (): Promise<ClaudeCliUpdateResult> => deps.update())
  return removeHandlers(IpcChannels.claudeCliStatus, IpcChannels.claudeCliUpdate)
}
