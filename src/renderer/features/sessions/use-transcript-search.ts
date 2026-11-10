import { useEffect, useState } from 'react'
import type { HistorySearchHit } from '@shared/events'

export const TRANSCRIPT_SEARCH_DEBOUNCE_MS = 350
export const TRANSCRIPT_SEARCH_MIN_CHARS = 2

export interface TranscriptSearchState {
  hits: HistorySearchHit[]
  searching: boolean
}

/** Debounced full-text search over saved transcripts; stale responses are dropped. */
export function useTranscriptSearch(query: string): TranscriptSearchState {
  const q = query.trim()
  const enabled = q.length >= TRANSCRIPT_SEARCH_MIN_CHARS
  const [state, setState] = useState<{ q: string; hits: HistorySearchHit[] }>({ q: '', hits: [] })

  useEffect(() => {
    if (!enabled) {
      setState((s) => (s.hits.length || s.q ? { q: '', hits: [] } : s))
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      const api = window.claudrift?.history
      if (!api?.search) return
      api
        .search({ query: q })
        .then((hits) => {
          if (!stale) setState({ q, hits })
        })
        .catch(() => {
          if (!stale) setState({ q, hits: [] })
        })
    }, TRANSCRIPT_SEARCH_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [q, enabled])

  if (!enabled) return { hits: [], searching: false }
  return { hits: state.q === q ? state.hits : [], searching: state.q !== q }
}
