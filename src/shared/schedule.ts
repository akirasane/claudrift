import { z } from 'zod'

// Scheduled tasks: a prompt or a script that runs at a set time while the app is open.

export const SCHEDULE_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
export type ScheduleMode = (typeof SCHEDULE_MODES)[number]

export const MAX_SCHEDULE_RUNS = 20
export const MIN_INTERVAL_MINUTES = 1

export type ScheduleWhen =
  | { type: 'once'; at: number }
  | { type: 'interval'; everyMinutes: number }
  /** `time` is local "HH:MM". `days` are 0 (Sunday) to 6; empty means every day. */
  | { type: 'daily'; time: string; days: number[] }

export type ScheduleAction =
  | { kind: 'prompt'; prompt: string }
  /** Runs `command` in a shell in the task's folder. With `followUpPrompt`, Claude then gets that prompt plus the output. */
  | { kind: 'script'; command: string; followUpPrompt?: string }

export interface ScheduleRun {
  id: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'ok' | 'error' | 'missed'
  /** Short result or error text. Shown in the Schedule page only. */
  summary?: string
  /** SDK session id, so the run can be opened from the sidebar. */
  sessionId?: string
  costUsd?: number
}

export interface ScheduledTask {
  id: string
  name: string
  enabled: boolean
  cwd: string
  action: ScheduleAction
  permissionMode: ScheduleMode
  when: ScheduleWhen
  /** Run once at the next start / wake-up when a run was missed while the app was closed or the PC asleep. */
  catchUp?: boolean
  createdAt: number
  lastRunAt?: number
  nextRunAt?: number
  runs: ScheduleRun[]
}

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM')

export const ScheduleWhenSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('once'), at: z.number().int().positive() }),
  z.object({ type: z.literal('interval'), everyMinutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(60 * 24 * 30) }),
  z.object({ type: z.literal('daily'), time: Time, days: z.array(z.number().int().min(0).max(6)).max(7) })
])

export const ScheduleActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), prompt: z.string().trim().min(1).max(20_000) }),
  z.object({
    kind: z.literal('script'),
    command: z.string().trim().min(1).max(4_000),
    followUpPrompt: z.string().trim().max(20_000).optional()
  })
])

/** What a user (or Claude, through the chat tool) supplies to create or edit a task. */
export const ScheduleInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  cwd: z.string().min(1),
  action: ScheduleActionSchema,
  permissionMode: z.enum(SCHEDULE_MODES).default('default'),
  when: ScheduleWhenSchema,
  catchUp: z.boolean().default(false)
})
export type ScheduleInput = z.input<typeof ScheduleInputSchema>

export const ScheduleIdSchema = z.object({ id: z.string().min(1) })
export const ScheduleEnabledSchema = z.object({ id: z.string().min(1), enabled: z.boolean() })

/** The next time `when` fires after `from`, or undefined when it never will again. `lastRunAt` and `createdAt` anchor intervals. */
export function nextRunAfter(
  when: ScheduleWhen,
  from: number,
  anchors: { lastRunAt?: number; createdAt: number }
): number | undefined {
  switch (when.type) {
    case 'once':
      return when.at > from ? when.at : undefined
    case 'interval': {
      const base = anchors.lastRunAt ?? anchors.createdAt
      return Math.max(base + when.everyMinutes * 60_000, from + 1000)
    }
    case 'daily': {
      const [h, m] = when.time.split(':').map(Number) as [number, number]
      const days = when.days.length ? when.days : [0, 1, 2, 3, 4, 5, 6]
      const start = new Date(from)
      for (let i = 0; i <= 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, h, m, 0, 0)
        if (d.getTime() > from && days.includes(d.getDay())) return d.getTime()
      }
      return undefined
    }
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function describeWhen(when: ScheduleWhen): string {
  switch (when.type) {
    case 'once':
      return `Once, ${new Date(when.at).toLocaleString()}`
    case 'interval':
      return when.everyMinutes % 60 === 0
        ? `Every ${when.everyMinutes / 60 === 1 ? 'hour' : `${when.everyMinutes / 60} hours`}`
        : `Every ${when.everyMinutes} min`
    case 'daily':
      return when.days.length && when.days.length < 7
        ? `${[...when.days].sort().map((d) => DAY_NAMES[d]).join(', ')} at ${when.time}`
        : `Daily at ${when.time}`
  }
}
