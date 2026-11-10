import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { DEFAULT_PREFS } from '../../shared/app'
import { TrayController, installHideToTray, trayCloseAction } from './tray-service'
import type { CloseContext, TrayLike } from './tray-service'
import { installQuitGuard } from './quit-guard'

vi.mock('electron', () => ({ dialog: {} }))

const ctx = (o: Partial<CloseContext> = {}): CloseContext => ({ keepRunningInTray: true, trayReady: true, quitting: false, ...o })

describe('trayCloseAction', () => {
  it('hides only when the pref is on, the tray exists and no quit is under way', () => {
    expect(trayCloseAction(ctx())).toBe('hide')
    expect(trayCloseAction(ctx({ keepRunningInTray: false }))).toBe('close')
    expect(trayCloseAction(ctx({ trayReady: false }))).toBe('close')
    expect(trayCloseAction(ctx({ quitting: true }))).toBe('close')
  })
})

class FakeWin extends EventEmitter {
  hidden = 0
  closes = 0
  isDestroyed = (): boolean => false
  hide(): void {
    this.hidden++
  }
  /** Mimics BrowserWindow.close: a cancelable 'close' event with defaultPrevented. */
  close(): void {
    const e = {
      defaultPrevented: false,
      preventDefault(): void {
        this.defaultPrevented = true
      }
    }
    this.emit('close', e)
    if (!e.defaultPrevented) this.closes++
  }
}

describe('installHideToTray', () => {
  it('hides instead of closing, and the quit guard stays silent', () => {
    const w = new FakeWin()
    const showDialog = vi.fn(async () => ({ response: 1 }))
    installHideToTray(w as unknown as BrowserWindow, { context: () => ctx() })
    installQuitGuard(w as unknown as BrowserWindow, { busyCount: () => 3, prefs: { get: () => DEFAULT_PREFS }, showDialog })
    w.close()
    expect(w.hidden).toBe(1)
    expect(w.closes).toBe(0)
    expect(showDialog).not.toHaveBeenCalled()
  })

  it('closes for real while quitting, so the quit guard still asks when sessions are busy', () => {
    const w = new FakeWin()
    const showDialog = vi.fn(async () => ({ response: 1 }))
    installHideToTray(w as unknown as BrowserWindow, { context: () => ctx({ quitting: true }) })
    installQuitGuard(w as unknown as BrowserWindow, { busyCount: () => 1, prefs: { get: () => DEFAULT_PREFS }, showDialog })
    w.close()
    expect(w.hidden).toBe(0)
    expect(showDialog).toHaveBeenCalledTimes(1)
  })

  it('closes normally when the pref is off', () => {
    const w = new FakeWin()
    installHideToTray(w as unknown as BrowserWindow, { context: () => ctx({ keepRunningInTray: false }) })
    w.close()
    expect(w.closes).toBe(1)
    expect(w.hidden).toBe(0)
  })
})

describe('TrayController', () => {
  function setup() {
    const handlers: Record<string, () => void> = {}
    const tray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn((ev: string, cb: () => void) => void (handlers[ev] = cb)), destroy: vi.fn() }
    let menu: Array<{ label?: string; click?: () => void }> = []
    const deps = {
      createTray: vi.fn(() => tray as unknown as TrayLike),
      buildMenu: (items: unknown) => {
        menu = items as typeof menu
        return items
      },
      showWindow: vi.fn(),
      quit: vi.fn()
    }
    return { c: new TrayController(deps), tray, deps, handlers, menu: () => menu }
  }

  it('creates the tray once when enabled and wires Show / Quit', () => {
    const { c, deps, handlers, menu } = setup()
    expect(c.ready).toBe(false)
    c.apply(true)
    c.apply(true)
    expect(deps.createTray).toHaveBeenCalledTimes(1)
    expect(c.ready).toBe(true)
    menu().find((m) => m.label === 'Show Claudrift')!.click!()
    menu().find((m) => m.label === 'Quit')!.click!()
    handlers['click']!()
    expect(deps.showWindow).toHaveBeenCalledTimes(2)
    expect(deps.quit).toHaveBeenCalledTimes(1)
  })

  it('removes the tray when disabled and says the window should be shown', () => {
    const { c, tray } = setup()
    expect(c.apply(false)).toBe(false)
    c.apply(true)
    expect(c.apply(false)).toBe(true)
    expect(tray.destroy).toHaveBeenCalledTimes(1)
    expect(c.ready).toBe(false)
  })

  it('stays not-ready when the tray cannot be created', () => {
    const log = vi.fn()
    const c = new TrayController({ createTray: () => { throw new Error('boom') }, buildMenu: () => ({}), showWindow: () => {}, quit: () => {}, log })
    c.apply(true)
    expect(c.ready).toBe(false)
    expect(log).toHaveBeenCalled()
  })
})
