import { describe, expect, it } from 'vitest'
import { conversationToMarkdown } from './export-markdown'
import type { ChatItem, ToolCallView } from './model/types'

const info = { title: 'Fix bug', cwd: 'C:\\proj', model: 'sonnet', exportedAt: new Date('2026-01-02T03:04:05.000Z') }
const tool = (id: string, name: string, input: unknown): ToolCallView => ({ toolUseId: id, name, input, status: 'done' })

describe('conversationToMarkdown', () => {
  it('renders header, user and assistant text, and short tool lines without thinking', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u1', text: 'Please fix it' },
      {
        kind: 'assistant',
        id: 'a1',
        msgId: 'm1',
        streaming: false,
        parts: [
          { kind: 'thinking', text: 'SECRET THOUGHT' },
          { kind: 'text', text: 'Looking now.' }
        ]
      },
      { kind: 'tool', id: 't1', toolUseId: 'x1' },
      { kind: 'tool', id: 't2', toolUseId: 'x2' },
      { kind: 'assistant', id: 'a2', msgId: 'm2', streaming: false, parts: [{ kind: 'text', text: 'Done.' }] }
    ]
    const tools = {
      x1: tool('x1', 'Read', { file_path: 'src/a.ts' }),
      x2: tool('x2', 'Bash', { command: 'npm test\nsecond line' })
    }
    const md = conversationToMarkdown({ items, tools }, info)
    expect(md).toBe(
      [
        '# Fix bug',
        '',
        'Project: `C:\\proj`  ',
        'Model: sonnet  ',
        'Exported: 2026-01-02T03:04:05.000Z',
        '',
        '## User',
        '',
        'Please fix it',
        '',
        '## Assistant',
        '',
        'Looking now.',
        '',
        '- Tool: `Read` `src/a.ts`',
        '- Tool: `Bash` `npm test`',
        '',
        '## Assistant',
        '',
        'Done.',
        ''
      ].join('\n')
    )
    expect(md).not.toContain('SECRET')
  })

  it('skips subagent items and empty assistant turns, truncates long tool args, keeps errors', () => {
    const items: ChatItem[] = [
      { kind: 'assistant', id: 'a1', msgId: 'm1', streaming: false, parts: [{ kind: 'thinking', text: 'only thinking' }] },
      { kind: 'assistant', id: 'a2', msgId: 'm2', streaming: false, parts: [{ kind: 'text', text: 'sub' }], parentToolUseId: 'p' },
      { kind: 'tool', id: 't1', toolUseId: 'x1', parentToolUseId: 'p' },
      { kind: 'tool', id: 't2', toolUseId: 'x2' },
      { kind: 'error', id: 'e1', message: 'boom\nbad' }
    ]
    const tools = { x1: tool('x1', 'Read', { file_path: 'nested' }), x2: tool('x2', 'Grep', { pattern: 'a'.repeat(300) }) }
    const md = conversationToMarkdown({ items, tools }, { ...info, title: '', model: undefined })
    expect(md.startsWith('# Conversation\n')).toBe(true)
    expect(md).not.toContain('Model:')
    expect(md).not.toContain('nested')
    expect(md).not.toContain('sub')
    expect(md).not.toContain('only thinking')
    expect(md).toContain(`\`Grep\` \`${'a'.repeat(117)}...\``)
    expect(md).toContain('> Error: boom bad')
    expect(md.endsWith('\n')).toBe(true)
  })
})
