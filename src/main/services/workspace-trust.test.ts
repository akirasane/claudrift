import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTrusted, trustWorkspace } from './workspace-trust'

let dir: string
let f: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trust-'))
  f = join(dir, '.claude.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const read = (): any => JSON.parse(readFileSync(f, 'utf8'))

describe('workspace-trust', () => {
  it('creates the file and entry when missing', () => {
    expect(isTrusted('D:\\Coding\\x', f)).toBe(false)
    expect(trustWorkspace('D:\\Coding\\x', f)).toEqual({ ok: true })
    expect(read()).toEqual({ projects: { 'D:/Coding/x': { hasTrustDialogAccepted: true } } })
    expect(isTrusted('D:\\Coding\\x', f)).toBe(true)
  })

  it('flips false to true, preserves other keys and projects, keeps indent', () => {
    writeFileSync(
      f,
      JSON.stringify({ a: 1, projects: { 'D:/Coding/x': { hasTrustDialogAccepted: false, allowedTools: ['t'] }, 'D:/Coding': { hasTrustDialogAccepted: true } } }, null, 4)
    )
    expect(trustWorkspace('D:/Coding/x', f).ok).toBe(true)
    expect(readFileSync(f, 'utf8')).toContain('\n    "a"')
    expect(read()).toEqual({
      a: 1,
      projects: { 'D:/Coding/x': { hasTrustDialogAccepted: true, allowedTools: ['t'] }, 'D:/Coding': { hasTrustDialogAccepted: true } }
    })
  })

  it('matches existing key casing and never trusts parents', () => {
    writeFileSync(f, JSON.stringify({ projects: { 'd:/coding/X': { n: 1 } } }, null, 2))
    trustWorkspace('D:\\Coding\\x', f)
    expect(read().projects).toEqual({ 'd:/coding/X': { n: 1, hasTrustDialogAccepted: true } })
    expect(isTrusted('D:/coding', f)).toBe(false)
  })

  it('refuses a corrupt file and leaves it untouched', () => {
    writeFileSync(f, '{ not json')
    expect(trustWorkspace('D:/x', f).ok).toBe(false)
    expect(readFileSync(f, 'utf8')).toBe('{ not json')
    expect(existsSync(`${f}.claudrift-bak`)).toBe(false)
  })

  it('backs up once', () => {
    writeFileSync(f, JSON.stringify({ k: 1 }))
    trustWorkspace('D:/a', f)
    trustWorkspace('D:/b', f)
    expect(JSON.parse(readFileSync(`${f}.claudrift-bak`, 'utf8'))).toEqual({ k: 1 })
  })
})
