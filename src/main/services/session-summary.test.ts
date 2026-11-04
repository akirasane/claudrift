import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryService } from './history-service'
import type { HistoryApi, RawSessionMessage } from './sdk-history'
import { appendSummary, transcriptText } from './session-summary'

const msg = (type: 'user' | 'assistant', content: unknown, parent: string | null = null): RawSessionMessage => ({
  type,
  uuid: Math.random().toString(),
  session_id: 's',
  message: { content },
  parent_tool_use_id: parent
})

describe('transcriptText', () => {
  it('keeps text turns only: no tool blocks, subagent turns or system reminders', () => {
    const out = transcriptText([
      msg('user', 'fix the bug <system-reminder>hidden</system-reminder>'),
      msg('assistant', [{ type: 'text', text: 'on it' }, { type: 'tool_use', name: 'Bash' }]),
      msg('assistant', [{ type: 'text', text: 'subagent chatter' }], 'toolu_1'),
      msg('user', [{ type: 'tool_result', content: 'x' }])
    ])
    expect(out).toBe('User: fix the bug\n\nAssistant: on it')
  })
  it('cuts the middle of very long transcripts', () => {
    const out = transcriptText([msg('user', 'a'.repeat(500)), msg('assistant', 'b'.repeat(500))], 300)
    expect(out).toContain('middle of the conversation omitted')
    expect(out.length).toBeLessThan(400)
  })
})

describe('appendSummary', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })
  it('creates CLAUDE.md, then appends a second dated section without touching the first', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccw-sum-'))
    const f = await appendSummary(dir, 'First chat', '- a', new Date('2026-01-02T00:00:00Z'))
    expect(f).toBe(join(dir, 'CLAUDE.md'))
    await appendSummary(dir, 'Second', '- b', new Date('2026-01-03T00:00:00Z'))
    const text = await readFile(f, 'utf8')
    expect(text).toBe('## Session summary: First chat (2026-01-02)\n\n- a\n\n## Session summary: Second (2026-01-03)\n\n- b\n')
  })
  it('keeps existing memory text', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccw-sum-'))
    await writeFile(join(dir, 'CLAUDE.md'), '# Mine\nrules\n')
    await appendSummary(dir, 't', '- x', new Date('2026-01-02T00:00:00Z'))
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8').then((s) => s.startsWith('# Mine\nrules\n\n## Session summary'))).toBe(true)
  })
})

describe('HistoryService delete / summarize', () => {
  const api = (msgs: RawSessionMessage[]): HistoryApi & { deleteSession: ReturnType<typeof vi.fn> } => ({
    listSessions: vi.fn(async () => []),
    getSessionMessages: vi.fn(async () => msgs),
    deleteSession: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {})
  })
  it('delete passes the project dir to the SDK', async () => {
    const a = api([])
    await new HistoryService({ api: async () => a }).delete('s1', 'C:\p')
    expect(a.deleteSession).toHaveBeenCalledWith('s1', { dir: 'C:\p' })
  })
  it('summarize feeds the text transcript to the summarizer and refuses an empty session', async () => {
    const summarize = vi.fn(async () => '- bullet')
    const svc = new HistoryService({ api: async () => api([msg('user', 'hello')]), summarize, claudePath: () => 'claude.exe' })
    expect(await svc.summarize('s1', 'C:\p')).toBe('- bullet')
    expect(summarize).toHaveBeenCalledWith('User: hello', { cwd: 'C:\p', claudePath: 'claude.exe' })
    const empty = new HistoryService({ api: async () => api([]), summarize })
    await expect(empty.summarize('s1', 'C:\p')).rejects.toThrow(/no conversation text/)
  })
})
