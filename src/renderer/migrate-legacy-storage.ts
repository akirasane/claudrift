/**
 * One-time copy of pre-rename `ccwrap.*` localStorage keys to `claudrift.*` (only when the new key is absent).
 * Old keys are left in place. Must run before any store reads localStorage.
 */
const OLD_PREFIX = 'ccwrap.'
const NEW_PREFIX = 'claudrift.'

export function migrateLegacyStorage(storage: Storage = window.localStorage): number {
  let copied = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.startsWith(OLD_PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      const nk = NEW_PREFIX + k.slice(OLD_PREFIX.length)
      if (storage.getItem(nk) !== null) continue
      const v = storage.getItem(k)
      if (v === null) continue
      storage.setItem(nk, v)
      copied++
    }
  } catch {
    // storage unavailable: nothing to migrate
  }
  return copied
}

migrateLegacyStorage()
