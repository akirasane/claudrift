import { Clock, SendHorizontal, X } from 'lucide-react'
import * as React from 'react'
import { Button, Tooltip } from '@/components/ui'
import { useChatStore, type QueuedMessage } from '@/stores/chat-store'

const NO_QUEUE: QueuedMessage[] = []

/** Messages waiting for the running turn to end. Each can be sent now (stops the turn) or dropped. */
export function QueuedMessages({ convId }: { convId: string }): React.JSX.Element | null {
  const queue = useChatStore((s) => s.queues[convId]) ?? NO_QUEUE
  if (queue.length === 0) return null
  return (
    <ul data-testid="queued-messages" aria-label="Queued messages" className="mb-1.5 flex flex-col gap-1">
      {queue.map((m, i) => (
        <li
          key={m.id}
          data-testid="queued-message"
          className="ccw-toast-in flex items-center gap-2 rounded-md border border-border bg-bg-1 px-2.5 py-1.5 text-sm text-fg-2"
        >
          <Clock size={12} className="shrink-0 text-fg-3" aria-hidden />
          <span className="shrink-0 text-xs text-fg-3">{i === 0 ? 'Next' : `#${i + 1}`}</span>
          <span className="min-w-0 flex-1 truncate" title={m.text}>
            {m.text}
            {m.images?.length ? ` (+${m.images.length} image${m.images.length > 1 ? 's' : ''})` : ''}
          </span>
          <Tooltip content="Stop the current turn and send this now">
            <Button
              size="sm"
              variant="secondary"
              aria-label="Send now"
              data-testid="queued-send-now"
              onClick={() => void useChatStore.getState().sendQueuedNow(convId, m.id)}
            >
              <SendHorizontal size={12} aria-hidden /> Send now
            </Button>
          </Tooltip>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove queued message"
            data-testid="queued-remove"
            onClick={() => useChatStore.getState().removeQueued(convId, m.id)}
          >
            <X size={12} aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  )
}
