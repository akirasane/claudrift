import { Zap } from 'lucide-react'
import * as React from 'react'
import { DEFAULT_PREFS } from '@shared/app'
import { chipVariants } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useChatStore } from '@/stores/chat-store'

/**
 * Ultra token saver for this chat. A new chat starts from the app default (Preferences / status bar) and can be flipped
 * until its first message; after that the chat keeps what it started with, because the saver is applied at session start.
 */
export function SaverChip({ convId, disabled }: { convId: string; disabled?: boolean }): React.JSX.Element {
  // Plain fetch (no query client): the composer is also rendered without one. Re-read when the window regains focus,
  // which is when the default may have been changed in the status bar or Preferences.
  const [appDefault, setAppDefault] = React.useState(DEFAULT_PREFS.ultraSaver)
  React.useEffect(() => {
    const read = (): void => {
      void Promise.resolve(window.claudrift?.prefs?.get())
        .then((p) => p && setAppDefault(p.ultraSaver))
        .catch(() => {})
    }
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])
  const chosen = useChatStore((s) => s.savers[convId])
  const locked = useChatStore((s) => !!s.convs[convId]?.localId)
  const on = chosen ?? appDefault
  return (
    <button
      type="button"
      data-testid="saver-chip"
      aria-pressed={on}
      disabled={disabled || locked}
      onClick={() => useChatStore.getState().setSaver(convId, !on)}
      title={
        locked
          ? `Token saver is ${on ? 'on' : 'off'} for this chat. It is fixed once the chat has started; start a new chat to change it.`
          : `Token saver ${on ? 'on' : 'off'} for this chat: ${on ? 'terse replies, cheaper model, low effort, earlier compaction' : 'normal behaviour'}. Click to switch.`
      }
      className={cn(
        chipVariants({ variant: on ? 'selected' : 'neutral' }),
        'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from'
      )}
    >
      <Zap size={12} aria-hidden />
      Saver {on ? 'on' : 'off'}
    </button>
  )
}
