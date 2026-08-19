/**
 * Project resolution for the 项目文件夹 tab: the single source of truth for
 * "which project does a session belong to" — the same anchor matching the
 * runner and fs fence use. A session cwd (canonical) that equals a record's
 * `path` owns that record; its project is the main root plus every surviving
 * shared dir. Configured dirs that vanished are reported separately so the
 * tree can flag them `(⚠ directory missing)` without failing the rest.
 * @module dsh-codex-project/project-view
 */

import { realpathSync } from 'node:fs'

import { matchingWorkspace, type WorkspaceDirs } from './dirs-config.ts'

/** The project a session sees: main root + shared dirs + stale dirs. */
export interface ProjectView {
  /** The owning workspace id (the anchored record). */
  workspaceId: string
  /** Canonical main workspace root (== the session cwd). */
  path: string
  /** Surviving additional writable dirs (canonical). */
  dirs: string[]
  /** Configured dirs that no longer exist (original spellings), each a stale root. */
  missingDirs: string[]
}

/** Canonicalize a directory, or `undefined` when it does not exist. */
export function canonicalizeDirectory(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    return undefined
  }
}

/**
 * Resolve the project anchored at a canonical session cwd.
 * @param records - the loaded dirs records.
 * @param canonicalCwd - the canonical session working directory.
 * @returns the project view, or undefined when no record anchors this cwd.
 */
export function projectFor(records: Record<string, WorkspaceDirs>, canonicalCwd: string): ProjectView | undefined {
  const match = matchingWorkspace(records, canonicalCwd)
  if (match === undefined) return undefined
  // roots[0] is always the canonical main root (matchingWorkspace anchors it).
  const [main, ...dirs] = match.roots
  return {
    workspaceId: match.workspaceId,
    path: main!,
    dirs,
    missingDirs: match.missingDirs,
  }
}
