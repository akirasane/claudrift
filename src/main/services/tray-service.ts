import type { BrowserWindow } from 'electron'
import type { Disposer } from '../ipc/dispose'

// "Keep running in the tray": closing the window hides it so scheduled tasks keep running. Real quits still quit.

export interface CloseContext {
  /** The keepRunningInTray preference. */
  keepRunningInTray: boolean
  /** The tray icon exists (without it a hidden window could not be brought back). */
  trayReady: boolean
  /** A real quit is under way (tray Quit, app.quit(), the updater, relaunch, OS shutdown). */
  quitting: boolean
}

/** What a click on the window's close button does. */
export function trayCloseAction(c: CloseContext): 'hide' | 'close' {
  return c.keepRunningInTray && c.trayReady && !c.quitting ? 'hide' : 'close'
}

export interface HideToTrayDeps {
  context: () => CloseContext
}

/**
 * Hides the window instead of closing it when the policy says so. Install it BEFORE the quit guard: the guard skips
 * events that are already prevented, so nothing is asked while the sessions keep running in the background.
 */
export function installHideToTray(win: BrowserWindow, deps: HideToTrayDeps): Disposer {
  const onClose = (e: { preventDefault(): void }): void => {
    if (trayCloseAction(deps.context()) !== 'hide') return
    e.preventDefault()
    win.hide()
  }
  win.on('close', onClose)
  return () => {
    if (!win.isDestroyed()) win.removeListener('close', onClose)
  }
}

export interface TrayLike {
  setToolTip(tip: string): void
  setContextMenu(menu: unknown): void
  on(event: 'click' | 'double-click', cb: () => void): void
  destroy(): void
}

export interface TrayControllerDeps {
  createTray: () => TrayLike
  buildMenu: (items: Array<{ label: string; click: () => void } | { type: 'separator' }>) => unknown
  showWindow: () => void
  quit: () => void
  log?: (m: string) => void
}

/** Owns the tray icon: created when the preference is on, removed when it goes off. */
export class TrayController {
  private tray: TrayLike | undefined

  constructor(private readonly deps: TrayControllerDeps) {}

  get ready(): boolean {
    return this.tray !== undefined
  }

  /** Create or remove the icon. Returns true when the icon was just removed (the caller should show the window). */
  apply(enabled: boolean): boolean {
    if (enabled && !this.tray) {
      try {
        const t = this.deps.createTray()
        t.setToolTip('Claudrift')
        t.setContextMenu(
          this.deps.buildMenu([{ label: 'Show Claudrift', click: () => this.deps.showWindow() }, { type: 'separator' }, { label: 'Quit', click: () => this.deps.quit() }])
        )
        t.on('click', () => this.deps.showWindow())
        t.on('double-click', () => this.deps.showWindow())
        this.tray = t
      } catch (err) {
        this.deps.log?.(`tray failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      return false
    }
    if (!enabled && this.tray) {
      this.dispose()
      return true
    }
    return false
  }

  dispose(): void {
    const t = this.tray
    this.tray = undefined
    if (!t) return
    try {
      t.destroy()
    } catch {
      /* already gone */
    }
  }
}
