import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import type { AppPrefs, AppPrefsPatch, HotkeyStatus } from '@shared/app'
import type { ShellId, ShellProfile } from '@shared/config'
import type { AppInfo } from '@shared/events'
import { useToolCardPrefs } from '../chat/tools/tool-card-prefs'
import { useModePrefs } from '@/features/chat/mode/mode-prefs'
import { Button, Input, Toggle, fieldClass } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AutoResumeCard } from '@/features/autoresume/AutoResumeCard'
import { useTerminalStore } from '@/features/terminal/terminal-store'
import { describeUpdate, useUpdateState } from '@/features/updates/use-update-state'
import {
  SAVER_CAVEMAN_MODES,
  SAVER_COMPACT_MAX,
  SAVER_COMPACT_MIN,
  SAVER_EFFORTS,
  SAVER_MODELS,
  type SaverConfig
} from '@shared/saver'
import { acceleratorFromEvent } from './accelerator'
import { ClaudeCliSection } from './ClaudeCliSection'

const PREFS_KEY = ['prefs'] as const

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section aria-labelledby={id} data-testid={`prefs-${id}`} className="border-b border-border py-5 last:border-b-0">
      <h3 id={id} className="mb-2 text-md font-medium text-fg">
        {title}
      </h3>
      <div className="divide-y divide-border">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  htmlFor,
  children
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-base text-fg">
          {label}
        </label>
        {hint && <div className="text-sm text-fg-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function usePrefs() {
  const qc = useQueryClient()
  const query = useQuery<AppPrefs>({ queryKey: PREFS_KEY, queryFn: () => window.claudrift.prefs.get(), retry: false })
  const [hotkey, setHotkey] = React.useState<HotkeyStatus | undefined>()
  const [saveError, setSaveError] = React.useState<string | undefined>()

  React.useEffect(() => {
    const off = window.claudrift.prefs?.onChanged?.((p) => qc.setQueryData(PREFS_KEY, p))
    return off
  }, [qc])

  const set = React.useCallback(
    async (patch: AppPrefsPatch): Promise<void> => {
      setSaveError(undefined)
      try {
        const res = await window.claudrift.prefs.set(patch)
        qc.setQueryData(PREFS_KEY, res.prefs)
        useModePrefs.getState().set(res.prefs.allowBypassMode === true)
        useToolCardPrefs.getState().set(res.prefs.toolCardsExpanded === true)
        setHotkey(res.hotkey)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not save preferences.')
      }
    },
    [qc]
  )
  return { prefs: query.data, loadError: query.isError, hotkey, saveError, set }
}

function AcceleratorInput({
  value,
  disabled,
  onCommit
}: {
  value: string
  disabled?: boolean
  onCommit: (accelerator: string) => void
}): React.JSX.Element {
  const [message, setMessage] = React.useState<string | undefined>()
  const [capturing, setCapturing] = React.useState(false)

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
    // Keep keyboard navigation: a bare Tab moves focus, a bare Escape leaves the field.
    if (plain && e.key === 'Tab') return
    if (plain && e.key === 'Escape') {
      e.currentTarget.blur()
      return
    }
    e.preventDefault()
    const r = acceleratorFromEvent(e.nativeEvent)
    if (r.kind === 'pending') return
    if (r.kind === 'error') {
      setMessage(r.message)
      return
    }
    setMessage(undefined)
    if (r.accelerator !== value) onCommit(r.accelerator)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        mono
        readOnly
        disabled={disabled}
        value={capturing ? 'Press a shortcut...' : value}
        aria-label="Global shortcut"
        aria-describedby={message ? 'hotkey-capture-error' : undefined}
        error={!!message}
        data-testid="hotkey-input"
        className="w-52 cursor-pointer text-center"
        onFocus={() => setCapturing(true)}
        onBlur={() => {
          setCapturing(false)
          setMessage(undefined)
        }}
        onKeyDown={onKeyDown}
      />
      {message && (
        <span id="hotkey-capture-error" role="alert" data-testid="hotkey-capture-error" className="text-sm text-danger">
          {message}
        </span>
      )}
    </div>
  )
}

function CostAlertInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }): React.JSX.Element {
  const [text, setText] = React.useState(String(value))
  React.useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Number(text)
    if (!Number.isFinite(n) || n < 0) return setText(String(value))
    const usd = Math.min(100000, Math.round(n * 100) / 100)
    setText(String(usd))
    if (usd !== value) onCommit(usd)
  }
  return (
    <Input
      id="cost-alert"
      data-testid="cost-alert"
      inputMode="decimal"
      value={text}
      className="h-[30px] w-24 text-right"
      onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

const MODEL_CUSTOM = '__custom'

/** Fine-tuning for each saver part. Each control is enabled only when the saver and its part are on. */
function SaverTuning({ prefs, set }: { prefs: AppPrefs; set: (p: AppPrefsPatch) => Promise<void> }): React.JSX.Element {
  const c = prefs.ultraSaverConfig
  const on = prefs.ultraSaver
  const parts = prefs.ultraSaverParts
  const known = (SAVER_MODELS as readonly string[]).includes(c.model)
  const [custom, setCustom] = React.useState(known ? '' : c.model)
  const [compactText, setCompactText] = React.useState(String(Math.round(c.compactTokens / 1000)))
  React.useEffect(() => setCompactText(String(Math.round(c.compactTokens / 1000))), [c.compactTokens])
  const patch = (p: Partial<SaverConfig>): void => void set({ ultraSaverConfig: p })
  const commitCompact = (): void => {
    const n = Math.round(Number(compactText))
    if (!Number.isFinite(n)) return setCompactText(String(Math.round(c.compactTokens / 1000)))
    const tokens = Math.min(SAVER_COMPACT_MAX, Math.max(SAVER_COMPACT_MIN, n * 1000))
    setCompactText(String(Math.round(tokens / 1000)))
    if (tokens !== c.compactTokens) patch({ compactTokens: tokens })
  }
  const sel = 'h-[30px] w-40'
  return (
    <>
      <Row label="Reply style" hint="How terse the caveman plugin makes replies. Ultra is shortest." htmlFor="saver-caveman-mode">
        <select
          id="saver-caveman-mode"
          data-testid="saver-caveman-mode"
          value={c.cavemanMode}
          disabled={!on || !parts.caveman}
          className={cn(fieldClass, sel)}
          onChange={(e) => patch({ cavemanMode: e.target.value as SaverConfig['cavemanMode'] })}
        >
          {SAVER_CAVEMAN_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Model" hint="Used by new chats that have no model of their own. Pick Custom for a full model id." htmlFor="saver-model-select">
        <div className="flex flex-col items-end gap-1">
          <select
            id="saver-model-select"
            data-testid="saver-model-select"
            value={known ? c.model : MODEL_CUSTOM}
            disabled={!on || !parts.model}
            className={cn(fieldClass, sel)}
            onChange={(e) => {
              if (e.target.value === MODEL_CUSTOM) setCustom(known ? '' : c.model)
              else patch({ model: e.target.value })
            }}
          >
            {SAVER_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={MODEL_CUSTOM}>Custom...</option>
          </select>
          {!known && (
            <Input
              mono
              aria-label="Custom model id"
              data-testid="saver-model-custom"
              disabled={!on || !parts.model}
              value={custom}
              className="h-[30px] w-40"
              onChange={(e) => setCustom(e.target.value)}
              onBlur={() => custom.trim() && custom.trim() !== c.model && patch({ model: custom.trim() })}
            />
          )}
        </div>
      </Row>
      <Row label="Effort" hint="Lower is cheaper and faster, higher thinks harder." htmlFor="saver-effort">
        <select
          id="saver-effort"
          data-testid="saver-effort"
          value={c.effort}
          disabled={!on || !parts.model}
          className={cn(fieldClass, sel)}
          onChange={(e) => patch({ effort: e.target.value as SaverConfig['effort'] })}
        >
          {SAVER_EFFORTS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Turn off extended thinking" hint="Thinking tokens are billed as output." htmlFor="saver-no-thinking">
        <Toggle
          id="saver-no-thinking"
          checked={c.disableThinking}
          disabled={!on || !parts.model}
          data-testid="saver-no-thinking"
          onCheckedChange={(v) => patch({ disableThinking: v })}
        />
      </Row>
      <Row label="Compact at (thousand tokens)" hint="20 to 1000. Lower compacts sooner and keeps chats cheaper." htmlFor="saver-compact-at">
        <Input
          id="saver-compact-at"
          data-testid="saver-compact-at"
          inputMode="numeric"
          disabled={!on || !parts.compact}
          value={compactText}
          className="h-[30px] w-24 text-right"
          onChange={(e) => setCompactText(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commitCompact}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </Row>
    </>
  )
}

function ThresholdInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }): React.JSX.Element {
  const [text, setText] = React.useState(String(value))
  React.useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Math.min(3600, Math.max(0, Math.round(Number(text))))
    if (!Number.isFinite(n) || text.trim() === '') {
      setText(String(value))
      return
    }
    setText(String(n))
    if (n !== value) onCommit(n)
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        id="turn-done-min"
        type="number"
        min={0}
        max={3600}
        step={1}
        value={text}
        data-testid="turn-done-min"
        className="w-20 text-right"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="text-sm text-fg-3">seconds</span>
    </div>
  )
}

function NotificationsSection({ prefs, set }: { prefs: AppPrefs; set: (p: AppPrefsPatch) => void }): React.JSX.Element {
  const n = prefs.notifications
  const sub = !n.enabled
  const toggle = (id: string, label: string, hint: string, key: 'permission' | 'turnDone' | 'backgroundTask' | 'flashTaskbar') => (
    <Row label={label} hint={hint} htmlFor={id}>
      <Toggle
        id={id}
        checked={n[key]}
        disabled={sub}
        data-testid={id}
        onCheckedChange={(v) => set({ notifications: { [key]: v } })}
      />
    </Row>
  )
  return (
    <Section id="notifications" title="Notifications">
      <Row label="Desktop notifications" hint="Only shown while the window is not focused." htmlFor="notif-enabled">
        <Toggle
          id="notif-enabled"
          checked={n.enabled}
          data-testid="notif-enabled"
          onCheckedChange={(v) => set({ notifications: { enabled: v } })}
        />
      </Row>
      {toggle('notif-permission', 'Approval needed', 'When Claude waits for a permission.', 'permission')}
      {toggle('notif-turnDone', 'Turn finished', 'When a long turn completes.', 'turnDone')}
      <Row label="Only if the turn took at least" htmlFor="turn-done-min">
        <ThresholdInput
          value={n.turnDoneMinSeconds}
          onCommit={(v) => set({ notifications: { turnDoneMinSeconds: v } })}
        />
      </Row>
      {toggle('notif-backgroundTask', 'Background task ended', 'When an agent finishes in the background.', 'backgroundTask')}
      {toggle('notif-flashTaskbar', 'Flash the taskbar', 'When approval is needed.', 'flashTaskbar')}
    </Section>
  )
}

function HotkeySection({
  prefs,
  hotkey,
  set
}: {
  prefs: AppPrefs
  hotkey: HotkeyStatus | undefined
  set: (p: AppPrefsPatch) => void
}): React.JSX.Element {
  return (
    <Section id="hotkey" title="Global hotkey">
      <Row
        label="Show or hide Claudrift"
        hint="Works from any app. Off by default because it takes the shortcut system-wide."
        htmlFor="hotkey-enabled"
      >
        <Toggle
          id="hotkey-enabled"
          checked={prefs.hotkey.enabled}
          data-testid="hotkey-enabled"
          onCheckedChange={(v) => set({ hotkey: { enabled: v } })}
        />
      </Row>
      <Row label="Shortcut" hint="Focus the field and press the keys.">
        <AcceleratorInput
          value={prefs.hotkey.accelerator}
          onCommit={(accelerator) => set({ hotkey: { accelerator } })}
        />
      </Row>
      {hotkey?.error && (
        <p role="alert" data-testid="hotkey-error" className="py-2 text-sm text-danger">
          {hotkey.error}
        </p>
      )}
      {hotkey && !hotkey.error && hotkey.enabled && hotkey.registered && (
        <p role="status" data-testid="hotkey-ok" className="py-2 text-sm text-fg-3">
          Registered.
        </p>
      )}
    </Section>
  )
}

function ShellSection(): React.JSX.Element {
  const defaultShell = useTerminalStore((s) => s.defaultShell)
  const setDefaultShell = useTerminalStore((s) => s.setDefaultShell)
  const shells = useQuery<ShellProfile[]>({
    queryKey: ['pty', 'shells'],
    queryFn: async () => (await window.claudrift.pty?.listShells?.()) ?? [],
    retry: false
  })
  const list = shells.data ?? []
  const value = defaultShell ?? list.find((s) => s.isDefault)?.id ?? list[0]?.id ?? ''
  return (
    <Section id="terminal" title="Terminal">
      <Row label="Default shell" hint="Used when a new terminal tab opens." htmlFor="default-shell">
        <select
          id="default-shell"
          data-testid="default-shell"
          value={value}
          disabled={list.length === 0}
          className={cn(fieldClass, 'h-[30px] w-52')}
          onChange={(e) => setDefaultShell(e.target.value as ShellId)}
        >
          {list.length === 0 && <option value="">No shells found</option>}
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Row>
    </Section>
  )
}

function UpdatesSection({ prefs, set }: { prefs: AppPrefs; set: (p: AppPrefsPatch) => void }): React.JSX.Element {
  const state = useUpdateState()
  const info = useQuery<AppInfo>({ queryKey: ['app', 'info'], queryFn: () => window.claudrift.app.info(), retry: false })
  const [checking, setChecking] = React.useState(false)
  const disabled = state.kind === 'disabled'
  const check = (): void => {
    setChecking(true)
    void Promise.resolve(window.claudrift.update.check())
      .catch(() => {})
      .finally(() => setChecking(false))
  }
  return (
    <Section id="updates" title="Updates">
      <Row label="Current version" htmlFor="update-check">
        <span data-testid="update-current" className="font-mono text-sm text-fg-2">
          {info.data ? `${info.data.version}${info.data.packaged ? '' : ' (dev)'}` : '...'}
        </span>
      </Row>
      <Row label="Status">
        <span
          role="status"
          data-testid="update-status"
          data-kind={state.kind}
          className={cn('max-w-xs text-right text-sm', state.kind === 'error' ? 'text-danger' : 'text-fg-3')}
        >
          {describeUpdate(state)}
        </span>
      </Row>
      <Row label="Check now" hint="Looks for a newer release on GitHub.">
        <Button
          id="update-check"
          size="sm"
          data-testid="update-check"
          disabled={disabled || checking || state.kind === 'checking' || state.kind === 'downloading'}
          onClick={check}
        >
          Check for updates
        </Button>
      </Row>
      <Row label="Check for updates automatically" hint="At startup and every few hours." htmlFor="update-auto">
        <Toggle
          id="update-auto"
          checked={prefs.autoUpdate}
          data-testid="update-auto"
          onCheckedChange={(v) => set({ autoUpdate: v })}
        />
      </Row>
    </Section>
  )
}

function Field({ label, value, testId }: { label: string; value: string | undefined; testId: string }): React.JSX.Element {
  return (
    <div className="flex gap-4 py-2 text-base">
      <dt className="w-32 shrink-0 text-fg-3">{label}</dt>
      <dd data-testid={testId} className="min-w-0 flex-1 break-all font-mono text-sm text-fg-2">
        {value || 'unknown'}
      </dd>
    </div>
  )
}

function SystemSection({ prefs, set }: { prefs: AppPrefs; set: (p: AppPrefsPatch) => void }): React.JSX.Element {
  const [elevated, setElevated] = React.useState<boolean | undefined>()
  const [win, setWin] = React.useState(false)
  React.useEffect(() => {
    void window.claudrift?.app?.info().then((i) => {
      setElevated(i.elevated)
      setWin(i.platform === 'win32' && i.packaged)
    })
  }, [])
  return (
    <Section id="system" title="System">
      <Row label="Start when I sign in" hint="Scheduled tasks only run while Claudrift is open. Installed Windows app only." htmlFor="start-login">
        <Toggle id="start-login" checked={prefs.startAtLogin} data-testid="start-login" onCheckedChange={(v) => set({ startAtLogin: v })} />
      </Row>
      <Row label="Keep running in the tray" hint="Closing the window hides Claudrift to the tray icon so scheduled tasks keep running. Use Quit in the tray menu to exit." htmlFor="keep-tray">
        <Toggle id="keep-tray" checked={prefs.keepRunningInTray} data-testid="keep-tray" onCheckedChange={(v) => set({ keepRunningInTray: v })} />
      </Row>
      {win && (
        <Row
          label={elevated ? 'Running as administrator' : 'Run as administrator'}
          hint="Claude's tools, MCP servers and scheduled scripts then run with admin rights. Windows also blocks drag-and-drop from Explorer into an elevated window. Only use it when a task needs it."
        >
          {!elevated && (
            <Button variant="secondary" size="sm" data-testid="relaunch-admin" onClick={() => void window.claudrift.app.relaunchElevated()}>
              Relaunch as administrator
            </Button>
          )}
        </Row>
      )}
    </Section>
  )
}

function AboutSection(): React.JSX.Element {
  const info = useQuery<AppInfo>({ queryKey: ['app', 'info'], queryFn: () => window.claudrift.app.info(), retry: false })
  const i = info.data
  return (
    <Section id="about" title="About">
      {!i ? (
        <p className="py-2 text-base text-fg-3">{info.isError ? 'App info is unavailable.' : 'Loading...'}</p>
      ) : (
        <dl>
          <Field label="Claudrift" value={`${i.version}${i.packaged ? '' : ' (dev)'}`} testId="about-version" />
          <Field label="Electron" value={i.electronVersion} testId="about-electron" />
          <Field label="Claude Code" value={i.claudeVersion} testId="about-claude-version" />
          <Field label="Claude source" value={i.claudeSource} testId="about-claude-source" />
          <Field label="Claude path" value={i.claudePath} testId="about-claude-path" />
          <Field label="Agent SDK" value={i.sdkVersion} testId="about-sdk" />
          <Field label="Data folder" value={i.userDataDir} testId="about-userdata" />
          <Field label="Trash folder" value={i.trashDir} testId="about-trash" />
        </dl>
      )}
    </Section>
  )
}

export function PreferencesPage(): React.JSX.Element {
  const { prefs, loadError, hotkey, saveError, set } = usePrefs()
  return (
    <div data-testid="preferences-page" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <h2 className="text-lg font-medium text-fg">Preferences</h2>
        {saveError && (
          <p role="alert" data-testid="prefs-save-error" className="mt-2 text-sm text-danger">
            {saveError}
          </p>
        )}
        {!prefs ? (
          <p role="status" className="mt-4 text-base text-fg-3">
            {loadError ? 'Preferences could not be loaded.' : 'Loading...'}
          </p>
        ) : (
          <>
            <NotificationsSection prefs={prefs} set={(p) => void set(p)} />
            <HotkeySection prefs={prefs} hotkey={hotkey} set={(p) => void set(p)} />
            <UpdatesSection prefs={prefs} set={(p) => void set(p)} />
            <SystemSection prefs={prefs} set={(p) => void set(p)} />
            <ClaudeCliSection />
            <Section id="statusbar" title="Status bar">
              <Row
                label="Show usage limits"
                hint="5-hour and 7-day subscription usage with a reset countdown. Updates after the first message of a session."
                htmlFor="show-limits"
              >
                <Toggle
                  id="show-limits"
                  checked={prefs.showLimitsBar}
                  data-testid="show-limits"
                  onCheckedChange={(v) => void set({ showLimitsBar: v })}
                />
              </Row>
              <Row
                label="Show caveman badge"
                hint="Token savings from the caveman plugin. Read-only: Claudrift only reads the plugin's status files."
                htmlFor="show-caveman"
              >
                <Toggle
                  id="show-caveman"
                  checked={prefs.showCavemanBadge}
                  data-testid="show-caveman"
                  onCheckedChange={(v) => void set({ showCavemanBadge: v })}
                />
              </Row>
            </Section>
            <Section id="bypass" title="Permission modes">
              <Row
                label="Allow Bypass mode (dangerous)"
                hint="Adds Bypass to the mode menu. In Bypass every tool call runs without asking, including shell commands and file deletes. Each use still asks you to confirm, and it is never remembered across restarts."
                htmlFor="allow-bypass"
              >
                <Toggle
                  id="allow-bypass"
                  checked={prefs.allowBypassMode}
                  data-testid="allow-bypass"
                  onCheckedChange={(v) => void set({ allowBypassMode: v })}
                />
              </Row>
            </Section>
            <Section id="saver" title="Ultra token saver">
              <Row
                label="Ultra token saver"
                hint="Cuts spend on new chats with the parts below. Chats already running keep their settings. Also switchable from the status bar."
                htmlFor="ultra-saver"
              >
                <Toggle
                  id="ultra-saver"
                  checked={prefs.ultraSaver}
                  data-testid="ultra-saver"
                  onCheckedChange={(v) => void set({ ultraSaver: v })}
                />
              </Row>
              {(
                [
                  ['caveman', 'Terse replies (caveman ultra)', 'Needs the caveman plugin. Sets its mode for the session (choose the style below).'],
                  ['model', 'Cheaper model, low effort, no extended thinking', 'New chats use the model, effort and thinking choices below unless you pick a model for that chat.'],
                  ['compact', 'Compact early', 'Summarizes old turns sooner so long chats stop re-sending a huge history.']
                ] as const
              ).map(([key, label, hint]) => (
                <Row key={key} label={label} hint={hint} htmlFor={`saver-${key}`}>
                  <Toggle
                    id={`saver-${key}`}
                    checked={prefs.ultraSaverParts[key]}
                    disabled={!prefs.ultraSaver}
                    data-testid={`saver-${key}`}
                    onCheckedChange={(v) => void set({ ultraSaverParts: { [key]: v } })}
                  />
                </Row>
              ))}
              <SaverTuning prefs={prefs} set={set} />
            </Section>
            <Section id="chat" title="Conversation">
              <Row
                label="Expand tool cards by default"
                hint="Edit, Read, Bash and other tool calls show their full body. Off keeps them collapsed to one line; click a card to open it."
                htmlFor="tool-cards-expanded"
              >
                <Toggle
                  id="tool-cards-expanded"
                  checked={prefs.toolCardsExpanded}
                  data-testid="tool-cards-expanded"
                  onCheckedChange={(v) => void set({ toolCardsExpanded: v })}
                />
              </Row>
              <Row
                label="Cost alert (USD)"
                hint="Shows a toast once per conversation when its total cost passes this amount. 0 turns it off."
                htmlFor="cost-alert"
              >
                <CostAlertInput value={prefs.costAlertUsd ?? 0} onCommit={(v) => void set({ costAlertUsd: v })} />
              </Row>
            </Section>
            <Section id="chrome" title="Browser testing">
              <Row
                label="Claude in Chrome"
                hint="Starts new sessions with --chrome so Claude can drive your own Chrome (needs the Claude in Chrome extension, logged in). Applies to new sessions only. For an isolated browser, add Playwright from the MCP page instead."
                htmlFor="claude-in-chrome"
              >
                <Toggle
                  id="claude-in-chrome"
                  checked={prefs.claudeInChrome}
                  data-testid="claude-in-chrome"
                  onCheckedChange={(v) => void set({ claudeInChrome: v })}
                />
              </Row>
            </Section>
            <Section id="quit" title="Quit confirmation">
              <Row
                label="Confirm before quitting while work is running"
                hint="Asks first if a session or background agent is busy."
                htmlFor="confirm-quit"
              >
                <Toggle
                  id="confirm-quit"
                  checked={prefs.confirmQuitWhileRunning}
                  data-testid="confirm-quit"
                  onCheckedChange={(v) => void set({ confirmQuitWhileRunning: v })}
                />
              </Row>
            </Section>
          </>
        )}
        <ShellSection />
        {/* Usage limit: the lead mounts <AutoResumeCard /> (features/autoresume, WP14) inside this section. */}
        <section aria-label="Usage limit" data-testid="prefs-usage-limit" className="border-b border-border empty:hidden">
          <AutoResumeCard />
        </section>
        <AboutSection />
      </div>
    </div>
  )
}
