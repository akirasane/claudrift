import { z } from 'zod'
import type { AppPrefs, AppPrefsPatch } from '../../shared/app'
import type { ConfigFileRef, ConfigItemList, ItemKind, ItemMutationResult, MemoryScope, SettingsScope } from '../../shared/config'
import type { McpListResult, McpMutationResult, McpScope } from '../../shared/config'
import type { PluginsListResult, PluginsMutationResult } from '../../shared/plugins'
import { AppPrefsPatchSchema, PluginActionSchema } from '../../shared/ipc'
import type { ConfigService } from './config-service'

export const ADMIN_SERVER_NAME = 'claudrift-admin'

/** The slice of the app's services the assistant's tools use. Injected so tests need no Electron. */
export interface AssistantDeps {
  prefs: { get(): AppPrefs; set(patch: AppPrefsPatch): Promise<AppPrefs> }
  mcp: {
    list(cwd?: string): Promise<McpListResult>
    add(a: { scope: McpScope; cwd?: string; name: string; config: Record<string, unknown> }): Promise<McpMutationResult>
    remove(a: { scope: McpScope; cwd?: string; name: string }): Promise<McpMutationResult>
  }
  plugins: {
    list(cwd?: string): Promise<PluginsListResult>
    mutate(a: z.infer<typeof PluginActionSchema>, cwd?: string): Promise<PluginsMutationResult>
  }
  items: {
    list(kind: ItemKind, cwd?: string): Promise<ConfigItemList>
    create(a: { kind: ItemKind; scope: 'user' | 'project'; cwd?: string; name: string; text: string }): Promise<ItemMutationResult>
  }
  /** Undefined until the config IPC is up. */
  config(): ConfigService | undefined
}

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) })
const json = (v: unknown): ReturnType<typeof text> => text(JSON.stringify(v, null, 2))

const NEEDS_PROJECT = 'This scope needs a project folder. Ask the user which project, then pass `project_dir`.'
const SECRET_KEY = /key|token|secret|password|authorization/i

/** Env / header values can hold secrets; the model sees the shape, not the values. */
function maskConfig(c: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...c }
  for (const k of ['env', 'headers']) {
    const m = out[k]
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      out[k] = Object.fromEntries(Object.entries(m).map(([n, v]) => [n, SECRET_KEY.test(n) ? '***' : v]))
    }
  }
  return out
}

/** App preferences the assistant must not change: they widen what Claude may do without asking. */
const LOCKED_PREFS = ['allowBypassMode'] as const

export async function createAdminMcpServer(deps: AssistantDeps) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  const projectArg = z.string().optional().describe('Absolute path of the project folder. Needed for project and local scopes.')

  return createSdkMcpServer({
    name: ADMIN_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool('get_app_settings', 'Read the Claudrift app preferences (notifications, hotkey, auto-update, token saver, ...).', {}, async () => json(deps.prefs.get())),
      tool(
        'set_app_settings',
        'Change Claudrift app preferences. `patch` is a JSON object with only the keys to change, e.g. {"ultraSaver":true,"ultraSaverConfig":{"cavemanMode":"ultra"}}. Call get_app_settings first to see the keys.',
        { patch: z.string().describe('JSON object, partial preferences') },
        async (a) => {
          let raw: unknown
          try {
            raw = JSON.parse(a.patch)
          } catch {
            return text('`patch` is not valid JSON.', true)
          }
          if (raw && typeof raw === 'object') {
            for (const k of LOCKED_PREFS) if (k in raw) return text(`"${k}" can only be changed by the user in Preferences.`, true)
          }
          const parsed = AppPrefsPatchSchema.safeParse(raw)
          if (!parsed.success) return text(`Invalid patch: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, true)
          return json(await deps.prefs.set(parsed.data as AppPrefsPatch))
        }
      ),

      tool('list_mcp_servers', 'List MCP servers (user, project and local scope). Secret values are hidden.', { project_dir: projectArg }, async (a) => {
        const r = await deps.mcp.list(a.project_dir)
        return json({ ...r, servers: r.servers.map((s) => ({ ...s, config: maskConfig(s.config) })) })
      }),
      tool(
        'add_mcp_server',
        'Add an MCP server. `config` is JSON like {"type":"stdio","command":"npx","args":["-y","pkg"],"env":{}} or {"type":"http","url":"https://..."}.',
        {
          name: z.string().describe('Server name'),
          scope: z.enum(['user', 'project', 'local']).describe('user = all projects, project = shared .mcp.json, local = private to the project'),
          config: z.string().describe('Server config as a JSON object'),
          project_dir: projectArg
        },
        async (a) => {
          if (a.scope !== 'user' && !a.project_dir) return text(NEEDS_PROJECT, true)
          let config: unknown
          try {
            config = JSON.parse(a.config)
          } catch {
            return text('`config` is not valid JSON.', true)
          }
          if (!config || typeof config !== 'object' || Array.isArray(config)) return text('`config` must be a JSON object.', true)
          const r = await deps.mcp.add({ scope: a.scope, name: a.name, config: config as Record<string, unknown>, ...(a.project_dir ? { cwd: a.project_dir } : {}) })
          return r.ok ? text(r.output || 'Added.') : text(r.message, true)
        }
      ),
      tool(
        'remove_mcp_server',
        'Remove an MCP server.',
        { name: z.string(), scope: z.enum(['user', 'project', 'local']), project_dir: projectArg },
        async (a) => {
          if (a.scope !== 'user' && !a.project_dir) return text(NEEDS_PROJECT, true)
          const r = await deps.mcp.remove({ scope: a.scope, name: a.name, ...(a.project_dir ? { cwd: a.project_dir } : {}) })
          return r.ok ? text(r.output || 'Removed.') : text(r.message, true)
        }
      ),

      tool('list_plugins', 'List installed plugins and known marketplaces.', { project_dir: projectArg }, async (a) => json(await deps.plugins.list(a.project_dir))),
      tool(
        'plugin_action',
        'Install, uninstall, enable, disable or update a plugin, or add / remove / update a marketplace. Plugin ids look like name@marketplace.',
        {
          op: z.enum(['install', 'uninstall', 'enable', 'disable', 'update', 'marketplaceAdd', 'marketplaceRemove', 'marketplaceUpdate']),
          plugin: z.string().optional().describe('Plugin id, for install / uninstall / enable / disable / update'),
          scope: z.enum(['user', 'project', 'local']).optional().describe('For install / uninstall / enable / disable. Default user'),
          source: z.string().optional().describe('marketplaceAdd: GitHub owner/repo, git URL or path'),
          name: z.string().optional().describe('marketplaceRemove / marketplaceUpdate: marketplace name'),
          project_dir: projectArg
        },
        async (a) => {
          const raw = { op: a.op, ...(a.plugin ? { plugin: a.plugin } : {}), ...(a.op === 'install' || a.op === 'uninstall' || a.op === 'enable' || a.op === 'disable' ? { scope: a.scope ?? 'user' } : {}), ...(a.source ? { source: a.source } : {}), ...(a.name ? { name: a.name } : {}) }
          const parsed = PluginActionSchema.safeParse(raw)
          if (!parsed.success) return text(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'op'}: ${i.message}`).join('; ')}`, true)
          const r = await deps.plugins.mutate(parsed.data, a.project_dir)
          return r.ok ? text(r.output || 'Done.') : text(r.message, true)
        }
      ),

      tool(
        'list_skills_commands_agents',
        'List skills, slash commands or subagents.',
        { kind: z.enum(['skill', 'command', 'agent']), project_dir: projectArg },
        async (a) => {
          const r = await deps.items.list(a.kind, a.project_dir)
          return json(r.items.map((i) => ({ name: i.name, scope: i.scope, plugin: i.plugin, description: i.description, path: i.path, error: i.error })))
        }
      ),
      tool(
        'create_skill_command_or_agent',
        'Create a skill, slash command or subagent. `content` is the whole file: Markdown with YAML frontmatter (skills and agents need `name` and `description`). Names use lowercase letters, digits and hyphens.',
        {
          kind: z.enum(['skill', 'command', 'agent']),
          scope: z.enum(['user', 'project']),
          name: z.string(),
          content: z.string(),
          project_dir: projectArg
        },
        async (a) => {
          if (a.scope === 'project' && !a.project_dir) return text(NEEDS_PROJECT, true)
          const r = await deps.items.create({ kind: a.kind, scope: a.scope, name: a.name, text: a.content, ...(a.project_dir ? { cwd: a.project_dir } : {}) })
          return r.ok ? text(`Created ${a.kind} "${a.name}" (${r.snapshot?.path ?? a.scope}).`) : text(r.message, true)
        }
      ),

      tool(
        'read_memory',
        'Read a CLAUDE.md memory file. user = ~/.claude/CLAUDE.md, project = <project>/CLAUDE.md, projectDotClaude = <project>/.claude/CLAUDE.md, local = <project>/CLAUDE.local.md.',
        { scope: z.enum(['user', 'project', 'projectDotClaude', 'local']), project_dir: projectArg },
        async (a) => {
          const cfg = deps.config()
          if (!cfg) return text('Config service is not ready yet.', true)
          if (a.scope !== 'user' && !a.project_dir) return text(NEEDS_PROJECT, true)
          const s = await cfg.read(memoryRef(a.scope, a.project_dir))
          return text(s.exists ? s.text : '(file does not exist yet)')
        }
      ),
      tool(
        'write_memory',
        'Replace a CLAUDE.md memory file with `content`. Read it first and keep what the user wants to keep. The previous version is backed up.',
        { scope: z.enum(['user', 'project', 'projectDotClaude', 'local']), content: z.string(), project_dir: projectArg },
        async (a) => {
          const cfg = deps.config()
          if (!cfg) return text('Config service is not ready yet.', true)
          if (a.scope !== 'user' && !a.project_dir) return text(NEEDS_PROJECT, true)
          const ref = memoryRef(a.scope, a.project_dir)
          const cur = await cfg.read(ref)
          const r = await cfg.write(ref, a.content, cur.hash)
          return r.ok ? text(`Saved ${r.snapshot.path}.`) : text(r.message, true)
        }
      ),

      tool(
        'read_claude_settings',
        'Read a Claude Code settings.json (permissions, env, hooks, model, ...). user = ~/.claude/settings.json, project = <project>/.claude/settings.json, local = <project>/.claude/settings.local.json.',
        { scope: z.enum(['user', 'project', 'local']), project_dir: projectArg },
        async (a) => {
          const cfg = deps.config()
          if (!cfg) return text('Config service is not ready yet.', true)
          if (a.scope !== 'user' && !a.project_dir) return text(NEEDS_PROJECT, true)
          const s = await cfg.read(settingsRef(a.scope, a.project_dir))
          return text(s.exists ? s.text : '{}')
        }
      ),
      tool(
        'write_claude_settings',
        'Replace a Claude Code settings.json. `content` must be the complete JSON object, so read the file first and keep existing keys. The previous version is backed up.',
        { scope: z.enum(['user', 'project', 'local']), content: z.string().describe('The whole settings JSON object'), project_dir: projectArg },
        async (a) => {
          const cfg = deps.config()
          if (!cfg) return text('Config service is not ready yet.', true)
          if (a.scope !== 'user' && !a.project_dir) return text(NEEDS_PROJECT, true)
          const ref = settingsRef(a.scope, a.project_dir)
          const cur = await cfg.read(ref)
          const r = await cfg.write(ref, a.content, cur.hash)
          return r.ok ? text(`Saved ${r.snapshot.path}.`) : text(r.message, true)
        }
      )
    ]
  })
}

const memoryRef = (scope: MemoryScope, cwd?: string): ConfigFileRef => ({ kind: 'memory', scope, ...(cwd ? { cwd } : {}) })
const settingsRef = (scope: SettingsScope, cwd?: string): ConfigFileRef => ({ kind: 'settings', scope, ...(cwd ? { cwd } : {}) })

/** Looking changes nothing, so these run without a prompt. Everything else the assistant does asks first. */
export const ASSISTANT_READ_ONLY_TOOLS = [
  'get_app_settings',
  'list_mcp_servers',
  'list_plugins',
  'list_skills_commands_agents',
  'read_memory',
  'read_claude_settings'
]
export const ASSISTANT_AUTO_ALLOWED: string[] = [
  ...ASSISTANT_READ_ONLY_TOOLS.map((t) => `mcp__${ADMIN_SERVER_NAME}__${t}`),
  'mcp__claudrift-schedule__list_scheduled_tasks'
]

/** Appended to Claude Code's system prompt in the assistant chat only. */
export const ASSISTANT_SYSTEM_PROMPT = `You are the Claudrift assistant, built into the Claudrift desktop app (a GUI for Claude Code). You help the user set up and change Claudrift and their Claude Code configuration. You are not working on a code project: this chat has no project of its own.

What you can change, with the claudrift-admin tools: app preferences (get_app_settings / set_app_settings), MCP servers, plugins and marketplaces, skills / slash commands / subagents, CLAUDE.md memory files, and Claude Code settings.json (permissions, env, hooks, model). With the claudrift-schedule tools you can create, list and delete scheduled tasks (prompts or scripts that run while the app is open).

Rules:
- Use these tools rather than editing config files by hand with Bash or Write.
- Read the current state first (list_* / read_* / get_*) before you change anything, and keep what the user already has.
- Project, local and project-scope items need a project folder. Ask which project and pass its absolute path as project_dir. Never guess.
- Each tool call is shown to the user for approval. Do the change the user asked for, then say in a sentence or two what changed and where.
- Do not turn on Bypass mode, and do not widen permissions beyond what the user asked for.
- Secrets (API keys, tokens): ask the user for them, never invent values, and do not repeat them back.
- If something is outside these tools (for example a project's source code), tell the user to open a normal chat in that project.
- Answer in the user's language. Be brief.`
