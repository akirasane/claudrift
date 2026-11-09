import { describe, expect, it, vi } from 'vitest'
import { ADMIN_SERVER_NAME, ASSISTANT_SYSTEM_PROMPT, createAdminMcpServer } from './assistant-tools'
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
