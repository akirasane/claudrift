import { ipcMain } from 'electron'
import { IpcChannels, RemoteStartSchema, RemoteStopSchema, RemoteTrustSchema } from '../../shared/ipc'
import type { RemoteState } from '../../shared/remote'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface RemoteIpcDeps {
  /** Every run that is not off. */
  list(): RemoteState[]
  start(a: { cwd: string; name?: string; permissionMode?: string }): RemoteState
  stop(cwd: string): RemoteState
  trust(a: { cwd: string }): { ok: boolean; message?: string }
}

export function registerRemoteIpc(deps: RemoteIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.remoteGet, (): RemoteState[] => deps.list())
  ipcMain.handle(IpcChannels.remoteStart, (_e, raw: unknown): RemoteState => deps.start(RemoteStartSchema.parse(raw)))
  ipcMain.handle(IpcChannels.remoteStop, (_e, raw: unknown): RemoteState => deps.stop(RemoteStopSchema.parse(raw).cwd))
  ipcMain.handle(IpcChannels.remoteTrust, (_e, raw: unknown) => deps.trust(RemoteTrustSchema.parse(raw)))
  return removeHandlers(IpcChannels.remoteGet, IpcChannels.remoteStart, IpcChannels.remoteStop, IpcChannels.remoteTrust)
}
