import { ipcMain } from 'electron'
import { IpcChannels, RemoteStartSchema, RemoteStopSchema, RemoteTrustSchema } from '../../shared/ipc'
import type { RemoteState } from '../../shared/remote'
import { BYPASS_DISABLED } from '../services/sdk-adapter'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface RemoteIpcDeps {
  /** Every run that is not off. */
  list(): RemoteState[]
  start(a: { cwd: string; name?: string; permissionMode?: string }): RemoteState
  stop(cwd: string): RemoteState
  trust(a: { cwd: string }): { ok: boolean; message?: string }
  /** Reads the allowBypassMode preference at call time. Defaults to off. */
  allowBypass?: () => boolean
}

/** Parses a start request and refuses Bypass mode unless the preference allows it (same rule as SessionManager). */
export function parseRemoteStart(raw: unknown, allowBypass: boolean): ReturnType<typeof RemoteStartSchema.parse> {
  const a = RemoteStartSchema.parse(raw)
  if (a.permissionMode === 'bypassPermissions' && !allowBypass) throw new Error(BYPASS_DISABLED)
  return a
}

export function registerRemoteIpc(deps: RemoteIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.remoteGet, (): RemoteState[] => deps.list())
  ipcMain.handle(IpcChannels.remoteStart, (_e, raw: unknown): RemoteState => deps.start(parseRemoteStart(raw, deps.allowBypass?.() === true)))
  ipcMain.handle(IpcChannels.remoteStop, (_e, raw: unknown): RemoteState => deps.stop(RemoteStopSchema.parse(raw).cwd))
  ipcMain.handle(IpcChannels.remoteTrust, (_e, raw: unknown) => deps.trust(RemoteTrustSchema.parse(raw)))
  return removeHandlers(IpcChannels.remoteGet, IpcChannels.remoteStart, IpcChannels.remoteStop, IpcChannels.remoteTrust)
}
