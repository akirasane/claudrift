import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface TrustResult {
  ok: boolean
  message?: string
}

function defaultPath(): string {
  return join(homedir(), '.claude.json')
}

function toKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/(?<=.)\/+$/, '')
}

type Json = Record<string, unknown>

function load(path: string): { data: Json; indent: string | number } | { error: string } {
  if (!existsSync(path)) return { data: {}, indent: 2 }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    return { error: `Could not read ${path}: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (text.trim() === '') return { data: {}, indent: 2 }
  try {
    const data = JSON.parse(text.replace(/^﻿/, '')) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: `${path} is not a JSON object; left untouched` }
    const m = /^\{\r?\n([ \t]+)"/.exec(text)
    return { data: data as Json, indent: m?.[1] ?? 2 }
  } catch {
    return { error: `${path} is not valid JSON; left untouched` }
  }
}

function findKey(projects: Json, cwd: string): string | undefined {
  const want = toKey(cwd)
  if (want in projects) return want
  const lower = want.toLowerCase()
  return Object.keys(projects).find((k) => toKey(k).toLowerCase() === lower)
}

export function isTrusted(cwd: string, claudeJsonPath: string = defaultPath()): boolean {
  const l = load(claudeJsonPath)
  if ('error' in l) return false
  const projects = l.data.projects
  if (!projects || typeof projects !== 'object') return false
  const key = findKey(projects as Json, cwd)
  if (key === undefined) return false
  return (projects as Json)[key] != null && ((projects as Json)[key] as Json).hasTrustDialogAccepted === true
}

/** Sets hasTrustDialogAccepted for exactly this folder in ~/.claude.json. Never touches a corrupt file. */
export function trustWorkspace(cwd: string, claudeJsonPath: string = defaultPath()): TrustResult {
  if (!cwd || !cwd.trim()) return { ok: false, message: 'No folder given' }
  const l = load(claudeJsonPath)
  if ('error' in l) return { ok: false, message: l.error }
  try {
    const raw = l.data.projects
    const projects: Json = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Json) : {}
    const key = findKey(projects, cwd) ?? toKey(cwd)
    const existing = projects[key]
    projects[key] = { ...(existing && typeof existing === 'object' ? (existing as Json) : {}), hasTrustDialogAccepted: true }
    l.data.projects = projects
    const bak = `${claudeJsonPath}.claudrift-bak`
    if (existsSync(claudeJsonPath) && !existsSync(bak)) copyFileSync(claudeJsonPath, bak)
    const tmp = join(dirname(claudeJsonPath), `.claude.json.claudrift-${process.pid}.tmp`)
    writeFileSync(tmp, JSON.stringify(l.data, null, l.indent), 'utf8')
    renameSync(tmp, claudeJsonPath)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
