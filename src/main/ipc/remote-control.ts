import { ipcMain } from 'electron'
import { IpcChannels, RemoteStartSchema } from '../../shared/ipc'
import type { RemoteState } from '../../shared/remote'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface RemoteIpcDeps {
  getState(): RemoteState
  start(a: { cwd: string; name?: string; permissionMode?: string }): RemoteState
  stop(): RemoteState
}

export function registerRemoteIpc(deps: RemoteIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.remoteGet, (): RemoteState => deps.getState())
  ipcMain.handle(IpcChannels.remoteStart, (_e, raw: unknown): RemoteState => deps.start(RemoteStartSchema.parse(raw)))
  ipcMain.handle(IpcChannels.remoteStop, (): RemoteState => deps.stop())
  return removeHandlers(IpcChannels.remoteGet, IpcChannels.remoteStart, IpcChannels.remoteStop)
}
