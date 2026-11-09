import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { RemoteControlHub, RemoteControlService, stripAnsi } from './remote-control'

function fakeChild(): ChildProcess & { out: EventEmitter; err: EventEmitter } {
  const c = new EventEmitter() as ChildProcess & { out: EventEmitter; err: EventEmitter }
  c.out = new EventEmitter()
  c.err = new EventEmitter()
  ;(c as unknown as { stdout: EventEmitter }).stdout = c.out
  ;(c as unknown as { stderr: EventEmitter }).stderr = c.err
  ;(c as unknown as { pid: number }).pid = 4242
  return c
}

function setup() {
  const child = fakeChild()
  const spawn = vi.fn(() => child)
  const kill = vi.fn()
  const broadcast = vi.fn()
  const svc = new RemoteControlService({ spawn, kill, broadcast, exe: () => 'claude.exe' })
  return { child, spawn, kill, broadcast, svc }
}

describe('RemoteControlService', () => {
  it('spawns remote-control with name and mode, then goes on when a URL prints', () => {
    const { child, spawn, svc } = setup()
    expect(svc.start({ cwd: 'C:\p', name: 'n', permissionMode: 'plan' }).status).toBe('starting')
    expect(spawn).toHaveBeenCalledWith('claude.exe', ['remote-control', '--name', 'n', '--permission-mode', 'plan'], { cwd: 'C:\p' })
    child.out.emit('data', Buffer.from('\u001b[32mConnected\u001b[0m\nView at https://claude.ai/code/session_abc.\n'))
    const s = svc.getState()
    expect(s.status).toBe('on')
    expect(s.url).toBe('https://claude.ai/code/session_abc')
    expect(s.log).toEqual(['Connected', 'View at https://claude.ai/code/session_abc.'])
  })

  it('reports an error when the process exits early', () => {
    const { child, svc } = setup()
    svc.start({ cwd: 'C:\p' })
    child.err.emit('data', 'Error: Workspace not trusted. Please run `claude` first.\n')
    child.emit('exit', 1)
    const s = svc.getState()
    expect(s.status).toBe('error')
    expect(s.message).toMatch(/Workspace not trusted/)
    expect(s.needsTrust).toBe(true)
  })

  it('needsTrust stays false for other failures', () => {
    const { child, svc } = setup()
    svc.start({ cwd: 'C:/p' })
    child.err.emit('data', 'Error: boom\n')
    child.emit('exit', 1)
    expect(svc.getState().needsTrust).toBe(false)
  })

  it('stop kills the child and goes off', () => {
    const { child, kill, svc } = setup()
    svc.start({ cwd: 'C:\p' })
    expect(svc.stop().status).toBe('off')
    expect(kill).toHaveBeenCalledWith(child)
    child.emit('exit', 1)
    expect(svc.getState().status).toBe('off')
  })

  it('dispose kills a running child; start is idempotent; log is capped', () => {
    const { child, spawn, kill, svc } = setup()
    svc.start({ cwd: 'C:\p' })
    svc.start({ cwd: 'C:\p' })
    expect(spawn).toHaveBeenCalledTimes(1)
    child.out.emit('data', Array.from({ length: 80 }, (_, i) => `l${i}`).join('\n'))
    expect(svc.getState().log).toHaveLength(50)
    svc.dispose()
    expect(kill).toHaveBeenCalledWith(child)
  })

  it('errors when no executable is found', () => {
    const svc = new RemoteControlService({ exe: () => undefined })
    expect(svc.start({ cwd: 'C:\p' }).status).toBe('error')
  })

  it('strips ANSI', () => {
    expect(stripAnsi('\u001b[1;31mred\u001b[0m \u001b]8;;http://x\u0007link')).toBe('red link')
  })
})

describe('RemoteControlHub', () => {
  it('runs one process per project and stops them independently', () => {
    const kids = [fakeChild(), fakeChild()]
    const spawn = vi.fn(() => kids[spawn.mock.calls.length - 1]!)
    const kill = vi.fn()
    const broadcast = vi.fn()
    const hub = new RemoteControlHub({ spawn, kill, broadcast, exe: () => 'claude.exe' })
    hub.start({ cwd: 'C:/a' })
    hub.start({ cwd: 'C:/b' })
    expect(spawn).toHaveBeenCalledTimes(2)
    // Same folder again (different spelling) reuses the run.
    hub.start({ cwd: 'c:/A/' })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(hub.list().map((s) => s.cwd)).toEqual(['C:/a', 'C:/b'])
    hub.stop('C:/a')
    expect(kill).toHaveBeenCalledWith(kids[0])
    expect(hub.list().map((s) => s.cwd)).toEqual(['C:/b'])
    expect(broadcast).toHaveBeenLastCalledWith([expect.objectContaining({ cwd: 'C:/b' })])
  })
})
