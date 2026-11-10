import { History } from 'lucide-react'
import * as React from 'react'
import type { ConfigBackupInfo, ConfigFileRef, ConfigSnapshot } from '@shared/config'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Spinner, toast } from '@/components/ui'

const fmt = (ms: number): string => new Date(ms).toLocaleString()

/**
 * "Backups" button + dialog for one config file: pick an earlier version, read it, restore it.
 * Restoring goes through the normal write in main (validated, the current file is backed up first).
 */
export function BackupsButton({
  fileRef,
  baseHash,
  dirty = false,
  disabled = false,
  onRestored
}: {
  fileRef: ConfigFileRef
  /** Hash of the file as last read; restore is refused if the file changed since. */
  baseHash: string | null | undefined
  dirty?: boolean
  disabled?: boolean
  onRestored: (snapshot: ConfigSnapshot) => void
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [list, setList] = React.useState<ConfigBackupInfo[] | undefined>()
  const [sel, setSel] = React.useState<string | undefined>()
  const [preview, setPreview] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>()

  React.useEffect(() => {
    if (!open) return
    let live = true
    setList(undefined)
    setSel(undefined)
    setError(undefined)
    window.claudrift.config
      .backups(fileRef)
      .then((l) => {
        if (!live) return
        setList(l)
        setSel(l[0]?.path)
      })
      .catch((e: unknown) => live && (setList([]), setError(e instanceof Error ? e.message : String(e))))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  React.useEffect(() => {
    if (!open || !sel) {
      setPreview(undefined)
      return
    }
    let live = true
    window.claudrift.config
      .readBackup({ ref: fileRef, backupPath: sel })
      .then((t) => live && setPreview(t))
      .catch((e: unknown) => live && setPreview(`Could not read the backup: ${e instanceof Error ? e.message : String(e)}`))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sel])

  const restore = async (): Promise<void> => {
    if (!sel || baseHash === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      const res = await window.claudrift.config.restore({ ref: fileRef, backupPath: sel, baseHash })
      if (res.ok) {
        onRestored(res.snapshot)
        toast.success('Backup restored')
        setOpen(false)
      } else {
        setError(res.code === 'conflict' ? 'The file changed on disk since you opened it. Reload it and try again.' : res.message)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="ghost" disabled={disabled} data-testid="backups-open" onClick={() => setOpen(true)}>
        <History size={13} /> Backups
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[640px]" data-testid="backups-dialog">
          <DialogHeader>
            <DialogTitle>Backups</DialogTitle>
            <DialogDescription>Earlier versions saved before a change. Restoring keeps a backup of the current file.</DialogDescription>
          </DialogHeader>
          {list === undefined ? (
            <div role="status" className="flex items-center gap-2 text-fg-3">
              <Spinner size={14} /> Loading&hellip;
            </div>
          ) : list.length === 0 ? (
            <p className="text-base text-fg-3" data-testid="backups-empty">
              No backups yet. One is made the first time you save this file in each session.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <select
                aria-label="Backup"
                data-testid="backups-select"
                className="h-8 rounded-sm border border-border bg-bg-1 px-2 text-base text-fg"
                value={sel ?? ''}
                onChange={(e) => setSel(e.target.value)}
              >
                {list.map((b) => (
                  <option key={b.path} value={b.path}>
                    {fmt(b.mtimeMs)} ({b.size} bytes)
                  </option>
                ))}
              </select>
              <pre
                data-testid="backups-preview"
                aria-label="Backup preview"
                className="max-h-72 overflow-auto rounded-sm border border-border bg-bg-1 p-3 font-mono text-sm text-fg-2"
              >
                {preview ?? ''}
              </pre>
              {dirty && <p className="text-sm text-warn">Your unsaved edits will be replaced.</p>}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Close</Button>
            <Button variant="primary" data-testid="backups-restore" disabled={!sel || busy || baseHash === undefined} onClick={() => void restore()}>
              {busy ? 'Restoring...' : 'Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
