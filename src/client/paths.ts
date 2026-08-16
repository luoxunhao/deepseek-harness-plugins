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
