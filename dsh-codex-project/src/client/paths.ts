/**
 * Client-side path helpers for the codex-project UI. The browser bundle can
 * never import `node:path`, so the few string operations the tree, the file
 * panel, and the '@' source need live here (display names + Windows-safe
 * equality).
 * @module dsh-codex-project/client/paths
 */

/** The trailing path segment of an absolute or relative path (no node:path). */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(part => part !== '')
  return parts[parts.length - 1] ?? path
}

/** Strip trailing separators for comparison. */
function trimmed(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

/**
 * Whether two absolute paths address the same directory, per the host
 * platform's case convention (Windows paths compare case-insensitively).
 */
export function samePath(a: string, b: string): boolean {
  const x = trimmed(a)
  const y = trimmed(b)
  const caseInsensitive = typeof navigator !== 'undefined'
    && (/windows/i.test(navigator.userAgent) || /win/i.test(navigator.platform))
  return caseInsensitive ? x.toLowerCase() === y.toLowerCase() : x === y
}

/**
 * A slash-joined, `..`-normalized path from `from` to `target` (no node:path).
 * Cross-drive (no common prefix, e.g. `C:\…` vs `D:\…`) or unrelated paths
 * return `target` unchanged — the caller falls back to the absolute form.
 */
export function relativePath(from: string, target: string): string {
  const a = trimmed(from).split(/[\\/]+/).filter(part => part !== '')
  const b = trimmed(target).split(/[\\/]+/).filter(part => part !== '')
  const lower = (part: string) => part.toLowerCase()
  let i = 0
  while (i < a.length && i < b.length && lower(a[i]!) === lower(b[i]!)) i += 1
  if (i === 0) return target
  const up = a.length - i
  const parts = [...Array(up).fill('..'), ...b.slice(i)]
  return parts.join('/')
}

/** Matches a Windows drive prefix or a rooted (UNC/slash) path. */
const ABS_RE = /^([a-zA-Z]:[\\/]|[\\/])/

/**
 * Resolve a path-box input against the session cwd into a normalized absolute
 * path (no node:path in the browser bundle). Absolute inputs pass through
 * (drive letter preserved); relative inputs join under the cwd and `..`/`.`
 * are folded. The result need not exist — the host read rejects it.
 */
export function resolvePath(cwd: string, input: string): string {
  const text = input.trim().replace(/[\\/]+/g, '/')
  if (text === '') return trimmed(cwd).replace(/[\\/]+/g, '/')
  const joined = ABS_RE.test(text)
    ? text
    : `${trimmed(cwd).replace(/[\\/]+/g, '/')}/${text}`
  const drive = joined.match(/^[a-zA-Z]:/)?.[0] ?? ''
  const parts: string[] = []
  for (const part of joined.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { parts.pop(); continue }
    parts.push(part)
  }
  const normalized = parts.join('/')
  return `${drive}/${normalized}`.replace(/\/$/, '')
}
