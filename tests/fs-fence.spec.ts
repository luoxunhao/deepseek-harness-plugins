/**
 * Multi-root fs fence tests: a real `CodexProjectFileSystem` over real
 * temporary directories. The fence is an in-process canonical containment
 * check (not a kernel boundary), so these tests exercise the exact mutation
 * paths the model tools use — write into every space root succeeds, writes
 * outside the space are denied with FS_SANDBOX_DENIED, and the core seam's
 * semantics hold verbatim outside any space.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { CodexProjectFileSystem } from '../src/fs.ts'

describe('CodexProjectFileSystem', () => {
  // Under the user's home, NOT under the temp area: the core writable-root
  // set includes the ambient temp root, so denied targets must live outside
  // it (denial assertions would otherwise be granted by the temp root).
  const base = mkdtempSync(join(homedir(), 'dsh-fs-'))
  const rootA = join(base, 'root-a')
  const rootB = join(base, 'root-b')
  const outside = join(base, 'outside')
  for (const dir of [rootA, rootB, outside]) mkdirSync(dir)
  const configPath = join(base, 'spaces.json')
  const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG
  // Direct construction bypasses the loader's schemastery defaults, so the
  // resolved config must be complete (as the loader would pass it), and the
  // sandboxPolicy service must exist for the inherited constructor.
  const ctx = new Context()
  ctx.provide('sandboxPolicy', {
    defaultMode: 'workspace-write',
    resolve: () => ({ mode: 'workspace-write', workspaceRoot: base }),
  })
  const fs = new CodexProjectFileSystem(ctx, { cwd: base, diffBasisMaxBytes: 10 * 1024 * 1024 })

  function policy(workspaceRoot: string, mode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write'): SandboxExecutionPolicy {
    return { mode, workspaceRoot }
  }

  async function write(path: string, mode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write'): Promise<{ ok: boolean; code?: string }> {
    const target = await fs.resolve(path)
    try {
      // The session workspace is root A (a session whose cwd is a space root).
      await fs.writeText(target, 'probe', undefined, undefined, policy(rootA, mode))
      return { ok: true }
    } catch (error) {
      return { ok: false, code: (error as { code?: string }).code }
    }
  }

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
    else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('writes into every root of a multi-root space', async () => {
    writeFileSync(configPath, JSON.stringify({ spaces: [{ id: 'space-1', roots: [rootA, rootB] }] }))
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    expect(await write(join(rootA, 'file-a.txt'))).toEqual({ ok: true })
    expect(await write(join(rootB, 'file-b.txt'))).toEqual({ ok: true })
    expect(await write(join(rootA, 'deep', 'nested', 'file.txt'))).toEqual({ ok: true })
  })

  it('denies writes outside the space with FS_SANDBOX_DENIED', async () => {
    writeFileSync(configPath, JSON.stringify({ spaces: [{ id: 'space-1', roots: [rootA, rootB] }] }))
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const result = await write(join(outside, 'file.txt'))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('FS_SANDBOX_DENIED')
  })

  it('keeps the core single-root semantics outside any space', async () => {
    delete process.env.DSH_CODEX_PROJECT_CONFIG
    expect(await write(join(rootA, 'file.txt'))).toEqual({ ok: true })
    const denied = await write(join(rootB, 'file.txt'))
    expect(denied.ok).toBe(false)
    expect(denied.code).toBe('FS_SANDBOX_DENIED')
  })

  it('keeps the core temp-area writability', async () => {
    writeFileSync(configPath, JSON.stringify({ spaces: [{ id: 'space-1', roots: [rootA, rootB] }] }))
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const tempTarget = join(tmpdir(), `dsh-fs-temp-${process.pid}`, 'file.txt')
    mkdirSync(join(tmpdir(), `dsh-fs-temp-${process.pid}`), { recursive: true })
    expect(await write(tempTarget)).toEqual({ ok: true })
    rmSync(join(tmpdir(), `dsh-fs-temp-${process.pid}`), { recursive: true, force: true })
  })

  it('denies every mutation under read-only', async () => {
    writeFileSync(configPath, JSON.stringify({ spaces: [{ id: 'space-1', roots: [rootA, rootB] }] }))
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    const denied = await write(join(rootA, 'file.txt'), 'read-only')
    expect(denied.ok).toBe(false)
    expect(denied.code).toBe('FS_SANDBOX_DENIED')
  })

  it('passes unfenced under danger-full-access', async () => {
    delete process.env.DSH_CODEX_PROJECT_CONFIG
    expect(await write(join(outside, 'file.txt'), 'danger-full-access')).toEqual({ ok: true })
  })

  it('fails loud when a configured space root is missing', async () => {
    writeFileSync(configPath, JSON.stringify({ spaces: [{ id: 'space-1', roots: [rootA, join(base, 'missing')] }] }))
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
    await expect(fs.writeText(
      await fs.resolve(join(rootA, 'file.txt')),
      'probe',
      undefined,
      undefined,
      policy(rootA),
    )).rejects.toThrow(/space space-1 root is not an existing directory/)
  })
})
