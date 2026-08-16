/**
 * Host open-directory route tests: payload validation (absolute existing
 * directory only) and the file-manager spawn boundary.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { openDirectoryRequest } from '../src/open-directory.ts'

describe('openDirectoryRequest', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-codex-open-dir-test-'))
  const dirA = join(base, 'a')
  const fileA = join(base, 'a.txt')

  beforeAll(() => {
    mkdirSync(dirA, { recursive: true })
    writeFileSync(fileA, 'x', 'utf8')
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('spawns the file manager for an existing directory', () => {
    const opened: string[] = []
    const result = openDirectoryRequest({ path: dirA }, (path) => { opened.push(path) })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(opened).toEqual([dirA])
  })

  it('rejects a missing or non-string path', () => {
    expect(openDirectoryRequest(undefined).status).toBe(400)
    expect(openDirectoryRequest({}).status).toBe(400)
    expect(openDirectoryRequest({ path: 42 }).status).toBe(400)
    expect(openDirectoryRequest({ path: '' }).status).toBe(400)
  })

  it('rejects a relative path', () => {
    expect(openDirectoryRequest({ path: 'relative\\dir' }).status).toBe(400)
  })

  it('rejects a missing directory', () => {
    expect(openDirectoryRequest({ path: join(base, 'nope') }).status).toBe(404)
  })

  it('rejects a plain file', () => {
    expect(openDirectoryRequest({ path: fileA }).status).toBe(404)
  })

  it('reports an opener failure', () => {
    const result = openDirectoryRequest({ path: dirA }, () => { throw new Error('boom') })
    expect(result.status).toBe(500)
    expect(result.body).toMatchObject({ ok: false, error: 'boom' })
  })
})
