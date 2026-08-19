import { describe, expect, it } from 'vitest'
import { applyFrontmatterPatch, parseFrontmatterScalars, setFrontmatterKey } from '../src/frontmatter.ts'

const SAMPLE = [
  '---',
  'name: review',
  'description: Code review guide',
  '---',
  '',
  '# Review',
  'Instructions body.',
  '',
].join('\n')

describe('setFrontmatterKey', () => {
  it('adds a key at the end of the frontmatter, preserving the body', () => {
    const out = setFrontmatterKey(SAMPLE, 'disable-model-invocation', true)
    expect(out).toBe([
      '---',
      'name: review',
      'description: Code review guide',
      'disable-model-invocation: true',
      '---',
      '',
      '# Review',
      'Instructions body.',
      '',
    ].join('\n'))
  })

  it('writes the raw disable-model-invocation key', () => {
    const out = setFrontmatterKey(SAMPLE, 'disable-model-invocation', true)!
    expect(out).toContain('disable-model-invocation: true')
    expect(out).not.toContain('modelInvocable:')
  })

  it('writes the raw user-invocable key', () => {
    const out = setFrontmatterKey(SAMPLE, 'user-invocable', false)!
    expect(out).toContain('user-invocable: false')
    expect(out).not.toContain('userInvocable:')
  })

  it('removes an existing key line byte-for-byte, restoring the original', () => {
    const withKey = setFrontmatterKey(SAMPLE, 'user-invocable', false)!
    const out = setFrontmatterKey(withKey, 'user-invocable', undefined)!
    expect(out).toBe(SAMPLE)
  })

  it('rewrites the key in place regardless of its current position', () => {
    const withKey = setFrontmatterKey(SAMPLE, 'disable-model-invocation', true)!
    const out = setFrontmatterKey(withKey, 'disable-model-invocation', false)!
    expect(out).toContain('disable-model-invocation: false')
    expect(out).not.toContain('disable-model-invocation: true')
    expect(out).toContain('# Review')
  })

  it('removes a middle key without merging the surrounding lines', () => {
    const src = '---\nname: a\ndisable-model-invocation: true\ndescription: b\n---\nbody'
    const out = setFrontmatterKey(src, 'disable-model-invocation', undefined)!
    expect(out).toBe('---\nname: a\ndescription: b\n---\nbody')
  })

  it('returns undefined for a file without a leading frontmatter block', () => {
    expect(setFrontmatterKey('# no frontmatter\n\nbody', 'disable-model-invocation', false)).toBeUndefined()
  })

  it('returns undefined for an unterminated frontmatter block', () => {
    expect(setFrontmatterKey('---\nname: x\n', 'disable-model-invocation', false)).toBeUndefined()
  })

  it('supports CRLF files and preserves CRLF on write', () => {
    const crlf = ['---', 'name: review', 'description: d', '---', '', 'body'].join('\r\n')
    const out = setFrontmatterKey(crlf, 'user-invocable', false)!
    expect(out).toContain('user-invocable: false')
    expect(out).toContain('\r\n')
    // round-trip: removing restores the exact original CRLF text
    const restored = setFrontmatterKey(out, 'user-invocable', undefined)!
    expect(restored).toBe(crlf)
  })

  it('reads CRLF scalar fields', () => {
    const crlf = ['---', 'name: probe', 'description: d', 'disable-model-invocation: true', '---'].join('\r\n')
    const data = parseFrontmatterScalars(crlf)
    expect(data).toMatchObject({ name: 'probe', description: 'd', 'disable-model-invocation': true })
  })
})

describe('applyFrontmatterPatch', () => {
  it('sets both keys and preserves everything else', () => {
    const out = applyFrontmatterPatch(SAMPLE, {
      'disable-model-invocation': true,
      'user-invocable': false,
    })!
    expect(out).toContain('disable-model-invocation: true')
    expect(out).toContain('user-invocable: false')
    expect(out).toContain('# Review')
    expect(out).toContain('Instructions body.')
    expect(out).toContain('name: review')
  })

  it('leaves omitted keys untouched', () => {
    const out = applyFrontmatterPatch(SAMPLE, { 'disable-model-invocation': true })!
    expect(out).toContain('disable-model-invocation: true')
    expect(out).not.toContain('user-invocable')
  })

  it('propagates the no-frontmatter failure', () => {
    expect(applyFrontmatterPatch('no frontmatter', { 'disable-model-invocation': true })).toBeUndefined()
  })

  it('removing the only key leaves an empty but valid frontmatter block', () => {
    const only = '---\nuser-invocable: true\n---\nbody'
    const out = applyFrontmatterPatch(only, { 'user-invocable': undefined })!
    expect(out.startsWith('---\n')).toBe(true)
    expect(out.endsWith('---\nbody')).toBe(true)
    expect(out).not.toContain('user-invocable')
  })
})