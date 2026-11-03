export type ClaudeCliSource = 'env' | 'user' | 'bundled'

/** Snapshot for the Settings "Claude Code & SDK" panel. Latest versions are undefined when the registry is unreachable. */
export interface ClaudeCliStatus {
  active: { path?: string; version?: string; source: ClaudeCliSource; note?: string }
  bundledCliVersion?: string
  sdkPinned?: string
  latestCli?: string
  latestSdk?: string
  /** A newer published CLI than the active one. */
  cliUpdateAvailable: boolean
  /** A newer published Agent SDK than the pinned one (only a new Claudrift release can ship it). */
  sdkUpdateAvailable: boolean
  /** Sessions currently mid-turn. */
  activeSessions: number
  /** Active source is user/env, a newer CLI exists, and nothing is running. */
  canUpdate: boolean
}

export interface ClaudeCliUpdateResult {
  ok: boolean
  message: string
  /** Version after the update (re-probed), when known. */
  version?: string
  /** Last lines of updater output. */
  output: string[]
}
