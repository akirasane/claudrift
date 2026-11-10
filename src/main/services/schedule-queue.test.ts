import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { QUEUE_MAX_MS, QUEUE_RETRY_MS, ScheduleService, WAITING_SUMMARY } from './schedule-service'

const task = { name: 'n', cwd: 'C:\\p', action: { kind: 'prompt' as const, prompt: 'hi' }, when: { type: 'daily' as const, time: '09:00', days: [] } }
const cap = (): Error => new Error('Session cap reached (4)')

function setup(start: ReturnType<typeof vi.fn>) {
  const file = join(mkdtempSync(join(tmpdir(), 'sched-q-')), 'schedule.json')
  let now = new Date(2026, 0, 5, 8, 0, 0).getTime()
  const close = vi.fn()
  const sleep = vi.fn(async (ms: number) => void (now += ms))
  const svc = new ScheduleService({
    file,
    start: start as never,
    close,
    denyPermission: vi.fn(),
    broadcast: () => {},
    sleep,
    now: () => now,
    autoTick: false
  })
  return { svc, sleep, close }
}

describe('scheduled run waiting for a session slot', () => {
  it('retries every 30 s while the cap is hit, then starts', async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(cap())
      .mockRejectedValueOnce(cap())
      .mockResolvedValue({ localId: 'L1' })
    const { svc, sleep } = setup(start)
    const t = svc.upsert(task)
    const summaries: (string | undefined)[] = []
    const origSleep = sleep.getMockImplementation()!
    sleep.mockImplementation(async (ms: number) => {
      summaries.push(svc.list()[0]!.runs[0]!.summary)
      await origSleep(ms)
    })
    await svc.run(t.id)
    expect(start).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledWith(QUEUE_RETRY_MS)
    expect(summaries).toEqual([WAITING_SUMMARY, WAITING_SUMMARY])
    const run = svc.list()[0]!.runs[0]!
    expect(run.status).toBe('running')
    expect(run.summary).toBeUndefined() // waiting note cleared once it started
    svc.onSessionEvent('L1', { t: 'result', isError: false, resultText: 'done', costUsd: 0 } as never)
    expect(svc.list()[0]!.runs[0]).toMatchObject({ status: 'ok', summary: 'done' })
  })

  it('gives up after 10 minutes with an error', async () => {
    const start = vi.fn().mockRejectedValue(cap())
    const { svc, sleep } = setup(start)
    const t = svc.upsert(task)
    await svc.run(t.id)
    expect(sleep).toHaveBeenCalledTimes(QUEUE_MAX_MS / QUEUE_RETRY_MS)
    const run = svc.list()[0]!.runs[0]!
    expect(run.status).toBe('error')
    expect(run.summary).toMatch(/No free session after waiting 10 minutes/)
  })

  it('does not wait on other start errors', async () => {
    const start = vi.fn().mockRejectedValue(new Error('Working directory not found: x'))
    const { svc, sleep } = setup(start)
    const t = svc.upsert(task)
    await svc.run(t.id)
    expect(sleep).not.toHaveBeenCalled()
    expect(svc.list()[0]!.runs[0]).toMatchObject({ status: 'error', summary: 'Working directory not found: x' })
  })

  it('stops waiting when the task is deleted', async () => {
    const start = vi.fn().mockRejectedValue(cap())
    const { svc, sleep } = setup(start)
    const t = svc.upsert(task)
    sleep.mockImplementationOnce(async () => void svc.remove(t.id))
    await svc.run(t.id)
    expect(start).toHaveBeenCalledTimes(1)
  })
})

describe('per-task limits', () => {
  it('passes maxTurns and maxCostUsd to the session start', async () => {
    const start = vi.fn().mockResolvedValue({ localId: 'L1' })
    const { svc } = setup(start)
    const t = svc.upsert({ ...task, maxTurns: 7, maxCostUsd: 0.5 })
    expect(t).toMatchObject({ maxTurns: 7, maxCostUsd: 0.5 })
    await svc.run(t.id)
    expect(start).toHaveBeenCalledWith({ cwd: 'C:\\p', prompt: 'hi', permissionMode: 'default', maxTurns: 7, maxCostUsd: 0.5 })
  })

  it('clears the limits when an edit leaves them out, and rejects out-of-range values', () => {
    const { svc } = setup(vi.fn())
    const t = svc.upsert({ ...task, maxTurns: 7 })
    expect(svc.upsert({ ...task, id: t.id }).maxTurns).toBeUndefined()
    expect(() => svc.upsert({ ...task, maxTurns: 0 })).toThrow()
    expect(() => svc.upsert({ ...task, maxTurns: 201 })).toThrow()
    expect(() => svc.upsert({ ...task, maxCostUsd: -1 })).toThrow()
  })

  it('ends the run with an error when the result costs more than maxCostUsd', async () => {
    const start = vi.fn().mockResolvedValue({ localId: 'L1' })
    const { svc, close } = setup(start)
    const t = svc.upsert({ ...task, maxCostUsd: 0.5 })
    await svc.run(t.id)
    svc.onSessionEvent('L1', { t: 'result', isError: false, resultText: 'done', costUsd: 0.75 } as never)
    expect(svc.list()[0]!.runs[0]).toMatchObject({ status: 'error', summary: 'Cost limit exceeded: $0.75 of $0.50.', costUsd: 0.75 })
    expect(close).toHaveBeenCalledWith('L1')
  })

  it('a result within the limit is ok', async () => {
    const start = vi.fn().mockResolvedValue({ localId: 'L1' })
    const { svc } = setup(start)
    const t = svc.upsert({ ...task, maxCostUsd: 0.5 })
    await svc.run(t.id)
    svc.onSessionEvent('L1', { t: 'result', isError: false, resultText: 'done', costUsd: 0.25 } as never)
    expect(svc.list()[0]!.runs[0]).toMatchObject({ status: 'ok' })
  })

  it('records the session id on the run as soon as the session inits', async () => {
    const start = vi.fn().mockResolvedValue({ localId: 'L1' })
    const { svc } = setup(start)
    const t = svc.upsert(task)
    await svc.run(t.id)
    svc.onSessionEvent('L1', { t: 'init', sessionId: 'sdk-9' } as never)
    expect(svc.list()[0]!.runs[0]).toMatchObject({ status: 'running', sessionId: 'sdk-9' })
  })
})
