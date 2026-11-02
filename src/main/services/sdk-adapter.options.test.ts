import { describe, expect, it, vi } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { startSdkSession, TASK_TOOLS, type QueryImpl } from './sdk-adapter'

describe('SDK options', () => {
  it('allow-lists the task-list tools so headless sessions expose them', async () => {
    const impl = vi.fn((() => {
      const q = {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true as const }) }),
        interrupt: async () => {},
        close: () => {}
      }
      return q as unknown as Query
    }) as QueryImpl)
    const s = await startSdkSession({ cwd: 'C:/x', prompt: 'hi', queryImpl: impl, onEvent: () => {} })
    const opts = (impl.mock.calls[0]![0] as { options: { allowedTools?: string[] } }).options
    expect(opts.allowedTools).toEqual([...TASK_TOOLS])
    expect(TASK_TOOLS).toEqual(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
    s.close()
  })
})

describe('additionalDirectories option', () => {
  const make = (): { impl: QueryImpl; opts: () => Record<string, unknown> } => {
    let captured: Record<string, unknown> = {}
    const impl = ((arg: { options: Record<string, unknown> }) => {
      captured = arg.options
      return {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true as const }) }),
        interrupt: async () => {},
        close: () => {}
      } as unknown as Query
    }) as unknown as QueryImpl
    return { impl, opts: () => captured }
  }
  it('passes extra folders through and omits the option when empty', async () => {
    const a = make()
    await startSdkSession({ cwd: 'C:/x', prompt: 'hi', additionalDirectories: ['D:/lib'], queryImpl: a.impl, onEvent: () => {} })
    expect(a.opts()['additionalDirectories']).toEqual(['D:/lib'])
    const b = make()
    await startSdkSession({ cwd: 'C:/x', prompt: 'hi', additionalDirectories: [], queryImpl: b.impl, onEvent: () => {} })
    expect(b.opts()).not.toHaveProperty('additionalDirectories')
  })
})

describe('token saver options', () => {
  const make = (): { impl: QueryImpl; opts: () => Record<string, unknown> } => {
    let captured: Record<string, unknown> = {}
    const impl = ((arg: { options: Record<string, unknown> }) => {
      captured = arg.options
      return {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true as const }) }),
        interrupt: async () => {},
        close: () => {}
      } as unknown as Query
    }) as unknown as QueryImpl
    return { impl, opts: () => captured }
  }

  it('without a saver: summarized thinking, no effort, no settings, inherited environment', async () => {
    const a = make()
    await startSdkSession({ cwd: 'C:/x', prompt: 'hi', thinking: true, queryImpl: a.impl, onEvent: () => {} })
    expect(a.opts()['thinking']).toEqual({ type: 'adaptive', display: 'summarized' })
    for (const k of ['effort', 'settings', 'env']) expect(a.opts()).not.toHaveProperty(k)
  })

  it('with a saver: thinking disabled, low effort, compact window, and env layered over process.env', async () => {
    const a = make()
    await startSdkSession({
      cwd: 'C:/x',
      prompt: 'hi',
      thinking: true,
      saver: { env: { CAVEMAN_DEFAULT_MODE: 'ultra' }, effort: 'low', disableThinking: true, autoCompactWindow: 100_000 },
      queryImpl: a.impl,
      onEvent: () => {}
    })
    expect(a.opts()['thinking']).toEqual({ type: 'disabled' })
    expect(a.opts()['effort']).toBe('low')
    expect(a.opts()['settings']).toEqual({ autoCompactWindow: 100_000 })
    const env = a.opts()['env'] as Record<string, string>
    expect(env['CAVEMAN_DEFAULT_MODE']).toBe('ultra')
    expect(env['PATH'] ?? env['Path']).toBe(process.env['PATH'] ?? process.env['Path'])
  })

  it('a caveman-only saver keeps summarized thinking', async () => {
    const a = make()
    await startSdkSession({ cwd: 'C:/x', prompt: 'hi', thinking: true, saver: { env: { CAVEMAN_DEFAULT_MODE: 'ultra' } }, queryImpl: a.impl, onEvent: () => {} })
    expect(a.opts()['thinking']).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(a.opts()).not.toHaveProperty('effort')
  })
})
