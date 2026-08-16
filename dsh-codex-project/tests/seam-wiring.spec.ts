/**
 * Seam wiring tests: `wrapSandboxConfine` routes confine calls through the
 * dsh-codex-project runner exactly when a session's workspace owns
 * additional dirs, and passes everything else through to the original
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
  const configPath = join(base, 'dirs.json')
  const runnerPath = join(base, 'lib', 'runner.js')
  mkdirSync(join(base, 'lib'), { recursive: true })
  writeFileSync(runnerPath, '')
  const previousConfig = process.env.DSH_CODEX_PROJECT_CONFIG

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.DSH_CODEX_PROJECT_CONFIG
    else process.env.DSH_CODEX_PROJECT_CONFIG = previousConfig
  })

  function writeDirs(workspaces: Record<string, { path: string; dirs: string[] }>): void {
    writeFileSync(configPath, JSON.stringify({ workspaces }, null, 2))
    process.env.DSH_CODEX_PROJECT_CONFIG = configPath
  }

  it.runIf(isWin)('routes a workspace-write call inside a recorded workspace through the runner', () => {
    writeDirs({ w1: { path: wsA, dirs: [wsB] } })
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
    writeDirs({ w1: { path: wsA, dirs: [wsB] } })
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(wsA, 'read-only'))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it('passes calls outside every record through untouched', () => {
    writeDirs({ w1: { path: wsA, dirs: [wsB] } })
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(outside))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it('passes records without dirs through untouched (core-identical semantics)', () => {
    writeDirs({ w1: { path: wsA, dirs: [] } })
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it('passes single-root records through untouched (core-identical semantics)', () => {
    writeDirs({ w1: { path: wsA, dirs: [] } })
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it.runIf(isWin)('still routes through the runner when some added dirs are missing (narrowing)', () => {
    writeDirs({ w1: { path: wsA, dirs: [join(base, 'missing'), wsB] } })
    const { provider } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    // Narrowing: a dead dir is skipped, but the surviving dir keeps the
    // multi-root route active.
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv.slice(0, 2)).toEqual([process.execPath, runnerPath])
    expect(result.argv[result.argv.indexOf('--bind') + 1]).toBe(wsA)
    dispose()
  })

  it('passes through when all added dirs vanish (single root remains)', () => {
    writeDirs({ w1: { path: wsA, dirs: [join(base, 'missing')] } })
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    // Narrowing to a single root is core-identical: pass through.
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it.runIf(isWin)('unrelated dead records never affect other workspaces', () => {
    writeDirs({
      dead: { path: join(base, 'dead-path'), dirs: [join(base, 'dead-dir')] },
      w1: { path: wsA, dirs: [wsB] },
    })
    const { provider } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv.slice(0, 2)).toEqual([process.execPath, runnerPath])
    dispose()
  })

  it('restores the original confine on dispose', () => {
    writeDirs({ w1: { path: wsA, dirs: [wsB] } })
    const { provider } = fakeSandbox()
    const original = provider.confine
    const dispose = wrapSandboxConfine(provider, runnerPath)
    dispose()
    expect(provider.confine).toBe(original)
  })

  it('behaves as a pure pass-through on non-Windows hosts', () => {
    const { provider, calls } = fakeSandbox()
    const dispose = wrapSandboxConfine(provider, runnerPath)
    const result = provider.confine(['true'], policy(wsA))
    expect(result.argv).toEqual(['true'])
    expect(calls).toHaveLength(1)
    dispose()
  })

  it('keeps pass-through behavior when no records are configured', () => {
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
