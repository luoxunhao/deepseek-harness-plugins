/**
 * Seam wiring tests: `wrapSandboxConfine` routes confine calls through the
 * codex-project runner exactly when a session's workspace belongs to a
 * multi-root space, and passes everything else through to the original
 * confine untouched (the pure-superset contract). The wrapper's own
 * end-to-end confinement behavior is proven separately by
 * `scripts/proto-verify.mjs` against real restricted tokens.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConfinedArgv, SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { wrapSandboxConfine } from '../src/seam.ts'

const isWin = process.platform === 'win32'

/** A record-and-passthrough fake of the sandbox service. */
function fakeSandbox(): {
  provider: SandboxProvider
  calls: Array<{ argv: readonly string[]; policy: SandboxPolicy }>
} {
  const calls: Array<{ argv: readonly string[]; policy: SandboxPolicy }> = []
  const provider = {
    confine: (argv: readonly string[], policy: SandboxPolicy): ConfinedArgv => {
      calls.push({ argv, policy })
      return {
        argv: [...argv],
        enforcement: 'full',
        denialSignatures: [],
        runnerFailureRules: [],
      }
    },
  } as unknown as SandboxProvider
  return { provider, calls }
}

function policy(workspaceRoot: string, mode: 'read-only' | 'workspace-write' = 'workspace-write'): SandboxPolicy {
  return { mode, workspaceRoot }
}

describe('wrapSandboxConfine', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-seam-'))
  const wsA = join(base, 'ws-a')
  const wsB = join(base, 'ws-b')
  const outside = join(base, 'outside')
  for (const dir of [wsA, wsB, outside]) mkdirSync(dir)
  const configPath = join(base, 'spaces.json')
  const runnerPath = join(base, 'lib', 'runner.js')
  mkdirSync(join(base, 'lib'), { recursive: true })
  writeFileSync(runnerPath, '')
  const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
    else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
  })

  function writeSpaces(spaces: unknown[]): void {
    writeFileSync(configPath, JSON.stringify({ spaces }, null, 2))
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
  }

  it.runIf(isWin)('routes a workspace-write call inside a multi-root space through the runner', () => {
    writeSpaces([{ id: 'space-1', title: 'Proto', roots: [wsA, wsB] }])
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['pwsh', '/Command', 'echo hi'], policy(wsA))

    expect(result.argv.slice(0, 2)).toEqual([process.execPath, runnerPath])
    expect(result.argv.slice(2, 11)).toEqual(
      ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--tmpfs'],
    )
    expect(result.argv).toContain('--bind')
    expect(result.argv[result.argv.indexOf('--bind') + 1]).toBe(wsA)
    expect(result.argv[result.argv.indexOf('--bind') + 2]).toBe(wsA)
    expect(result.argv.slice(result.argv.indexOf('--') + 1)).toEqual(['pwsh', '/Command', 'echo hi'])
    expect(result.enforcement).toBe('partial')
    expect(result.denialSignatures).toContain('permission denied')
    expect(result.runnerFailureRules[0]?.fatalSignatures).toContain('codex-project-run: ')
    expect(calls).toHaveLength(0)
    dispose()
  })

  it('passes read-only calls through untouched', () => {
    writeSpaces([{ id: 'space-1', roots: [wsA, wsB] }])
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(wsA, 'read-only'))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it('passes calls outside every space through untouched', () => {
    writeSpaces([{ id: 'space-1', roots: [wsA, wsB] }])
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(outside))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it('passes single-root spaces through untouched (core-identical semantics)', () => {
    writeSpaces([{ id: 'space-1', roots: [wsA] }])
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it.runIf(isWin)('still routes through the runner when a configured space root is missing', () => {
    writeSpaces([{ id: 'space-1', roots: [wsA, join(base, 'missing')] }])
    const { provider } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    // Narrowing: the dead root no longer fails the confine — the runner
    // materializes grants on the surviving roots instead.
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv.slice(0, 2)).toEqual([process.execPath, runnerPath])
    expect(result.argv[result.argv.indexOf('--bind') + 1]).toBe(wsA)
    dispose()
  })

  it.runIf(isWin)('unrelated dead spaces never affect other sessions', () => {
    writeSpaces([
      { id: 'space-1', roots: [join(base, 'missing-1'), join(base, 'missing-2')] },
      { id: 'space-2', roots: [wsA, wsB] },
    ])
    const { provider } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    // The fully-dead space is skipped; the workspace still matches space-2.
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv.slice(0, 2)).toEqual([process.execPath, runnerPath])
    dispose()
  })

  it('restores the original confine on dispose', () => {
    writeSpaces([{ id: 'space-1', roots: [wsA, wsB] }])
    const { provider } = fakeSandbox()
    const original = provider.confine
    const dispose = wrapSandboxConfine(provider, runnerPath)
    dispose()
    expect(provider.confine).toBe(original)
  })

  it('behaves as a pure pass-through on non-Windows hosts', () => {
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    // The win32 branch is the only one that can route; the routing branch
    // itself is guarded by process.platform, exercised implicitly on this
    // machine. The pass-through path must be platform-independent.
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it('keeps pass-through behavior when no spaces are configured', () => {
    delete process.env.DSH_CODEX_PROJECT_CONFIG
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })
})
