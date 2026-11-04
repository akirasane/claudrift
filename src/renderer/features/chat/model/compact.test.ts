import { describe, expect, it } from 'vitest'
import { createConvState, reduce } from './reducer'

describe('compact events', () => {
  const base = createConvState({ convId: 'c', cwd: 'C:\p' })
  it('start adds one active marker, done replaces it with the token counts', () => {
    const a = reduce(reduce(base, { t: 'compact', phase: 'start' }, 0), { t: 'compact', phase: 'start' }, 0)
    expect(a.items).toHaveLength(1)
    expect(a.items[0]).toMatchObject({ kind: 'compact', active: true })
    const b = reduce(a, { t: 'compact', phase: 'done', trigger: 'auto', preTokens: 150000, postTokens: 20000 }, 0)
    expect(b.items).toHaveLength(1)
    expect(b.items[0]).toMatchObject({ kind: 'compact', active: false, trigger: 'auto', preTokens: 150000, postTokens: 20000 })
  })
  it('done without a start still adds a marker; failed marks it failed', () => {
    const d = reduce(base, { t: 'compact', phase: 'done', trigger: 'manual', preTokens: 1000 }, 0)
    expect(d.items[0]).toMatchObject({ kind: 'compact', active: false })
    const f = reduce(reduce(base, { t: 'compact', phase: 'start' }, 0), { t: 'compact', phase: 'failed' }, 0)
    expect(f.items[0]).toMatchObject({ kind: 'compact', failed: true, active: false })
  })
})
