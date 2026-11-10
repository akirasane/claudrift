import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { MAX_SCHEDULE_RUNS, ScheduleInputSchema, nextRunAfter } from '../../shared/schedule'
import type { ScheduleInput, ScheduleMode, ScheduleRun, ScheduledTask } from '../../shared/schedule'
import type { SessionEvent } from '../../shared/events'
import { writeFileAtomic } from './atomic-write'

const TICK_MS = 15_000
/** A task that was due while the app was closed or asleep is skipped when it is more than this late. */
export const MISSED_GRACE_MS = 2 * 60_000
const SCRIPT_TIMEOUT_MS = 10 * 60_000
const SESSION_TIMEOUT_MS = 30 * 60_000
const OUTPUT_CAP = 20_000
/** A run that finds every session slot taken waits and retries this often, for at most QUEUE_MAX_MS. */
export const QUEUE_RETRY_MS = 30_000
export const QUEUE_MAX_MS = 10 * 60_000
export const WAITING_SUMMARY = 'Waiting for a free session'
const isCapError = (err: unknown): boolean => err instanceof Error && err.message.startsWith('Session cap reached')

export interface ScriptResult {
  code: number | null
  output: string
}

export function runShellScript(command: string, cwd: string, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<ScriptResult> {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(command, { cwd, shell: true, windowsHide: true })
    const add = (b: Buffer): void => {
      output = (output + b.toString('utf8')).slice(-OUTPUT_CAP)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const timer = setTimeout(() => {
      output += '\n[timed out]'
      // shell:true on Windows: child.kill() would only end cmd.exe, not the script it started.
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
      else child.kill()
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, output: `${output}\n${err.message}`.trim() })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output: output.trim() })
    })
  })
}

export interface ScheduleServiceDeps {
  file: string
  start(args: { cwd: string; prompt: string; permissionMode: ScheduleMode; maxTurns?: number; maxCostUsd?: number }): Promise<{ localId: string }>
  /** Test seam for the wait between session-cap retries. */
  sleep?: (ms: number) => Promise<void>
  close(localId: string): void
  denyPermission(localId: string, reqId: string): void
  broadcast(tasks: ScheduledTask[]): void
  notify?(title: string, body: string): void
  runScript?: (command: string, cwd: string) => Promise<ScriptResult>
  now?: () => number
  log?: (m: string) => void
  /** Test seam: skip the interval timer and call tick() yourself. */
  autoTick?: boolean
}

interface ActiveRun {
  taskId: string
  runId: string
  timer: ReturnType<typeof setTimeout>
  sessionId?: string
  maxCostUsd?: number
  done: boolean
}

const clip = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Time-triggered prompts and scripts, kept in `<userData>/schedule.json`. Runs only while the app is open.
 * A prompt task starts a headless session in the task's folder; its transcript lands in the normal session history.
 * Nobody is there to click Allow, so permission requests are denied unless the task's mode already allows the tool.
 */
export class ScheduleService {
  private tasks: ScheduledTask[] = []
  private active = new Map<string, ActiveRun>()
  private byTask = new Set<string>()
  private timer: ReturnType<typeof setInterval> | undefined
  private writeChain: Promise<unknown> = Promise.resolve()
  private now: () => number
  private disposed = false

  constructor(private deps: ScheduleServiceDeps) {
    this.now = deps.now ?? Date.now
    this.load()
  }

  private log(m: string): void {
    this.deps.log?.(m)
  }

  private load(): void {
    try {
      if (!existsSync(this.deps.file)) return
      const raw = JSON.parse(readFileSync(this.deps.file, 'utf8')) as { tasks?: ScheduledTask[] }
      this.tasks = Array.isArray(raw.tasks) ? raw.tasks.filter((t) => t && typeof t.id === 'string') : []
    } catch (err) {
      this.log(`schedule.json unusable: ${err instanceof Error ? err.message : String(err)}`)
      this.tasks = []
    }
    // Anything that was running when the app closed did not finish.
    const now = this.now()
    for (const t of this.tasks) {
      for (const r of t.runs) {
        if (r.status === 'running') Object.assign(r, { status: 'error', endedAt: now, summary: 'The app closed before this run finished.' })
      }
      this.settle(t, now)
    }
  }

  /** Recompute nextRunAt; record a missed run when the app was not open at the due time. */
  private settle(t: ScheduledTask, now: number): void {
    if (!t.enabled) {
      delete t.nextRunAt
      return
    }
    // A catch-up task keeps its overdue time; tick() runs it once.
    if (t.catchUp && t.nextRunAt !== undefined && t.nextRunAt <= now && t.when.type !== 'interval') return
    if (t.nextRunAt !== undefined && t.nextRunAt < now - MISSED_GRACE_MS && t.when.type !== 'interval') {
      this.addRun(t, { id: randomUUID(), startedAt: t.nextRunAt, endedAt: now, status: 'missed', summary: 'The app was not open at the scheduled time.' })
      // A one-time task that was missed has nothing left to wait for.
      if (t.when.type === 'once') t.enabled = false
    }
    if (t.nextRunAt === undefined || t.nextRunAt < now - MISSED_GRACE_MS) {
      const next = nextRunAfter(t.when, now, { lastRunAt: t.when.type === 'interval' ? now : t.lastRunAt, createdAt: t.createdAt })
      if (next === undefined) delete t.nextRunAt
      else t.nextRunAt = next
    }
  }

  private addRun(t: ScheduledTask, run: ScheduleRun): void {
    t.runs = [run, ...t.runs].slice(0, MAX_SCHEDULE_RUNS)
  }

  private persist(): void {
    const data = JSON.stringify({ version: 1, tasks: this.tasks }, null, 2) + '\n'
    const w = this.writeChain.then(() => writeFileAtomic(this.deps.file, data))
    this.writeChain = w.catch((err) => this.log(`schedule save failed: ${err instanceof Error ? err.message : String(err)}`))
    this.deps.broadcast(this.list())
  }

  /** Resolves when pending writes are on disk. */
  flush(): Promise<unknown> {
    return this.writeChain
  }

  list(): ScheduledTask[] {
    return structuredClone(this.tasks)
  }

  start(): void {
    if (this.timer || this.deps.autoTick === false) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref?.()
    void this.tick()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const [id, a] of [...this.active]) {
      clearTimeout(a.timer)
      this.deps.close(id)
    }
    this.active.clear()
  }

  upsert(raw: ScheduleInput): ScheduledTask {
    const input = ScheduleInputSchema.parse(raw)
    const now = this.now()
    const existing = input.id ? this.tasks.find((t) => t.id === input.id) : undefined
    const t: ScheduledTask = existing ?? {
      id: randomUUID(),
      name: input.name,
      enabled: input.enabled,
      cwd: input.cwd,
      action: input.action,
      permissionMode: input.permissionMode,
      when: input.when,
      ...(input.catchUp ? { catchUp: true } : {}),
      ...(input.maxTurns ? { maxTurns: input.maxTurns } : {}),
      ...(input.maxCostUsd ? { maxCostUsd: input.maxCostUsd } : {}),
      createdAt: now,
      runs: []
    }
    if (existing) {
      Object.assign(existing, {
        name: input.name,
        enabled: input.enabled,
        cwd: input.cwd,
        action: input.action,
        permissionMode: input.permissionMode,
        when: input.when,
        catchUp: input.catchUp || undefined,
        maxTurns: input.maxTurns,
        maxCostUsd: input.maxCostUsd
      })
    } else {
      this.tasks.push(t)
    }
    const target = existing ?? t
    delete target.nextRunAt
    this.settle(target, now)
    this.persist()
    return structuredClone(target)
  }

  remove(id: string): boolean {
    const i = this.tasks.findIndex((t) => t.id === id)
    if (i < 0) return false
    this.tasks.splice(i, 1)
    this.persist()
    return true
  }

  setEnabled(id: string, enabled: boolean): ScheduledTask | undefined {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return undefined
    t.enabled = enabled
    delete t.nextRunAt
    this.settle(t, this.now())
    this.persist()
    return structuredClone(t)
  }

  /** Fires every enabled task that is due. Public so tests can drive it. */
  async tick(): Promise<void> {
    const now = this.now()
    for (const t of this.tasks) {
      if (t.enabled && t.nextRunAt !== undefined && t.nextRunAt <= now) {
        if (t.nextRunAt < now - MISSED_GRACE_MS && !t.catchUp) {
          this.settle(t, now)
          this.persist()
        } else void this.run(t.id)
      }
    }
  }

  /** Runs a task now (also the "Run now" button). Returns false when it is unknown or already running. */
  async run(id: string): Promise<boolean> {
    const t = this.tasks.find((x) => x.id === id)
    if (!t || this.byTask.has(id)) return false
    this.byTask.add(id)
    const startedAt = this.now()
    const run: ScheduleRun = { id: randomUUID(), startedAt, status: 'running' }
    this.addRun(t, run)
    t.lastRunAt = startedAt
    delete t.nextRunAt
    this.settle(t, startedAt)
    this.persist()
    try {
      let prompt: string | undefined
      if (t.action.kind === 'prompt') {
        prompt = t.action.prompt
      } else {
        const res = await (this.deps.runScript ?? runShellScript)(t.action.command, t.cwd)
        if (!t.action.followUpPrompt) {
          this.finish(t, run, res.code === 0 ? 'ok' : 'error', clip(res.output || `Exit code ${res.code}`))
          return true
        }
        prompt = `${t.action.followUpPrompt}\n\nOutput of \`${t.action.command}\` (exit code ${res.code}):\n\`\`\`\n${res.output}\n\`\`\``
      }
      const { localId } = await this.startWhenFree(t, run, {
        cwd: t.cwd,
        prompt,
        permissionMode: t.permissionMode,
        ...(t.maxTurns ? { maxTurns: t.maxTurns } : {}),
        ...(t.maxCostUsd ? { maxCostUsd: t.maxCostUsd } : {})
      })
      const timer = setTimeout(() => this.endSession(localId, 'error', 'Timed out after 30 minutes.'), SESSION_TIMEOUT_MS)
      this.active.set(localId, { taskId: t.id, runId: run.id, timer, done: false, ...(t.maxCostUsd ? { maxCostUsd: t.maxCostUsd } : {}) })
    } catch (err) {
      this.finish(t, run, 'error', clip(err instanceof Error ? err.message : String(err)))
    }
    return true
  }

  /**
   * Starts the session; when every slot a scheduled run may use is taken, the run waits (status stays 'running',
   * summary WAITING_SUMMARY) and retries every QUEUE_RETRY_MS for up to QUEUE_MAX_MS. Other start errors fail at once.
   */
  private async startWhenFree(t: ScheduledTask, run: ScheduleRun, args: Parameters<ScheduleServiceDeps['start']>[0]): Promise<{ localId: string }> {
    const began = this.now()
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()))
    for (;;) {
      try {
        const res = await this.deps.start(args)
        if (run.summary === WAITING_SUMMARY) {
          delete run.summary
          this.persist()
        }
        return res
      } catch (err) {
        if (!isCapError(err)) throw err
        if (this.now() - began >= QUEUE_MAX_MS) throw new Error('No free session after waiting 10 minutes.')
        if (run.summary !== WAITING_SUMMARY) {
          run.summary = WAITING_SUMMARY
          this.persist()
        }
        await sleep(QUEUE_RETRY_MS)
        if (this.disposed || !this.tasks.includes(t)) throw new Error('Cancelled while waiting for a free session.')
      }
    }
  }

  /** Feed every session event here; events of scheduled sessions end or steer their run. */
  onSessionEvent(localId: string, e: SessionEvent): void {
    const a = this.active.get(localId)
    if (!a || a.done) return
    switch (e.t) {
      case 'init': {
        a.sessionId = e.sessionId
        // Recorded at once (not only at the end) so the Remote Control mirror can tell this transcript is a scheduled run.
        const run = this.tasks.find((x) => x.id === a.taskId)?.runs.find((r) => r.id === a.runId)
        if (run) {
          run.sessionId = e.sessionId
          this.persist()
        }
        break
      }
      case 'permission_request':
        this.deps.denyPermission(localId, e.reqId)
        break
      case 'result':
        if (a.maxCostUsd !== undefined && e.costUsd > a.maxCostUsd) {
          this.endSession(localId, 'error', `Cost limit exceeded: $${e.costUsd.toFixed(2)} of $${a.maxCostUsd.toFixed(2)}.`, e.costUsd)
          break
        }
        this.endSession(localId, e.isError ? 'error' : 'ok', clip(e.resultText ?? (e.isError ? 'The run ended with an error.' : 'Done.')), e.costUsd)
        break
      case 'error':
        this.endSession(localId, 'error', clip(e.message))
        break
      case 'session_closed':
        this.endSession(localId, 'error', 'The session ended before it finished.')
        break
      default:
        break
    }
  }

  private endSession(localId: string, status: 'ok' | 'error', summary: string, costUsd?: number): void {
    const a = this.active.get(localId)
    if (!a || a.done) return
    a.done = true
    clearTimeout(a.timer)
    this.active.delete(localId)
    this.deps.close(localId)
    const t = this.tasks.find((x) => x.id === a.taskId)
    const run = t?.runs.find((r) => r.id === a.runId)
    if (t && run) this.finish(t, run, status, summary, a.sessionId, costUsd)
    else this.byTask.delete(a.taskId)
  }

  private finish(t: ScheduledTask, run: ScheduleRun, status: 'ok' | 'error', summary: string, sessionId?: string, costUsd?: number): void {
    Object.assign(run, { status, summary, endedAt: this.now() })
    if (sessionId) run.sessionId = sessionId
    if (costUsd !== undefined) run.costUsd = costUsd
    this.byTask.delete(t.id)
    // A one-time task has nothing left to do.
    if (t.when.type === 'once') t.enabled = false
    this.persist()
    // Titles and bodies hold no prompt or result text: Windows keeps toasts in the Action Center.
    this.deps.notify?.(status === 'ok' ? 'Scheduled task finished' : 'Scheduled task failed', t.name)
  }
}
