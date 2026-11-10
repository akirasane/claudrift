import { z } from 'zod'
import { cronError } from '../../shared/cron'
import { SCHEDULE_MODES, describeWhen } from '../../shared/schedule'
import type { ScheduleInput, ScheduleMode, ScheduleWhen, ScheduledTask } from '../../shared/schedule'

/** The slice of ScheduleService the chat tools need. */
export interface ScheduleApi {
  list(): ScheduledTask[]
  upsert(input: ScheduleInput): ScheduledTask
  remove(id: string): boolean
}

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) })

export const SCHEDULE_SERVER_NAME = 'claudrift-schedule'

/** Turns the flat tool arguments into a ScheduleWhen, or an error message the model can act on. */
export function parseWhen(a: { when_type: 'once' | 'interval' | 'daily' | 'cron'; at?: string; every_minutes?: number; time?: string; days?: number[]; cron?: string }): ScheduleWhen | string {
  if (a.when_type === 'cron') {
    if (!a.cron?.trim()) return 'For when_type "cron", pass `cron` as a 5-field expression (minute hour day-of-month month day-of-week), e.g. "*/15 9-17 * * 1-5".'
    const err = cronError(a.cron)
    return err ?? { type: 'cron', expr: a.cron.trim() }
  }
  if (a.when_type === 'once') {
    const ms = a.at ? new Date(a.at).getTime() : NaN
    if (!Number.isFinite(ms)) return 'For when_type "once", pass `at` as a local date-time like 2026-03-01T14:30.'
    if (ms <= Date.now()) return '`at` is in the past.'
    return { type: 'once', at: ms }
  }
  if (a.when_type === 'interval') {
    if (!a.every_minutes) return 'For when_type "interval", pass `every_minutes`.'
    return { type: 'interval', everyMinutes: a.every_minutes }
  }
  if (!a.time) return 'For when_type "daily", pass `time` as HH:MM (24 hour, local time).'
  return { type: 'daily', time: a.time, days: a.days ?? [] }
}

/**
 * In-process MCP server that lets a chat create, list and delete scheduled tasks. Each call goes through the
 * normal permission prompt, so the user sees the full task before it exists.
 */
/** Modes a chat may give a task. Bypass is only available when the user sets the task up themselves. */
const CHAT_SCHEDULE_MODES = SCHEDULE_MODES.filter((m) => m !== 'bypassPermissions') as unknown as [string, ...string[]]

export async function createScheduleMcpServer(api: ScheduleApi, defaultCwd: string | undefined) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  return createSdkMcpServer({
    name: SCHEDULE_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        'schedule_task',
        'Schedule a prompt to run later in Claudrift, while the app is open (or once at the next start when catch_up is set). Use this when the user asks to run something at a time or on a repeat. The task is created DISABLED: the user reviews it on the Schedule page and switches it on. Tasks made from chat can only run a prompt, never a script, and never in Bypass mode. Tell the user to enable it there.',
        {
          name: z.string().describe('Short title for the task'),
          prompt: z.string().describe('The prompt Claude runs when the task fires'),
          when_type: z.enum(['once', 'interval', 'daily', 'cron']),
          cron: z.string().optional().describe('cron: 5-field expression "minute hour day-of-month month day-of-week" in local time, e.g. "*/15 9-17 * * 1-5"'),
          at: z.string().optional().describe('once: local date-time, e.g. 2026-03-01T14:30'),
          every_minutes: z.number().int().min(1).optional().describe('interval: minutes between runs'),
          time: z.string().optional().describe('daily: local time HH:MM (24 hour)'),
          days: z.array(z.number().int().min(0).max(6)).optional().describe('daily: weekdays, 0 = Sunday. Omit for every day'),
          cwd: z.string().optional().describe(defaultCwd ? "Project folder to run in. Defaults to this chat's folder" : 'Absolute path of the project folder to run in (required: this chat has no project)'),
          catch_up: z.boolean().optional().describe('Run once at the next start or wake-up if a run was missed'),
          permission_mode: z
            .enum(CHAT_SCHEDULE_MODES)
            .optional()
            .describe('Tool permissions for the unattended run. Nobody can approve prompts, so tools that need approval are denied. Default: default')
        },
        async (a) => {
          const when = parseWhen(a)
          if (typeof when === 'string') return text(when, true)
          const cwd = a.cwd ?? defaultCwd
          if (!cwd) return text('Pass the cwd argument: the absolute path of the project folder the task should run in. Ask the user which project.', true)
          try {
            const t = api.upsert({
              name: a.name,
              enabled: false,
              cwd,
              action: { kind: 'prompt', prompt: a.prompt },
              permissionMode: (a.permission_mode ?? 'default') as ScheduleMode,
              when,
              catchUp: a.catch_up === true
            })
            return text('Created "' + t.name + '" (id ' + t.id + '): ' + describeWhen(t.when) + '. It is OFF until the user enables it on the Schedule page.')
          } catch (err) {
            return text(err instanceof Error ? err.message : String(err), true)
          }
        }
      ),
      tool('list_scheduled_tasks', 'List the scheduled tasks in Claudrift.', {}, async () => {
        const tasks = api.list()
        if (!tasks.length) return text('No scheduled tasks.')
        return text(
          tasks
            .map((t) => `${t.id} | ${t.name} | ${describeWhen(t.when)} | ${t.enabled ? 'on' : 'off'} | ${t.action.kind} | ${t.cwd}`)
            .join('\n')
        )
      }),
      tool('delete_scheduled_task', 'Delete a scheduled task by id.', { id: z.string() }, async (a) =>
        api.remove(a.id) ? text('Deleted.') : text('No task with that id.', true)
      )
    ]
  })
}
