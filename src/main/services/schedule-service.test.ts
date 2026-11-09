import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { nextRunAfter } from '../../shared/schedule'
import type { ScheduledTask } from '../../shared/schedule'
import { MISSED_GRACE_MS, ScheduleService } from './schedule-service'

function setup(over: Partial<ConstructorParameters<typeof ScheduleService>[0]> = {}, t0 = new Date(2026, 0, 5, 8, 0, 0).getTime()) {
  const dir = mkdtempSync(join(tmpdir(), 'sched-'))
  const file = join(dir, 'schedule.json')
  let now = t0
  const start = vi.fn(async () => ({ localId: 'L1' }))
  const close = vi.fn()
  const deny = vi.fn()
  const notify = vi.fn()
  const mk = () =>
    new ScheduleService({ file, start, close, denyPermission: deny, broadcast: () => {}, notify, now: () => now, autoTick: false, ...over })
  return { file, start, close, deny, notify, mk, advance: (ms: number) => (now += ms), clock: () => now }
}

const daily = { name: 'n', cwd: 'C:\p', action: { kind: 'prompt' as const, prompt: 'hi' }, when: { type: 'daily' as const, time: '09:00', days: [] } }

describe('nextRunAfter', () => {
  it('daily picks the next matching day and time', () => {
    const from = new Date(2026, 0, 5, 10, 0).getTime() // Monday 10:00
    const n = nextRunAfter({ type: 'daily', time: '09:00', days: [3] }, from, { createdAt: 0 })
    expect(new Date(n!).getDay()).toBe(3)
    expect(new Date(n!).getHours()).toBe(9)
  })
  it('once in the past never fires', () => {
    expect(nextRunAfter({ type: 'once', at: 5 }, 10, { createdAt: 0 })).toBeUndefined()
  })
})

describe('ScheduleService', () => {
  it('fires a due prompt task and finishes it on result', async () => {
    const s = setup()
    const svc = s.mk()
    const t = svc.upsert(daily)
    expect(t.nextRunAt).toBe(new Date(2026, 0, 5, 9, 0).getTime())
    s.advance(61 * 60_000)
    await svc.tick()
    await Promise.resolve()
    expect(s.start).toHaveBeenCalledWith({ cwd: 'C:\p', prompt: 'hi', permissionMode: 'default' })
    svc.onSessionEvent('L1', { t: 'init', sessionId: 'sdk-1' } as never)
    svc.onSessionEvent('L1', { t: 'permission_request', reqId: 'r1', toolName: 'Bash', input: {} })
    expect(s.deny).toHaveBeenCalledWith('L1', 'r1')
    svc.onSessionEvent('L1', { t: 'result', isError: false, resultText: 'done', costUsd: 0.1 } as never)
    const run = svc.list()[0]!.runs[0]!
    expect(run).toMatchObject({ status: 'ok', summary: 'done', sessionId: 'sdk-1', costUsd: 0.1 })
    expect(s.close).toHaveBeenCalledWith('L1')
    expect(s.notify).toHaveBeenCalledWith('Scheduled task finished', 'n')
  })

  it('does not start a task that is already running', async () => {
    const s = setup()
    const svc = s.mk()
    const t = svc.upsert(daily)
    expect(await svc.run(t.id)).toBe(true)
    expect(await svc.run(t.id)).toBe(false)
  })

  it('a script task without a follow-up records the exit status', async () => {
    const runScript = vi.fn(async () => ({ code: 1, output: 'boom' }))
    const s = setup({ runScript })
    const svc = s.mk()
    const t = svc.upsert({ ...daily, action: { kind: 'script', command: 'x' } })
    await svc.run(t.id)
    expect(s.start).not.toHaveBeenCalled()
    expect(svc.list()[0]!.runs[0]).toMatchObject({ status: 'error', summary: 'boom' })
  })

  it('a script follow-up sends the output to Claude', async () => {
    const runScript = vi.fn(async () => ({ code: 0, output: 'OUT' }))
    const s = setup({ runScript })
    const svc = s.mk()
    const t = svc.upsert({ ...daily, action: { kind: 'script', command: 'x', followUpPrompt: 'fix it' } })
    await svc.run(t.id)
    expect((s.start.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt).toContain('OUT')
  })

  it('a one-time task disables itself after it runs', async () => {
    const s = setup()
    const svc = s.mk()
    const t = svc.upsert({ ...daily, when: { type: 'once', at: s.clock() + 1000 } })
    await svc.run(t.id)
    svc.onSessionEvent('L1', { t: 'result', isError: false } as never)
    expect(svc.list()[0]).toMatchObject({ enabled: false })
  })

  it('records a missed run for a daily task that was due while the app was closed', async () => {
    const s = setup()
    const first = s.mk()
    first.upsert(daily)
    await first.flush()
    s.advance(MISSED_GRACE_MS + 3 * 3_600_000)
    const again = s.mk()
    const t: ScheduledTask = again.list()[0]!
    expect(t.runs[0]).toMatchObject({ status: 'missed' })
    expect(t.nextRunAt).toBeGreaterThan(s.clock())
  })

  it('persists to disk', async () => {
    const s = setup()
    const svc = s.mk()
    svc.upsert(daily)
    await svc.flush()
    expect(JSON.parse(readFileSync(s.file, 'utf8')).tasks).toHaveLength(1)
  })

  it('runs a catch-up task once after being closed, instead of recording a miss', async () => {
    const s = setup()
    const first = s.mk()
    first.upsert({ ...daily, catchUp: true })
    await first.flush()
    s.advance(MISSED_GRACE_MS + 3 * 3_600_000)
    const again = s.mk()
    await again.tick()
    await Promise.resolve()
    expect(s.start).toHaveBeenCalledTimes(1)
    expect(again.list()[0]!.runs.some((r) => r.status === 'missed')).toBe(false)
  })

  it('switches a missed one-time task off', async () => {
    const s = setup()
    const first = s.mk()
    first.upsert({ ...daily, when: { type: 'once', at: s.clock() + 60_000 } })
    await first.flush()
    s.advance(MISSED_GRACE_MS + 3_600_000)
    const t = s.mk().list()[0]!
    expect(t.runs[0]).toMatchObject({ status: 'missed' })
    expect(t.enabled).toBe(false)
  })
})
