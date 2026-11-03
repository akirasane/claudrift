import { existsSync, renameSync } from 'node:fs'

export type UserDataMigration = 'none' | 'renamed' | 'kept-new' | 'use-old'

interface MigrationFs {
  exists(path: string): boolean
  rename(from: string, to: string): void
}

const nodeFs: MigrationFs = { exists: existsSync, rename: renameSync }

/**
 * One-time move of the pre-rename (ccwraper) userData dir to the Claudrift one.
 * - old missing, or new already present: nothing to do ('none' / 'kept-new').
 * - rename ok: 'renamed'.
 * - rename failed (locked, cross-device, permissions): 'use-old'; the caller points userData at the old dir
 *   so no settings are lost.
 */
export function migrateUserDataDir(oldDir: string, newDir: string, fs: MigrationFs = nodeFs): UserDataMigration {
  if (!fs.exists(oldDir)) return 'none'
  if (fs.exists(newDir)) return 'kept-new'
  try {
    fs.rename(oldDir, newDir)
    return 'renamed'
  } catch {
    return 'use-old'
  }
}
