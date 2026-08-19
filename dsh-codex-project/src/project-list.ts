/**
 * Project folder listing for the 项目文件夹 tab: a self-contained directory
 * listing (opendir stream, dirs-first + case-insensitive name sort, symlink
 * target probing) plus a fence that only admits paths inside a project's
 * roots. Kept local to the plugin — the tab renders its own tree, so it owns
 * its listing feed too (mirrors the better-sidebar fs-tree shape so the wire
 * is familiar, without importing that plugin's runtime symbols).
 * @module dsh-codex-project/project-list
 */

import { opendir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { isPathUnder } from './containment.ts'

/** One project-tree row. */
export interface ProjectEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  /** Whether the row is a symlink; `isDir` then describes the link's target. */
  isSymlink: boolean
  /** For symlinks: the target is missing or unreadable (stat failed). */
  broken: boolean
}

/** One listed directory level. */
export interface ProjectListing {
  path: string
  entries: ProjectEntry[]
  truncated: boolean
}

/** Directory-first, case-insensitive name ordering (VSCode explorer order). */
export function compareEntries(a: ProjectEntry, b: ProjectEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** How many symlink target stats run in flight during one level listing. */
const SYMLINK_PROBE_CONCURRENCY = 32

/**
 * List one directory level.
 * @param path - absolute directory path.
 * @param maxEntries - row bound of one level (extra rows flag `truncated`).
 * @returns the sorted listing.
 * @throws when the level is unreadable or not a directory.
 */
export async function listProjectDirectory(path: string, maxEntries = 1000): Promise<ProjectListing> {
  const rows: ProjectEntry[] = []
  let overflow = 0
  const level = await opendir(path)
  try {
    for await (const dirent of level) {
      if (rows.length >= maxEntries) {
        overflow += 1
        continue
      }
      rows.push({
        name: dirent.name,
        path: join(path, dirent.name),
        isDir: dirent.isDirectory(),
        isSymlink: dirent.isSymbolicLink(),
        broken: false,
        hidden: dirent.name.startsWith('.'),
      })
    }
  } finally {
    // opendir streams are not auto-closed; close regardless of the walk result.
    await level.close().catch(() => {})
  }
  await probeSymlinkTargets(rows)
  rows.sort(compareEntries)
  return { path, entries: rows, truncated: overflow > 0 }
}

/** Probe each symlink row's target once (bounded concurrency, order-preserving). */
async function probeSymlinkTargets(rows: ProjectEntry[], concurrency = SYMLINK_PROBE_CONCURRENCY): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= rows.length) return
      const row = rows[index]!
      if (!row.isSymlink) continue
      const info = await stat(row.path).catch(() => undefined)
      row.isDir = info !== undefined ? info.isDirectory() : row.isDir
      row.broken = info === undefined
    }
  })
  await Promise.all(workers)
}

/**
 * Whether a target path lies inside any of a project's roots (main root +
 * surviving shared dirs). Uses the plugin's containment semantics, so a
 * Windows alias/case spelling still fences correctly.
 * @param target - the absolute path to test.
 * @param roots - the project's writable roots.
 * @returns whether the target is a root or a descendant of one.
 */
export async function isWithinRoots(target: string, roots: readonly string[]): Promise<boolean> {
  for (const root of roots) {
    if (await isPathUnder(target, root)) return true
  }
  return false
}
