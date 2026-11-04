import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { RawSessionMessage } from './sdk-history'

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const MAX_CHARS = 60_000
const SUMMARY_TIMEOUT_MS = 90_000

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

/** Plain "User: / Assistant:" transcript (text only, no tool traffic), cut to the head and tail when very long. */
export function transcriptText(msgs: RawSessionMessage[], maxChars = MAX_CHARS): string {
  const lines: string[] = []
  for (const m of msgs) {
    if (m.type !== 'user' && m.type !== 'assistant') continue
    if (m.parent_tool_use_id) continue
    const content = (m.message as { content?: unknown } | null)?.content
    const text = textOf(content).replace(SYSTEM_REMINDER_RE, '').trim()
    if (text) lines.push(`${m.type === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }
  const all = lines.join('\n\n')
  if (all.length <= maxChars) return all
  const head = Math.floor(maxChars * 0.2)
  return `${all.slice(0, head)}\n\n[... middle of the conversation omitted ...]\n\n${all.slice(all.length - (maxChars - head))}`
}

const INSTRUCTIONS =
  'Summarize the conversation below as durable project memory for a future session. Write 5 to 12 short markdown bullets: ' +
  'decisions made, conventions or preferences stated, key files and commands, open problems or next steps. ' +
  'Leave out chit-chat and anything transient. Output only the bullets.'

export type SummarizeFn = (transcript: string, ctx: { cwd: string; claudePath?: string }) => Promise<string>

/** One text-only model call through the SDK. Writes no transcript of its own. */
export const summarizeWithSdk: SummarizeFn = async (transcript, ctx) => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const q = sdk.query({
    prompt: `${INSTRUCTIONS}\n\n<conversation>\n${transcript}\n</conversation>`,
    options: {
      cwd: tmpdir(),
      maxTurns: 1,
      tools: [],
      persistSession: false,
      settingSources: [],
      ...(ctx.claudePath ? { pathToClaudeCodeExecutable: ctx.claudePath } : {})
    }
  })
  let out = ''
  const run = (async (): Promise<string> => {
    for await (const m of q) {
      if (m.type === 'assistant') out += textOf((m.message as { content?: unknown }).content)
      if (m.type === 'result' && m.subtype !== 'success') throw new Error('The summary request failed')
    }
    return out.trim()
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error('The summary request timed out')), SUMMARY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([run, timeout])
  } finally {
    clearTimeout(timer)
    q.close?.()
  }
}

/** Appends a dated section to the project's CLAUDE.md (created when missing). Returns the file path. */
export async function appendSummary(cwd: string, title: string, summary: string, now = new Date()): Promise<string> {
  const file = join(cwd, 'CLAUDE.md')
  let current = ''
  try {
    current = await readFile(file, 'utf8')
  } catch {
    await mkdir(dirname(file), { recursive: true })
  }
  const heading = `## Session summary: ${title.replace(/\s+/g, ' ').slice(0, 100)} (${now.toISOString().slice(0, 10)})`
  const sep = current && !current.endsWith('\n\n') ? (current.endsWith('\n') ? '\n' : '\n\n') : ''
  await writeFile(file, `${current}${sep}${heading}\n\n${summary.trim()}\n`, 'utf8')
  return file
}
