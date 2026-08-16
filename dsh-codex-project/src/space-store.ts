/**
 * Project-space configuration store: the read-modify-write layer over the
 * spaces data file (`$DSH_CODEX_PROJECT_CONFIG` or
 * `~/.dsh-codex-project/spaces.json`, shared with `src/space-config.ts`).
 * Writes are atomic (temp file + rename) and serialized through a promise
 * queue so interleaved CRUD requests cannot lose updates; reads go straight
 * to the shared loader. Every mutation re-validates the whole file shape AND
 * the existence of every root — a saved space must be runnable. A root that
 * vanishes later narrows the grant at confinement time (the runner, the
 * seam, and the fs fence all operate on surviving roots), and the confirmed
 * removal path (`allowMissingRoots`) lets the user clean such stale roots
 * out of the record without a fail-loud wall.
 * @module dsh-codex-project/space-store
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { loadSpaces, requireCanonicalDirectory, spaceConfigPath, tryCanonicalDirectory } from './space-config.ts'
import type { SpaceRecord } from './space-config.ts'

/** A mutation failure: the request is invalid or names a missing space. */
export class SpaceStoreError extends Error {
  constructor(
    /** `not-found` (no such space id) or `invalid` (bad shape/root). */
    public readonly code: 'not-found' | 'invalid',
    message: string,
  ) {
    super(message)
    this.name = 'SpaceStoreError'
  }
}

/** The editable fields of one space (id is server-assigned and immutable). */
export interface SpaceInput {
  title?: string
  /** The host workspace the subspace is anchored to (optional; path-matched when absent). */
  workspaceId?: string
  roots: string[]
  /**
   * Confirmed stale-root cleanup: skip the existence check so vanished
   * configured roots can be removed from the record. The saved list is
   * normalized — surviving roots first (their relative order kept), stale
   * ones after — so `roots[0]` is an existing directory whenever one
   * remains, and an empty list deletes the whole record.
   */
  allowMissingRoots?: boolean
}

/** Validate that every root exists as a directory (shape is the API boundary's job). */
function validateRoots(input: SpaceInput): void {
  if (input.allowMissingRoots === true) return
  for (const root of input.roots) {
    try {
      requireCanonicalDirectory('space root', root)
    } catch (error) {
      throw new SpaceStoreError('invalid', error instanceof Error ? error.message : String(error))
    }
  }
}

/** Normalize a confirmed stale-root list: surviving roots first, stale after. */
function normalizeRoots(roots: string[]): string[] {
  const existing = roots.filter(root => tryCanonicalDirectory(root) !== undefined)
  const stale = roots.filter(root => tryCanonicalDirectory(root) === undefined)
  return [...existing, ...stale]
}

/** Serialize one mutation over the data file, atomically. */
export class SpaceStore {
  private queue: Promise<unknown> = Promise.resolve()

  private enqueue<T>(task: () => T): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  /** The configured spaces (shared loader; a malformed file fails loud). */
  async list(): Promise<SpaceRecord[]> {
    return loadSpaces()
  }

  /** Create a space with a fresh id and persist it. */
  async create(input: SpaceInput): Promise<SpaceRecord> {
    return this.enqueue(() => {
      validateRoots(input)
      const spaces = loadSpaces()
      const space: SpaceRecord = {
        id: randomUUID(),
        ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
        ...(input.title === undefined ? {} : { title: input.title }),
        roots: input.roots,
      }
      spaces.push(space)
      writeSpaces(spaces)
      return space
    })
  }

  /** Replace one space's editable fields, keeping its id. */
  async update(id: string, input: SpaceInput): Promise<SpaceRecord> {
    return this.enqueue(() => {
      validateRoots(input)
      const spaces = loadSpaces()
      const space = spaces.find((candidate) => candidate.id === id)
      if (space === undefined) throw new SpaceStoreError('not-found', `no space with id ${id}`)
      // Absent fields are preserved (the API rejects empty titles anyway):
      // root-list updates must not wipe the display title.
      if (input.title !== undefined) space.title = input.title
      // The anchor is settable (the 设为主 handover); absent keeps the current one.
      if (input.workspaceId !== undefined) space.workspaceId = input.workspaceId
      if (input.allowMissingRoots === true) {
        const normalized = normalizeRoots(input.roots)
        if (normalized.some(root => tryCanonicalDirectory(root) !== undefined)) {
          space.roots = normalized
          writeSpaces(spaces)
          return { ...space }
        }
        // Every configured root is stale — the record anchors nothing real
        // anymore; remove the whole space (the confirmed cleanup path).
        const next = spaces.filter((candidate) => candidate.id !== id)
        writeSpaces(next)
        return { ...space }
      }
      if (input.roots.length === 0) throw new SpaceStoreError('invalid', 'space roots must not be empty')
      space.roots = input.roots
      writeSpaces(spaces)
      return { ...space }
    })
  }

  /** Remove one space by id. */
  async remove(id: string): Promise<void> {
    return this.enqueue(() => {
      const spaces = loadSpaces()
      const next = spaces.filter((space) => space.id !== id)
      if (next.length === spaces.length) throw new SpaceStoreError('not-found', `no space with id ${id}`)
      writeSpaces(next)
    })
  }
}

/** Atomically persist the full space list (temp file + rename). */
export function writeSpaces(spaces: SpaceRecord[]): void {
  const path = spaceConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, JSON.stringify({ spaces }, null, 2), 'utf8')
    renameSync(tmp, path)
  } catch (error) {
    throw new SpaceStoreError('invalid', `cannot persist spaces: ${error instanceof Error ? error.message : String(error)}`)
  }
}
