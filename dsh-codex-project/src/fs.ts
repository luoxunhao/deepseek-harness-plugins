/**
 * `CodexProjectFileSystem`: the codex-project multi-root fence over
 * `SandboxedFileSystem` (itself `LocalFileSystem` + per-call policy fence).
 * Registers as `ctx.fs` INSTEAD OF `@deepseek-ai/dsh-fs-sandbox` (the
 * plugin's bundle patch disables the core fs-sandbox row and inserts this
 * module as the fs provider; the model-facing tools are untouched).
 *
 * The fence is the core seam's exact mechanism with one generalization: the
 * writable-root set for a workspace-write mutation is the SPACE's canonical
 * roots (plus the same `/tmp` and ambient temp entries the core set carries)
 * when the per-call policy's workspace belongs to a multi-root space, and
 * the core `writableRoots(policy)` set verbatim otherwise — a pure superset,
 * byte-identical to the core seam outside any space.
 *
 * The mutation path re-checks the FRESH canonical target against every root
 * (the core's canonicalize-then-contain stance, including the
 * re-canonicalize-immediately-before-delegating TOCTOU narrowing), then
 * delegates to the parent with a `danger-full-access` policy so the parent's
 * own single-root fence is a no-op — the atomic write/edit mechanics
 * (locks, fsio) stay the parent's, verbatim. A configured dir that
 * vanished narrows the writable set to the surviving roots: writing the dead
 * directory fails naturally (the directory is gone) without poisoning the
 * rest of the workspace or any unrelated session.
 *
 * Reads pass through untouched (every mode permits reading), exactly like
 * the core seam.
 * @module dsh-codex-project/fs
 */

import { tmpdir } from 'node:os'

import { FsError } from '@deepseek-ai/dsh-fs'
import type {
  FsEditOutcome,
  FsEditRequest,
  FsTarget,
  FsVersion,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

import { isPathUnder } from './containment.ts'
import { loadWorkspaceDirs, matchingWorkspace, requireCanonicalDirectory } from './dirs-config.ts'

/** A policy that makes the parent's single-root fence a no-op. */
const FULL_ACCESS: SandboxExecutionPolicy = {
  mode: 'danger-full-access',
  workspaceRoot: process.cwd(),
}

/**
 * The writable-root set for one workspace-write mutation: the owning
 * workspace's SURVIVING canonical roots (`path` + existing dirs, plus the
 * core set's temp entries) when the policy's workspace owns a record with
 * at least one dir, else the core set verbatim. A configured dir that
 * vanished narrows the grant to the surviving roots — writing the dead
 * directory fails naturally (the directory is gone), so failing the whole
 * mutation would only poison unrelated sessions.
 */
function writableRootsFor(policy: SandboxExecutionPolicy): string[] {
  const canonicalWorkspace = requireCanonicalDirectory('session workspace', policy.workspaceRoot)
  const match = matchingWorkspace(loadWorkspaceDirs(), canonicalWorkspace)
  if (match === undefined || match.roots.length <= 1) return writableRoots(policy)
  return [...match.roots, '/tmp', tmpdir()]
}

/**
 * Multi-root sandbox-enforcing filesystem backend. Registers as `ctx.fs`.
 */
export class CodexProjectFileSystem extends SandboxedFileSystem {
  /**
   * Fence the write by the per-call policy against the space's writable
   * roots, then delegate the atomic write with the parent's fence bypassed.
   * @param target - the resolved target to write.
   * @param content - the full new file content.
   * @param expected - the write intent guarding the write; omit for unconditional.
   * @param signal - aborts before atomic publication takes effect.
   * @param sandboxPolicy - the per-call mode and workspace root; omit to use
   *   the deployment fallback.
   * @returns the write outcome from the inherited backend.
   */
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    return super.writeText(await this.checkedSpaceTarget(target, sandboxPolicy), content, expected, signal, FULL_ACCESS)
  }

  /**
   * Fence the edit by the per-call policy against the space's writable
   * roots, then delegate the atomic edit with the parent's fence bypassed.
   * @param target - the resolved target to edit.
   * @param edit - the literal search/replace request.
   * @param expected - the version guard; omit for an unconditional edit.
   * @param signal - aborts before atomic publication takes effect.
   * @param sandboxPolicy - the per-call mode and workspace root; omit to use
   *   the deployment fallback.
   * @returns the edit outcome from the inherited backend.
   */
  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    return super.editText(await this.checkedSpaceTarget(target, sandboxPolicy), edit, expected, signal, FULL_ACCESS)
  }

  /**
   * Enforce the per-call policy against `target` and return the EXACT target
   * the mutation must use (the core seam's canonicalize-then-contain, with
   * the space's writable-root set). `read-only` denies; `danger-full-access`
   * passes unfenced; `workspace-write` re-canonicalizes NOW and requires
   * containment under one of the writable roots. Throws the structured
   * `FS_SANDBOX_DENIED` on refusal — the tool layer maps it to the
   * model-facing `[sandbox: …]` marker and the escalation hint.
   */
  private async checkedSpaceTarget(target: FsTarget, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsTarget> {
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()
    const { mode } = policy
    if (mode === 'danger-full-access') return target
    if (mode === 'read-only') {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED')
    }
    const fresh = await this.resolve(target.displayPath)
    for (const root of writableRootsFor(policy)) {
      if (await isPathUnder(fresh.targetKey, root)) return fresh
    }
    throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED')
  }
}

export default CodexProjectFileSystem
