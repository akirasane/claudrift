import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { resolveClaudeExecutable } from '../paths'
import type { RemoteStartArgs, RemoteState } from '../../shared/remote'

// Probe (docs/P5-FINDINGS.md): in an untrusted folder the CLI prints one line, "Error: Workspace not trusted. ..." and exits.
const ANSI = /\u001b(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\^_])/g
const URL_RE = /https:\/\/[^\s"'<>)]+/
const LOG_MAX = 50
/** No URL printed but the process is still alive after this long: treat it as running (output format unverified). */
const READY_AFTER_MS = 6000

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string }) => ChildProcess

export interface RemoteControlDeps {
  spawn?: SpawnFn
  exe?: () => string | undefined
  broadcast?: (s: RemoteState) => void
  /** Kills the whole tree; default is taskkill /T /F on Windows, SIGTERM elsewhere. */
  kill?: (child: ChildProcess) => void
  platform?: NodeJS.Platform
  readyAfterMs?: number
}

export class RemoteControlService {
  private child: ChildProcess | null = null
  private readyTimer: ReturnType<typeof setTimeout> | undefined
  private state: RemoteState = { status: 'off', log: [] }
  private readonly spawnFn: SpawnFn
  private readonly platform: NodeJS.Platform

  constructor(private readonly deps: RemoteControlDeps = {}) {
    this.platform = deps.platform ?? process.platform
    this.spawnFn =
      deps.spawn ??
      ((cmd, args, opts) => nodeSpawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }))
  }

  getState(): RemoteState {
    return { ...this.state, log: [...this.state.log] }
  }

  start(a: RemoteStartArgs): RemoteState {
    if (this.child) return this.getState()
    const exe = (this.deps.exe ?? resolveClaudeExecutable)()
    if (!exe) {
      this.set({ status: 'error', message: 'Claude CLI not found', log: [] })
      return this.getState()
    }
    const args = ['remote-control']
    if (a.name) args.push('--name', a.name)
    if (a.permissionMode) args.push('--permission-mode', a.permissionMode)
    this.state = { status: 'starting', name: a.name, cwd: a.cwd, startedAt: Date.now(), log: [], needsTrust: false }
    let child: ChildProcess
    try {
      child = this.spawnFn(exe, args, { cwd: a.cwd })
    } catch (err) {
      this.set({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      return this.getState()
    }
    this.child = child
    this.readyTimer = setTimeout(() => {
      if (this.child === child && this.state.status === 'starting') this.set({ status: 'on' })
    }, this.deps.readyAfterMs ?? READY_AFTER_MS)
    this.readyTimer.unref?.()
    const feed = (buf: Buffer | string): void => {
      if (this.child !== child) return
      this.ingest(String(buf))
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.on('error', (err) => {
      if (this.child !== child) return
      this.child = null
      this.set({ status: 'error', message: err.message })
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      clearTimeout(this.readyTimer)
      if (this.state.status === 'off') return
      const last = [...this.state.log].reverse().find((l) => /error/i.test(l)) ?? this.state.log[this.state.log.length - 1]
      const message = last ?? `remote-control exited (code ${code ?? '?'})`
      this.set({ status: 'error', url: undefined, message, needsTrust: /Workspace not trusted/i.test(`${this.state.log.join(' ')} ${message}`) })
    })
    this.broadcast()
    return this.getState()
  }

  stop(): RemoteState {
    clearTimeout(this.readyTimer)
    const child = this.child
    this.child = null
    if (child) this.killTree(child)
    this.state = { status: 'off', log: this.state.log }
    this.broadcast()
    return this.getState()
  }

  dispose(): void {
    clearTimeout(this.readyTimer)
    const child = this.child
    this.child = null
    if (child) this.killTree(child)
  }

  private ingest(chunk: string): void {
    const lines = stripAnsi(chunk)
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim())
    if (lines.length === 0) return
    const log = [...this.state.log, ...lines].slice(-LOG_MAX)
    let { status, url } = this.state
    if (!url) {
      const m = URL_RE.exec(lines.join('\n'))
      if (m) {
        url = m[0].replace(/[.,;]+$/, '')
        status = 'on'
      }
    }
    this.set({ status, url, log })
  }

  private killTree(child: ChildProcess): void {
    if (this.deps.kill) return this.deps.kill(child)
    try {
      if (this.platform === 'win32' && child.pid) {
        nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
      } else child.kill()
    } catch {
      /* already gone */
    }
  }

  private set(patch: Partial<RemoteState>): void {
    this.state = { ...this.state, ...patch }
    this.broadcast()
  }

  private broadcast(): void {
    this.deps.broadcast?.(this.getState())
  }
}
