import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { ClaudeCliStatus, ClaudeCliUpdateResult } from '../../shared/claude-cli'
import type { ClaudeBinaryInfo } from '../paths'
import { compareVersions, parseVersion } from '../paths'

export const CLI_LATEST_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
export const SDK_LATEST_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest'

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean
  json(): Promise<unknown>
}>
type SpawnLike = (cmd: string, args: readonly string[], opts: SpawnOptions) => ChildProcess

export interface ClaudeCliServiceDeps {
  resolve(): ClaudeBinaryInfo
  sdkVersions(): { cli?: string; sdk?: string }
  resetCache(): void
  busyCount(): number
  fetch?: FetchLike
  spawn?: SpawnLike
  fetchTimeoutMs?: number
  updateTimeoutMs?: number
  /** How long a registry answer is reused unless refresh is requested. */
  cacheMs?: number
  now?: () => number
}

const OUTPUT_LINES = 8

/** True when `latest` is a valid version strictly newer than `current`. Unknown on either side => false. */
export function isNewer(latest: string | undefined, current: string | undefined): boolean {
  if (!latest || !current || !parseVersion(latest) || !parseVersion(current)) return false
  return compareVersions(latest, current) > 0
}

export class ClaudeCliService {
  private readonly fetchImpl: FetchLike
  private readonly spawnImpl: SpawnLike
  private latest: { at: number; cli?: string; sdk?: string } | undefined
  private updating = false

  constructor(private readonly deps: ClaudeCliServiceDeps) {
    this.fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init))
    this.spawnImpl = deps.spawn ?? ((cmd, args, opts) => nodeSpawn(cmd, [...args], opts))
  }

  /** Fetch a package's `version` from the registry. Sends no identifying data; any failure => undefined. */
  private async fetchVersion(url: string): Promise<string | undefined> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.deps.fetchTimeoutMs ?? 5000)
    try {
      const res = await this.fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } })
      if (!res.ok) return undefined
      const body = (await res.json()) as { version?: unknown } | null
      const v = typeof body?.version === 'string' ? body.version : undefined
      return v && parseVersion(v) ? v : undefined
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  private async getLatest(refresh: boolean): Promise<{ cli?: string; sdk?: string }> {
    const now = (this.deps.now ?? Date.now)()
    if (!refresh && this.latest && now - this.latest.at < (this.deps.cacheMs ?? 10 * 60_000)) return this.latest
    const [cli, sdk] = await Promise.all([this.fetchVersion(CLI_LATEST_URL), this.fetchVersion(SDK_LATEST_URL)])
    // Keep an earlier good answer when the network is down now.
    const keepCli = cli ?? this.latest?.cli
    const keepSdk = sdk ?? this.latest?.sdk
    const next = { at: now, ...(keepCli ? { cli: keepCli } : {}), ...(keepSdk ? { sdk: keepSdk } : {}) }
    this.latest = next
    return next
  }

  async status(refresh = false): Promise<ClaudeCliStatus> {
    const bin = this.deps.resolve()
    const pinned = this.deps.sdkVersions()
    const latest = await this.getLatest(refresh)
    const activeSessions = this.deps.busyCount()
    const cliUpdateAvailable = isNewer(latest.cli, bin.version ?? pinned.cli)
    return {
      active: {
        ...(bin.path ? { path: bin.path } : {}),
        ...(bin.version ? { version: bin.version } : {}),
        source: bin.source,
        ...(bin.note ? { note: bin.note } : {})
      },
      ...(pinned.cli ? { bundledCliVersion: pinned.cli } : {}),
      ...(pinned.sdk ? { sdkPinned: pinned.sdk } : {}),
      ...(latest.cli ? { latestCli: latest.cli } : {}),
      ...(latest.sdk ? { latestSdk: latest.sdk } : {}),
      cliUpdateAvailable,
      sdkUpdateAvailable: isNewer(latest.sdk, pinned.sdk),
      activeSessions,
      canUpdate: bin.source !== 'bundled' && !!bin.path && cliUpdateAvailable && activeSessions === 0 && !this.updating
    }
  }

  /** Run `<claude> update` (spawn, args array, no shell). Never rejects. */
  async update(): Promise<ClaudeCliUpdateResult> {
    const bin = this.deps.resolve()
    if (bin.source === 'bundled' || !bin.path)
      return { ok: false, message: 'The bundled CLI cannot be updated in place; it updates with a new Claudrift release.', output: [] }
    if (this.deps.busyCount() > 0)
      return { ok: false, message: 'Stop running sessions before updating Claude Code.', output: [] }
    if (this.updating) return { ok: false, message: 'An update is already running.', output: [] }
    this.updating = true
    try {
      const run = await this.runUpdater(bin.path)
      this.deps.resetCache()
      const after = this.deps.resolve()
      const version = after.version
      if (!run.ok) return { ok: false, message: run.message, ...(version ? { version } : {}), output: run.output }
      return {
        ok: true,
        message: version ? `Claude Code is now ${version}. Running chats must restart to use it.` : 'Update finished. Running chats must restart to use it.',
        ...(version ? { version } : {}),
        output: run.output
      }
    } finally {
      this.updating = false
    }
  }

  private runUpdater(path: string): Promise<{ ok: boolean; message: string; output: string[] }> {
    return new Promise((resolve) => {
      const lines: string[] = []
      let partial = ''
      let settled = false
      let timedOut = false
      const push = (chunk: Buffer | string): void => {
        const parts = (partial + String(chunk)).split(/\r?\n/)
        partial = parts.pop() ?? ''
        for (const l of parts) if (l.trim()) lines.push(l.trim())
        if (lines.length > OUTPUT_LINES) lines.splice(0, lines.length - OUTPUT_LINES)
      }
      const finish = (ok: boolean, message: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (partial.trim()) lines.push(partial.trim())
        resolve({ ok, message, output: lines.slice(-OUTPUT_LINES) })
      }
      let child: ChildProcess
      try {
        child = this.spawnImpl(path, ['update'], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) {
        resolve({ ok: false, message: `Could not start the updater: ${e instanceof Error ? e.message : String(e)}`, output: [] })
        return
      }
      const timer = setTimeout(() => {
        timedOut = true
        try {
          child.kill()
        } catch {
          /* already gone */
        }
        finish(false, 'Update timed out.')
      }, this.deps.updateTimeoutMs ?? 120_000)
      child.stdout?.on('data', push)
      child.stderr?.on('data', push)
      child.on('error', (e) => finish(false, `Could not run the updater: ${e.message}`))
      child.on('close', (code) => {
        if (timedOut) return
        finish(code === 0, code === 0 ? 'ok' : `Updater exited with code ${code ?? 'unknown'}.`)
      })
    })
  }
}
