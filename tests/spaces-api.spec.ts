/**
 * Project-space config CRUD tests: the pure route function over a real
 * temporary store (file-backed, atomic writes) — create/list/update/delete,
 * validation errors, 404/405 semantics, and persistence across reads.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { loadSpaces } from '../src/space-config.ts'
import { SpaceStore } from '../src/space-store.ts'
import { spacesApi } from '../src/spaces-api.ts'

describe('spaces API', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-crud-'))
  const rootA = join(base, 'root-a')
  const rootB = join(base, 'root-b')
  mkdirSync(rootA)
  mkdirSync(rootB)
  const configPath = join(base, 'spaces.json')
  const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG
  const store = new SpaceStore()

  function api(method: string, pathname: string, body?: unknown) {
    return spacesApi(store, method, pathname, body)
  }

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
    else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('starts empty and supports the mount smoke', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const ping = await api('GET', '/codex-project/api/ping')
    expect(ping.status).toBe(200)
    expect(ping.body).toEqual({ ok: true, plugin: 'dsh-codex-project' })
    const list = await api('GET', '/codex-project/api/spaces')
    expect(list.status).toBe(200)
    expect(list.body).toEqual({ ok: true, spaces: [] })
  })

  it('creates, lists, updates, and deletes a record', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const created = await api('POST', '/codex-project/api/spaces', { title: '我的工作区', roots: [rootA, rootB] })
    expect(created.status).toBe(201)
    const space = (created.body as { space: { id: string; title: string; roots: string[] } }).space
    expect(space.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(space.title).toBe('我的工作区')
    expect(space.roots).toEqual([rootA, rootB])

    const list = await api('GET', '/codex-project/api/spaces')
    expect(list.body).toEqual({ ok: true, spaces: [space] })

    const updated = await api('PUT', `/codex-project/api/spaces/${space.id}`, { title: '改名', roots: [rootA] })
    expect(updated.status).toBe(200)
    expect(updated.body).toEqual({ ok: true, space: { id: space.id, title: '改名', roots: [rootA] } })

    const removed = await api('DELETE', `/codex-project/api/spaces/${space.id}`)
    expect(removed.status).toBe(200)
    const after = await api('GET', '/codex-project/api/spaces')
    expect(after.body).toEqual({ ok: true, spaces: [] })
  })

  it('persists to the data file', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await api('POST', '/codex-project/api/spaces', { title: '持久', roots: [rootA] })
    expect(loadSpaces()).toHaveLength(1)
  })

  it('persists the workspaceId anchor and rejects malformed ones', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const created = await api('POST', '/codex-project/api/spaces', { workspaceId: 'w-1', roots: [rootA] })
    expect(created.status).toBe(201)
    expect((created.body as { space: { workspaceId?: string } }).space.workspaceId).toBe('w-1')

    const bad = await api('POST', '/codex-project/api/spaces', { workspaceId: '', roots: [rootA] })
    expect(bad.status).toBe(400)
    const nonString = await api('POST', '/codex-project/api/spaces', { workspaceId: 42, roots: [rootA] })
    expect(nonString.status).toBe(400)
  })

  it('allows the anchor to be re-set (the 设为主 handover)', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const created = await api('POST', '/codex-project/api/spaces', { workspaceId: 'w-1', roots: [rootA, rootB] })
    const id = (created.body as { space: { id: string } }).space.id
    const handed = await api('PUT', `/codex-project/api/spaces/${id}`, { workspaceId: 'w-2', roots: [rootB, rootA] })
    expect(handed.status).toBe(200)
    expect(handed.body).toEqual({ ok: true, space: { id, workspaceId: 'w-2', roots: [rootB, rootA] } })
  })

  it('rejects invalid input with 400', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const noRoots = await api('POST', '/codex-project/api/spaces', { roots: [] })
    expect(noRoots.status).toBe(400)
    const badBody = await api('POST', '/codex-project/api/spaces', 'nonsense')
    expect(badBody.status).toBe(400)
    const missingRoot = await api('POST', '/codex-project/api/spaces', { roots: [join(base, 'missing')] })
    expect(missingRoot.status).toBe(400)
    expect((missingRoot.body as { error: string }).error).toContain('not an existing directory')
  })

  it('returns 404 for unknown ids and 405 for unsupported methods', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const update = await api('PUT', '/codex-project/api/spaces/nope', { roots: [rootA] })
    expect(update.status).toBe(404)
    const remove = await api('DELETE', '/codex-project/api/spaces/nope')
    expect(remove.status).toBe(404)
    const method = await api('PATCH', '/codex-project/api/spaces')
    expect(method.status).toBe(405)
    const unknown = await api('GET', '/codex-project/api/other')
    expect(unknown.status).toBe(404)
  })
})
