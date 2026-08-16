/**
 * Seam wiring: route `ctx.sandbox.confine` through the dsh-codex-project
 * multi-root runner for sessions whose workspace owns an
 * additional-writable-dir record. The wrapping is the plugin's only touch on
 * the core sandbox service — the core's `runnerCommand` config surface is
 * left alone (its static argv cannot carry a dynamically resolved runner
 * path), and everything else the plugin does (config CRUD, UI) composes
 * through its own services.
 *
 * Routing decision per confine call (pure superset of the core seam):
 *  - non-Windows, non-`workspace-write`, a session cwd outside every
 *    record, or a record with no dirs → the ORIGINAL confine (core
 *    behavior, bit-identical);
 *  - otherwise → the dsh-codex-project runner with the bwrap
 *    workspace-write profile argv (the exact shape the core
 *    `bwrapProfileArgs(policy)` builds for workspace-write — the wrapper
 *    parses it back; keep the two in lockstep), which grants a
 *    workspace-level SID on every surviving root and confines under one
 *    restricted token.
 *
 * A configured dir that vanished narrows the grant to the surviving roots
 * (the canonical match never throws): the runner materializes grants only on
 * roots that still exist, exactly like the fs fence and the context
 * injection — a dead directory must not poison unrelated sessions.
 * @module dsh-codex-project/seam
 */

import type { ConfinedArgv, SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'

import { loadWorkspaceDirs, matchingWorkspace, requireCanonicalDirectory } from './dirs-config.ts'

/** The runner's failure signature (must match `src/runner.ts`). */
const RUNNER_SIGNATURE = 'codex-project-run: '

/**
 * The bwrap workspace-write profile the wrapper parses: the exact argv
 * `@deepseek-ai/dsh-sandbox-local`'s `bwrapProfileArgs(policy)` builds for
 * workspace-write. Keep this and the wrapper's parser in lockstep.
 */
export function bwrapWorkspaceWriteArgs(workspaceRoot: string): string[] {
  return [
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--die-with-parent',
    '--tmpfs', '/tmp',
    '--bind', workspaceRoot, workspaceRoot,
  ]
}

/**
 * Wrap one sandbox provider's confine in the codex-project routing.
 * @param sandbox - the sandbox service instance (`ctx.get('sandbox')`).
 * @param runnerPath - absolute path of the built `lib/runner.js`.
 * @returns a disposer restoring the original confine (fiber teardown; HMR
 *   reloads re-apply the whole tree, so a fresh provider gets wrapped again).
 */
export function wrapSandboxConfine(sandbox: SandboxProvider, runnerPath: string): () => void {
  const original = sandbox.confine
  sandbox.confine = (argv: readonly string[], policy: SandboxPolicy): ConfinedArgv => {
    if (process.platform !== 'win32') return Reflect.apply(original, sandbox, [argv, policy])
    if (policy.mode !== 'workspace-write') return Reflect.apply(original, sandbox, [argv, policy])
    const canonicalWorkspace = requireCanonicalDirectory('session workspace', policy.workspaceRoot)
    const match = matchingWorkspace(loadWorkspaceDirs(), canonicalWorkspace)
    if (match === undefined || match.roots.length <= 1) return Reflect.apply(original, sandbox, [argv, policy])
    return {
      argv: [process.execPath, runnerPath, ...bwrapWorkspaceWriteArgs(canonicalWorkspace), '--', ...argv],
      // Same restricted-token mechanism as the core windows-acl runner, so
      // the same documented Everyone and hard-link boundaries apply.
      enforcement: 'partial',
      // Denied writes surface as Node EPERM text — the same dialect the core
      // seam's runnerCommand branch declares.
      denialSignatures: ['read-only file system', 'permission denied'],
      runnerFailureRules: [{ fatalSignatures: [RUNNER_SIGNATURE] }],
    }
  }
  return () => {
    sandbox.confine = original
  }
}
