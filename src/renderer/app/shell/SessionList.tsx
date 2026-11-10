import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { HistorySessionInfo } from '@shared/events'
import { Button, Kbd, toast, Tooltip } from '@/components/ui'
import { DeleteSessionDialog } from '@/features/sessions/DeleteSessionDialog'
import { filterSessions, groupByDay } from '@/features/sessions/group'
import { queryKeys, useSessions } from '@/features/sessions/queries'
import { useTranscriptSearch } from '@/features/sessions/use-transcript-search'
import { cn } from '@/lib/cn'
import { stagger } from '@/lib/motion'
import { isBusyConv, useWorkspaceStore } from '@/stores/workspace-store'
import { useChatStore } from '@/stores/chat-store'

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

/** Search box appears once the list is long enough to need it. */
const SEARCH_FROM = 6
const REMOVE_ANIM_MS = 160

export function SessionList({ disabled }: { disabled?: boolean }): React.JSX.Element {
  const qc = useQueryClient()
  const cwd = useWorkspaceStore((s) => s.cwd)
  const activeConvId = useWorkspaceStore((s) => s.activeConvId)
  const openSession = useWorkspaceStore((s) => s.openSession)
  const newSession = useWorkspaceStore((s) => s.newSession)
  const conv = useChatStore((s) => (activeConvId ? s.convs[activeConvId] : undefined))
  const tabs = useWorkspaceStore((s) => s.tabs)
  const convs = useChatStore((s) => s.convs)
  const openIds = new Set(tabs.map((t) => t.sessionId).filter((x): x is string => !!x))
  const { data: sessions, isLoading, error } = useSessions(cwd)

  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<HistorySessionInfo | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [leaving, setLeaving] = useState<Set<string>>(new Set())

  // Refetch after each result so new / updated sessions appear.
  const lastResult = conv?.lastResult
  useEffect(() => {
    if (lastResult && cwd) void qc.invalidateQueries({ queryKey: queryKeys.sessions(cwd) })
  }, [lastResult, cwd, qc])

  const activeSessionId = conv?.meta.sessionId ?? conv?.resumeSessionId
  const filtered = useMemo(() => filterSessions(sessions ?? [], query), [sessions, query])
  const groups = useMemo(() => groupByDay(filtered), [filtered])
  const transcript = useTranscriptSearch(query)
  const showSearch = (sessions?.length ?? 0) >= SEARCH_FROM || query !== ''

  const busyReason = (s: HistorySessionInfo): string | undefined => {
    const tab = tabs.find((t) => t.sessionId === s.sessionId)
    const c = tab ? convs[tab.convId] : undefined
    return c && isBusyConv(c) ? 'Stop this session before deleting it' : undefined
  }

  const refresh = (): Promise<void> => (cwd ? qc.invalidateQueries({ queryKey: queryKeys.sessions(cwd) }) : Promise.resolve())

  const afterDelete = (s: HistorySessionInfo): void => {
    setDeleting(null)
    setLeaving((p) => new Set(p).add(s.sessionId))
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.sessionId === s.sessionId)
    if (tab) void useWorkspaceStore.getState().closeTab(tab.convId)
    toast('Session deleted')
    setTimeout(() => {
      void refresh()
      setLeaving((p) => {
        const n = new Set(p)
        n.delete(s.sessionId)
        return n
      })
    }, REMOVE_ANIM_MS)
  }

  const commitRename = async (s: HistorySessionInfo): Promise<void> => {
    const title = draft.trim()
    setRenaming(null)
    if (!title || title === s.title) return
    try {
      await window.claudrift.history.rename({ sessionId: s.sessionId, title, cwd: s.cwd })
      await refresh()
    } catch (err) {
      toast.error('Could not rename', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  let index = 0
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border" data-testid="session-list">
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-2">
        <Button variant="secondary" className="min-w-0 flex-1" disabled={disabled || !cwd} onClick={newSession}>
          <Plus size={14} aria-hidden /> New session
        </Button>
      </div>
      {showSearch && (
        <div className="relative px-2 pb-1.5">
          <Search size={12} className="pointer-events-none absolute left-4 top-1/2 -translate-y-[60%] text-fg-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Search sessions"
            aria-label="Search sessions"
            data-testid="session-search"
            className="h-7 w-full rounded-sm border border-border bg-bg-2 pl-7 pr-6 text-sm text-fg placeholder:text-fg-muted transition-colors duration-fast focus:border-accent-from focus:outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-[60%] rounded-xs p-0.5 text-fg-3 hover:text-fg"
            >
              <X size={11} aria-hidden />
            </button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {cwd && isLoading && <p className="px-2 py-1 text-sm text-fg-3">Loading sessions...</p>}
        {error != null && <p className="px-2 py-1 text-sm text-danger">Could not load sessions</p>}
        {sessions && sessions.length === 0 && (
          <div className="ccw-fade-in flex flex-col items-center gap-1 px-3 py-6 text-center text-sm text-fg-3">
            <span>No past sessions yet.</span>
            <span>
              Press <Kbd>Enter</Kbd> in the composer to start one.
            </span>
          </div>
        )}
        {sessions && sessions.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-3 text-center text-sm text-fg-3">No sessions match "{query}"</p>
        )}
        {query.trim().length >= 2 && (
          <section aria-label="Matches in conversations" data-testid="transcript-hits" className="mb-1.5">
            <h3 className="sticky top-0 z-[1] bg-bg-1 px-2 pb-0.5 pt-1.5 text-xs font-medium uppercase tracking-wide text-fg-3">
              In conversations
            </h3>
            {transcript.searching && <p className="px-2 py-1 text-sm text-fg-3">Searching...</p>}
            {!transcript.searching && transcript.hits.length === 0 && (
              <p className="px-2 py-1 text-sm text-fg-3">No matches in saved conversations</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {transcript.hits.map((h) => (
                <li key={h.sessionId}>
                  <button
                    type="button"
                    disabled={disabled}
                    data-testid="transcript-hit"
                    onClick={() => void openSession({ sessionId: h.sessionId, title: h.title, cwd: h.cwd, lastModified: h.lastModified })}
                    className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left transition-colors duration-fast hover:bg-bg-3 focus-visible:bg-bg-3 disabled:opacity-45"
                  >
                    <span className="truncate text-base text-fg">{h.title}</span>
                    <span className="line-clamp-2 break-words text-xs text-fg-3">{h.snippet}</span>
                    <span className="truncate text-xs text-fg-3">
                      {h.cwd.split(/[\\/]/).filter(Boolean).pop() ?? h.cwd} · {relativeTime(h.lastModified)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label} className="mb-1.5">
            <h3 className="sticky top-0 z-[1] bg-bg-1 px-2 pb-0.5 pt-1.5 text-xs font-medium uppercase tracking-wide text-fg-3">{g.label}</h3>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((s) => {
                const i = index++
                const active = activeSessionId === s.sessionId
                const reason = busyReason(s)
                return (
                  <li
                    key={s.sessionId}
                    data-testid="session-row"
                    className={cn(
                      'group/row relative',
                      leaving.has(s.sessionId) ? 'ccw-slide-out' : i < stagger.maxItems ? 'ccw-fade-in' : undefined
                    )}
                    style={i < stagger.maxItems && !leaving.has(s.sessionId) ? { animationDelay: `${i * stagger.step}ms` } : undefined}
                  >
                    {renaming === s.sessionId ? (
                      <input
                        autoFocus
                        value={draft}
                        aria-label="Session title"
                        maxLength={200}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => void commitRename(s)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(s)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className="h-[42px] w-full rounded-sm border border-accent-from bg-bg-2 px-2 text-base text-fg focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-current={active || undefined}
                        onClick={() => void openSession(s)}
                        onKeyDown={(e) => {
                          if (e.key === 'Delete' && !reason) setDeleting(s)
                        }}
                        className={cn(
                          'flex w-full flex-col rounded-sm px-2 py-1.5 pr-14 text-left transition-colors duration-fast hover:bg-bg-3 focus-visible:bg-bg-3 disabled:opacity-45',
                          active && 'bg-accent-tint'
                        )}
                      >
                        <span className="flex items-center gap-1.5 truncate text-base text-fg">
                          {openIds.has(s.sessionId) && (
                            <span
                              data-testid="open-dot"
                              title="Open in a tab"
                              aria-label="Open in a tab"
                              role="img"
                              className={cn('size-1.5 shrink-0 rounded-full bg-accent-to', active && 'ccw-pop')}
                            />
                          )}
                          <span className="truncate">{s.title}</span>
                        </span>
                        <span className="truncate text-xs text-fg-3">
                          {relativeTime(s.lastModified)}
                          {s.gitBranch ? ` · ${s.gitBranch}` : ''}
                        </span>
                      </button>
                    )}
                    {renaming !== s.sessionId && !disabled && (
                      <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity duration-fast focus-within:opacity-100 group-hover/row:opacity-100">
                        <Tooltip content="Rename">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Rename ${s.title}`}
                            onClick={() => {
                              setDraft(s.title)
                              setRenaming(s.sessionId)
                            }}
                          >
                            <Pencil size={12} aria-hidden />
                          </Button>
                        </Tooltip>
                        <Tooltip content={reason ?? 'Delete (optionally saving a summary to memory)'}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Delete ${s.title}`}
                            disabled={!!reason}
                            onClick={() => setDeleting(s)}
                          >
                            <Trash2 size={12} aria-hidden />
                          </Button>
                        </Tooltip>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      <DeleteSessionDialog session={deleting} onClose={() => setDeleting(null)} onDeleted={afterDelete} />
    </div>
  )
}
