/**
 * 打开本地目录 — the host-side native action behind the workspace menu's
 * 打开本地目录 row. Runs as a plugin-owned route
 * (`POST /codex-project/api/open-directory`) that spawns the OS file manager
 * directly. Deliberately NOT `workspaces.openPath`: that method is the
 * chat-side file-open funnel, and dsh-better-sidebar wraps it to route opens
 * into its sidebar editor — a directory has no meaning there and surfaces
 * as `"<path>" is a directory` in the sidebar. A plugin-owned route keeps
 * the action independent of any other plugin's interception.
 *
 * Validation: the payload must carry an absolute path that exists as a
 * directory; the spawn is detached and unref'd (explorer.exe reports exit
 * code 1 even on success, so the child's outcome is never consulted).
 * @module dsh-codex-project/open-directory
 */

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** The open side effect, injectable for tests. */
export type DirectoryOpener = (path: string) => void

/** Default opener: start the OS file manager detached and never block on it. */
export const openWithFileManager: DirectoryOpener = (path) => {
  spawn('explorer.exe', [path], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Handle one open-directory request: validate and spawn the file manager.
 * @param body - the JSON request body (`{ path }`).
 * @param open - the opener (defaults to the OS file manager).
 * @returns the wire result.
 */
export function openDirectoryRequest(
  body: unknown,
  open: DirectoryOpener = openWithFileManager,
): { status: number; body: { ok: true } | { ok: false; error: string } } {
  const candidate = typeof body === 'object' && body !== null
    ? (body as { path?: unknown }).path
    : undefined
  if (typeof candidate !== 'string' || candidate === '') {
    return { status: 400, body: { ok: false, error: 'missing "path"' } }
  }
  if (!isAbsolute(candidate)) {
    return { status: 400, body: { ok: false, error: 'path must be absolute' } }
  }
  let isDirectory = false
  try {
    isDirectory = statSync(candidate).isDirectory()
  } catch {
    // Missing or unreadable → the 404 below.
  }
  if (!isDirectory) {
    return { status: 404, body: { ok: false, error: `not an existing directory: ${candidate}` } }
  }
  if (process.platform !== 'win32') {
    return { status: 501, body: { ok: false, error: 'opening directories is only supported on Windows' } }
  }
  try {
    open(candidate)
  } catch (error) {
    return { status: 500, body: { ok: false, error: error instanceof Error ? error.message : String(error) } }
  }
  return { status: 200, body: { ok: true } }
}
