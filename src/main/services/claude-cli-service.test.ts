import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ClaudeBinaryInfo } from '../paths'
import { ClaudeCliService, isNewer } from './claude-cli-service'

function fakeFetch(map: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: unknown) => {
    if (!(url in map)) throw new Error('offline')
    return { ok: true, json: async () => map[url] }
  })
}
const CLI = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
const SDK = 'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest'

function make(over: { bin?: ClaudeBinaryInfo; busy?: number; fetch?: unknown; spawn?: unknown; updateTimeoutMs?: number } = {}) {
  let bin: ClaudeBinaryInfo = over.bin ?? { path: '/u/claude', version: '2.1.0', source: 'user' }
  const resetCache = vi.fn()
  const svc = new ClaudeCliService({
    resolve: () => bin,
    sdkVersions: () => ({ cli: '2.0.5', sdk: '0.2.9' }),
    resetCache,
    busyCount: () => over.busy ?? 0,
    fetch: (over.fetch ?? fakeFetch({ [CLI]: { version: '2.2.0' }, [SDK]: { version: '0.3.0' } })) as never,
    ...(over.spawn ? { spawn: over.spawn as never } : {}),
    ...(over.updateTimeoutMs ? { updateTimeoutMs: over.updateTimeoutMs } : {})
  })
  return { svc, resetCache, setBin: (b: ClaudeBinaryInfo) => (bin = b) }
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

describe('isNewer', () => {
  it('compares versions and treats unknown as not newer', () => {
    expect(isNewer('2.10.0', '2.9.9')).toBe(true)
    expect(isNewer('2.1.0', '2.1.0')).toBe(false)
    expect(isNewer('2.0.0', '2.1.0')).toBe(false)
    expect(isNewer(undefined, '1.0.0')).toBe(false)
    expect(isNewer('x', '1.0.0')).toBe(false)
  })
})

describe('ClaudeCliService.status', () => {
  it('reports updates for a user CLI and SDK', async () => {
    const s = await make().svc.status()
    expect(s).toMatchObject({
      latestCli: '2.2.0',
      latestSdk: '0.3.0',
      cliUpdateAvailable: true,
      sdkUpdateAvailable: true,
      canUpdate: true,
      bundledCliVersion: '2.0.5',
      sdkPinned: '0.2.9'
    })
  })

  it('degrades to unknown when fetch fails', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline')
    })
    const s = await make({ fetch: f }).svc.status()
    expect(s.latestCli).toBeUndefined()
    expect(s.cliUpdateAvailable).toBe(false)
    expect(s.canUpdate).toBe(false)
  })

  it('ignores non-ok and malformed registry answers', async () => {
    const f = vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    expect((await make({ fetch: f }).svc.status()).latestSdk).toBeUndefined()
    const g = vi.fn(async () => ({ ok: true, json: async () => ({ version: 5 }) }))
    expect((await make({ fetch: g }).svc.status()).latestCli).toBeUndefined()
  })

  it('never allows update for bundled or while sessions run', async () => {
    expect((await make({ bin: { source: 'bundled', version: '2.0.5' } }).svc.status()).canUpdate).toBe(false)
    expect((await make({ busy: 1 }).svc.status()).canUpdate).toBe(false)
  })

  it('sends no body or identifying headers', async () => {
    const f = fakeFetch({ [CLI]: { version: '2.2.0' } })
    await make({ fetch: f }).svc.status()
    const init = f.mock.calls[0]![1] as { headers: Record<string, string>; body?: unknown }
    expect(Object.keys(init.headers)).toEqual(['accept'])
    expect(init.body).toBeUndefined()
  })

  it('caches the registry answer unless refresh is requested', async () => {
    const f = fakeFetch({ [CLI]: { version: '2.2.0' }, [SDK]: { version: '0.3.0' } })
    const { svc } = make({ fetch: f })
    await svc.status()
    await svc.status()
    expect(f).toHaveBeenCalledTimes(2)
    await svc.status(true)
    expect(f).toHaveBeenCalledTimes(4)
  })
})

describe('ClaudeCliService.update', () => {
  it('refuses for bundled and while busy without spawning', async () => {
    const spawn = vi.fn()
    expect((await make({ bin: { source: 'bundled' }, spawn }).svc.update()).ok).toBe(false)
    expect((await make({ busy: 2, spawn }).svc.update()).ok).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('runs `<path> update` with an args array, resets cache, reports new version', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const { svc, resetCache, setBin } = make({ spawn })
    const p = svc.update()
    child.stdout.emit('data', Buffer.from('Checking\nInstalled 2.2.0\n'))
    setBin({ path: '/u/claude', version: '2.2.0', source: 'user' })
    child.emit('close', 0)
    const r = await p
    expect(spawn).toHaveBeenCalledWith('/u/claude', ['update'], expect.objectContaining({ shell: false }))
    expect(resetCache).toHaveBeenCalled()
    expect(r).toMatchObject({ ok: true, version: '2.2.0', output: ['Checking', 'Installed 2.2.0'] })
  })

  it('reports failure with the last output lines', async () => {
    const child = fakeChild()
    const { svc } = make({ spawn: () => child })
    const p = svc.update()
    for (let i = 0; i < 12; i++) child.stderr.emit('data', `line ${i}\n`)
    child.emit('close', 1)
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.message).toContain('code 1')
    expect(r.output).toHaveLength(8)
    expect(r.output.at(-1)).toBe('line 11')
  })

  it('reports spawn errors', async () => {
    const child = fakeChild()
    const { svc } = make({ spawn: () => child })
    const p = svc.update()
    child.emit('error', new Error('ENOENT'))
    expect((await p).message).toContain('ENOENT')
  })

  it('kills and fails on timeout', async () => {
    const child = fakeChild()
    const { svc } = make({ spawn: () => child, updateTimeoutMs: 20 })
    const r = await svc.update()
    expect(child.kill).toHaveBeenCalled()
    expect(r).toMatchObject({ ok: false, message: 'Update timed out.' })
  })
})
