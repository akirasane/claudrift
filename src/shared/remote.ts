// Remote Control (`claude remote-control` child process) state. Pure and zod-free (the sandboxed preload bundles it).

export type RemoteStatus = 'off' | 'starting' | 'on' | 'error'

export interface RemoteState {
  status: RemoteStatus
  url?: string
  name?: string
  cwd?: string
  message?: string
  /** Last ~50 output lines, ANSI stripped. */
  log: string[]
}

export const EMPTY_REMOTE: RemoteState = { status: 'off', log: [] }

export interface RemoteStartArgs {
  cwd: string
  name?: string
  permissionMode?: string
}
