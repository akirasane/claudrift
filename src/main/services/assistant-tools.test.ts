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
      expect.arrayContaining(['set_app_settings', 'add_mcp_server', 'plugin_action', 'create_skill_command_or_agent', 'write_memory', 'write_claude_settings', 'undo_last_config_change', 'list_config_backups'])
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
    for (const t of ASSISTANT_AUTO_ALLOWED) expect(t).not.toMatch(/set_|add_|remove_|write_|undo_|create_|plugin_action|schedule_task|delete_/)
  })
})

describe('assistant undo', () => {
  it('keeps list_config_backups read-only and undo behind the prompt', () => {
    expect(ASSISTANT_AUTO_ALLOWED).toContain('mcp__claudrift-admin__list_config_backups')
    expect(ASSISTANT_AUTO_ALLOWED).not.toContain('mcp__claudrift-admin__undo_last_config_change')
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('undo_last_config_change')
  })

  it('restores the newest backup, and refuses when there is none or it would bring back risky keys', async () => {
    const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createConfigPaths } = await import('../paths')
    const { ConfigService, sha256 } = await import('./config-service')
    const { undoLastChange } = await import('./assistant-tools')
    const root = await mkdtemp(join(tmpdir(), 'claudrift-undo-'))
    try {
      const home = join(root, 'home')
      await mkdir(join(home, '.claude'), { recursive: true })
      const svc = new ConfigService(createConfigPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, home), join(root, 'bk'))
      const ref = { kind: 'memory', scope: 'user' } as const
      const file = join(home, '.claude', 'CLAUDE.md')
      expect((await undoLastChange(svc, ref)).ok).toBe(false)
      await writeFile(file, 'v0')
      await svc.write(ref, 'v1', sha256('v0'), { forceBackup: true })
      await new Promise((r) => setTimeout(r, 5))
      await svc.write(ref, 'v2', sha256('v1'), { forceBackup: true })
      expect((await undoLastChange(svc, ref)).ok).toBe(true)
      expect(await readFile(file, 'utf8')).toBe('v1')

      const sref = { kind: 'settings', scope: 'user' } as const
      const sfile = join(home, '.claude', 'settings.json')
      const risky = JSON.stringify({ hooks: { Stop: [] } })
      await writeFile(sfile, risky)
      await svc.write(sref, '{}', sha256(risky), { forceBackup: true })
      const r = await undoLastChange(svc, sref)
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/hooks/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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
