// Ultra token-saver mode: one switch that bundles the levers that actually reduce spend.
//
// Probed against CLI 2.1.312 (docs/P5-FINDINGS.md): input is already small and cached (/context shows ~15k, MCP tools
// are deferred, and `skills: []` only moves tokens to a tool), so trimming plugins or MCP saves nothing. The spend is
// output text, thinking, the model's price, and an ever-growing history. Those are the three parts below.

export interface SaverParts {
  /** Caveman plugin at ultra: terse replies. Done with CAVEMAN_DEFAULT_MODE in the session's environment. */
  caveman: boolean
  /** Haiku, low effort, no extended thinking (unless the user picked a model for that chat). */
  model: boolean
  /** Compact the conversation at 100k tokens instead of letting a 1M window grow. */
  compact: boolean
}

export const DEFAULT_SAVER_PARTS: SaverParts = { caveman: true, model: true, compact: true }

export const SAVER_MODEL = 'haiku'
export const SAVER_COMPACT_TOKENS = 100_000

/** What a saver-mode session starts with. Every field is optional; empty means "nothing to change". */
export interface SaverOptions {
  /** Added to the session's environment. */
  env?: Record<string, string>
  /** Used only when the chat has no explicit model. */
  model?: string
  effort?: 'low'
  disableThinking?: boolean
  autoCompactWindow?: number
}

export function saverOptions(prefs: { ultraSaver: boolean; ultraSaverParts: SaverParts }): SaverOptions | undefined {
  if (!prefs.ultraSaver) return undefined
  const p = prefs.ultraSaverParts
  const out: SaverOptions = {}
  if (p.caveman) out.env = { CAVEMAN_DEFAULT_MODE: 'ultra' }
  if (p.model) {
    out.model = SAVER_MODEL
    out.effort = 'low'
    out.disableThinking = true
  }
  if (p.compact) out.autoCompactWindow = SAVER_COMPACT_TOKENS
  return Object.keys(out).length ? out : undefined
}
