import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui'
import { selectIsRunning } from '@/features/chat/model/selectors'
import { useChatStore } from '@/stores/chat-store'
import { useUpdateState } from './use-update-state'

const DISMISS_KEY = 'claudrift.update.dismissed'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

/**
 * Update notice. While downloading it is a strip under the title bar. When the update is ready it opens as a
 * modal in the middle of the app; collapsing the modal ("Later" or the close button) drops back to the strip,
 * which keeps the Restart button. Dismissing the strip hides the notice for that version.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const state = useUpdateState()
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  /** Version whose modal the user collapsed this run. A newer version opens the modal again. */
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null)
  const busy = useChatStore((s) => Object.values(s.convs).some((c) => selectIsRunning(c)))
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (state.kind !== 'ready') setInstalling(false)
  }, [state.kind])

  if (state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'ready') return null
  if (dismissed === state.version) return null

  const dismiss = (): void => {
    setDismissed(state.version)
    try {
      localStorage.setItem(DISMISS_KEY, state.version)
    } catch {
      /* per-viewer convenience only */
    }
  }
  const install = (): void => {
    setInstalling(true)
    void window.claudrift.update.install().catch(() => setInstalling(false))
  }
  const runningNote = busy ? 'Sessions are running; you will be asked before they stop.' : ''

  if (state.kind === 'ready' && collapsedFor !== state.version) {
    return (
      <Dialog open onOpenChange={(open) => !open && setCollapsedFor(state.version)}>
        <DialogContent data-testid="update-modal">
          <DialogHeader>
            <DialogTitle>Update v{state.version} is ready</DialogTitle>
            <DialogDescription>
              Restart Claudrift to finish installing it. {runningNote} Choose Later to keep working; the update stays in the bar at the top.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" data-testid="update-modal-later" onClick={() => setCollapsedFor(state.version)}>
              Later
            </Button>
            <Button variant="primary" disabled={installing} onClick={install} data-testid="update-banner-install">
              Restart to update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const text =
    state.kind === 'ready'
      ? `Update v${state.version} is ready`
      : state.kind === 'downloading'
        ? `Update v${state.version} downloading ${state.percent}%`
        : `Update v${state.version} found`

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="flex h-8 shrink-0 items-center gap-3 border-b border-info-border bg-info-bg px-3 text-sm text-fg-2"
    >
      <Download size={13} className="shrink-0 text-info" aria-hidden />
      <span data-testid="update-banner-text" className="min-w-0 truncate">
        {text}
        {state.kind === 'ready' && busy && ' (sessions are running; you will be asked before they stop)'}
      </span>
      {state.kind === 'ready' && (
        <Button size="sm" variant="primary" disabled={installing} onClick={install} data-testid="update-banner-install">
          Restart to update
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        className="ml-auto"
        aria-label="Dismiss update notice"
        data-testid="update-banner-dismiss"
        onClick={dismiss}
      >
        <X size={13} aria-hidden />
      </Button>
    </div>
  )
}
