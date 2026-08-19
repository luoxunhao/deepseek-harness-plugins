/**
 * Additional-dir config API tests: the pure route function over a real
 * temporary store — GET/PUT semantics, auto-anchoring, validation, 404/405,
 * and persistence. A registry-backed workspace with no recorded dirs reads
 * as empty (200), and its first PUT anchors the record.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { loadWorkspaceDirs } from '../src/dirs-config.ts'
import { DirsStore } from '../src/dirs-store.ts'
import type { WorkspaceRegistryFace } from '../src/dirs-store.ts'
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

  const registry: WorkspaceRegistryFace = {
    list: () => [
      { id: 'w-known', path: rootA },
      { id: 'w-add', path: rootB },
    ],
  }

  function api(method: string, pathname: string, body?: unknown) {
    return dirsApi(store, registry, method, pathname, body)
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
    await store.anchor('w-known', rootA)
    const dirs = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-known', dirs: [rootB] })
    expect(dirs.status).toBe(200)
    expect((dirs.body as { dirs: string[] }).dirs).toEqual([rootB])

    const listed = await api('GET', '/codex-project/api/dirs?workspaceId=w-known')
    expect(listed.status).toBe(200)
    expect((listed.body as { dirs: string[] }).dirs).toEqual([rootB])
  })

  it('persists to the data file', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w-known', rootA)
    await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-known', dirs: [rootB] })
    expect(loadWorkspaceDirs()['w-known']?.dirs).toEqual([rootB])
  })

  it('clears dirs with an empty array without deleting the record', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w-known', rootA)
    const cleared = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-known', dirs: [] })
    expect(cleared.status).toBe(200)
    expect((cleared.body as { dirs: string[] }).dirs).toEqual([])
    expect(loadWorkspaceDirs()['w-known']?.path).toBe(rootA)
  })

  it('dedupes duplicate dirs', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w-known', rootA)
    const set = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-known', dirs: [rootB, rootB] })
    expect((set.body as { dirs: string[] }).dirs).toEqual([rootB])
  })

  it('reads a registry workspace WITHOUT a record as an empty list (200)', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const listed = await api('GET', '/codex-project/api/dirs?workspaceId=w-add')
    expect(listed.status).toBe(200)
    expect(listed.body).toEqual({ ok: true, dirs: [] })
  })

  it('anchors automatically on the first PUT for an unrecorded registry workspace', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const put = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-add', dirs: [rootA] })
    expect(put.status).toBe(200)
    const record = loadWorkspaceDirs()['w-add']
    expect(record?.path).toBe(rootB)
    expect(record?.dirs).toEqual([rootA])
  })

  it('rejects a completely unknown workspace id with 404', async () => {
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
    const badDirs = await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-known', dirs: 'no' })
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

describe('project folder API (/project and /list)', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-project-'))
  const rootA = join(base, 'root-a')
  const rootB = join(base, 'root-b')
  const gone = join(base, 'gone-dir')
  mkdirSync(rootA)
  mkdirSync(rootB)
  // A nested file + dir inside the main root for listing assertions.
  const inner = join(rootA, 'inner')
  mkdirSync(inner)
  writeFileSync(join(inner, 'a.ts'), 'export const a = 1')
  writeFileSync(join(rootA, 'top.txt'), 'hi')
  const configPath = join(base, 'dirs.json')
  const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG
  const store = new DirsStore()

  const registry: WorkspaceRegistryFace = {
    list: () => [
      { id: 'w-known', path: rootA },
      { id: 'w-other', path: rootB },
    ],
  }

  function api(method: string, pathname: string, body?: unknown) {
    return dirsApi(store, registry, method, pathname, body)
  }

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
    else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
    rmSync(configPath, { force: true })
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('returns project null when no record anchors the cwd', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const res = await api('GET', `/codex-project/api/project?cwd=${encodeURIComponent(rootB)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, project: null })
  })

  it('resolves the project anchored at the cwd with its shared dirs', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w-known', rootA)
    await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-known', dirs: [rootB] })
    const res = await api('GET', `/codex-project/api/project?cwd=${encodeURIComponent(rootA)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      project: { workspaceId: 'w-known', path: rootA, dirs: [rootB], missingDirs: [] },
    })
  })

  it('reports a vanished shared dir in missingDirs instead of failing', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w-known', rootA)
    await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-known', dirs: [rootB, gone] })
    const res = await api('GET', `/codex-project/api/project?cwd=${encodeURIComponent(rootA)}`)
    expect(res.status).toBe(200)
    const project = (res.body as { project: { dirs: string[]; missingDirs: string[] } }).project
    expect(project.dirs).toEqual([rootB])
    expect(project.missingDirs).toEqual([gone])
  })

  it('requires the cwd query parameter', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const res = await api('GET', '/codex-project/api/project')
    expect(res.status).toBe(400)
  })

  it('lists a project-root directory level', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w-known', rootA)
    const res = await api('GET', `/codex-project/api/list?cwd=${encodeURIComponent(rootA)}&path=${encodeURIComponent(rootA)}`)
    expect(res.status).toBe(200)
    const body = res.body as { ok: boolean; path: string; entries: Array<{ name: string; isDir: boolean }> }
    expect(body.ok).toBe(true)
    // dirs-first sort: 'inner' before 'top.txt'
    expect(body.entries.map(entry => entry.name)).toEqual(['inner', 'top.txt'])
    expect(body.entries[0]!.isDir).toBe(true)
    expect(body.entries[1]!.isDir).toBe(false)
  })

  it('fences listing to the project roots (403 outside)', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w-known', rootA)
    const outside = join(base, 'elsewhere')
    mkdirSync(outside)
    const res = await api('GET', `/codex-project/api/list?cwd=${encodeURIComponent(rootA)}&path=${encodeURIComponent(outside)}`)
    expect(res.status).toBe(403)
  })

  it('falls back to the cwd root when no project is configured', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    // No project anchors rootB: the tab's fallback lists the session's own cwd.
    const inside = await api('GET', `/codex-project/api/list?cwd=${encodeURIComponent(rootB)}&path=${encodeURIComponent(rootB)}`)
    expect(inside.status).toBe(200)
    expect((inside.body as { ok: boolean }).ok).toBe(true)
    // Still fenced to that cwd: a path outside it is rejected.
    const outside = await api('GET', `/codex-project/api/list?cwd=${encodeURIComponent(rootB)}&path=${encodeURIComponent(rootA)}`)
    expect(outside.status).toBe(403)
  })

  it('allows listing a surviving shared dir (cross-drive-style root)', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await store.anchor('w-known', rootA)
    await api('PUT', '/codex-project/api/dirs', { workspaceId: 'w-known', dirs: [rootB] })
    const res = await api('GET', `/codex-project/api/list?cwd=${encodeURIComponent(rootA)}&path=${encodeURIComponent(rootB)}`)
    expect(res.status).toBe(200)
  })
})

describe('project file API (/read, /write, /file)', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-file-'))
  const rootA = join(base, 'root-a')
  mkdirSync(rootA)
  const textFile = join(rootA, 'note.md')
  writeFileSync(textFile, '# hello')
  const imageFile = join(rootA, 'pic.png')
  writeFileSync(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const configPath = join(base, 'dirs.json')
  const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG
  const store = new DirsStore()

  const registry: WorkspaceRegistryFace = {
    list: () => [{ id: 'w-known', path: rootA }],
  }

  function api(method: string, pathname: string, body?: unknown) {
    return dirsApi(store, registry, method, pathname, body)
  }

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
    else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
    rmSync(configPath, { force: true })
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('reads a text file within the project roots', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const res = await api('GET', `/codex-project/api/read?cwd=${encodeURIComponent(rootA)}&path=${encodeURIComponent(textFile)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, path: textFile, content: '# hello', truncated: false })
  })

  it('writes and re-reads a file', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const target = join(rootA, 'nested', 'out.ts')
    const written = await api('POST', '/codex-project/api/write', { cwd: rootA, path: target, content: 'export const x = 1' })
    expect(written.status).toBe(200)
    expect(written.body).toEqual({ ok: true, path: target })
    const res = await api('GET', `/codex-project/api/read?cwd=${encodeURIComponent(rootA)}&path=${encodeURIComponent(target)}`)
    expect(res.status).toBe(200)
    expect((res.body as { content: string }).content).toBe('export const x = 1')
  })

  it('fences read/write to the project roots (403 outside)', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const outside = join(base, 'elsewhere.txt')
    const read = await api('GET', `/codex-project/api/read?cwd=${encodeURIComponent(rootA)}&path=${encodeURIComponent(outside)}`)
    expect(read.status).toBe(403)
    const write = await api('POST', '/codex-project/api/write', { cwd: rootA, path: outside, content: 'x' })
    expect(write.status).toBe(403)
  })

  it('serves raw bytes with a media content type', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const res = await api('GET', `/codex-project/api/file?cwd=${encodeURIComponent(rootA)}&path=${encodeURIComponent(imageFile)}`)
    expect(res.status).toBe(200)
    expect(res.contentType).toBe('image/png')
    expect(res.raw).toBeDefined()
    expect(res.raw!.length).toBe(4)
  })

  it('serves a download disposition for ?download=1', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const res = await api('GET', `/codex-project/api/file?cwd=${encodeURIComponent(rootA)}&path=${encodeURIComponent(imageFile)}&download=1`)
    expect(res.status).toBe(200)
    expect(res.headers!['content-disposition']).toContain('pic.png')
  })

  it('rejects invalid or missing bodies', async () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const missingPath = await api('POST', '/codex-project/api/write', { cwd: rootA, content: 'x' })
    expect(missingPath.status).toBe(400)
    const badContent = await api('POST', '/codex-project/api/write', { cwd: rootA, path: join(rootA, 'x.txt'), content: 5 })
    expect(badContent.status).toBe(400)
    const noQuery = await api('GET', '/codex-project/api/read')
    expect(noQuery.status).toBe(400)
  })
})
