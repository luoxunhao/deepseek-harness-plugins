/**
 * Old-format → subspace lazy migration: a pre-subspace space record has no
 * `workspaceId` anchor and its roots are in arbitrary order. The migration
 * anchors every anchor-less record to the registered workspace whose path
 * matches one of its roots (canonical, case-insensitive on Windows), moves
 * that root to `roots[0]` (the host root position), and persists the file.
 *
 * A record whose roots match NO registered workspace keeps working by path
 * matching (the runner and the fs fence only read `roots`) and stays
 * anchor-less — the migration re-runs on the next startup and anchors it as
 * soon as its host workspace is registered.
 *
 * The migration is idempotent: anchored records are skipped, and the anchor
 * is never rewritten once set.
 * @module dsh-codex-project/space-migration
 */

import { realpathSync } from 'node:fs'

import { loadSpaces } from './space-config.ts'
import type { SpaceRecord } from './space-config.ts'
import { writeSpaces } from './space-store.ts'

/** The host workspace registry face (structural; see @deepseek-ai/dsh-workspace). */
export interface WorkspaceRegistryFace {
  /** Fresh ordered workspace projection (canonical paths). */
  list(): Array<{ id: string; path: string }>
}

// The npm cordis instance in this plugin's dependency graph does not see the
// dsh monorepo's augmentation, so the service property is restated here —
// the same structural-mirror pattern the rest of the plugin uses.
declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceRegistry: WorkspaceRegistryFace
  }
}

/** Canonicalize one root for matching (a vanished root stays as-is). */
function canonicalForMatching(root: string): string {
  try {
    return realpathSync.native(root)
  } catch {
    return root
  }
}

/** Whether two canonical paths address the same directory (host convention). */
function sameCanonical(a: string, b: string): boolean {
  const comparable = process.platform === 'win32'
    ? (path: string): string => path.toLowerCase()
    : (path: string): string => path
  return comparable(a) === comparable(b)
}

/** Anchor one old-format record; returns true when the record changed. */
function anchorRecord(space: SpaceRecord, workspaces: Array<{ id: string; path: string }>): boolean {
  if (space.workspaceId !== undefined) return false
  const canonicalRoots = space.roots.map(canonicalForMatching)
  for (let index = 0; index < space.roots.length; index++) {
    const workspace = workspaces.find(candidate => sameCanonical(canonicalRoots[index] ?? '', candidate.path))
    if (workspace === undefined) continue
    space.workspaceId = workspace.id
    if (index !== 0) {
      const [hostRoot] = space.roots.splice(index, 1)
      space.roots.unshift(hostRoot!)
    }
    return true
  }
  return false
}

/**
 * Lazily migrate every anchor-less space record to the subspace shape.
 * @param registry - the host workspace registry (or a structural fake in tests).
 * @returns whether the configuration file was rewritten.
 */
export function migrateSpacesToSubspaces(registry: WorkspaceRegistryFace): boolean {
  const spaces = loadSpaces()
  const workspaces = registry.list()
  let changed = false
  for (const space of spaces) {
    if (anchorRecord(space, workspaces)) changed = true
  }
  if (changed) writeSpaces(spaces)
  return changed
}
