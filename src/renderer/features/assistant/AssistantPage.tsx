import { LifeBuoy, Plus } from 'lucide-react'
import * as React from 'react'
import { ChatView } from '@/features/chat/ChatView'
import { Button } from '@/components/ui'
import { useChatStore } from '@/stores/chat-store'

const SUGGESTIONS = [
  'Schedule a prompt to run every weekday at 9:00',
  'Install a plugin for me',
  'Add an MCP server',
  'Create a skill from my instructions',
  'Turn on the token saver and make it cheaper'
]

/**
 * A chat that is not tied to any project. It works in its own folder and has extra tools to change Claudrift's
 * settings, MCP servers, plugins, skills, memory and scheduled tasks. Each change goes through the permission prompt.
 */
export function AssistantPage(): React.JSX.Element {
  const [dir, setDir] = React.useState<string | undefined>()
  const [failed, setFailed] = React.useState(false)
  const [n, setN] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    window.claudrift?.app
      ?.info()
      .then((i) => {
        if (cancelled) return
        if (i.assistantDir) setDir(i.assistantDir)
        else setFailed(true)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [])

  const convId = `claudrift-assistant-${n}`
  // Always start in Default mode: changes must be approved by the user, not decided by auto mode.
  React.useEffect(() => {
    if (dir) useChatStore.getState().seedMode(convId, 'default')
  }, [dir, convId])
  const target = React.useMemo(() => (dir ? { convId, cwd: dir } : undefined), [dir, convId])

  const startOver = async (): Promise<void> => {
    const st = useChatStore.getState()
    const c = st.convs[convId]
    if (c?.localId && !c.closed) await window.claudrift.session.close(c.localId).catch(() => {})
    st.removeConv(convId)
    setN((x) => x + 1)
  }

  return (
    <div data-testid="assistant-page" className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <LifeBuoy size={16} className="text-accent-from" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-md font-semibold text-fg">Claudrift assistant</h1>
          <p className="m-0 truncate text-sm text-fg-muted">
            Ask it to set up schedules, plugins, MCP servers, skills, memory or app settings. It works outside any project and asks before each change.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void startOver()} data-testid="assistant-new">
          <Plus size={14} aria-hidden /> New chat
        </Button>
      </header>
      {failed ? (
        <div className="m-auto max-w-md px-6 text-center text-sm text-fg-muted">The assistant folder is not available. Restart Claudrift and try again.</div>
      ) : !target ? (
        <div className="flex-1" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <Suggestions convId={convId} />
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatView key={target.convId} target={target} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Quick starts, shown until the first message. */
function Suggestions({ convId }: { convId: string }): React.JSX.Element | null {
  const empty = useChatStore((s) => {
    const c = s.convs[convId]
    return !c || c.items.length === 0
  })
  if (!empty) return null
  return (
    <div className="flex shrink-0 flex-wrap gap-2 border-b border-border px-5 py-2" data-testid="assistant-suggestions">
      {SUGGESTIONS.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => useChatStore.getState().setDraft(convId, q)}
          className="rounded-full border border-border bg-bg-1 px-3 py-1 text-sm text-fg-muted transition-colors duration-fast hover:border-accent-from hover:text-fg"
        >
          {q}
        </button>
      ))}
    </div>
  )
}
