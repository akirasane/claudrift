import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AdapterSession } from './sdk-adapter'
import { MAX_SESSIONS, SCHEDULED_SESSION_LIMIT, SessionManager } from './session-manager'

const adapter = (): AdapterSession =>
  ({
    send: vi.fn(),
    interrupt: vi.fn(async () => {}),
    done: new Promise<void>(() => {}),
    close: vi.fn()
  }) as unknown as AdapterSession

describe('SessionManager scheduled-run slots', () => {
  it('scheduled runs never take the last free slot; user chats still can', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudrift-'))
    try {
      const m = new SessionManager(() => {}, { startSession: vi.fn(async () => adapter()) as never })
      for (let i = 0; i < SCHEDULED_SESSION_LIMIT; i++) await m.start({ cwd: dir, prompt: 'x' }, { internal: true })
      await expect(m.start({ cwd: dir, prompt: 'x' }, { internal: true })).rejects.toThrow(/^Session cap reached/)
      expect(m.size).toBe(MAX_SESSIONS - 1)
      await m.start({ cwd: dir, prompt: 'x' }) // user chat takes the reserved slot
      expect(m.size).toBe(MAX_SESSIONS)
      await expect(m.start({ cwd: dir, prompt: 'x' })).rejects.toThrow(/^Session cap reached/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('user chats alone can use all slots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudrift-'))
    try {
      const m = new SessionManager(() => {}, { startSession: vi.fn(async () => adapter()) as never })
      for (let i = 0; i < MAX_SESSIONS; i++) await m.start({ cwd: dir, prompt: 'x' })
      expect(m.size).toBe(MAX_SESSIONS)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes maxTurns / maxBudgetUsd only for internal runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudrift-'))
    try {
      const startSession = vi.fn(async (_o: unknown) => adapter())
      const m = new SessionManager(() => {}, { startSession: startSession as never })
      await m.start({ cwd: dir, prompt: 'x' }, { internal: true, maxTurns: 5, maxBudgetUsd: 1.5 })
      expect(startSession).toHaveBeenLastCalledWith(expect.objectContaining({ maxTurns: 5, maxBudgetUsd: 1.5 }))
      await m.start({ cwd: dir, prompt: 'x' }, { maxTurns: 5, maxBudgetUsd: 1.5 })
      const last = (startSession.mock.calls as unknown[][])[1]![0]
      expect(last).not.toHaveProperty('maxTurns')
      expect(last).not.toHaveProperty('maxBudgetUsd')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
