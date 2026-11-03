import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import type { ClaudeCliStatus, ClaudeCliUpdateResult } from '@shared/claude-cli'
import { Button } from '@/components/ui'

const KEY = ['claude-cli', 'status'] as const

function Line({ label, value, testId }: { label: string; value: string; testId: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="min-w-0 flex-1 text-base text-fg">{label}</div>
      <span data-testid={testId} className="max-w-xs break-all text-right font-mono text-sm text-fg-2">
        {value}
      </span>
    </div>
  )
}

/** "Claude Code & SDK" panel: active CLI, latest published versions, and the in-place CLI updater. */
export function ClaudeCliSection(): React.JSX.Element {
  const qc = useQueryClient()
  const q = useQuery<ClaudeCliStatus>({
    queryKey: KEY,
    queryFn: () => window.claudrift.claudeCli.status(),
    retry: false
  })
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<ClaudeCliUpdateResult | undefined>()
  const s = q.data

  const refresh = (): void => {
    void window.claudrift.claudeCli.status({ refresh: true }).then((d) => qc.setQueryData(KEY, d), () => {})
  }
  const update = (): void => {
    setBusy(true)
    setResult(undefined)
    void Promise.resolve(window.claudrift.claudeCli.update())
      .then((r) => {
        setResult(r)
        refresh()
      })
      .catch(() => setResult({ ok: false, message: 'Update failed.', output: [] }))
      .finally(() => setBusy(false))
  }

  return (
    <section aria-labelledby="claude-cli" data-testid="prefs-claude-cli" className="border-b border-border py-5">
      <h3 id="claude-cli" className="mb-2 text-md font-medium text-fg">
        Claude Code &amp; SDK
      </h3>
      {!s ? (
        <div className="py-2.5 text-sm text-fg-3">{q.isError ? 'Could not read version info.' : '...'}</div>
      ) : (
        <div className="divide-y divide-border">
          <Line label="Active CLI" value={`${s.active.version ?? 'unknown'} (${s.active.source})`} testId="cli-active" />
          <Line label="CLI path" value={s.active.path ?? 'bundled with the app'} testId="cli-path" />
          <Line label="Latest CLI" value={s.latestCli ?? 'unknown'} testId="cli-latest" />
          <Line label="Bundled CLI" value={s.bundledCliVersion ?? 'unknown'} testId="cli-bundled" />
          <Line label="Agent SDK (pinned)" value={s.sdkPinned ?? 'unknown'} testId="sdk-pinned" />
          <Line label="Latest Agent SDK" value={s.latestSdk ?? 'unknown'} testId="sdk-latest" />
          {s.active.note && <div className="py-2.5 text-sm text-fg-3">{s.active.note}</div>}
          {s.sdkUpdateAvailable && (
            <div data-testid="sdk-newer" className="py-2.5 text-sm text-fg-3">
              Newer Agent SDK available — arrives with the next Claudrift release.
            </div>
          )}
          {s.active.source === 'bundled' ? (
            <div data-testid="cli-bundled-note" className="py-2.5 text-sm text-fg-3">
              The bundled CLI updates only with a new Claudrift release. Install Claude Code globally (
              <code className="font-mono">npm i -g @anthropic-ai/claude-code</code>) and the app will prefer it.
            </div>
          ) : (
            <div className="flex items-center gap-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-base text-fg">Update Claude Code</div>
                <div data-testid="cli-update-hint" className="text-sm text-fg-3">
                  {s.activeSessions > 0
                    ? 'Stop running sessions first.'
                    : s.cliUpdateAvailable
                      ? `Version ${s.latestCli} is available. Running chats must restart to use it.`
                      : 'No newer version found.'}
                </div>
              </div>
              <Button size="sm" data-testid="cli-update" disabled={!s.canUpdate || busy} onClick={update}>
                {busy ? 'Updating...' : 'Update Claude Code'}
              </Button>
            </div>
          )}
          {result && (
            <div data-testid="cli-update-result" data-ok={result.ok} className={`py-2.5 text-sm ${result.ok ? 'text-fg-3' : 'text-danger'}`}>
              <div>{result.message}</div>
              {result.output.length > 0 && <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-fg-3">{result.output.join('\n')}</pre>}
            </div>
          )}
          <div className="py-2.5">
            <Button size="sm" data-testid="cli-refresh" onClick={refresh}>
              Check versions
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
