/**
 * Additional-dir fs fence tests: a real `CodexProjectFileSystem` over real
 * temporary directories. Writes into the workspace path and every added dir
 * succeed; outside denied with FS_SANDBOX_DENIED; a record without dirs and
 * workspaces outside every record keep the core single-root semantics.
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
  const workspace = join(base, 'workspace')
  const extraA = join(base, 'extra-a')
  const extraB = join(base, 'extra-b')
  const outside = join(base, 'outside')
  for (const dir of [workspace, extraA, extraB, outside]) mkdirSync(dir)
  const configPath = join(base, 'dirs.json')
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

  function writeConfig(workspaces: Record<string, { path: string; dirs: string[] }>): void {
    writeFileSync(configPath, JSON.stringify({ workspaces }), 'utf8')
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
  }

  async function write(path: string, mode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write'): Promise<{ ok: boolean; code?: string }> {
    const target = await fs.resolve(path)
    try {
      await fs.writeText(target, 'probe', undefined, undefined, policy(workspace, mode))
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

  it('writes into the workspace path and every added dir of a recorded workspace', async () => {
    writeConfig({ w1: { path: workspace, dirs: [extraA, extraB] } })
    expect(await write(join(workspace, 'main.txt'))).toEqual({ ok: true })
    expect(await write(join(extraA, 'probe.txt'))).toEqual({ ok: true })
    expect(await write(join(extraB, 'deep', 'nested', 'file.txt'))).toEqual({ ok: true })
  })

  it('denies writes outside the workspace with FS_SANDBOX_DENIED', async () => {
    writeConfig({ w1: { path: workspace, dirs: [extraA] } })
    const denied = await write(join(outside, 'file.txt'))
    expect(denied.ok).toBe(false)
    expect(denied.code).toBe('FS_SANDBOX_DENIED')
  })

  it('keeps the core single-root semantics for a record without dirs', async () => {
    writeConfig({ w1: { path: workspace, dirs: [] } })
    expect(await write(join(workspace, 'file.txt'))).toEqual({ ok: true })
    const denied = await write(join(extraA, 'file.txt'))
    expect(denied.ok).toBe(false)
    expect(denied.code).toBe('FS_SANDBOX_DENIED')
  })

  it('keeps the core single-root semantics outside every record', async () => {
    writeConfig({})
    expect(await write(join(workspace, 'file.txt'))).toEqual({ ok: true })
  })

  it('keeps the core temp-area writability', async () => {
    writeConfig({ w1: { path: workspace, dirs: [extraA] } })
    const tempTarget = join(tmpdir(), `dsh-fs-temp-${process.pid}`, 'file.txt')
    mkdirSync(join(tmpdir(), `dsh-fs-temp-${process.pid}`), { recursive: true })
    expect(await write(tempTarget)).toEqual({ ok: true })
    rmSync(join(tmpdir(), `dsh-fs-temp-${process.pid}`), { recursive: true, force: true })
  })

  it('denies every mutation under read-only', async () => {
    writeConfig({ w1: { path: workspace, dirs: [extraA] } })
    const denied = await write(join(workspace, 'file.txt'), 'read-only')
    expect(denied.ok).toBe(false)
    expect(denied.code).toBe('FS_SANDBOX_DENIED')
  })

  it('passes unfenced under danger-full-access', async () => {
    writeConfig({})
    expect(await write(join(outside, 'file.txt'), 'danger-full-access')).toEqual({ ok: true })
  })

  it('narrows silently when an added dir vanishes (no throw, others still writable)', async () => {
    const transient = join(base, 'transient')
    mkdirSync(transient)
    writeConfig({ w1: { path: workspace, dirs: [transient, extraA] } })
    expect(await write(join(transient, 'file.txt'))).toEqual({ ok: true })
    expect(await write(join(extraA, 'file.txt'))).toEqual({ ok: true })
    rmSync(transient, { recursive: true, force: true })
    // The surviving roots stay writable; no space-level fail-loud throw.
    expect(await write(join(extraA, 'file.txt'))).toEqual({ ok: true })
    expect(await write(join(workspace, 'file.txt'))).toEqual({ ok: true })
  })

  it('self-heals without restart: a restored dir re-enters the writable set', async () => {
    const transient = join(base, 'transient2')
    mkdirSync(transient)
    writeConfig({ w1: { path: workspace, dirs: [transient] } })
    expect(await write(join(transient, 'file.txt'))).toEqual({ ok: true })
    rmSync(transient, { recursive: true, force: true })
    expect(await write(join(workspace, 'file.txt'))).toEqual({ ok: true })
    mkdirSync(transient)
    expect(await write(join(transient, 'file.txt'))).toEqual({ ok: true })
  })

  it('unrelated records never affect each other', async () => {
    writeConfig({
      w1: { path: workspace, dirs: [extraA] },
      w2: { path: extraB, dirs: [] },
    })
    expect(await write(join(extraA, 'file.txt'))).toEqual({ ok: true })
    // A cwd matching w1 grants only w1's roots; extraB (w2's path) stays
    // outside w1's writable set even though w2 exists separately.
    const denied = await write(join(extraB, 'file.txt'))
    expect(denied.ok).toBe(false)
    expect(denied.code).toBe('FS_SANDBOX_DENIED')
    const outsideDenied = await write(join(outside, 'file.txt'))
    expect(outsideDenied.ok).toBe(false)
    expect(outsideDenied.code).toBe('FS_SANDBOX_DENIED')
  })
})
