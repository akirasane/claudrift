import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Zap } from 'lucide-react'
import * as React from 'react'
import { DEFAULT_PREFS, type AppPrefs } from '@shared/app'
import { toast, Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'

/** Status bar switch for the ultra token-saver mode. Shares the ['prefs'] query with the Preferences page. */
export function SaverToggle(): React.JSX.Element {
  const qc = useQueryClient()
  const q = useQuery<AppPrefs>({
    queryKey: ['prefs'],
    queryFn: () => window.claudrift.prefs.get(),
    retry: false,
    staleTime: Infinity
  })
  const on = q.data?.ultraSaver ?? DEFAULT_PREFS.ultraSaver
  const toggle = async (): Promise<void> => {
    try {
      const res = await window.claudrift.prefs.set({ ultraSaver: !on })
      qc.setQueryData(['prefs'], res.prefs)
      toast(res.prefs.ultraSaver ? 'Ultra saver is the default for new chats' : 'Ultra saver is off by default', { description: 'Each chat can override it with the Saver chip in its composer. Chats already running keep their setting.' })
    } catch (err) {
      toast.error('Could not change the token saver', { description: err instanceof Error ? err.message : String(err) })
    }
  }
  return (
    <Tooltip
      content={
        <span data-testid="saver-tip">
          Ultra token saver default: {on ? 'on' : 'off'}. This is only the starting choice for new chats; each chat has its own Saver chip. When on, a chat uses terse replies, a cheaper model, low effort, no extended
          thinking, and earlier compaction. Choose the parts in Preferences.
        </span>
      }
    >
      <button
        type="button"
        data-testid="status-saver"
        aria-pressed={on}
        onClick={() => void toggle()}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xs px-1.5 transition-colors duration-fast',
          on ? 'bg-accent-tint text-accent-text' : 'text-fg-3 hover:text-fg-2'
        )}
      >
        <Zap size={11} aria-hidden />
        <span className="font-medium">SAVER</span>
        <span>{on ? 'ON' : 'OFF'}</span>
      </button>
    </Tooltip>
  )
}
