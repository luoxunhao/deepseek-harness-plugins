/**
 * One-time migration from the old "space record" model to the
 * additional-writable-dir model. The previous data file
 * (`{ "spaces": [{ "id", "workspaceId"?, "title"?, "roots": [...] }] }`) is
 * converted to `{ "workspaces": { "<id>": { path, dirs } } }`:
 *
 *   - `roots[0]` (the main root) becomes the record's `path`;
 *   - the remaining roots become `dirs`;
 *   - a record whose `workspaceId` is missing is anchored to the registered
 *     workspace matching one of its roots; if none matches it is dropped
 *     with a warn (its data cannot be attributed).
 *
 * The migration writes the NEW file (at `$DSH_CODEX_PROJECT_CONFIG` /
 * `~/.dsh-codex-project/dirs.json`) and leaves the old
 * `~/.dsh-codex-project/spaces.json` untouched as a backup. It is
 * idempotent: once the new file exists, it never rewrites.
 * @module dsh-codex-project/dirs-migration
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { dirsConfigPath } from './dirs-config.ts'
import type { WorkspaceDirs } from './dirs-config.ts'
import type { WorkspaceRegistryFace } from './dirs-store.ts'
import { persistWorkspaceDirs } from './dirs-store.ts'

/** The old default data file (pre-rename location, kept literal). */
export const LEGACY_SPACES_PATH = join(homedir(), '.dsh-codex-project', 'spaces.json')

/** A legacy space record as persisted by the pre-add-dir versions. */
interface LegacySpaceRecord {
  id: string
  workspaceId?: string
  roots: string[]
}

/** There is nothing to migrate when the new file already exists. */
export function needsMigration(): boolean {
  return !existsSync(dirsConfigPath()) && existsSync(LEGACY_SPACES_PATH)
}

function canonicalOr(raw: string): string {
  try {
    return realpathSync.native(raw)
  } catch {
    return raw
  }
}

function sameDirectory(a: string, b: string): boolean {
  const comparable = process.platform === 'win32'
    ? (path: string): string => path.toLowerCase()
    : (path: string): string => path
  return comparable(canonicalOr(a)) === comparable(canonicalOr(b))
}

/**
 * Attach a legacy record to a registered workspace, preferring the explicit
 * anchor then a root that matches a registry path.
 * @param record - the legacy record.
 * @param workspaces - the registry projection.
 * @param warn - a logger for dropped/unattributable records.
 * @returns the attributed workspaceId or undefined.
 */
function attribute(
  record: LegacySpaceRecord,
  workspaces: Array<{ id: string; path: string }>,
): string | undefined {
  if (record.workspaceId !== undefined && workspaces.some(w => w.id === record.workspaceId)) {
    return record.workspaceId
  }
  return workspaces.find(w => record.roots.some(root => sameDirectory(root, w.path)))?.id
}

/**
 * Run the migration, writing the new file exactly once.
 * @param registry - the host workspace registry (or a structural fake in tests).
 * @param warn - per-record drop notices (defaults to no-op).
 * @returns the number of records migrated; 0 when nothing was migrated.
 */
export function migrateLegacySpaces(
  registry: WorkspaceRegistryFace,
  warn: (message: string) => void = () => {},
): number {
  if (!needsMigration()) return 0
  let legacy: { spaces?: LegacySpaceRecord[] } = {}
  try {
    // Strip a UTF-8 BOM (Windows text editors write one routinely).
    legacy = JSON.parse(readFileSync(LEGACY_SPACES_PATH, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    warn(`dsh-codex-project: legacy ${LEGACY_SPACES_PATH} is unreadable; nothing migrated`)
    return 0
  }
  if (!legacy || !Array.isArray(legacy.spaces)) {
    warn(`dsh-codex-project: legacy ${LEGACY_SPACES_PATH} has no spaces array; nothing migrated`)
    return 0
  }
  const workspaces = registry.list()
  const result: Record<string, WorkspaceDirs> = {}
  let migrated = 0
  for (const record of legacy.spaces) {
    const workspaceId = attribute(record, workspaces)
    if (workspaceId === undefined) {
      warn(`dsh-codex-project: legacy record ${record.id} matches no registered workspace; dropped (backup at ${LEGACY_SPACES_PATH})`)
      continue
    }
    const [main, ...dirs] = record.roots
    if (main === undefined) {
      warn(`dsh-codex-project: legacy record ${record.id} has no roots; dropped`)
      continue
    }
    result[workspaceId] = { path: main, dirs }
    migrated++
  }
  if (migrated > 0) persistWorkspaceDirs(result)
  return migrated
}
