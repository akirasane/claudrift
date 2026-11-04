import { Minimize2 } from 'lucide-react'
import type { ChatItem } from './model/types'

type CompactItem = Extract<ChatItem, { kind: 'compact' }>

const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

/** Marks where the conversation was compacted: a squeezing bar while it runs, then a before / after bar. */
export function CompactDivider({ item }: { item: CompactItem }): React.JSX.Element {
  if (item.active) {
    return (
      <div role="status" data-testid="compact-active" className="ccw-fade-in my-1 flex flex-col gap-1.5 text-sm">
        <span className="flex items-center gap-1.5">
          <Minimize2 size={13} className="text-accent-text" aria-hidden />
          <span className="ccw-shimmer-text">Compacting conversation...</span>
        </span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-bg-3">
          <span className="ccw-squeeze block h-full w-full rounded-full bg-accent-to/60" />
        </span>
      </div>
    )
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
