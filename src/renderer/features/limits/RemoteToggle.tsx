import { Copy, Radio } from 'lucide-react'
import * as React from 'react'
import { EMPTY_REMOTE, type RemoteState } from '@shared/remote'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, toast, Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useRemoteMirror } from './remote-mirror'

/** Latest Remote Control state pushed by main. */
export function useRemoteState(): RemoteState {
  const [state, setState] = React.useState<RemoteState>(EMPTY_REMOTE)
  React.useEffect(() => {
    const api = window.claudrift?.remote
    if (!api) return
    let alive = true
    void Promise.resolve(api.getState())
      .then((s) => alive && s && setState(s))
      .catch(() => {})
    const off = api.onState((s) => setState(s))
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return state
}

const trustListeners = new Set<() => void>()
function requestTrustDialog(): void {
  trustListeners.forEach((l) => l())
}

export function defaultRemoteName(cwd: string): string {
  return `Claudrift - ${cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'project'}`
}

/** Starts Remote Control in the active project (or stops it when running). Returns a short note for the UI. */
export async function toggleRemote(name?: string): Promise<string> {
  const api = window.claudrift?.remote
  if (!api) return 'Remote Control is not available'
  const cur = await api.getState()
  if (cur.status === 'on' || cur.status === 'starting') {
    await api.stop()
    return 'Remote Control stopped'
  }
  if (cur.status === 'error' && cur.needsTrust) {
    requestTrustDialog()
    return ''
  }
  const cwd = useWorkspaceStore.getState().cwd
  if (!cwd) return 'Open a project first to start Remote Control'
  const label = name?.trim() || `Claudrift - ${cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'project'}`
  await api.start({ cwd, name: label })
  return `Remote Control starting as "${label}". It opens separate sessions you can drive from claude.ai/code or the phone app.`
}

export async function toggleRemoteWithToast(name?: string): Promise<void> {
  try {
    const note = await toggleRemote(name)
    if (note) toast(note)
  } catch (err) {
    toast.error('Remote Control failed', { description: err instanceof Error ? err.message : String(err) })
  }
}

/** Status bar switch that runs `claude remote-control` in the active project. */
export function RemoteToggle(): React.JSX.Element {
  const s = useRemoteState()
  useRemoteMirror(s)
  const active = s.status === 'on' || s.status === 'starting'
  const [trustOpen, setTrustOpen] = React.useState(false)
  const [nameOpen, setNameOpen] = React.useState(false)
  const [nameDraft, setNameDraft] = React.useState('')
  const needsTrust = s.status === 'error' && Boolean(s.needsTrust)
  React.useEffect(() => {
    const open = (): void => setTrustOpen(true)
    trustListeners.add(open)
    return () => void trustListeners.delete(open)
  }, [])
  React.useEffect(() => {
    if (needsTrust) setTrustOpen(true)
  }, [needsTrust])
  const trustCwd = s.cwd ?? useWorkspaceStore.getState().cwd ?? ''
  const confirmTrust = async (): Promise<void> => {
    setTrustOpen(false)
    const api = window.claudrift?.remote
    if (!api || !trustCwd) return
    try {
      const r = await api.trust({ cwd: trustCwd })
      if (!r.ok) {
        toast.error('Could not trust this folder', { description: r.message })
        return
      }
      await api.start({ cwd: trustCwd, name: s.name })
    } catch (err) {
      toast.error('Could not trust this folder', { description: err instanceof Error ? err.message : String(err) })
    }
  }
  const onClick = (): void => {
    if (active || needsTrust) {
      void toggleRemoteWithToast()
      return
    }
    const cwd = useWorkspaceStore.getState().cwd
    if (!cwd) {
      void toggleRemoteWithToast()
      return
    }
    setNameDraft(defaultRemoteName(cwd))
    setNameOpen(true)
  }
  const confirmName = (): void => {
    setNameOpen(false)
    void toggleRemoteWithToast(nameDraft)
  }
  const copy = (): void => {
    if (!s.url) return
    void navigator.clipboard?.writeText(s.url).then(
      () => toast('Remote Control link copied'),
      () => toast.error('Could not copy the link')
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <Tooltip
        content={
          <span data-testid="remote-tip">
            {s.status === 'error'
              ? `Remote Control failed: ${s.message ?? 'unknown error'}`
              : s.status === 'on'
                ? `Remote Control is on${s.cwd ? ` in ${s.cwd}` : ''}. Open claude.ai/code or the phone app to drive sessions on this PC.${s.url ? '' : ' (no link was printed; look for this machine in the Claude app)'}${s.log.length ? ` Last output: ${s.log[s.log.length - 1]}` : ''}`
                : s.status === 'starting'
                  ? `Remote Control is starting...${s.log.length ? ` ${s.log[s.log.length - 1]}` : ''}`
                  : 'Remote Control is off. Turn it on to drive sessions on this PC from claude.ai/code or the phone app.'}
          </span>
        }
      >
        <button
          type="button"
          data-testid="status-remote"
          data-status={s.status}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xs px-1.5 transition-colors duration-fast',
            s.status === 'error' ? 'text-danger' : active ? 'bg-accent-tint text-accent-text' : 'text-fg-3 hover:text-fg-2'
          )}
        >
          <Radio size={11} aria-hidden />
          <span className="font-medium">REMOTE</span>
          <span>{s.status === 'error' ? 'ERR' : s.status === 'starting' ? '...' : active ? 'ON' : 'OFF'}</span>
        </button>
      </Tooltip>
      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent data-testid="name-dialog">
          <DialogHeader>
            <DialogTitle>Start Remote Control</DialogTitle>
            <DialogDescription>Name this session. It shows up under this name in claude.ai/code and the phone app.</DialogDescription>
          </DialogHeader>
          <input
            data-testid="remote-name"
            aria-label="Session name"
            value={nameDraft}
            maxLength={100}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmName()}
            className="w-full rounded-sm border border-line bg-bg-1 px-2 py-1 text-fg-1"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNameOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" data-testid="remote-name-start" onClick={confirmName}>
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={trustOpen} onOpenChange={setTrustOpen}>
        <DialogContent data-testid="trust-dialog">
          <DialogHeader>
            <DialogTitle>Trust this folder?</DialogTitle>
            <DialogDescription>
              <span className="block break-all font-mono" data-testid="trust-path">
                {trustCwd}
              </span>
              Claude Code runs commands and edits files in trusted folders. Only trust folders you own or whose contents you trust. This writes{' '}
              <code>hasTrustDialogAccepted</code> for this folder to ~/.claude.json, the same as accepting the prompt in <code>claude</code>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTrustOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" data-testid="trust-confirm" onClick={() => void confirmTrust()}>
              Trust folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {s.status === 'on' && s.url && (
        <button
          type="button"
          data-testid="remote-copy"
          aria-label="Copy Remote Control link"
          title={s.url}
          onClick={copy}
          className="rounded-xs px-1 text-fg-3 hover:text-fg-2"
        >
          <Copy size={11} aria-hidden />
        </button>
      )}
    </span>
  )
}
