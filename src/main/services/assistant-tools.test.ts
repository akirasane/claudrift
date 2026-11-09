import { describe, expect, it, vi } from 'vitest'
import { ADMIN_SERVER_NAME, ASSISTANT_AUTO_ALLOWED, ASSISTANT_SYSTEM_PROMPT, createAdminMcpServer } from './assistant-tools'
import type { AssistantDeps } from './assistant-tools'

describe('assistant admin tools', () => {
  it('builds an in-process MCP server with every tool registered', async () => {
    const deps = { prefs: { get: vi.fn(), set: vi.fn() }, mcp: {}, plugins: {}, items: {}, config: () => undefined } as unknown as AssistantDeps
    const server = await createAdminMcpServer(deps)
    expect(server.type).toBe('sdk')
    expect(server.name).toBe(ADMIN_SERVER_NAME)
    const tools = Object.keys((server.instance as unknown as { _registeredTools: Record<string, unknown> })._registeredTools)
    expect(tools).toEqual(
      expect.arrayContaining(['set_app_settings', 'add_mcp_server', 'plugin_action', 'create_skill_command_or_agent', 'write_memory', 'write_claude_settings'])
    )
  })

  it('tells the model which tools to use', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('claudrift-admin')
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('project_dir')
  })
})

describe('assistant auto-allowed tools', () => {
  it('only lets read-only tools skip the prompt', () => {
    expect(ASSISTANT_AUTO_ALLOWED).toContain('mcp__claudrift-admin__list_plugins')
    for (const t of ASSISTANT_AUTO_ALLOWED) expect(t).not.toMatch(/set_|add_|remove_|write_|create_|plugin_action|schedule_task|delete_/)
  })
})

describe('settings write guard', () => {
  it('flags hooks, bypass default and broad allow rules, but not ordinary edits', async () => {
    const { riskyChanges } = await import('./assistant-tools')
    const old = JSON.stringify({ model: 'sonnet', permissions: { allow: ['Read'] } })
    expect(riskyChanges(old, JSON.stringify({ model: 'opus', permissions: { allow: ['Read', 'Bash(git status)'] } }))).toEqual([])
    expect(riskyChanges(old, JSON.stringify({ hooks: { Stop: [] } }))).toContain('hooks')
    expect(riskyChanges(old, JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }))).toContain('permissions.defaultMode')
    expect(riskyChanges(old, JSON.stringify({ permissions: { allow: ['Bash'] } })).join()).toMatch(/broad allow rule/)
    expect(riskyChanges(old, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://evil' } }))).toContain('env.ANTHROPIC_BASE_URL')
  })

  it('masks env secrets for the model and restores them on write', async () => {
    const { maskSettings, restoreMasked } = await import('./assistant-tools')
    const file = JSON.stringify({ env: { MY_API_KEY: 'sk-real', DEBUG: '1' } })
    const shown = maskSettings(file)
    expect(shown).not.toContain('sk-real')
    expect(shown).toContain('DEBUG')
    const back = restoreMasked(file, shown)
    expect(back.ok && JSON.parse(back.text).env.MY_API_KEY).toBe('sk-real')
    const bad = restoreMasked('{}', JSON.stringify({ env: { NEW_TOKEN: '***' } }))
    expect(bad.ok).toBe(false)
  })
})
