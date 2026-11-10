import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))

import { parseRemoteStart } from './remote-control'

describe('parseRemoteStart', () => {
  it('refuses bypassPermissions unless the preference allows it', () => {
    expect(() => parseRemoteStart({ cwd: 'C:\\proj', permissionMode: 'bypassPermissions' }, false)).toThrow(/Bypass mode is disabled/)
    expect(parseRemoteStart({ cwd: 'C:\\proj', permissionMode: 'bypassPermissions' }, true).permissionMode).toBe('bypassPermissions')
  })
  it('lets other modes through without the preference', () => {
    expect(parseRemoteStart({ cwd: 'C:\\proj', permissionMode: 'plan' }, false).permissionMode).toBe('plan')
    expect(parseRemoteStart({ cwd: 'C:\\proj' }, false).cwd).toBe('C:\\proj')
  })
  it('still validates the payload', () => {
    expect(() => parseRemoteStart({ cwd: 'relative' }, true)).toThrow()
  })
})
