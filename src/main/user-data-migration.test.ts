import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateUserDataDir } from './user-data-migration'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'claudrift-udm-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('migrateUserDataDir', () => {
  it('does nothing when the old dir is missing', () => {
    expect(migrateUserDataDir(join(root, 'ccwraper'), join(root, 'Claudrift'))).toBe('none')
    expect(existsSync(join(root, 'Claudrift'))).toBe(false)
  })

  it('renames old to new, keeping contents', () => {
    const o = join(root, 'ccwraper')
    mkdirSync(o)
    writeFileSync(join(o, 'prefs.json'), '{"a":1}')
    expect(migrateUserDataDir(o, join(root, 'Claudrift'))).toBe('renamed')
    expect(existsSync(o)).toBe(false)
    expect(readFileSync(join(root, 'Claudrift', 'prefs.json'), 'utf8')).toBe('{"a":1}')
  })

  it('never overwrites an existing new dir', () => {
    const o = join(root, 'ccwraper')
    const n = join(root, 'Claudrift')
    mkdirSync(o)
    mkdirSync(n)
    writeFileSync(join(n, 'prefs.json'), 'new')
    expect(migrateUserDataDir(o, n)).toBe('kept-new')
    expect(existsSync(o)).toBe(true)
    expect(readFileSync(join(n, 'prefs.json'), 'utf8')).toBe('new')
  })

  it('reports use-old when the rename fails', () => {
    const o = join(root, 'ccwraper')
    mkdirSync(o)
    const r = migrateUserDataDir(o, join(root, 'Claudrift'), {
      exists: existsSync,
      rename: () => {
        throw new Error('EBUSY')
      }
    })
    expect(r).toBe('use-old')
    expect(existsSync(o)).toBe(true)
  })
})
