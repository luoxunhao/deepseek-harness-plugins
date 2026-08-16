/**
 * Old-format → subspace lazy migration tests: anchoring anchor-less space
 * records to the registered workspace whose path matches a root, moving the
 * host root to roots[0], persisting the rewritten file, and staying
 * idempotent (anchored records are never re-rewritten; unmatched records
 * stay anchor-less and path-matched).
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { migrateSpacesToSubspaces, type WorkspaceRegistryFace } from '../src/space-migration.ts'
import { loadSpaces } from '../src/space-config.ts'

describe('subspace migration', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-migrate-'))
  const hostA = join(base, 'host-a')
  const extraB = join(base, 'extra-b')
  const extraC = join(base, 'extra-c')
  mkdirSync(hostA, { recursive: true })
  mkdirSync(extraB, { recursive: true })
  mkdirSync(extraC, { recursive: true })
  const configPath = join(base, 'spaces.json')
  const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG

  const registry: WorkspaceRegistryFace = {
    list: () => [{ id: 'w-a', path: hostA }],
  }

  function writeConfig(spaces: unknown[]): void {
    writeFileSync(configPath, JSON.stringify({ spaces }), 'utf8')
  }

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
    else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('anchors an old-format record and moves the host root to roots[0]', () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    // Old format: no workspaceId, host root NOT first.
    writeConfig([{ id: 's1', title: '我的空间', roots: [extraB, hostA, extraC] }])

    expect(migrateSpacesToSubspaces(registry)).toBe(true)

    const spaces = loadSpaces()
    expect(spaces).toHaveLength(1)
    expect(spaces[0]!.workspaceId).toBe('w-a')
    expect(spaces[0]!.roots).toEqual([hostA, extraB, extraC])
    expect(spaces[0]!.title).toBe('我的空间')
    // The file was rewritten with the anchor.
    const persisted = JSON.parse(readFileSync(configPath, 'utf8')) as { spaces: Array<{ workspaceId?: string }> }
    expect(persisted.spaces[0]!.workspaceId).toBe('w-a')
  })

  it('is idempotent: anchored records are left untouched', () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    writeConfig([{ id: 's1', workspaceId: 'w-other', title: '已有锚点', roots: [extraB, hostA] }])
    expect(migrateSpacesToSubspaces(registry)).toBe(false)
    const spaces = loadSpaces()
    expect(spaces[0]!.workspaceId).toBe('w-other')
    // The host root is NOT moved (the anchor pre-dates the migration).
    expect(spaces[0]!.roots).toEqual([extraB, hostA])
  })

  it('keeps unmatched records anchor-less and path-matched', () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    writeConfig([{ id: 's1', roots: [extraC] }])
    expect(migrateSpacesToSubspaces(registry)).toBe(false)
    const spaces = loadSpaces()
    expect(spaces[0]!.workspaceId).toBeUndefined()
    expect(spaces[0]!.roots).toEqual([extraC])
  })

  it('migrates several records in one pass and handles an empty config', () => {
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    writeConfig([
      { id: 's1', roots: [extraB, hostA] },
      { id: 's2', roots: [hostA, extraC] },
      { id: 's3', roots: [extraC] },
    ])
    expect(migrateSpacesToSubspaces(registry)).toBe(true)
    const spaces = loadSpaces()
    expect(spaces.map(space => space.workspaceId)).toEqual(['w-a', 'w-a', undefined])
    expect(spaces[0]!.roots).toEqual([hostA, extraB])
    expect(spaces[1]!.roots).toEqual([hostA, extraC])

    writeConfig([])
    expect(migrateSpacesToSubspaces(registry)).toBe(false)
  })
})
