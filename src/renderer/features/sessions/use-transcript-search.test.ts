import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRANSCRIPT_SEARCH_DEBOUNCE_MS, useTranscriptSearch } from './use-transcript-search'

const hit = (id: string) => ({ sessionId: id, cwd: 'C:\\p', title: id, snippet: 's', lastModified: 1 })
let search: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  search = vi.fn(async ({ query }: { query: string }) => [hit(query)])
  ;(window as unknown as { claudrift: unknown }).claudrift = { history: { search } }
})
afterEach(() => vi.useRealTimers())

describe('useTranscriptSearch', () => {
  it('does nothing below 2 characters', async () => {
    const { result } = renderHook(() => useTranscriptSearch('a'))
    await act(async () => void vi.advanceTimersByTime(1000))
    expect(search).not.toHaveBeenCalled()
    expect(result.current).toEqual({ hits: [], searching: false })
  })

  it('debounces typing into a single request', async () => {
    const { result, rerender } = renderHook(({ q }) => useTranscriptSearch(q), { initialProps: { q: 'ab' } })
    await act(async () => void vi.advanceTimersByTime(TRANSCRIPT_SEARCH_DEBOUNCE_MS - 50))
    rerender({ q: 'abc' })
    expect(result.current.searching).toBe(true)
    await act(async () => void vi.advanceTimersByTime(TRANSCRIPT_SEARCH_DEBOUNCE_MS))
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith({ query: 'abc' })
    expect(result.current.hits.map((h) => h.sessionId)).toEqual(['abc'])
    expect(result.current.searching).toBe(false)
  })

  it('clears hits when the query is emptied', async () => {
    const { result, rerender } = renderHook(({ q }) => useTranscriptSearch(q), { initialProps: { q: 'abc' } })
    await act(async () => void vi.advanceTimersByTime(TRANSCRIPT_SEARCH_DEBOUNCE_MS))
    expect(result.current.hits).toHaveLength(1)
    rerender({ q: '' })
    expect(result.current.hits).toEqual([])
  })
})
