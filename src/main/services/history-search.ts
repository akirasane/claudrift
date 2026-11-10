import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { HistorySearchHit } from '../../shared/events'
import { transcriptsRoot } from '../paths'
import { loadSdkHistory, userPromptText, type HistoryApi, type RawSessionInfo } from './sdk-history'

export const SEARCH_MAX_HITS = 50
export const SEARCH_MAX_FILES = 300
/** Per file: stop reading after this many bytes (a runaway transcript must not stall a search). */
export const SEARCH_MAX_BYTES_PER_FILE = 20 * 1024 * 1024
const SNIPPET_RADIUS = 60

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

/** User prompt or assistant text of one transcript line; tool calls, tool results, thinking and sidechains give undefined. */
export function lineText(line: string): string | undefined {
  let obj: Record<string, unknown> | undefined
  try {
    obj = asRecord(JSON.parse(line))
  } catch {
    return undefined
  }
  if (!obj || obj['isSidechain'] === true) return undefined
  const type = obj['type']
  if (type !== 'user' && type !== 'assistant') return undefined
  const content = asRecord(obj['message'])?.['content']
  let text: string
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    text = content
      .map((b) => asRecord(b))
      .filter((b) => b?.['type'] === 'text' && typeof b['text'] === 'string')
      .map((b) => String(b?.['text']))
      .join('\n')
  } else return undefined
  if (type === 'user') return userPromptText(text)
  return text.trim() || undefined
}

/** A one-line excerpt around the match. `index` is the match start in `text`. */
export function makeSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '...' : ''}${body}${end < text.length ? '...' : ''}`
}

/** First user/assistant text in the stream that contains `needle` (already lower-case), or undefined. */
export async function findInTranscript(
  lines: AsyncIterable<string>,
  needle: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  // A plain needle appears verbatim in the raw JSON line, so non-matching lines skip the JSON parse.
  const plain = /^[\x20-\x7e]*$/.test(needle) && !/["\\]/.test(needle)
  for await (const line of lines) {
    if (signal?.aborted) return undefined
    if (plain && !line.toLowerCase().includes(needle)) continue
    const text = lineText(line)
    if (!text) continue
    const i = text.toLowerCase().indexOf(needle)
    if (i >= 0) return makeSnippet(text, i, needle.length)
  }
  return undefined
}

function fileLines(path: string): AsyncIterable<string> {
  const stream = createReadStream(path, { encoding: 'utf8', start: 0, end: SEARCH_MAX_BYTES_PER_FILE })
  return createInterface({ input: stream, crlfDelay: Infinity })
}

export interface HistorySearchDeps {
  api?: () => Promise<HistoryApi>
  root?: () => string
  linesOf?: (path: string) => AsyncIterable<string>
  listDir?: (dir: string) => Promise<string[]>
}

const listNames = (dir: string): Promise<string[]> => readdir(dir).catch(() => [])

/**
 * Case-insensitive substring search over saved transcripts (newest sessions first), stream-read.
 * Bounded by SEARCH_MAX_FILES files and SEARCH_MAX_HITS hits per request. A new search aborts the previous one.
 */
export class HistorySearchService {
  private apiP?: Promise<HistoryApi>
  private current?: AbortController
  private readonly getApi: () => Promise<HistoryApi>
  private readonly root: () => string
  private readonly linesOf: (path: string) => AsyncIterable<string>
  private readonly listDir: (dir: string) => Promise<string[]>

  constructor(deps: HistorySearchDeps = {}) {
    const loader = deps.api ?? loadSdkHistory
    this.getApi = () => (this.apiP ??= loader())
    this.root = deps.root ?? (() => transcriptsRoot())
    this.linesOf = deps.linesOf ?? fileLines
    this.listDir = deps.listDir ?? listNames
  }

  cancel(): void {
    this.current?.abort()
    this.current = undefined
  }

  async search(query: string): Promise<HistorySearchHit[]> {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    this.cancel()
    const ctl = new AbortController()
    this.current = ctl
    const { signal } = ctl
    try {
      const api = await this.getApi()
      const sessions = (await api.listSessions())
        .filter((s): s is RawSessionInfo & { cwd: string } => !!s.cwd)
        .sort((a, b) => b.lastModified - a.lastModified)
      if (signal.aborted) return []
      const paths = await this.transcriptPaths(signal)
      const hits: HistorySearchHit[] = []
      let scanned = 0
      for (const s of sessions) {
        if (signal.aborted || hits.length >= SEARCH_MAX_HITS || scanned >= SEARCH_MAX_FILES) break
        const path = paths.get(s.sessionId)
        if (!path) continue
        scanned++
        let snippet: string | undefined
        try {
          snippet = await findInTranscript(this.linesOf(path), needle, signal)
        } catch {
          continue
        }
        if (snippet) {
          hits.push({
            sessionId: s.sessionId,
            cwd: s.cwd,
            title: s.customTitle || s.summary || s.firstPrompt || s.sessionId,
            snippet,
            lastModified: s.lastModified
          })
        }
      }
      return signal.aborted ? [] : hits
    } finally {
      if (this.current === ctl) this.current = undefined
    }
  }

  /** sessionId -> transcript path, from one directory listing per project folder (no per-file stat). */
  private async transcriptPaths(signal: AbortSignal): Promise<Map<string, string>> {
    const root = this.root()
    const out = new Map<string, string>()
    for (const dir of await this.listDir(root)) {
      if (signal.aborted) break
      const full = join(root, dir)
      for (const name of await this.listDir(full)) {
        if (name.endsWith('.jsonl')) out.set(name.slice(0, -'.jsonl'.length), join(full, name))
      }
    }
    return out
  }
}
