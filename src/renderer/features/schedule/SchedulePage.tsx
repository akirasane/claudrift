import { CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { MAX_SCHEDULE_RUNS, SCHEDULE_MODES, describeWhen } from '@shared/schedule'
import type { ScheduleInput, ScheduleMode, ScheduledTask } from '@shared/schedule'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  Toggle,
  fieldClass,
  toast
} from '@/components/ui'
import { cn } from '@/lib/cn'

const MODE_LABEL: Record<ScheduleMode, string> = {
  default: 'Ask (unattended runs deny anything that needs approval)',
  acceptEdits: 'Accept file edits, deny the rest',
  plan: 'Plan only (read-only)',
  bypassPermissions: 'Bypass (runs everything without asking)'
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const STATUS_STYLE: Record<string, string> = {
  ok: 'text-success',
  error: 'text-danger',
  missed: 'text-warn',
  running: 'text-accent-text'
}

function useTasks(): ScheduledTask[] | undefined {
  const [tasks, setTasks] = React.useState<ScheduledTask[] | undefined>()
  React.useEffect(() => {
    let live = true
    void window.claudrift.schedule.list().then((t) => live && setTasks(t))
    const off = window.claudrift.schedule.onState((t) => live && setTasks(t))
    return () => {
      live = false
      off()
    }
  }, [])
  return tasks
}

const localInput = (ms: number): string => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

interface Draft {
  id?: string
  name: string
  cwd: string
  kind: 'prompt' | 'script'
  prompt: string
  command: string
  followUp: string
  whenType: 'daily' | 'interval' | 'once'
  time: string
  days: number[]
  everyMinutes: string
  at: string
  mode: ScheduleMode
  catchUp: boolean
  enabled: boolean
}

function toDraft(cwd: string, t?: ScheduledTask): Draft {
  const base: Draft = {
    name: '',
    cwd,
    kind: 'prompt',
    prompt: '',
    command: '',
    followUp: '',
    whenType: 'daily',
    time: '09:00',
    days: [],
    everyMinutes: '60',
    at: localInput(Date.now() + 3_600_000),
    mode: 'default',
    catchUp: false,
    enabled: true
  }
  if (!t) return base
  return {
    ...base,
    id: t.id,
    name: t.name,
    cwd: t.cwd,
    enabled: t.enabled,
    catchUp: t.catchUp === true,
    mode: t.permissionMode,
    ...(t.action.kind === 'prompt' ? { kind: 'prompt', prompt: t.action.prompt } : { kind: 'script', command: t.action.command, followUp: t.action.followUpPrompt ?? '' }),
    ...(t.when.type === 'daily'
      ? { whenType: 'daily', time: t.when.time, days: t.when.days }
      : t.when.type === 'interval'
        ? { whenType: 'interval', everyMinutes: String(t.when.everyMinutes) }
        : { whenType: 'once', at: localInput(t.when.at) })
  }
}

function toInput(d: Draft): ScheduleInput {
  return {
    ...(d.id ? { id: d.id } : {}),
    name: d.name,
    enabled: d.enabled,
    cwd: d.cwd,
    permissionMode: d.mode,
    catchUp: d.catchUp,
    action:
      d.kind === 'prompt'
        ? { kind: 'prompt', prompt: d.prompt }
        : { kind: 'script', command: d.command, ...(d.followUp.trim() ? { followUpPrompt: d.followUp } : {}) },
    when:
      d.whenType === 'daily'
        ? { type: 'daily', time: d.time, days: d.days }
        : d.whenType === 'interval'
          ? { type: 'interval', everyMinutes: Math.round(Number(d.everyMinutes)) }
          : { type: 'once', at: new Date(d.at).getTime() }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-sm text-fg-2">
      {label}
      {children}
    </label>
  )
}

function TaskDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }): React.JSX.Element {
  const [d, setD] = React.useState<Draft | null>(draft)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setD(draft), [draft])
  if (!d) return <Dialog open={false} />
  const set = (p: Partial<Draft>): void => setD({ ...d, ...p })
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.claudrift.schedule.save(toInput(d))
      onClose()
    } catch (err) {
      toast.error('Could not save the task', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }
  const ready =
    d.name.trim() && d.cwd.trim() && (d.kind === 'prompt' ? d.prompt.trim() : d.command.trim()) && (d.whenType !== 'interval' || Number(d.everyMinutes) >= 1)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="schedule-dialog" className="max-h-[88vh] w-[560px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d.id ? 'Edit task' : 'New scheduled task'}</DialogTitle>
          <DialogDescription>Runs while Claudrift is open and the PC is awake.</DialogDescription>
        </DialogHeader>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Name">
            <Input data-testid="task-name" value={d.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Project folder">
            <Input mono data-testid="task-cwd" value={d.cwd} onChange={(e) => set({ cwd: e.target.value })} />
          </Field>
          <div role="radiogroup" aria-label="Action" className="flex gap-1">
            {(['prompt', 'script'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={d.kind === k}
                onClick={() => set({ kind: k })}
                className="rounded-md border border-border-strong px-2.5 py-1 text-sm text-fg-2 hover:bg-bg-3 aria-checked:bg-bg-3 aria-checked:text-fg"
              >
                {k === 'prompt' ? 'Send a prompt' : 'Run a script'}
              </button>
            ))}
          </div>
          {d.kind === 'prompt' ? (
            <Field label="Prompt">
              <Textarea data-testid="task-prompt" rows={4} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} />
            </Field>
          ) : (
            <>
              <Field label="Command (runs in the project folder)">
                <Input mono data-testid="task-command" value={d.command} placeholder="npm test" onChange={(e) => set({ command: e.target.value })} />
              </Field>
              <Field label="Then ask Claude (optional). It receives the script output.">
                <Textarea rows={3} value={d.followUp} placeholder="Summarize any failures and fix them." onChange={(e) => set({ followUp: e.target.value })} />
              </Field>
            </>
          )}
          <div className="flex gap-3">
            <Field label="Repeat">
              <select
                data-testid="task-when"
                value={d.whenType}
                className={cn(fieldClass, 'h-[30px] w-36')}
                onChange={(e) => set({ whenType: e.target.value as Draft['whenType'] })}
              >
                <option value="daily">Daily / weekly</option>
                <option value="interval">Every N minutes</option>
                <option value="once">Once</option>
              </select>
            </Field>
            {d.whenType === 'daily' && (
              <Field label="Time">
                <Input data-testid="task-time" type="time" value={d.time} className="w-32" onChange={(e) => set({ time: e.target.value })} />
              </Field>
            )}
            {d.whenType === 'interval' && (
              <Field label="Minutes">
                <Input
                  data-testid="task-every"
                  inputMode="numeric"
                  value={d.everyMinutes}
                  className="w-24"
                  onChange={(e) => set({ everyMinutes: e.target.value.replace(/[^\d]/g, '') })}
                />
              </Field>
            )}
            {d.whenType === 'once' && (
              <Field label="At">
                <Input data-testid="task-at" type="datetime-local" value={d.at} className="w-52" onChange={(e) => set({ at: e.target.value })} />
              </Field>
            )}
          </div>
          {d.whenType === 'daily' && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Days">
              {DAYS.map((name, i) => {
                const on = d.days.includes(i)
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ days: on ? d.days.filter((x) => x !== i) : [...d.days, i] })}
                    className="rounded-md border border-border-strong px-2 py-0.5 text-sm text-fg-2 hover:bg-bg-3 aria-pressed:bg-accent-tint aria-pressed:text-fg"
                  >
                    {name}
                  </button>
                )
              })}
              <span className="ml-1 text-sm text-fg-3">{d.days.length === 0 ? 'Every day' : ''}</span>
            </div>
          )}
          <Field label="Permissions">
            <select
              data-testid="task-mode"
              value={d.mode}
              className={cn(fieldClass, 'h-[30px]')}
              onChange={(e) => set({ mode: e.target.value as ScheduleMode })}
            >
              {SCHEDULE_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          {d.whenType !== 'interval' && (
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input type="checkbox" data-testid="task-catch-up" checked={d.catchUp} onChange={(e) => set({ catchUp: e.target.checked })} />
              Run once if it was missed (app closed or PC asleep at the time)
            </label>
          )}
          {d.mode === 'bypassPermissions' && (
            <p role="note" className="rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn">
              Bypass runs every tool call with no one watching, including shell commands and file deletes. It only works if Bypass mode is allowed in Preferences.
            </p>
          )}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="task-save" disabled={!ready || busy} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const when = (ms?: number): string => (ms ? new Date(ms).toLocaleString() : 'never')

function TaskCard({ t, onEdit }: { t: ScheduledTask; onEdit: () => void }): React.JSX.Element {
  const last = t.runs[0]
  const act = async (fn: () => Promise<unknown>, fail: string): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      toast.error(fail, { description: err instanceof Error ? err.message : String(err) })
    }
  }
  return (
    <li data-testid="schedule-task" className="ccw-fade-in rounded-md border border-border bg-bg-1 p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-medium text-fg">{t.name}</span>
            <span className="shrink-0 rounded-xs bg-bg-3 px-1.5 text-xs text-fg-3">{t.action.kind === 'prompt' ? 'prompt' : 'script'}</span>
            {t.permissionMode === 'bypassPermissions' && <span className="shrink-0 rounded-xs bg-warn-bg px-1.5 text-xs text-warn">bypass</span>}
            {t.action.kind === 'script' && <span className="shrink-0 rounded-xs bg-warn-bg px-1.5 text-xs text-warn">runs a command</span>}
            {t.catchUp && <span className="shrink-0 rounded-xs bg-bg-3 px-1.5 text-xs text-fg-3">catch up</span>}
          </div>
          <div className="truncate text-sm text-fg-3">
            {describeWhen(t.when)} · {t.cwd}
          </div>
          <div className="text-sm text-fg-3">
            {t.enabled && t.nextRunAt ? `Next: ${when(t.nextRunAt)}` : t.enabled ? 'No upcoming run' : 'Off: review it, then switch it on'}
            {last && (
              <>
                {' · Last: '}
                <span className={STATUS_STYLE[last.status]}>{last.status}</span> {when(last.startedAt)}
              </>
            )}
          </div>
        </div>
        <Toggle
          checked={t.enabled}
          aria-label={`${t.enabled ? 'Pause' : 'Enable'} ${t.name}`}
          onCheckedChange={(v) => void act(() => window.claudrift.schedule.setEnabled(t.id, v), 'Could not change the task')}
        />
        <Button size="icon-sm" variant="ghost" aria-label={`Run ${t.name} now`} onClick={() => void act(() => window.claudrift.schedule.run(t.id), 'Could not run the task')}>
          <Play size={13} aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={onEdit}>
          <Pencil size={13} aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => void act(() => window.claudrift.schedule.remove(t.id), 'Could not delete the task')}>
          <Trash2 size={13} aria-hidden />
        </Button>
      </div>
      {last?.summary && <p className="mt-2 line-clamp-2 border-t border-border pt-2 text-sm text-fg-2">{last.summary}</p>}
      {t.runs.length > 1 && (
        <details className="mt-1 text-sm text-fg-3">
          <summary className="cursor-pointer">History ({t.runs.length} of {MAX_SCHEDULE_RUNS})</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {t.runs.map((r) => (
              <li key={r.id} className="truncate">
                <span className={STATUS_STYLE[r.status]}>{r.status}</span> {when(r.startedAt)}
                {r.costUsd !== undefined ? ` · $${r.costUsd.toFixed(2)}` : ''}
                {r.summary ? ` · ${r.summary}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

export function SchedulePage({ cwd }: { cwd?: string | undefined }): React.JSX.Element {
  const tasks = useTasks()
  const [draft, setDraft] = React.useState<Draft | null>(null)
  return (
    <div data-testid="schedule-page" className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto px-6 py-5">
      <header className="flex items-center gap-3">
        <CalendarClock size={18} className="text-accent-text" aria-hidden />
        <h2 className="text-lg font-medium text-fg">Scheduled tasks</h2>
        <Button className="ml-auto" data-testid="schedule-new" onClick={() => setDraft(toDraft(cwd ?? ''))}>
          <Plus size={14} aria-hidden /> New task
        </Button>
      </header>
      <p className="text-sm text-fg-3">
        Tasks run only while Claudrift is open and the PC is awake. Runs are headless: a prompt starts a session you can open from the sidebar, and
        anything that needs approval is denied. You can also ask Claude in a chat to schedule something.
      </p>
      {tasks === undefined ? null : tasks.length === 0 ? (
        <div className="ccw-fade-in flex flex-col items-center gap-1 py-12 text-center text-sm text-fg-3">
          <span>No scheduled tasks yet.</span>
          <span>Try asking in a chat: "every weekday at 9am, summarize yesterday's git commits".</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} t={t} onEdit={() => setDraft(toDraft(cwd ?? '', t))} />
          ))}
        </ul>
      )}
      <TaskDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  )
}
