/**
 * The /codex-project/api JSON route logic as a pure function over the store
 * — the HTTP adapter in `src/index.ts` only parses the request and calls
 * `handle`, so the whole surface is testable without a server.
 *
 * Routes:
 *  - GET    /codex-project/api/ping        → mount smoke
 *  - GET    /codex-project/api/dirs        → one workspace's additional dirs
 *                                            (?workspaceId=<id>) — a workspace
 *                                            with NO recorded dirs returns an
 *                                            empty list (never 404: any
 *                                            registry workspace can manage its
 *                                            additional dirs)
 *  - PUT    /codex-project/api/dirs        → replace one workspace's dirs
 *                                            ({ workspaceId, dirs }); the
 *                                            workspace is anchored first so a
 *                                            first-time addition creates its
 *                                            record
 *  - GET    /codex-project/api/project     → the project anchored at a cwd
 *                                            (?cwd=<path>) — { path, dirs,
 *                                            missingDirs } or null
 *  - GET    /codex-project/api/list        → one project-root directory level
 *                                            (?cwd=<path>&path=<abs>), fenced
 *                                            to the project's roots
 *  - GET    /codex-project/api/read        → one text file's content
 *                                            (?cwd=<path>&path=<abs>), fenced;
 *                                            capped at READ_CAP bytes with a
 *                                            `truncated` flag
 *  - POST   /codex-project/api/write       → save a text file
 *                                            ({ cwd, path, content }), fenced
 *  - GET    /codex-project/api/file        → raw file bytes
 *                                            (?cwd=<path>&path=<abs>[&download=1]),
 *                                            fenced; download sets an
 *                                            attachment disposition
 *  - POST   /codex-project/api/open-directory → native-open a folder (kept)
 *
 * Errors: 400 for invalid input (bad shape, missing dir, unknown workspace
 * cannot be resolved from the registry), 403 for a path outside a project's
 * roots, 404 for an unknown workspace, 405 for unknown routes/methods.
 * @module dsh-codex-project/dirs-api
 */

import { open } from 'node:fs/promises'
import { extname } from 'node:path'

import type { DirsStore, WorkspaceRegistryFace } from './dirs-store.ts'
import { DirsStoreError } from './dirs-store.ts'
import { canonicalizeDirectory, projectFor } from './project-view.ts'
import { isWithinRoots, listProjectDirectory } from './project-list.ts'

/**
 * One API response: HTTP status plus a JSON body, optionally a raw byte
 * payload (the /file route) with its content type and extra headers.
 */
export interface ApiResponse {
  status: number
  body: unknown
  raw?: Buffer
  contentType?: string
  headers?: Record<string, string>
}

/** Text reads are capped so a giant file cannot pin the GUI or the bridge. */
export const READ_CAP = 4 * 1024 * 1024

function json(status: number, body: unknown): ApiResponse {
  return { status, body }
}

function ok(body: unknown): ApiResponse {
  return json(200, body)
}

/** Validate a non-empty string field or throw 400. */
function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DirsStoreError('invalid', `${key} must be a non-empty string`)
  }
  return value
}

/** Parse and shape-validate a PUT body into `{ workspaceId, dirs }`. */
function parsePut(body: unknown): { workspaceId: string; dirs: string[] } {
  if (typeof body !== 'object' || body === null) {
    throw new DirsStoreError('invalid', 'request body must be an object')
  }
  const record = body as Record<string, unknown>
  const workspaceId = requireString(record, 'workspaceId')
  const rawDirs = record.dirs
  if (!Array.isArray(rawDirs) || rawDirs.some(dir => typeof dir !== 'string' || dir === '')) {
    throw new DirsStoreError('invalid', 'dirs must be an array of non-empty strings')
  }
  return { workspaceId, dirs: rawDirs as string[] }
}

/** A fenced project target: the canonical cwd plus its writable roots. */
interface FencedProject {
  canonical: string
  roots: string[]
}

/**
 * Resolve the project a cwd anchors and its writable roots — the main root
 * and its surviving shared dirs. With no project config the fence anchors to
 * the session's own cwd as a single root (the tab's no-config fallback), so
 * every project-facing route shares one fence definition.
 * @param store - the persisted store.
 * @param cwd - the session's working directory (absolute).
 * @returns the canonical cwd and the fence roots.
 * @throws 400 when the cwd is not an existing directory.
 */
async function fenceFor(store: DirsStore, cwd: string): Promise<FencedProject> {
  const canonical = canonicalizeDirectory(cwd)
  if (canonical === undefined) {
    throw new DirsStoreError('invalid', 'cwd is not an existing directory')
  }
  const project = projectFor(await store.load(), canonical)
  const roots = project === undefined ? [canonical] : [project.path, ...project.dirs]
  return { canonical, roots }
}

/** Read a text file up to READ_CAP bytes; longer files flag `truncated`. */
export async function readProjectFile(
  path: string,
  maxBytes = READ_CAP,
): Promise<{ content: string; truncated: boolean }> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const toRead = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(toRead)
    await handle.read(buffer, 0, toRead, 0)
    return { content: buffer.toString('utf8'), truncated: size > maxBytes }
  } finally {
    await handle.close().catch(() => {})
  }
}

/** A small extension → media content-type map for the /file route. */
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
}

/** Read a raw file, fenced to a project's roots, as a byte response. */
export async function readProjectFileRaw(
  path: string,
  download = false,
): Promise<{ raw: Buffer; contentType: string; headers: Record<string, string> }> {
  const { readFile } = await import('node:fs/promises')
  const buffer = await readFile(path)
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const headers: Record<string, string> = {}
  if (download) {
    const name = path.split(/[\\/]/).pop() ?? 'file'
    headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
  }
  return { raw: buffer, contentType, headers }
}

/**
 * Dispatch one request.
 * @param store - the persisted store.
 * @param registry - the host workspace registry (path resolution for anchoring).
 * @param method - the HTTP method (uppercased).
 * @param pathname - the request path INCLUDING any query
 *   (`/codex-project/api/dirs?workspaceId=<id>`).
 * @param body - the parsed JSON body (PUT).
 * @returns the response.
 */
export async function dirsApi(
  store: DirsStore,
  registry: WorkspaceRegistryFace,
  method: string,
  pathname: string,
  body: unknown,
): Promise<ApiResponse> {
  try {
    if (pathname.startsWith('/codex-project/api/ping')) {
      return ok({ ok: true, plugin: 'dsh-codex-project' })
    }
    if (pathname.split('?')[0] === '/codex-project/api/dirs') {
      if (method === 'GET') {
        const query = new URL(pathname, 'http://127.0.0.1').searchParams
        const requested = query.get('workspaceId')
        const records = await store.load()
        if (requested !== null) {
          // An unrecorded workspace is a valid target with no additional
          // dirs (the empty state); only a totally unknown id is an error.
          const record = records[requested]
          if (record === undefined && !isKnownWorkspace(registry, requested)) {
            throw new DirsStoreError('not-found', `no workspace ${requested}`)
          }
          return ok({ ok: true, dirs: record?.dirs ?? [] })
        }
        return ok({ ok: true, spaces: records })
      }
      if (method === 'PUT') {
        const { workspaceId, dirs } = parsePut(body)
        // First-time addition anchors the workspace (resolving its path from
        // the registry); a later PUT just replaces the recorded dirs.
        const anchored = await store.anchor(workspaceId, resolveRegistryPath(registry, workspaceId))
        const record = await store.setDirs(workspaceId, dirs)
        return ok({ ok: true, dirs: record.dirs, path: anchored.path })
      }
      return json(405, { ok: false, error: 'method-not-allowed' })
    }
    if (pathname.split('?')[0] === '/codex-project/api/project') {
      if (method !== 'GET') {
        return json(405, { ok: false, error: 'method-not-allowed' })
      }
      const query = new URL(pathname, 'http://127.0.0.1').searchParams
      const cwd = query.get('cwd')
      if (cwd === null || cwd === '') {
        throw new DirsStoreError('invalid', 'cwd query parameter is required')
      }
      const canonical = canonicalizeDirectory(cwd)
      const records = await store.load()
      const project = canonical === undefined ? undefined : projectFor(records, canonical)
      return ok({ ok: true, project: project ?? null })
    }
    if (pathname.split('?')[0] === '/codex-project/api/list') {
      if (method !== 'GET') {
        return json(405, { ok: false, error: 'method-not-allowed' })
      }
      const query = new URL(pathname, 'http://127.0.0.1').searchParams
      const cwd = query.get('cwd')
      const rawPath = query.get('path')
      if (cwd === null || cwd === '' || rawPath === null || rawPath === '') {
        throw new DirsStoreError('invalid', 'cwd and path query parameters are required')
      }
      const { roots } = await fenceFor(store, cwd)
      if (!(await isWithinRoots(rawPath, roots))) {
        throw new DirsStoreError('forbidden', `"${rawPath}" is outside the project roots`)
      }
      try {
        const listing = await listProjectDirectory(rawPath)
        return ok({ ok: true, path: listing.path, entries: listing.entries, truncated: listing.truncated })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new DirsStoreError('invalid', `cannot list "${rawPath}": ${message}`)
      }
    }
    if (pathname.split('?')[0] === '/codex-project/api/read') {
      if (method !== 'GET') {
        return json(405, { ok: false, error: 'method-not-allowed' })
      }
      const query = new URL(pathname, 'http://127.0.0.1').searchParams
      const cwd = query.get('cwd')
      const rawPath = query.get('path')
      if (cwd === null || cwd === '' || rawPath === null || rawPath === '') {
        throw new DirsStoreError('invalid', 'cwd and path query parameters are required')
      }
      const { roots } = await fenceFor(store, cwd)
      if (!(await isWithinRoots(rawPath, roots))) {
        throw new DirsStoreError('forbidden', `"${rawPath}" is outside the project roots`)
      }
      try {
        const { content, truncated } = await readProjectFile(rawPath)
        return ok({ ok: true, path: rawPath, content, truncated })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new DirsStoreError('invalid', `cannot read "${rawPath}": ${message}`)
      }
    }
    if (pathname.split('?')[0] === '/codex-project/api/write') {
      if (method !== 'POST') {
        return json(405, { ok: false, error: 'method-not-allowed' })
      }
      if (typeof body !== 'object' || body === null) {
        throw new DirsStoreError('invalid', 'request body must be an object')
      }
      const record = body as Record<string, unknown>
      const cwd = requireString(record, 'cwd')
      const rawPath = requireString(record, 'path')
      const content = record.content
      if (typeof content !== 'string') {
        throw new DirsStoreError('invalid', 'content must be a string')
      }
      const { roots } = await fenceFor(store, cwd)
      if (!(await isWithinRoots(rawPath, roots))) {
        throw new DirsStoreError('forbidden', `"${rawPath}" is outside the project roots`)
      }
      try {
        const { writeFile, mkdir } = await import('node:fs/promises')
        const { dirname } = await import('node:path')
        await mkdir(dirname(rawPath), { recursive: true })
        await writeFile(rawPath, content, 'utf8')
        return ok({ ok: true, path: rawPath })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new DirsStoreError('invalid', `cannot write "${rawPath}": ${message}`)
      }
    }
    if (pathname.split('?')[0] === '/codex-project/api/file') {
      if (method !== 'GET') {
        return json(405, { ok: false, error: 'method-not-allowed' })
      }
      const query = new URL(pathname, 'http://127.0.0.1').searchParams
      const cwd = query.get('cwd')
      const rawPath = query.get('path')
      if (cwd === null || cwd === '' || rawPath === null || rawPath === '') {
        throw new DirsStoreError('invalid', 'cwd and path query parameters are required')
      }
      const { roots } = await fenceFor(store, cwd)
      if (!(await isWithinRoots(rawPath, roots))) {
        throw new DirsStoreError('forbidden', `"${rawPath}" is outside the project roots`)
      }
      try {
        const { raw, contentType, headers } = await readProjectFileRaw(rawPath, query.get('download') === '1')
        return { status: 200, body: undefined, raw, contentType, headers }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new DirsStoreError('invalid', `cannot read "${rawPath}": ${message}`)
      }
    }
    return json(404, { ok: false, error: 'not-found' })
  } catch (error) {
    if (error instanceof DirsStoreError) {
      const status = error.code === 'not-found' ? 404 : error.code === 'forbidden' ? 403 : 400
      return json(status, { ok: false, error: error.message })
    }
    throw error
  }
}

/** Whether the id names a registered workspace. */
function isKnownWorkspace(registry: WorkspaceRegistryFace, workspaceId: string): boolean {
  return registry.list().some(candidate => candidate.id === workspaceId)
}

/** Resolve a workspace's canonical path from the registry (throws 404 when unknown). */
function resolveRegistryPath(registry: WorkspaceRegistryFace, workspaceId: string): string {
  const workspace = registry.list().find(candidate => candidate.id === workspaceId)
  if (workspace === undefined) throw new DirsStoreError('not-found', `no workspace ${workspaceId}`)
  return workspace.path
}
