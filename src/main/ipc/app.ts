import { app, ipcMain } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { AuthStatusArgsSchema, IpcChannels, SetActiveSessionSchema } from '../../shared/ipc'
import type { AuthStatus } from '../../shared/app'
import type { AppInfo } from '../../shared/events'
import { assistantPath, readSdkVersions, resolveClaudeBinary, resolveClaudeExecutable, trashDir } from '../paths'
import type { AuthStatusService } from '../services/auth-status'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

let elevated = false
/** Windows: `net session` only succeeds with administrator rights. Call once at startup. */
export function detectElevation(): void {
  if (process.platform !== 'win32') return
  execFile('net', ['session'], { windowsHide: true }, (err) => {
    elevated = !err
  })
}

/** Starts a second, elevated copy after this one has quit (UAC prompt), then quits. */
export function relaunchElevated(): void {
  if (process.platform !== 'win32') throw new Error('Only available on Windows')
  if (!app.isPackaged) throw new Error('Only available in the installed app')
  const exe = process.execPath.split("'").join("''")
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Start-Sleep -Seconds 2; Start-Process -FilePath '${exe}' -Verb RunAs`],
    { detached: true, stdio: 'ignore', windowsHide: true }
  )
  child.unref()
  app.quit()
}

export function getAppInfo(): AppInfo {
  const bin = resolveClaudeBinary()
  const exe = resolveClaudeExecutable()
  const userData = app.getPath('userData')
  return {
    ...(exe ? { claudePath: exe } : {}),
    ...(bin.version ? { claudeVersion: bin.version } : {}),
    claudeSource: bin.source,
    sdkVersion: readSdkVersions().sdk ?? 'unknown',
    platform: process.platform,
    trashDir: trashDir(userData),
    version: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    packaged: app.isPackaged,
    userDataDir: userData,
    assistantDir: assistantPath(userData),
    elevated
  }
}

export interface AppIpcDeps {
  auth: Pick<AuthStatusService, 'get'>
  /** app:setActiveSession sink (notifications). */
  setActiveSession: (localId: string | null) => void
}

export function registerAppIpc(deps: AppIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.appInfo, async (): Promise<AppInfo> => getAppInfo())
  ipcMain.handle(IpcChannels.appRelaunchElevated, () => relaunchElevated())
  ipcMain.handle(
    IpcChannels.appAuthStatus,
    (_e, raw: unknown): Promise<AuthStatus> => deps.auth.get(AuthStatusArgsSchema.parse(raw ?? {}).refresh)
  )
  const onActive = (_e: unknown, raw: unknown): void => {
    const parsed = SetActiveSessionSchema.safeParse(raw)
    if (parsed.success) deps.setActiveSession(parsed.data.localId)
  }
  ipcMain.on(IpcChannels.appSetActiveSession, onActive)
  const off = removeHandlers(IpcChannels.appInfo, IpcChannels.appRelaunchElevated, IpcChannels.appAuthStatus)
  return () => {
    off()
    ipcMain.removeListener(IpcChannels.appSetActiveSession, onActive)
  }
}
