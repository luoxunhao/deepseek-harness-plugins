/**
 * add-dir tool tests: approval all branches, validation, workspace
 * resolution, and idempotence — the pure defineAddDirTool over injected deps.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AddDirToolDeps } from '../src/add-dir.ts'
import { defineAddDirTool } from '../src/add-dir.ts'
import { DirsStore } from '../src/dirs-store.ts'

const base = mkdtempSync(join(tmpdir(), 'dsh-adddir-'))
const workspacePath = join(base, 'ws')
const dirA = join(base, 'dir-a')
const missingDir = join(base, 'missing')
const configPath = join(base, 'dirs.json')
const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG

beforeEach(() => {
  mkdirSync(workspacePath, { recursive: true })
  mkdirSync(dirA, { recursive: true })
  process.env.DSH_CODEX_PROJECT_CONFIG = configPath
})

afterEach(() => {
  if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
  else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
  rmSync(configPath, { force: true })
})

function makeDeps(requestApproval: (path: string) => Promise<ApprovalOutcome>): {
  deps: AddDirToolDeps
  store: DirsStore
} {
  const store = new DirsStore()
  const deps: AddDirToolDeps = {
    resolveWorkspaceId: cwd => (cwd === workspacePath ? 'w1' : undefined),
    requestApproval: (_agent, path, _signal) => requestApproval(path),
    store,
  }
  return { deps, store }
}

function run(deps: AddDirToolDeps, path: string, cwd = workspacePath): Promise<unknown> {
  const tool = defineAddDirTool(deps)
  return tool.execute({ path }, {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } } as unknown as Agent,
  } as never)
}

describe('add-dir tool', () => {
  it('requires an existing directory and rejects non-absolute or missing paths', async () => {
    const { deps } = makeDeps(async () => 'allowed-once' as const)

    const rel = await run(deps, 'relative/path')
    expect(rel).toMatchObject({ ok: false, reason: 'path must be an absolute existing directory' })

    const missing = await run(deps, missingDir)
    expect(missing).toMatchObject({ ok: false, reason: `not an existing directory: ${missingDir}` })
  })

  it('writes on allowed-once approval and returns the updated list', async () => {
    const { deps, store } = makeDeps(async () => 'allowed-once' as const)
    await store.anchor('w1', workspacePath)

    const result = await run(deps, dirA)
    expect(result).toEqual({ ok: true, dirs: [dirA] })
    // Persisted too (the store is the single source of truth).
    expect(await store.load()).toMatchObject({ w1: { path: workspacePath, dirs: [dirA] } })
  })

  it('does not write on rejected or unavailable approval', async () => {
    for (const outcome of ['rejected', 'unavailable'] as const) {
      const { deps, store } = makeDeps(async () => outcome)
      await store.anchor('w1', workspacePath)
      const result = await run(deps, dirA)
      expect(result).toMatchObject({ ok: false, reason: `approval ${outcome}` })
      expect(await store.load()).toMatchObject({ w1: { path: workspacePath, dirs: [] } })
      rmSync(configPath, { force: true })
    }
  })

  it('rejects when the session is outside every registered workspace', async () => {
    mkdirSync(join(base, 'other'), { recursive: true })
    const { deps } = makeDeps(async () => 'allowed-once' as const)
    const result = await run(deps, dirA, join(base, 'other'))
    expect(result).toMatchObject({ ok: false, reason: 'session is not inside a registered workspace' })
  })

  it('rejects a call whose agent has no cwd', async () => {
    const { deps } = makeDeps(async () => 'allowed-once' as const)
    const tool = defineAddDirTool(deps)
    const result = await tool.execute({ path: dirA }, {
      signal: new AbortController().signal,
      agent: { session: { header: {} } } as unknown as Agent,
    } as never)
    expect(result).toMatchObject({ ok: false, reason: 'session has no working directory' })
  })

  it('is idempotent: adding an existing dir keeps the list unchanged', async () => {
    const { deps, store } = makeDeps(async () => 'allowed-once' as const)
    await store.anchor('w1', workspacePath)
    await store.setDirs('w1', [dirA])
    const result = await run(deps, dirA)
    expect(result).toEqual({ ok: true, dirs: [dirA] })
  })
})
