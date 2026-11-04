import * as React from 'react'
import type { HistorySessionInfo } from '@shared/events'
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Spinner, Textarea, toast } from '@/components/ui'

type Step = 'confirm' | 'summarizing' | 'review'

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Deletes a session for good. Optionally has the model write a summary first, lets the user edit it, and appends it
 * to the project's CLAUDE.md so the knowledge outlives the transcript.
 */
export function DeleteSessionDialog({
  session,
  onClose,
  onDeleted
}: {
  session: HistorySessionInfo | null
  onClose: () => void
  onDeleted: (s: HistorySessionInfo) => void
}): React.JSX.Element {
  const [keep, setKeep] = React.useState(true)
  const [step, setStep] = React.useState<Step>('confirm')
  const [summary, setSummary] = React.useState('')
  const [error, setError] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!session) return
    setKeep(true)
    setStep('confirm')
    setSummary('')
    setError(undefined)
    setBusy(false)
  }, [session?.sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const api = window.claudrift?.history
  const remove = async (s: HistorySessionInfo): Promise<void> => {
    await api.delete({ sessionId: s.sessionId, cwd: s.cwd })
    onDeleted(s)
  }

  const summarize = async (s: HistorySessionInfo): Promise<void> => {
    setError(undefined)
    setStep('summarizing')
    try {
      setSummary(await api.summarize({ sessionId: s.sessionId, cwd: s.cwd }))
      setStep('review')
    } catch (err) {
      setError(msgOf(err))
      setStep('confirm')
    }
  }

  const deleteNow = async (s: HistorySessionInfo, save: boolean): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      if (save) {
        const file = await api.saveSummary({ cwd: s.cwd, title: s.title, summary })
        toast('Summary saved', { description: file })
      }
      await remove(s)
    } catch (err) {
      setError(msgOf(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={session !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent data-testid="delete-session-dialog">
        {session && (
          <>
            <DialogHeader>
              <DialogTitle>{step === 'review' ? 'Review the summary' : 'Delete this session?'}</DialogTitle>
              <DialogDescription>
                {step === 'review' ? (
                  <>It will be added to CLAUDE.md in {session.cwd}. Edit it first if you like.</>
                ) : (
                  <>
                    <span className="block truncate font-medium text-fg" title={session.title}>
                      {session.title}
                    </span>
                    This permanently removes the conversation transcript. It cannot be undone.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            {step === 'confirm' && (
              <label className="flex cursor-pointer items-start gap-2 text-base text-fg-2">
                <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} data-testid="keep-summary" aria-label="Save a summary to memory first" />
                <span>
                  Save a summary to project memory first
                  <span className="block text-sm text-fg-3">Claude writes a few bullets, you review them, then they are added to CLAUDE.md.</span>
                </span>
              </label>
            )}

            {step === 'summarizing' && (
              <div role="status" data-testid="summarizing" className="ccw-fade-in flex items-center gap-2 py-3 text-base text-fg-2">
                <Spinner size={16} />
                <span className="ccw-shimmer-text">Summarizing the conversation...</span>
              </div>
            )}

            {step === 'review' && (
              <Textarea
                data-testid="summary-text"
                aria-label="Summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="ccw-fade-in min-h-[180px]"
                mono
              />
            )}

            {error && (
              <p role="alert" data-testid="delete-error" className="text-sm text-danger">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              {step === 'confirm' && keep && (
                <Button variant="primary" data-testid="summarize-continue" onClick={() => void summarize(session)}>
                  Summarize and continue
                </Button>
              )}
              {step === 'confirm' && !keep && (
                <Button variant="danger" disabled={busy} data-testid="delete-confirm" onClick={() => void deleteNow(session, false)}>
                  Delete
                </Button>
              )}
              {(step === 'confirm' && keep && error) || step === 'review' ? (
                <Button variant="danger" disabled={busy} data-testid="delete-without-summary" onClick={() => void deleteNow(session, false)}>
                  Delete without saving
                </Button>
              ) : null}
              {step === 'review' && (
                <Button variant="primary" disabled={busy || !summary.trim()} data-testid="save-and-delete" onClick={() => void deleteNow(session, true)}>
                  Save to memory and delete
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
