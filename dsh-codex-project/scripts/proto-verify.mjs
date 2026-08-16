/**
 * Prototype verification for the additional-dir codex-project runner.
 * Proves the mechanism end to end on Windows with real restricted tokens:
 *
 *   A. delegation parity   — no config: wrapper ≡ core seam behavior
 *                            (workspace writable, sibling dir denied)
 *   B. additional dirs     — workspace SID granted on path + added dirs:
 *                            both writable, outside denied
 *   C. read-only           — no grants: every target denied
 *   D. core-seam equivalence — the delegation branch reproduces the core
 *                            seam's own grant+runner output byte-for-byte
 *   E. failure contract    — unknown arg fails loud with the runner
 *                            signature + exit 127; a record whose added dir
 *                            vanished NARROWS (survivors writable, dead dir
 *                            naturally denied) instead of failing
 *   F. exit-code mirror    — the confined child's exit code passes through
 *
 * Test directories live under the user's home (no Everyone-write
 * inheritance), like real project workspaces. Run with `pnpm proto:verify`
 * after `pnpm build`; requires Windows + the plugin's node_modules.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const runnerPath = join(pluginRoot, 'lib', 'runner.js')

const PROBE = `
const fs = require('node:fs')
const path = require('node:path')
for (const p of process.argv.slice(1)) {
  try {
    fs.writeFileSync(path.join(p, 'probe.txt'), 'probe')
    console.log('WRITE-OK ' + p)
  } catch (e) {
    console.log('WRITE-DENIED ' + p + ' (' + e.code + ')')
  }
}
`

const EXIT_PROBE = `process.exit(42)`

let failures = 0

function check(name, condition, detail) {
  const line = `[${condition ? 'PASS' : 'FAIL'}] ${name}${condition ? '' : ' — ' + detail}`
  console.log(line)
  if (!condition) failures++
}

function probeLines(stdout) {
  const lines = new Map()
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(WRITE-OK|WRITE-DENIED) (.+?)(?: \((.+)\))?$/.exec(line)
    if (match) lines.set(match[2], match[1])
  }
  return lines
}

function runWrapper(env, args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: 'utf8', env })
}

function bwrapArgs(mode, workspace, command, args) {
  const profile =
    mode === 'workspace-write'
      ? ['--tmpfs', '/tmp', '--bind', workspace, workspace]
      : ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent']
  return [...profile, '--', ...command, ...args]
}

const base = mkdtempSync(join(homedir(), 'dsh-space-proto-'))
const wsA = join(base, 'ws-a')
const wsB = join(base, 'ws-b')
const outside = join(base, 'outside')
for (const dir of [wsA, wsB, outside]) mkdirSync(dir)

try {
  // --- A. delegation: no config -------------------------------------------
  {
    const result = runWrapper(process.env, bwrapArgs('workspace-write', wsA, [process.execPath, '-e', PROBE], [wsA, outside]))
    const lines = probeLines(result.stdout)
    check('A status 0', result.status === 0, `status=${result.status} stderr=${result.stderr}`)
    check('A workspace writable', lines.get(wsA) === 'WRITE-OK', `got ${lines.get(wsA)}`)
    check('A sibling denied', lines.get(outside) === 'WRITE-DENIED', `got ${lines.get(outside)}`)
  }

  // --- B. additional dirs ------------------------------------------------
  const spacesPath = join(base, 'dirs.json')
  const spacesEnv = { ...process.env, DSH_CODEX_PROJECT_CONFIG: spacesPath }
  {
    writeDirs(spacesPath, { w1: { path: wsA, dirs: [wsB] } })
    const result = runWrapper(spacesEnv, bwrapArgs('workspace-write', wsA, [process.execPath, '-e', PROBE], [wsA, wsB, outside]))
    const lines = probeLines(result.stdout)
    check('B status 0', result.status === 0, `status=${result.status} stderr=${result.stderr}`)
    check('B workspace writable', lines.get(wsA) === 'WRITE-OK', `got ${lines.get(wsA)}`)
    check('B added dir writable', lines.get(wsB) === 'WRITE-OK', `got ${lines.get(wsB)}`)
    check('B outside denied', lines.get(outside) === 'WRITE-DENIED', `got ${lines.get(outside)}`)
    check('B probe.txt in wsA', existsSync(join(wsA, 'probe.txt')))
    check('B probe.txt in wsB', existsSync(join(wsB, 'probe.txt')))
  }

  // --- C. read-only ------------------------------------------------------
  {
    const result = runWrapper(process.env, bwrapArgs('read-only', null, [process.execPath, '-e', PROBE], [wsA, wsB, outside]))
    const lines = probeLines(result.stdout)
    check('C status 0', result.status === 0, `status=${result.status} stderr=${result.stderr}`)
    check('C wsA denied', lines.get(wsA) === 'WRITE-DENIED', `got ${lines.get(wsA)}`)
    check('C wsB denied', lines.get(wsB) === 'WRITE-DENIED', `got ${lines.get(wsB)}`)
    check('C outside denied', lines.get(outside) === 'WRITE-DENIED', `got ${lines.get(outside)}`)
  }

  // --- D. core-seam equivalence (delegation branch) ----------------------
  {
    const { AclWriteGrant, workspaceWriteSid, tempWriteSid } = await import('@deepseek-ai/dsh-sandbox-windows-acl')
    const coreRunner = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner')
    const canonical = realpathSync.native(wsA)
    const temp = mkdtempSync(join(tmpdir(), 'dsh-seam-'))
    const sid = workspaceWriteSid(canonical)
    const grant = AclWriteGrant.create(sid)
    let seam
    try {
      grant.add(canonical, true)
      grant.add(temp, false)
      seam = spawnSync(
        process.execPath,
        [coreRunner, '--workspace', canonical, '--temp', temp, '--mode', 'workspace-write',
          '--write-sid', sid, '--temp-write-sid', tempWriteSid(temp), '--', process.execPath, '-e', PROBE, wsA, outside],
        { encoding: 'utf8' },
      )
    } finally {
      grant.dispose()
      rmSync(temp, { recursive: true, force: true })
    }
    const delegated = runWrapper(process.env, bwrapArgs('workspace-write', wsA, [process.execPath, '-e', PROBE], [wsA, outside]))
    check('D status equal', seam.status === delegated.status, `seam=${seam.status} wrapper=${delegated.status}`)
    check('D stdout identical', seam.stdout === delegated.stdout, `seam=${JSON.stringify(seam.stdout)} wrapper=${JSON.stringify(delegated.stdout)}`)
  }

  // --- E. failure contract ----------------------------------------------
  {
    const unknown = runWrapper(process.env, ['--bogus', '--', process.execPath, '-e', ''])
    check('E unknown arg exit 127', unknown.status === 127, `status=${unknown.status}`)
    check('E unknown arg signature', /codex-project-run: unknown argument: --bogus/.test(unknown.stderr), `stderr=${unknown.stderr}`)

    // An added dir that vanished NARROWS to the surviving roots: the
    // workspace path stays writable under the workspace SID, the dead dir is
    // naturally denied (the token never grants a dead directory).
    writeDirs(spacesPath, { w1: { path: wsA, dirs: [join(base, 'missing')] } })
    const missingRoot = runWrapper(spacesEnv, bwrapArgs('workspace-write', wsA, [process.execPath, '-e', PROBE], [wsA, join(base, 'missing'), outside]))
    const lines = probeLines(missingRoot.stdout)
    check('E missing dir status 0', missingRoot.status === 0, `status=${missingRoot.status} stderr=${missingRoot.stderr}`)
    check('E workspace writable', lines.get(wsA) === 'WRITE-OK', `got ${lines.get(wsA)}`)
    check('E dead dir denied', lines.get(join(base, 'missing')) === 'WRITE-DENIED', `got ${lines.get(join(base, 'missing'))}`)
    check('E outside denied', lines.get(outside) === 'WRITE-DENIED', `got ${lines.get(outside)}`)
  }

  // --- F. exit-code mirror (workspace branch) ----------------------------
  {
    writeDirs(spacesPath, { w1: { path: wsA, dirs: [wsB] } })
    const result = runWrapper(spacesEnv, bwrapArgs('workspace-write', wsA, [process.execPath, '-e', EXIT_PROBE], []))
    check('F exit code mirrored', result.status === 42, `status=${result.status}`)
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}

function writeDirs(path, workspaces) {
  writeFileSync(path, JSON.stringify({ workspaces }, null, 2))
}

console.log(failures === 0 ? 'proto-verify: ALL PASS' : `proto-verify: ${failures} FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1
