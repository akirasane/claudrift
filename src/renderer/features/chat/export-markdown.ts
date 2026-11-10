import type { ConvState } from './model/types'
import { argSummary } from './tools/tool-format'

export interface ExportInfo {
  title: string
  cwd: string
  model?: string
  exportedAt: Date
}

const MAX_TOOL_ARG = 120

function toolLine(name: string, input: unknown): string {
  const arg = argSummary(name, input).replace(/\s+/g, ' ').trim()
  const short = arg.length > MAX_TOOL_ARG ? `${arg.slice(0, MAX_TOOL_ARG - 3)}...` : arg
  return short ? `- Tool: \`${name}\` \`${short.replace(/`/g, "'")}\`` : `- Tool: \`${name}\``
}

/** The visible conversation as Markdown: user and assistant text, one line per tool call, no thinking. */
export function conversationToMarkdown(conv: Pick<ConvState, 'items' | 'tools'>, info: ExportInfo): string {
  const out: string[] = [`# ${info.title.replace(/\s+/g, ' ').trim() || 'Conversation'}`, '']
  const meta = [`Project: \`${info.cwd}\``]
  if (info.model) meta.push(`Model: ${info.model}`)
  meta.push(`Exported: ${info.exportedAt.toISOString()}`)
  out.push(meta.join('  \n'), '')

  let toolRun: string[] = []
  const flushTools = (): void => {
    if (toolRun.length) out.push(toolRun.join('\n'), '')
    toolRun = []
  }

  for (const item of conv.items) {
    if (item.kind === 'user') {
      flushTools()
      const images = item.images?.length ? `\n\n_${item.images.length} image${item.images.length === 1 ? '' : 's'} attached_` : ''
      out.push('## User', '', `${item.text.trim()}${images}`, '')
    } else if (item.kind === 'assistant') {
      if (item.parentToolUseId) continue
      const text = item.parts
        .flatMap((p) => (p.kind === 'text' && p.text.trim() ? [p.text.trim()] : []))
        .join('\n\n')
      if (!text) continue
      flushTools()
      out.push('## Assistant', '', text, '')
    } else if (item.kind === 'tool') {
      if (item.parentToolUseId) continue
      const t = conv.tools[item.toolUseId]
      if (t) toolRun.push(toolLine(t.name, t.input))
    } else if (item.kind === 'error') {
      flushTools()
      out.push(`> Error: ${item.message.replace(/\s+/g, ' ').trim()}`, '')
    }
  }
  flushTools()
  return `${out.join('\n').trimEnd()}\n`
}
