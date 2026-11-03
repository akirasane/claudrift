import { Copy, Radio } from 'lucide-react'
import * as React from 'react'
import { EMPTY_REMOTE, type RemoteState } from '@shared/remote'
import { toast, Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useWorkspaceStore } from '@/stores/workspace-store'

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

/** Starts Remote Control in the active project (or stops it when running). Returns a short note for the UI. */
export async function toggleRemote(): Promise<string> {
  const api = window.claudrift?.remote
  if (!api) return 'Remote Control is not available'
  const cur = await api.getState()
  if (cur.status === 'on' || cur.status === 'starting') {
    await api.stop()
    return 'Remote Control stopped'
  }
  const cwd = useWorkspaceStore.getState().cwd
  if (!cwd) return 'Open a project first to start Remote Control'
  await api.start({ cwd })
  return 'Remote Control starting. It opens separate sessions you can drive from claude.ai/code or the phone app.'
}

export async function toggleRemoteWithToast(): Promise<void> {
  try {
    toast(await toggleRemote())
  } catch (err) {
    toast.error('Remote Control failed', { description: err instanceof Error ? err.message : String(err) })
  }
}

/** Status bar switch that runs `claude remote-control` in the active project. */
export function RemoteToggle(): React.JSX.Element {
  const s = useRemoteState()
  const active = s.status === 'on' || s.status === 'starting'
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
          onClick={() => void toggleRemoteWithToast()}
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
