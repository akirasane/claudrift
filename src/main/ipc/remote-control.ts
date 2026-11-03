import { ipcMain } from 'electron'
import { IpcChannels, RemoteStartSchema, RemoteTrustSchema } from '../../shared/ipc'
import type { RemoteState } from '../../shared/remote'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface RemoteIpcDeps {
  getState(): RemoteState
  start(a: { cwd: string; name?: string; permissionMode?: string }): RemoteState
  stop(): RemoteState
  trust(a: { cwd: string }): { ok: boolean; message?: string }
}

export function registerRemoteIpc(deps: RemoteIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.remoteGet, (): RemoteState => deps.getState())
  ipcMain.handle(IpcChannels.remoteStart, (_e, raw: unknown): RemoteState => deps.start(RemoteStartSchema.parse(raw)))
  ipcMain.handle(IpcChannels.remoteStop, (): RemoteState => deps.stop())
  ipcMain.handle(IpcChannels.remoteTrust, (_e, raw: unknown) => deps.trust(RemoteTrustSchema.parse(raw)))
  return removeHandlers(IpcChannels.remoteGet, IpcChannels.remoteStart, IpcChannels.remoteStop, IpcChannels.remoteTrust)
}
