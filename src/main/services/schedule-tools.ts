import { z } from 'zod'
import { SCHEDULE_MODES, describeWhen } from '../../shared/schedule'
import type { ScheduleInput, ScheduleWhen, ScheduledTask } from '../../shared/schedule'

/** The slice of ScheduleService the chat tools need. */
export interface ScheduleApi {
  list(): ScheduledTask[]
  upsert(input: ScheduleInput): ScheduledTask
  remove(id: string): boolean
}

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) })

export const SCHEDULE_SERVER_NAME = 'claudrift-schedule'

/** Turns the flat tool arguments into a ScheduleWhen, or an error message the model can act on. */
export function parseWhen(a: { when_type: 'once' | 'interval' | 'daily'; at?: string; every_minutes?: number; time?: string; days?: number[] }): ScheduleWhen | string {
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
export async function createScheduleMcpServer(api: ScheduleApi, sessionCwd: string) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  return createSdkMcpServer({
    name: SCHEDULE_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        'schedule_task',
        'Schedule a prompt or a shell script to run later in Claudrift, while the app is open. Use this when the user asks to run something at a time or on a repeat. Pass `prompt` (Claude runs it in a fresh session) or `script` (a shell command; add `follow_up_prompt` to have Claude react to its output).',
        {
          name: z.string().describe('Short title for the task'),
          prompt: z.string().optional().describe('The prompt Claude runs when the task fires'),
          script: z.string().optional().describe('A shell command to run instead of a prompt'),
          follow_up_prompt: z.string().optional().describe('With `script`: sent to Claude together with the script output'),
          when_type: z.enum(['once', 'interval', 'daily']),
          at: z.string().optional().describe('once: local date-time, e.g. 2026-03-01T14:30'),
          every_minutes: z.number().int().min(1).optional().describe('interval: minutes between runs'),
          time: z.string().optional().describe('daily: local time HH:MM (24 hour)'),
          days: z.array(z.number().int().min(0).max(6)).optional().describe('daily: weekdays, 0 = Sunday. Omit for every day'),
          cwd: z.string().optional().describe('Project folder to run in. Defaults to this chat\'s folder'),
          permission_mode: z
            .enum(SCHEDULE_MODES)
            .optional()
            .describe('Tool permissions for the unattended run. Nobody can approve prompts, so tools that need approval are denied. Default: default')
        },
        async (a) => {
          if (!a.prompt === !a.script) return text('Pass exactly one of `prompt` or `script`.', true)
          const when = parseWhen(a)
          if (typeof when === 'string') return text(when, true)
          try {
            const t = api.upsert({
              name: a.name,
              enabled: true,
              cwd: a.cwd ?? sessionCwd,
              action: a.prompt
                ? { kind: 'prompt', prompt: a.prompt }
                : { kind: 'script', command: a.script as string, ...(a.follow_up_prompt ? { followUpPrompt: a.follow_up_prompt } : {}) },
              permissionMode: a.permission_mode ?? 'default',
              when
            })
            return text(`Scheduled "${t.name}" (id ${t.id}): ${describeWhen(t.when)}. Next run: ${t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : 'none'}.`)
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
