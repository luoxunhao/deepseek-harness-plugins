/**
 * Additional-dir config API tests: the pure route function over a real
 * temporary store — GET/PUT semantics, validation, 404/405, and persistence.
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { loadWorkspaceDirs } from '../src/dirs-config.ts'
import { DirsStore } from '../src/dirs-store.ts'
import { dirsApi } from '../src/dirs-api.ts'

describe('dirs API', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-crud-'))
  const rootA = join(base, 'root-a')
  const rootB = join(base, 'root-b')
  mkdirSync(rootA)
  mkdirSync(rootB)
  const configPath = join(base, 'dirs.json')
  const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG
  const store = new DirsStore()

  function api(method: string, pathname: string, body?: unknown) {
    return dirsApi(store, method, pathname, body)
  }

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
    else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
    rmSync(configPath, { force: true })
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('starts empty and supports the mount smoke', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const ping = await api('GET', '/codex-project/api/ping')
    expect(ping.status).toBe(200)
    expect(ping.body).toEqual({ ok: true, plugin: 'dsh-codex-project' })
    const list = await api('GET', '/codex-project/api/dirs')
    expect(list.status).toBe(200)
    expect(list.body).toEqual({ ok: true, spaces: {} })
  })

  it('anchors a record, then sets and lists its dirs', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w1', rootA)
    const dirs = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w1', dirs: [rootB] })
    expect(dirs.status).toBe(200)
    expect((dirs.body as { dirs: string[] }).dirs).toEqual([rootB])

    const listed = await api('GET', '/codex-project/api/dirs?workspaceId=w1')
    expect(listed.status).toBe(200)
    expect((listed.body as { dirs: string[] }).dirs).toEqual([rootB])
  })

  it('persists to the data file', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w1', rootA)
    await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w1', dirs: [rootB] })
    expect(loadWorkspaceDirs().w1?.dirs).toEqual([rootB])
  })

  it('clears dirs with an empty array without deleting the record', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w1', rootA)
    const cleared = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w1', dirs: [] })
    expect(cleared.status).toBe(200)
    expect((cleared.body as { dirs: string[] }).dirs).toEqual([])
    expect(loadWorkspaceDirs().w1?.path).toBe(rootA)
  })

  it('dedupes duplicate dirs', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w1', rootA)
    const set = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w1', dirs: [rootB, rootB] })
    expect((set.body as { dirs: string[] }).dirs).toEqual([rootB])
  })

  it('rejects unknown workspace ids with 404', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const get = await api('GET', '/codex-project/api/dirs?workspaceId=nope')
    expect(get.status).toBe(404)
    const put = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'nope', dirs: [rootB] })
    expect(put.status).toBe(404)
  })

  it('rejects invalid input with 400', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const badBody = await api('PUT', '/codex-project/api/dirs', 'nonsense')
    expect(badBody.status).toBe(400)
    const missingId = await api('PUT', '/codex-project/api/dirs', { dirs: [rootB] })
    expect(missingId.status).toBe(400)
    const badDirs = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w1', dirs: 'no' })
    expect(badDirs.status).toBe(400)
  })

  it('returns 405 for unsupported methods and 404 for unknown routes', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const method = await api('POST', '/codex-project/api/dirs')
    expect(method.status).toBe(405)
    const unknown = await api('GET', '/codex-project/api/other')
    expect(unknown.status).toBe(404)
  })
})
