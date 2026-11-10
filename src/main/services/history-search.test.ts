import { describe, expect, it } from 'vitest'
import {
  findInTranscript,
  HistorySearchService,
  lineText,
  makeSnippet,
  SEARCH_MAX_FILES,
  SEARCH_MAX_HITS
} from './history-search'
import type { HistoryApi, RawSessionInfo } from './sdk-history'

const user = (text: string): string => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const asst = (...blocks: unknown[]): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: blocks } })

async function* gen(lines: string[]): AsyncGenerator<string> {
  for (const l of lines) yield l
}

describe('lineText', () => {
  it('reads user strings and text blocks, assistant text only', () => {
    expect(lineText(user('Hello there'))).toBe('Hello there')
    expect(lineText(asst({ type: 'text', text: 'Answer' }, { type: 'text', text: 'more' }))).toBe('Answer\nmore')
  })
  it('ignores thinking, tool calls, tool results, sidechains, meta and junk', () => {
    expect(lineText(asst({ type: 'thinking', thinking: 'secret' }))).toBeUndefined()
    expect(lineText(asst({ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'secret' } }))).toBeUndefined()
    expect(
      lineText(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'secret' }] } }))
    ).toBeUndefined()
    expect(lineText(JSON.stringify({ type: 'user', isSidechain: true, message: { content: 'secret' } }))).toBeUndefined()
    expect(lineText(user('<system-reminder>secret</system-reminder>'))).toBeUndefined()
    expect(lineText(JSON.stringify({ type: 'summary', summary: 'secret' }))).toBeUndefined()
    expect(lineText('{not json')).toBeUndefined()
  })
})

describe('makeSnippet', () => {
  it('adds ellipses only where text was cut and flattens whitespace', () => {
    expect(makeSnippet('short\ntext', 6, 4)).toBe('short text')
    const long = `${'a '.repeat(100)}NEEDLE${' b'.repeat(100)}`
    const s = makeSnippet(long, long.indexOf('NEEDLE'), 6)
    expect(s.startsWith('...')).toBe(true)
    expect(s.endsWith('...')).toBe(true)
    expect(s).toContain('NEEDLE')
    expect(s.length).toBeLessThan(160)
  })
})

describe('findInTranscript', () => {
  it('matches case-insensitively in user and assistant text, not in tool calls', async () => {
    const lines = [
      asst({ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'grep Banana' } }),
      user('I like BaNaNa bread')
    ]
    expect(await findInTranscript(gen(lines), 'banana')).toContain('BaNaNa bread')
    expect(await findInTranscript(gen([lines[0]!]), 'banana')).toBeUndefined()
  })
  it('finds text that JSON escapes (quotes, newlines)', async () => {
    expect(await findInTranscript(gen([user('say "hi" now')]), '"hi"')).toContain('"hi"')
  })
  it('stops when aborted', async () => {
    const ctl = new AbortController()
    ctl.abort()
    expect(await findInTranscript(gen([user('needle')]), 'needle', ctl.signal)).toBeUndefined()
  })
})

function makeService(sessions: RawSessionInfo[], files: Record<string, string[]>) {
  const read: string[] = []
  const api: HistoryApi = {
    listSessions: async () => sessions,
    getSessionMessages: async () => [],
    deleteSession: async () => {},
    renameSession: async () => {}
  }
  const svc = new HistorySearchService({
    api: async () => api,
    root: () => 'ROOT',
    listDir: async (dir) => (dir === 'ROOT' ? ['p1'] : Object.keys(files).map((id) => `${id}.jsonl`)),
    linesOf: (path) => {
      const id = path.split(/[\\/]/).pop()!.replace('.jsonl', '')
      read.push(id)
      return gen(files[id] ?? [])
    }
  })
  return { svc, read }
}
const info = (id: string, lastModified: number, extra: Partial<RawSessionInfo> = {}): RawSessionInfo => ({
  sessionId: id,
  summary: `sum-${id}`,
  lastModified,
  cwd: 'C:\\proj',
  ...extra
})

describe('HistorySearchService', () => {
  it('returns hits newest first with title, cwd and snippet', async () => {
    const { svc } = makeService([info('old', 1), info('new', 9, { customTitle: 'Custom' }), info('none', 5)], {
      old: [user('the Widget is here')],
      new: [asst({ type: 'text', text: 'a widget answer' })],
      none: [user('nothing')]
    })
    const hits = await svc.search('WIDGET')
    expect(hits.map((h) => h.sessionId)).toEqual(['new', 'old'])
    expect(hits[0]).toMatchObject({ title: 'Custom', cwd: 'C:\\proj', lastModified: 9 })
    expect(hits[1]!.snippet).toContain('Widget')
    expect(hits[1]!.title).toBe('sum-old')
  })

  it('ignores too-short queries and sessions without a transcript or cwd', async () => {
    const { svc, read } = makeService([info('a', 1), info('nocwd', 2, { cwd: undefined })], { a: [user('xx')] })
    expect(await svc.search('x')).toEqual([])
    expect(await svc.search('xx')).toHaveLength(1)
    expect(read).toEqual(['a'])
  })

  it('caps hits at 50 and files scanned at 300', async () => {
    const many = Array.from({ length: 400 }, (_, i) => info(`s${i}`, i))
    const files: Record<string, string[]> = {}
    for (const s of many) files[s.sessionId] = [user('match me')]
    const a = makeService(many, files)
    expect((await a.svc.search('match')).length).toBe(SEARCH_MAX_HITS)
    const none: Record<string, string[]> = {}
    for (const s of many) none[s.sessionId] = [user('other')]
    const b = makeService(many, none)
    expect(await b.svc.search('match')).toEqual([])
    expect(b.read.length).toBe(SEARCH_MAX_FILES)
  })

  it('a newer search cancels the previous one', async () => {
    const { svc } = makeService([info('a', 1)], { a: [user('needle')] })
    const first = svc.search('needle')
    const second = svc.search('needle')
    expect(await first).toEqual([])
    expect(await second).toHaveLength(1)
  })
})
