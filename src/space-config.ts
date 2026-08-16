/**
 * Shared codex-project configuration access: the shared-directory record
 * format, canonical matching, and the record write-SID derivation. Used by
 * both the host half (seam wiring: deciding whether a session's policy
 * routes through the multi-root runner) and the confinement runner itself
 * (`src/runner.ts`), so the two halves can never drift apart on what a
 * record is or which record owns a workspace.
 *
 * The data file is `{ "spaces": [{ "id", "workspaceId"?, "title"?, "roots":
 * [...] }] }`, located at `$DSH_CODEX_PROJECT_CONFIG` when set, else
 * `~/.dsh-codex-project/spaces.json`. The file being absent or empty means
 * "no records configured" — the plugin stays a pure pass-through.
 *
 * Model: ONE record = ONE workspace's shared configuration. `workspaceId`
 * names the owning (main) workspace, `roots[0]` is its root directory, and
 * `roots[1..]` are the shared subdirectories the workspace's sessions may
 * also read/write. A session whose cwd lands in any root of a record with
 * more than one root gets the whole record's roots as its writable set (the
 * multi-root runner + fs fence + context injection). The anchor stays
 * optional — an old-format record keeps working by path matching, and the
 * lazy migration in `space-migration.ts` fills it. The runner and the fs
 * fence only ever read `roots`.
 *
 * This module is deliberately free of the windows-acl dependency: the
 * seam and the fs provider import it without pulling in koffi. The
 * record write-SID derivation lives in `space-sid.ts`.
 * @module dsh-codex-project/space-config
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** One shared-directory record: a workspace plus its shared subdirectories. */
export interface SpaceRecord {
  /** Stable record identity (unique within the file). */
  id: string
  /**
   * The owning (main) workspace, when known. Optional: an old-format record
   * (or one whose workspace is not registered) keeps working by path
   * matching — `roots[0]` is the main root either way.
   */
  workspaceId?: string
  /** Display title (context injection copy). */
  title?: string
  /**
   * The shared root set: `roots[0]` = the main workspace root, the remaining
   * entries = shared subdirectories (may cross drives).
   */
  roots: string[]
}

interface SpaceConfigFile {
  spaces: SpaceRecord[]
}

/**
 * The pre-rename default location (`~/.dsh-project-space/spaces.json`) the
 * one-time migration reads. Kept literal so the legacy file is found even
 * after this module's own naming changed.
 */
const LEGACY_DEFAULT_CONFIG_PATH = join(homedir(), '.dsh-project-space', 'spaces.json')
/** The space data file path: `$DSH_CODEX_PROJECT_CONFIG`, else the default under the user's home. */
export function spaceConfigPath(): string {
  return process.env.DSH_CODEX_PROJECT_CONFIG ?? join(homedir(), '.dsh-codex-project', 'spaces.json')
}

/**
 * Load the configured spaces. A missing file means no spaces; a present file
 * that is not the documented shape is a configuration error and throws.
 * A UTF-8 BOM is stripped (Windows text editors write one routinely).
 * @returns the configured spaces (possibly empty).
 */
/**
 * One-time migration from the plugin's pre-rename default location: when the
 * current default file is absent and the legacy file exists, copy it over so
 * existing shared records survive the rename. Best-effort — a failure keeps
 * the plugin a no-config pass-through until the user resolves the file
 * situation. An explicit `$DSH_CODEX_PROJECT_CONFIG` override never touches
 * the legacy file (the user pointed somewhere deliberately). Note: moving
 * the file changes the record SIDs (derived from the config directory), so
 * previously materialized standing ACEs on shared roots become inert and new
 * ones accumulate on the next confined run.
 */
function migrateLegacyConfig(configPath: string): void {
  if (process.env.DSH_CODEX_PROJECT_CONFIG !== undefined) return
  if (configPath === LEGACY_DEFAULT_CONFIG_PATH) return
  if (existsSync(configPath) || !existsSync(LEGACY_DEFAULT_CONFIG_PATH)) return
  try {
    mkdirSync(dirname(configPath), { recursive: true })
    copyFileSync(LEGACY_DEFAULT_CONFIG_PATH, configPath)
  } catch {
    // Best-effort migration; see the function doc.
  }
}
export function loadSpaces(): SpaceRecord[] {
  const configPath = spaceConfigPath()
  migrateLegacyConfig(configPath)
  if (!existsSync(configPath)) return []
  let parsed: unknown
  try {
    const raw = readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`DSH_CODEX_PROJECT_CONFIG is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as SpaceConfigFile).spaces)) {
    throw new Error('DSH_CODEX_PROJECT_CONFIG must contain a "spaces" array')
  }
  const spaces = (parsed as SpaceConfigFile).spaces
  for (const space of spaces) {
    if (typeof space !== 'object' || space === null || typeof space.id !== 'string' || space.id === '') {
      throw new Error('each space must have a non-empty string "id"')
    }
    if (!Array.isArray(space.roots) || space.roots.length === 0 || space.roots.some((root) => typeof root !== 'string' || root === '')) {
      throw new Error(`space ${space.id} must have a non-empty "roots" array of strings`)
    }
  }
  return spaces
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
 * The space's canonical roots, failing loud on a missing configured root —
 * silently narrowing a multi-root grant to fewer roots would change
 * semantics.
 */
export function canonicalRoots(space: SpaceRecord): string[] {
  return space.roots.map((root) => requireCanonicalDirectory(`space ${space.id} root`, root))
}

/**
 * The space whose canonical roots contain the canonical workspace, if any.
 * The first matching space wins (deterministic).
 */
export function matchingSpace(spaces: SpaceRecord[], canonicalWorkspace: string): SpaceRecord | undefined {
  for (const space of spaces) {
    if (canonicalRoots(space).includes(canonicalWorkspace)) return space
  }
  return undefined
}

/**
 * The space owning the canonical workspace, restricted to multi-root spaces
 * (more than one configured root). Single-root spaces behave exactly like the
 * core single-workspace sandbox, so every multi-root extension — the confine
 * routing, the fs fence, and the session context injection — keys off this
 * predicate and nowhere else.
 */
export function matchingMultiRootSpace(spaces: SpaceRecord[], canonicalWorkspace: string): SpaceRecord | undefined {
  const space = matchingSpace(spaces, canonicalWorkspace)
  if (space === undefined || space.roots.length <= 1) return undefined
  return space
}

/**
 * The canonical directory holding the space data file (exists by the loader's
 * guarantee once any space is configured; the runner derives the space SID
 * from it — see `space-sid.ts`).
 */
export function spaceConfigDirectory(): string {
  return requireCanonicalDirectory('space config directory', dirname(resolve(spaceConfigPath())))
}

