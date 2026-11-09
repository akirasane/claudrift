import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, Menu, Notification, powerMonitor, powerSaveBlocker, screen, shell } from 'electron'
import { join } from 'node:path'
import { IpcChannels } from '../shared/ipc'
import type { SessionEventPayload } from '../shared/ipc'
import { registerIpc } from './ipc'
import { detectElevation } from './ipc/app'
import type { Disposer } from './ipc/dispose'
import { isAppNavigation } from './navigation'
import { assistantPath, claudeConfigDir, createConfigPaths, trashDir, limitsPath, readSdkVersions, schedulePath, resetClaudeBinaryCache, resolveClaudeBinary, prefsPath, transcriptsRoot, usageCachePath, usageLedgerPath, windowStatePath } from './paths'
import { AutoResumeMain } from './services/autoresume-main'
import { AuthStatusService } from './services/auth-status'
import { runClaude } from './services/claude-cli'
import { CavemanService } from './services/caveman-service'
import { GitService } from './services/git-service'
import { FileSearchService } from './services/file-search'
import { LimitsService } from './services/limits-service'
import { UsageProbe } from './services/usage-probe'
import { trustWorkspace } from './services/workspace-trust'
import { RemoteControlHub } from './services/remote-control'
import { ScheduleService } from './services/schedule-service'
import { SCHEDULE_SERVER_NAME, createScheduleMcpServer } from './services/schedule-tools'
import { ADMIN_SERVER_NAME, ASSISTANT_AUTO_ALLOWED, ASSISTANT_SYSTEM_PROMPT, createAdminMcpServer } from './services/assistant-tools'
import type { AssistantDeps } from './services/assistant-tools'
import { McpService } from './services/mcp-service'
import { PluginService } from './services/plugin-service'
import { ItemsService } from './services/items-service'
import { Trash } from './services/trash'
import { sharedConfig } from './ipc/config'
import { mkdirSync } from 'node:fs'
import { saverOptions } from '../shared/saver'
import { HotkeyService } from './services/hotkey-service'
import { NotificationService } from './services/notification-service'
import { PluginRegistry } from './services/plugin-registry'
import { PrefsService } from './services/prefs-service'
import { installQuitGuard } from './services/quit-guard'
import { SessionManager } from './services/session-manager'
import { ClaudeCliService } from './services/claude-cli-service'
import { UpdateService } from './services/update-service'
import { UsageLedger } from './services/usage-ledger'
import { UsageService } from './services/usage-service'
import { migrateUserDataDir } from './user-data-migration'
import { loadWindowState, trackWindowState } from './services/window-state'

// A dev build must never share prefs, trash, ledger or localStorage with an installed app (P4 D8).
// Must run before anything reads app.getPath('userData'). An explicit --user-data-dir wins.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  // Pre-rename (ccwraper) data carries over: move the old dir to the new one, or keep using it if that fails.
  const appData = app.getPath('appData')
  const dev = !app.isPackaged
  const oldDir = join(appData, dev ? 'ccwraper-dev' : 'ccwraper')
  const newDir = join(appData, dev ? 'Claudrift-dev' : 'Claudrift')
  const moved = migrateUserDataDir(oldDir, newDir)
  if (moved === 'use-old') {
    console.warn('[claudrift] could not move legacy userData, continuing to use', oldDir)
    app.setPath('userData', oldDir)
  } else if (dev) {
    app.setPath('userData', newDir)
  }
}
// Same as the electron-builder appId, so toasts are attributed to "Claudrift" once installed.
app.setAppUserModelId('com.claudrift.app')

const userData = app.getPath('userData')

let win: BrowserWindow | null = null
let disposeIpc: Disposer | null = null
let disposeWindow: Disposer | null = null

function isHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

const getWindow = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null)

const prefs = new PrefsService(prefsPath(userData), {
  onCorrupt: ({ reason }) => console.warn('[claudrift] prefs.json was unusable, using defaults:', reason)
})
const pluginRegistry = new PluginRegistry()
const usage = new UsageService({
  root: transcriptsRoot(),
  cacheFile: usageCachePath(userData),
  ledgerFile: usageLedgerPath(userData)
})
const ledger = new UsageLedger(usageLedgerPath(userData))
const git = new GitService()
const files = new FileSearchService()
const auth = new AuthStatusService(runClaude)
const hotkey = new HotkeyService({ getWindow })
const updates = new UpdateService({
  // autoUpdater is a lazy getter; it is only touched in a packaged build.
  ...(app.isPackaged ? { updater: autoUpdater } : {}),
  isPackaged: app.isPackaged,
  prefs,
  broadcast: (state) => getWindow()?.webContents.send(IpcChannels.updateState, state),
  log: (m) => console.warn('[claudrift]', m)
})

const limits = new LimitsService({
  file: limitsPath(userData),
  broadcast: (state) => getWindow()?.webContents.send(IpcChannels.limitsState, state),
  log: (m) => console.warn('[claudrift]', m)
})
// Polls plan usage every 30 s through one idle SDK session so the 5h / 7d bars move without any chat.
const usageProbe = new UsageProbe({
  ingest: (l) => limits.ingest(l),
  enabled: () => prefs.get().showLimitsBar,
  log: (m) => console.warn('[claudrift]', m)
})
const remote = new RemoteControlHub({
  broadcast: (state) => getWindow()?.webContents.send(IpcChannels.remoteState, state)
})
const caveman = new CavemanService({
  configDir: claudeConfigDir(),
  broadcast: (state) => getWindow()?.webContents.send(IpcChannels.cavemanState, state)
})

// Session event fan-out: renderer, notifications, usage ledger.
const manager: SessionManager = new SessionManager(
  (localId, event) => {
    // Scheduled runs are headless: nothing in the window listens to them, and their permission requests are auto-denied.
    if (!manager.isInternal(localId)) {
      const payload: SessionEventPayload = { localId, event }
      getWindow()?.webContents.send(IpcChannels.sessionEvent, payload)
      notifications.onSessionEvent(localId, event)
    }
    ledger.onSessionEvent(localId, event, manager.info(localId))
    schedule.onSessionEvent(localId, event)
  },
  { registry: pluginRegistry, allowBypass: () => prefs.get().allowBypassMode, chrome: () => prefs.get().claudeInChrome, saver: (force) => saverOptions(force === undefined ? prefs.get() : { ...prefs.get(), ultraSaver: force }), onRateLimitInfo: (info) => limits.ingest(info), mcpServers: async (cwd) => ({
      [SCHEDULE_SERVER_NAME]: await createScheduleMcpServer(schedule, isAssistantDir(cwd) ? undefined : cwd),
      ...(isAssistantDir(cwd) ? { [ADMIN_SERVER_NAME]: await createAdminMcpServer(adminDeps) } : {})
    }),
    appendSystemPrompt: (cwd) => (isAssistantDir(cwd) ? ASSISTANT_SYSTEM_PROMPT : undefined),
    allowedTools: (cwd) => (isAssistantDir(cwd) ? ASSISTANT_AUTO_ALLOWED : undefined)
  }
)
// The assistant chat works in its own folder under userData, not in a project.
const assistantDir = assistantPath(userData)
mkdirSync(assistantDir, { recursive: true })
const normDir = (p: string): string => p.split('\\').join('/').replace(/\/+$/, '').toLowerCase()
const isAssistantDir = (cwd: string): boolean => normDir(cwd) === normDir(assistantDir)
let itemsSvc: ItemsService | undefined
const adminDeps: AssistantDeps = {
  prefs,
  mcp: new McpService({ paths: createConfigPaths() }),
  plugins: new PluginService(),
  items: {
    list: (kind, cwd) => getItems().list(kind, cwd),
    create: (a) => getItems().create(a)
  },
  config: () => sharedConfig()?.service
}
function getItems(): ItemsService {
  if (itemsSvc) return itemsSvc
  const shared = sharedConfig()
  if (!shared) throw new Error('Config service is not ready yet.')
  return (itemsSvc = new ItemsService(shared.paths, pluginRegistry, shared.service, new Trash(trashDir(userData))))
}
// Timed prompts and scripts. Runs headless sessions through the same manager; only fires while the app is open.
const schedule: ScheduleService = new ScheduleService({
  file: schedulePath(userData),
  start: (a) => manager.start({ cwd: a.cwd, prompt: a.prompt, permissionMode: a.permissionMode }, { internal: true }),
  close: (id) => manager.close(id),
  denyPermission: (localId, reqId) => manager.permissionReply({ localId, reqId, decision: 'deny' }),
  broadcast: (tasks) => getWindow()?.webContents.send(IpcChannels.scheduleState, tasks),
  notify: (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  },
  log: (m) => console.warn('[claudrift]', m)
})
const claudeCli = new ClaudeCliService({
  resolve: resolveClaudeBinary,
  sdkVersions: readSdkVersions,
  resetCache: resetClaudeBinaryCache,
  busyCount: () => manager.busyCount()
})
const notifications = new NotificationService({ getWindow, prefs, manager })
const autoResume = new AutoResumeMain({ powerSave: powerSaveBlocker, announce: (r) => notifications.announce(r) })

function createWindow(): void {
  const restored = loadWindowState(
    windowStatePath(userData),
    screen.getAllDisplays().map((d) => d.workArea)
  )
  const { maximized, ...bounds } = restored
  const w = new BrowserWindow({
    width: 1280,
    height: 800,
    ...bounds,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0A0A0C',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0A0A0C', symbolColor: '#9A9AA8', height: 40 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win = w
  if (maximized) w.maximize()
  w.once('ready-to-show', () => w.show())
  w.on('focus', () => void caveman.refresh())
  // Never open in-app windows; hand http(s) links to the OS browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const indexHtmlPath = join(__dirname, '../renderer/index.html')
  // Block in-place navigation away from the app (e.g. a clicked link without target).
  w.webContents.on('will-navigate', (e, url) => {
    if (isAppNavigation(url, { ...(devUrl ? { devUrl } : {}), indexHtmlPath })) return
    e.preventDefault()
    if (isHttpUrl(url)) void shell.openExternal(url)
  })
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (!app.isPackaged) {
      // Dev only: DevTools without the default menu.
      if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        w.webContents.toggleDevTools()
        e.preventDefault()
      }
    } else if (key === 'f5' || (input.control && key === 'r')) {
      // A reload would orphan the live main-process sessions.
      e.preventDefault()
    }
  })
  disposeWindow = combineWindowDisposers(trackWindowState(w, windowStatePath(userData)), installQuitGuard(w, { busyCount: () => manager.busyCount(), prefs }))
  w.on('closed', () => {
    disposeWindow?.()
    disposeWindow = null
    if (win === w) win = null
  })
  if (devUrl) void w.loadURL(devUrl)
  else void w.loadFile(indexHtmlPath)
}

function combineWindowDisposers(...ds: Disposer[]): Disposer {
  return () => {
    for (const d of ds) {
      try {
        d()
      } catch (err) {
        console.warn('[claudrift] window dispose failed', err instanceof Error ? err.message : err)
      }
    }
  }
}

function focusMainWindow(): void {
  const w = getWindow()
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}

// Without the default menu, Ctrl+W no longer closes the window and Ctrl+R no longer reloads (P4 D11).
Menu.setApplicationMenu(null)

if (!app.requestSingleInstanceLock()) {
  // A second launch hands over to the first one and exits.
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  void app.whenReady().then(() => {
    disposeIpc = registerIpc({
      manager,
      registry: pluginRegistry,
      send: (channel, payload) => {
        getWindow()?.webContents.send(channel, payload)
      },
      auth,
      setActiveSession: (localId) => notifications.setActive(localId),
      prefs,
      hotkey,
      usage,
      git,
      files,
      autoResume: { report: (r) => autoResume.report(r) },
      update: updates,
      claudeCli,
      limits,
      caveman,
      schedule: {
        list: () => schedule.list(),
        upsert: (i) => schedule.upsert(i as Parameters<ScheduleService['upsert']>[0]),
        remove: (id) => schedule.remove(id),
        setEnabled: (id, en) => schedule.setEnabled(id, en),
        run: (id) => schedule.run(id)
      },
      remote: { list: () => remote.list(), start: (a) => remote.start(a), stop: (cwd) => remote.stop(cwd), trust: (a) => trustWorkspace(a.cwd) }
    })
    updates.start()
    caveman.start()
    usageProbe.start()
    schedule.start()
    detectElevation()
    // Waking from sleep: run catch-up tasks and record the others as missed right away, not up to 15 s later.
    powerMonitor.on('resume', () => void schedule.tick())
    const applyLogin = (on: boolean): void => {
      if (app.isPackaged && process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: on })
    }
    applyLogin(prefs.get().startAtLogin)
    app.on('browser-window-focus', () => usageProbe.refreshNow())
    hotkey.apply(prefs.get().hotkey)
    prefs.onChange((p) => {
      applyLogin(p.startAtLogin)
      hotkey.apply(p.hotkey)
      usageProbe.refreshNow()
    })
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

function shutdown(): void {
  manager.closeAll()
  disposeIpc?.()
  disposeIpc = null
}

app.on('before-quit', shutdown)
app.on('will-quit', () => {
  hotkey.dispose()
  updates.dispose()
  caveman.dispose()
  usageProbe.dispose()
  remote.dispose()
  schedule.dispose()
  autoResume.dispose()
  notifications.dispose()
})
app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') app.quit()
})
