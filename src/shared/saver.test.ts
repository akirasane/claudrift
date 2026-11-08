import { describe, expect, it } from 'vitest'
import { DEFAULT_SAVER_PARTS, SAVER_COMPACT_TOKENS, SAVER_MODEL, saverOptions } from './saver'

describe('saverOptions', () => {
  it('is undefined when the mode is off, whatever the parts say', () => {
    expect(saverOptions({ ultraSaver: false, ultraSaverParts: DEFAULT_SAVER_PARTS })).toBeUndefined()
  })
  it('all parts on: ultra caveman env, Haiku, low effort, no thinking, 100k compaction', () => {
    expect(saverOptions({ ultraSaver: true, ultraSaverParts: DEFAULT_SAVER_PARTS })).toEqual({
      env: { CAVEMAN_DEFAULT_MODE: 'ultra' },
      model: SAVER_MODEL,
      effort: 'low',
      disableThinking: true,
      autoCompactWindow: SAVER_COMPACT_TOKENS
    })
  })
  it('each part switches on its own settings only', () => {
    const only = (k: 'caveman' | 'model' | 'compact') =>
      saverOptions({ ultraSaver: true, ultraSaverParts: { caveman: false, model: false, compact: false, [k]: true } })
    expect(only('caveman')).toEqual({ env: { CAVEMAN_DEFAULT_MODE: 'ultra' } })
    expect(only('model')).toEqual({ model: 'haiku', effort: 'low', disableThinking: true })
    expect(only('compact')).toEqual({ autoCompactWindow: 100_000 })
  })
  it('custom config flows into each part', () => {
    expect(
      saverOptions({
        ultraSaver: true,
        ultraSaverParts: DEFAULT_SAVER_PARTS,
        ultraSaverConfig: { cavemanMode: 'lite', model: 'sonnet', effort: 'medium', disableThinking: false, compactTokens: 150_000 }
      })
    ).toEqual({
      env: { CAVEMAN_DEFAULT_MODE: 'lite' },
      model: 'sonnet',
      effort: 'medium',
      autoCompactWindow: 150_000
    })
  })
  it('on with every part off changes nothing', () => {
    expect(saverOptions({ ultraSaver: true, ultraSaverParts: { caveman: false, model: false, compact: false } })).toBeUndefined()
  })
})
