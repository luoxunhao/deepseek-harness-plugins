import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

describe('dsh-codex-project plugin export shape', () => {
  it('exports the loader plugin shape', () => {
    expect(plugin.name).toBe('dsh-codex-project')
    expect(plugin.inject).toContain('webServer')
    expect(typeof plugin.apply).toBe('function')
  })
})
