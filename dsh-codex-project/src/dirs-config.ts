/**
 * dsh-codex-project configuration access: the additional-writable-dir model.
 * One workspace owns a record `{ path, dirs }` — `path` is the canonical
 * main workspace directory (the matching anchor the runner also uses), `dirs`
 * are the additional writable directories the workspace's sessions may
 * read/write. The record set is the plugin's ONLY persisted state; sessions
 * whose cwd is outside every record, or whose owning record has no dirs,
 * keep the core single-workspace behavior.
 *
 * The data file is `{ "workspaces": { "<id>": { path, dirs } } }`, at
 * `$DSH_CODEX_PROJECT_CONFIG` when set, else
 * `~/.dsh-codex-project/dirs.json`. Absent or empty file means "no
 * records" — the plugin stays a pure pass-through.
 *
 * Matching: a session cwd (canonical) that equals a record's `path` owns
 * that record; the writable root set is `[path, ...surviving dirs]`. A
 * configured dir that vanished narrows the set (a dead directory is
 * physically unwritable), never throwing and never poisoning unrelated
 * sessions or records.
 * @module dsh-codex-project/dirs-config
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** One workspace's persisted record: main path + additional writable dirs. */
export interface WorkspaceDirs {
  /** Canonical main workspace directory (the runner's matching anchor). */
  path: string
  /** Additional writable directories (absolute, may cross drives). */
  dirs: string[]
}

/** The persisted file shape. */
export interface DirsConfigFile {
  workspaces: Record<string, WorkspaceDirs>
}

/** A resolved match: the owning workspace + its writable root split. */
export interface WorkspaceMatch {
  workspaceId: string
  /** Canonical surviving writable roots: path + existing dirs. */
  roots: string[]
  /** Configured dirs that no longer exist (skipped, never failing). */
  missingDirs: string[]
}

/** The default data file location (`~/.dsh-codex-project/dirs.json`). */
export const DEFAULT_DIRS_CONFIG_PATH = join(homedir(), '.dsh-codex-project', 'dirs.json')

/** The data file path: `$DSH_CODEX_PROJECT_CONFIG`, else the default. */
export function dirsConfigPath(): string {
  return process.env.DSH_CODEX_PROJECT_CONFIG ?? DEFAULT_DIRS_CONFIG_PATH
}

/**
 * Load the configured workspace dirs. A missing file means none; a present
 * file that is not the documented shape is a configuration error and throws.
 * A UTF-8 BOM is stripped (Windows text editors write one routinely).
 * @returns the configured records (possibly empty).
 */
export function loadWorkspaceDirs(): Record<string, WorkspaceDirs> {
  const configPath = dirsConfigPath()
  if (!existsSync(configPath)) return {}
  let parsed: unknown
  try {
    const raw = readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`DSH config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as DirsConfigFile).workspaces !== 'object') {
    throw new Error('DSH config must contain a "workspaces" object')
  }
  const workspaces = (parsed as DirsConfigFile).workspaces
  for (const [id, record] of Object.entries(workspaces)) {
    if (typeof record !== 'object' || record === null || typeof record.path !== 'string' || record.path === '' || !Array.isArray(record.dirs)) {
      throw new Error(`workspace ${id} must have a non-empty string "path" and a "dirs" array`)
    }
    if (record.dirs.some(dir => typeof dir !== 'string' || dir === '')) {
      throw new Error(`workspace ${id} dirs must be an array of non-empty strings`)
    }
  }
  return workspaces
}

/**
 * Canonicalize one directory, failing loud when it does not exist.
 * @param label - what the directory is, for the error.
 * @param path - the directory to canonicalize.
 * @returns the canonical path (Windows: the `\\?\` real path).
 */
export function requireCanonicalDirectory(label: string, path: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} is not an existing directory: ${path}`)
  }
  return realpathSync.native(path)
}

/**
 * Canonicalize one directory without failing: a missing or non-directory
 * path yields `undefined`. A dir that vanished after being configured must
 * never throw — it narrows the writable set instead of failing every match.
 * @param path - the directory to canonicalize.
 * @returns the canonical path, or `undefined` when the path is not a directory.
 */
export function tryCanonicalDirectory(path: string): string | undefined {
  try {
    return requireCanonicalDirectory('dir', path)
  } catch {
    return undefined
  }
}

/**
 * The workspace record whose canonical `path` equals the canonical session
 * workspace, if any.
 * @param records - the loaded records.
 * @param canonicalWorkspace - the canonical session cwd.
 * @returns the owner id, or undefined when no record anchors this workspace.
 */
export function matchingWorkspace(
  records: Record<string, WorkspaceDirs>,
  canonicalWorkspace: string,
): WorkspaceMatch | undefined {
  for (const [workspaceId, record] of Object.entries(records)) {
    if (tryCanonicalDirectory(record.path) !== canonicalWorkspace) continue
    const roots: string[] = []
    const missingDirs: string[] = []
    for (const dir of record.dirs) {
      const canonical = tryCanonicalDirectory(dir)
      if (canonical === undefined) missingDirs.push(dir)
      else roots.push(canonical)
    }
    return { workspaceId, roots: [canonicalWorkspace, ...roots], missingDirs }
  }
  return undefined
}

/**
 * The canonical directory holding the data file. Exists by the loader's
 * guarantee once any record is configured (the store creates the parent);
 * the runner derives the workspace SID from it — see `space-sid.ts`.
 */
export function dirsConfigDirectory(): string {
  return requireCanonicalDirectory('dirs config directory', dirname(resolve(dirsConfigPath())))
}
