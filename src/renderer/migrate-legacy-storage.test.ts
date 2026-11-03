import { describe, expect, it } from 'vitest'
import { migrateLegacyStorage } from './migrate-legacy-storage'

describe('migrateLegacyStorage', () => {
  it('copies ccwrap.* to claudrift.* when absent and never overwrites', () => {
    const s = window.localStorage
    s.clear()
    s.setItem('ccwrap.tabs.v1', 'old-tabs')
    s.setItem('ccwrap.lastCwd', 'old-cwd')
    s.setItem('claudrift.lastCwd', 'new-cwd')
    s.setItem('other', 'x')
    expect(migrateLegacyStorage(s)).toBe(1)
    expect(s.getItem('claudrift.tabs.v1')).toBe('old-tabs')
    expect(s.getItem('claudrift.lastCwd')).toBe('new-cwd')
    expect(s.getItem('claudrift.other')).toBeNull()
    expect(migrateLegacyStorage(s)).toBe(0)
    s.clear()
  })
})
