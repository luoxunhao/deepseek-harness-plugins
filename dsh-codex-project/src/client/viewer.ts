/**
 * Viewer classification for the 项目文件夹 tab's inline preview: map a file
 * path to a preview kind, and detect binary payloads from their first bytes.
 * Pure string/int logic — no node:path, no DOM.
 * @module dsh-codex-project/client/viewer
 */

/** The preview kind a file maps to. `code` is the catch-all text viewer. */
export type ViewerKind = 'image' | 'pdf' | 'markdown' | 'html' | 'code' | 'binary'

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
])

/** Extension (without dot, lowercased) of an absolute path. */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The preview kind for a path, by extension. `code` is the fallback. */
export function viewerKindForPath(path: string): ViewerKind {
  const ext = extensionOf(path)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === '') return 'binary'
  return 'code'
}

/** Whether a text slice is actually binary — NUL bytes in the first bytes. */
export function looksBinary(content: string): boolean {
  const head = content.slice(0, 8192)
  for (let i = 0; i < head.length; i += 1) {
    if (head.charCodeAt(i) === 0) return true
  }
  return false
}
