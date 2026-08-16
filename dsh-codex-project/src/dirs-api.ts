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
 *  - POST   /codex-project/api/open-directory → native-open a folder (kept)
 *
 * Errors: 400 for invalid input (bad shape, missing dir, unknown workspace
 * cannot be resolved from the registry), 405 for unknown routes/methods.
 * @module dsh-codex-project/dirs-api
 */

import type { DirsStore, WorkspaceRegistryFace } from './dirs-store.ts'
import { DirsStoreError } from './dirs-store.ts'

/** One API response: HTTP status plus a JSON body. */
export interface ApiResponse {
  status: number
  body: unknown
}

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
    return json(404, { ok: false, error: 'not-found' })
  } catch (error) {
    if (error instanceof DirsStoreError) {
      const status = error.code === 'not-found' ? 404 : 400
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
