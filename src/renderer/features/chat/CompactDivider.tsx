import { Minimize2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ChatItem } from './model/types'

type CompactItem = Extract<ChatItem, { kind: 'compact' }>

const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

/** The SDK reports no progress while compacting, so fill on an easing curve that slows toward (never reaches) 94%. */
export function compactProgress(elapsedMs: number): number {
  return 0.94 * (1 - Math.exp(-elapsedMs / 9000))
}

function CompactProgress(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - start), 100)
    return () => clearInterval(id)
  }, [])
  const pct = Math.round(compactProgress(elapsed) * 100)
  return (
    <div role="status" data-testid="compact-active" className="ccw-fade-in my-1 flex flex-col gap-1.5 text-sm">
      <span className="flex items-center gap-1.5">
        <Minimize2 size={13} className="text-accent-text" aria-hidden />
        <span className="ccw-shimmer-text">Compacting conversation...</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-fg-3">
          {pct}% · {Math.floor(elapsed / 1000)}s
        </span>
      </span>
      <span
        role="progressbar"
        aria-label="Compacting conversation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 w-full overflow-hidden rounded-full bg-bg-3"
      >
        <span
          className="ccw-bar-shine block h-full rounded-full bg-accent-to/70 transition-[width] duration-slow ease-out"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  )
}

/** Marks where the conversation was compacted: a squeezing bar while it runs, then a before / after bar. */
export function CompactDivider({ item }: { item: CompactItem }): React.JSX.Element {
  if (item.active) {
    return <CompactProgress />
  }
  if (item.failed) {
    return (
      <div role="status" data-testid="compact-failed" className="ccw-fade-in my-1 text-sm text-fg-3">
        Compaction failed. The conversation continues as it was.
      </div>
    )
  }
  const pre = item.preTokens ?? 0
  const post = item.postTokens
  const ratio = post !== undefined && pre > 0 ? Math.min(1, Math.max(0.04, post / pre)) : undefined
  return (
    <div role="status" data-testid="compact-done" className="ccw-pop my-1 flex flex-col gap-1.5 text-sm text-fg-2">
      <span className="flex items-center gap-1.5">
        <Minimize2 size={13} className="text-accent-text" aria-hidden />
        <span>
          Context compacted{item.trigger === 'auto' ? ' automatically' : ''}
          {pre > 0 ? `: ${k(pre)}${post !== undefined ? ` → ${k(post)}` : ''} tokens` : ''}
          {ratio !== undefined ? ` (${Math.round((1 - ratio) * 100)}% smaller)` : ''}
        </span>
      </span>
      {ratio !== undefined && (
        <span className="h-1 w-full overflow-hidden rounded-full bg-bg-3" aria-hidden>
          <span className="ccw-shrink block h-full w-full rounded-full bg-accent-to/70" style={{ ['--to' as string]: String(ratio) }} />
        </span>
      )}
    </div>
  )
}
