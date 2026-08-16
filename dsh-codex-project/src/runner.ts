/**
 * The dsh-codex-project confinement runner: the argv-prefix wrapper the
 * codex-project seam spawns in place of the Linux bwrap profile when a
 * session runs inside a workspace that owns additional writable dirs on
 * Windows. It reads the bwrap-style argv, resolves the workspace whose
 * canonical `path` equals the bind root, and confines the wrapped command
 * under the `@deepseek-ai/dsh-sandbox-windows-acl` restricted token with a
 * WORKSPACE-level write SID granted on EVERY surviving root (`path` + dirs)
 * — the official AclSandbox multi-writable-dir shape, one token, N ACEs,
 * still under workspace-write permission. Sessions outside any recorded
 * workspace (or with a record that has no dirs) keep the core behavior:
 * workspace-write delegates to the core windows-acl runner with the seam's
 * exact grant + argv contract (per-workspace SID), and read-only confines
 * wrapper-locally (no grants exist to share).
 *
 * Stable argv contract (bwrap-compatible subset; the seam builds it):
 *   [node, runner.js, '--ro-bind', '/', '/', '--dev', '/dev',
 *    '--proc', '/proc', '--die-with-parent', '--tmpfs', '/tmp',
 *    '--bind', <root>, <root>, '--', <argv...>]
 * `--ro-bind`/`--dev`/`--proc`/`--die-with-parent` are accepted no-ops
 * (Linux profile markers with no Windows effect). `--tmpfs` selects
 * workspace-write mode; `--bind <src> <dst>` (src === dst only) names the
 * workspace root. Everything after `--` is the confined command.
 *
 * Branches:
 *  - workspace-write + workspace match (the bind root is the canonical
 *    `path` of a record with at least one dir): `AclSandbox({
 *    writableDirs: roots, tempDir, writeSid: workspaceDirsWriteSid(id),
 *    tempWriteSid, mode: 'workspace-write' })` with `manageDacls: true` —
 *    init() materializes the workspace SID's Write ACE on every surviving
 *    root (STANDING, the cross-session reuse cache, exactly like a core
 *    workspace grant) plus the revocable private-temp ACE, spawns with
 *    stdio inherited, and dispose() revokes only the temp ACE. The child's
 *    token carries [workspaceSid, tempSid], so writes pass exactly where a
 *    root or the private temp carries the capability.
 *  - workspace-write otherwise (no record match, or a record with no dirs):
 *    materialize the per-workspace grants (workspace standing, temp
 *    revocable — the core seam's `manageDacls: false` contract) and delegate
 *    to the core runner at `@deepseek-ai/dsh-sandbox-windows-acl/runner`
 *    with its exact argv. Bit-identical to the core seam.
 *  - read-only: `AclSandbox({ writableDirs: [], tempDir: null, mode:
 *    'read-only' })` — the official restricting-list-I token, no capability
 *    SIDs, no grants, ambient temp untouched. (The read-only bwrap profile
 *    carries no workspace root, so there is nothing to delegate.)
 *
 * Workspace discovery: `DSH_CODEX_PROJECT_CONFIG` names a JSON file
 * `{ "workspaces": { "<id>": { path, dirs } } }` (the plugin seam will
 * point it at its data store; the prototype reads it directly). The bind
 * root and each record's `path` are matched in canonical form; a record
 * whose configured dir vanished narrows to the surviving roots — the
 * token's Write ACEs materialize only on roots that still exist, and
 * writes to the dead dir fail naturally (the directory is gone), so a dead
 * dir never poisons unrelated sessions.
 *
 * The workspace SID derives from the config file's canonical directory plus
 * the workspace id via workspaceWriteSid(), NOT from any single root: a
 * workspace SID is a distinct identity, so a core session granted only its
 * own workspace SID cannot follow a workspace root's ACE into another root
 * of the recorded set, and a recorded-workspace session's token cannot use
 * one root's core ACE for a root it was not granted. (Same 2-subauthority
 * shape, different digest input.)
 *
 * Failure contract (mirrors the core runner): every runner-side failure
 * prints `codex-project-run: <detail>` to stderr and exits 127; the confined
 * child is NEVER spawned unrestricted. The wrapper survives a console
 * CTRL+C via no-op signal listeners so the child's exit and the revocations
 * still run — a native-exe wrapper would use the core runner's
 * SetConsoleCtrlHandler instead (prototype limitation).
 * @module dsh-codex-project/runner
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AclSandbox,
  AclWriteGrant,
  tempWriteSid,
  workspaceWriteSid,
} from '@deepseek-ai/dsh-sandbox-windows-acl'

import { loadWorkspaceDirs, matchingWorkspace, requireCanonicalDirectory } from './dirs-config.ts'
import type { WorkspaceMatch } from './dirs-config.ts'
import { workspaceDirsWriteSid } from './space-sid.ts'

const RUNNER_SIGNATURE = 'codex-project-run'
const RUNNER_FAILURE_EXIT = 127

class RunnerFailure extends Error {}

/** Print the runner-failure signature line and unwind. */
function fail(detail: string): never {
  process.stderr.write(`${RUNNER_SIGNATURE}: ${detail}\n`)
  throw new RunnerFailure(detail)
}

interface ParsedArgs {
  /** The --bind workspace root (workspace-write only; absent under read-only). */
  workspace: string | undefined
  mode: 'read-only' | 'workspace-write'
  command: string
  args: string[]
}

function parseArgs(raw: string[]): ParsedArgs {
  let workspace: string | undefined
  let sawTmpfs = false
  let index = 0
  for (; index < raw.length; index++) {
    const token = raw[index]
    if (token === undefined) break
    if (token === '--') {
      index++
      break
    }
    switch (token) {
      // Linux profile markers without a Windows effect; each takes its
      // bwrap value(s) which are consumed and ignored.
      case '--ro-bind':
        if (raw[index + 2] === undefined) fail('missing value after --ro-bind')
        index += 2
        break
      case '--dev':
      case '--proc':
      case '--tmpfs':
        if (raw[index + 1] === undefined) fail(`missing value after ${token}`)
        if (token === '--tmpfs') sawTmpfs = true
        index += 1
        break
      case '--die-with-parent':
        break
      case '--bind': {
        const src = raw[index + 1]
        const dst = raw[index + 2]
        if (src === undefined || dst === undefined) fail('missing value after --bind')
        if (workspace !== undefined) fail('multiple --bind entries are not supported')
        if (src !== dst) fail('--bind src/dst mismatch is not supported')
        workspace = src
        index += 2
        break
      }
      default:
        fail(`unknown argument: ${token}`)
    }
  }
  const mode = sawTmpfs ? 'workspace-write' : 'read-only'
  if (mode === 'workspace-write' && workspace === undefined) fail('workspace-write requires --bind <root> <root>')
  if (mode === 'read-only' && workspace !== undefined) fail('read-only does not accept --bind')
  const argv = raw.slice(index)
  const command = argv[0]
  if (command === undefined) fail('missing command after --')
  return { workspace, mode, command, args: argv.slice(1) }
}

/** The private temp directory (caller-owned by construction), removed with the run. */
function createPrivateTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-space-'))
}

/** Rewrite TMP/TEMP in this process's environment so the confined child inherits the private temp. */
function redirectTempEnv(privateTempDir: string): void {
  process.env.TMP = privateTempDir
  process.env.TEMP = privateTempDir
}

/** Run the core windows-acl runner with inherited stdio and mirror its exit code. */
function runCoreRunner(coreRunner: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [coreRunner, ...args], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      resolvePromise(code ?? RUNNER_FAILURE_EXIT)
    })
  })
}

/**
 * The wrapper-local confine skeleton: init the sandbox (fail-closed), spawn
 * the command with the caller's stdio inherited, mirror the exit code, and
 * always dispose (revoking the revocable temp grant; standing space-root
 * ACEs stay as the reuse cache). Cleanup failures are reported without
 * masking the child's exit code.
 */
async function confine(sandbox: AclSandbox, command: string, args: string[]): Promise<number> {
  let initialized = false
  try {
    await sandbox.init()
    initialized = true
    const child = sandbox.spawn({ command, args, stdio: 'inherit' })
    const result = await child.wait()
    return result.exitCode
  } finally {
    if (initialized) {
      try {
        sandbox.dispose()
      } catch (error) {
        process.stderr.write(`${RUNNER_SIGNATURE}: cleanup: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
  }
}

/**
 * The core-seam-equivalent branch: materialize the per-workspace grants
 * (workspace standing, private temp revocable) and delegate to the core
 * runner with the seam's exact argv contract.
 */
async function runDelegation(parsed: ParsedArgs, canonicalWorkspace: string): Promise<number> {
  const coreRunner = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner')
  const privateTempDir = createPrivateTempDir()
  const writeSid = workspaceWriteSid(canonicalWorkspace)
  const privateTempSid = tempWriteSid(privateTempDir)
  const grant = AclWriteGrant.create(writeSid)
  try {
    grant.add(canonicalWorkspace, true)
    grant.add(privateTempDir, false)
    return await runCoreRunner(coreRunner, [
      '--workspace', canonicalWorkspace,
      '--temp', privateTempDir,
      '--mode', 'workspace-write',
      '--write-sid', writeSid,
      '--temp-write-sid', privateTempSid,
      '--', parsed.command, ...parsed.args,
    ])
  } finally {
    try {
      grant.dispose()
    } catch (error) {
      process.stderr.write(`${RUNNER_SIGNATURE}: cleanup: ${error instanceof Error ? error.message : String(error)}\n`)
    }
    try {
      rmSync(privateTempDir, { recursive: true, force: true })
    } catch (error) {
      process.stderr.write(`${RUNNER_SIGNATURE}: cleanup: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
}

/**
 * The multi-dir workspace branch: one workspace-level SID, one restricted
 * token, Write ACEs on every SURVIVING root (`path` + existing dirs)
 * (standing) plus the private temp (revocable), spawned with the caller's
 * stdio inherited. A configured dir that vanished is skipped — the token
 * never grants a dead directory.
 */
async function runDirsBranch(
  parsed: ParsedArgs,
  match: WorkspaceMatch,
): Promise<number> {
  const privateTempDir = createPrivateTempDir()
  const sandbox = new AclSandbox({
    writableDirs: match.roots,
    tempDir: privateTempDir,
    writeSid: workspaceDirsWriteSid(match.workspaceId),
    tempWriteSid: tempWriteSid(privateTempDir),
    mode: 'workspace-write',
    manageDacls: true,
  })
  try {
    redirectTempEnv(privateTempDir)
    return await confine(sandbox, parsed.command, parsed.args)
  } finally {
    try {
      rmSync(privateTempDir, { recursive: true, force: true })
    } catch (error) {
      process.stderr.write(`${RUNNER_SIGNATURE}: cleanup: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
}

/**
 * The read-only branch: the official restricting-list-I token, no capability
 * SIDs, no grants, ambient temp untouched. (The read-only bwrap profile
 * carries no workspace root, so there is nothing to delegate.)
 */
async function runReadOnly(parsed: ParsedArgs): Promise<number> {
  const sandbox = new AclSandbox({
    writableDirs: [],
    tempDir: null,
    mode: 'read-only',
    manageDacls: true,
  })
  return confine(sandbox, parsed.command, parsed.args)
}

async function main(): Promise<number> {
  // The restricted-token machinery (koffi FFI) is Windows-only: refusing
  // loudly beats ever running the wrapped command unconfined on another
  // platform (the seam wires this runner only on win32, so this is a
  // misconfiguration guard, not a hot path).
  if (process.platform !== 'win32') fail('codex-project-run only supports win32')
  // Keep the wrapper alive while the confined child (same console) handles a
  // CTRL+C so revocation and exit-code mirroring still run.
  process.on('SIGINT', () => {})
  process.on('SIGBREAK', () => {})

  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.mode === 'read-only') {
    return runReadOnly(parsed)
  }
  // parseArgs guarantees --bind under workspace-write.
  const canonicalWorkspace = requireCanonicalDirectory('--bind workspace', parsed.workspace as string)
  const match = matchingWorkspace(loadWorkspaceDirs(), canonicalWorkspace)
  if (match !== undefined && match.roots.length > 1) {
    return runDirsBranch(parsed, match)
  }
  return runDelegation(parsed, canonicalWorkspace)
}

main().then(
  (exitCode) => {
    // Full-width exit-code mirroring, like the core runner.
    process.exitCode = exitCode
  },
  (error: unknown) => {
    if (!(error instanceof RunnerFailure)) {
      process.stderr.write(`${RUNNER_SIGNATURE}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
    process.exitCode = RUNNER_FAILURE_EXIT
  },
)
