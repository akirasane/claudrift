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

export const SAVER_CAVEMAN_MODES = ['lite', 'full', 'ultra'] as const
export const SAVER_EFFORTS = ['low', 'medium', 'high'] as const
export const SAVER_MODELS = ['haiku', 'sonnet', 'opus'] as const
export const SAVER_COMPACT_MIN = 20_000
export const SAVER_COMPACT_MAX = 1_000_000

/** Values behind each part. Every field has a default, so the saver works with no setup. */
export interface SaverConfig {
  cavemanMode: (typeof SAVER_CAVEMAN_MODES)[number]
  /** Alias (haiku / sonnet / opus) or a full model id. */
  model: string
  effort: (typeof SAVER_EFFORTS)[number]
  /** Turn extended thinking off. */
  disableThinking: boolean
  /** Auto-compact when the context reaches this many tokens. */
  compactTokens: number
}

export const DEFAULT_SAVER_CONFIG: SaverConfig = {
  cavemanMode: 'ultra',
  model: SAVER_MODEL,
  effort: 'low',
  disableThinking: true,
  compactTokens: SAVER_COMPACT_TOKENS
}

/** What a saver-mode session starts with. Every field is optional; empty means "nothing to change". */
export interface SaverOptions {
  /** Added to the session's environment. */
  env?: Record<string, string>
  /** Used only when the chat has no explicit model. */
  model?: string
  effort?: SaverConfig['effort']
  disableThinking?: boolean
  autoCompactWindow?: number
}

export function saverOptions(prefs: {
  ultraSaver: boolean
  ultraSaverParts: SaverParts
  ultraSaverConfig?: Partial<SaverConfig>
}): SaverOptions | undefined {
  if (!prefs.ultraSaver) return undefined
  const p = prefs.ultraSaverParts
  const c = { ...DEFAULT_SAVER_CONFIG, ...prefs.ultraSaverConfig }
  const out: SaverOptions = {}
  if (p.caveman) out.env = { CAVEMAN_DEFAULT_MODE: c.cavemanMode }
  if (p.model) {
    out.model = c.model
    out.effort = c.effort
    if (c.disableThinking) out.disableThinking = true
  }
  if (p.compact) out.autoCompactWindow = c.compactTokens
  return Object.keys(out).length ? out : undefined
}
