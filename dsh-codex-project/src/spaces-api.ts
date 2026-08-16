/**
 * The /codex-project/api JSON route logic as a pure function over the store
 * — the HTTP adapter in `src/index.ts` only parses the request and calls
 * `handle`, so the whole surface is testable without a server.
 *
 * Routes:
 *  - GET    /codex-project/api/ping        → mount smoke
 *  - GET    /codex-project/api/spaces      → the configured shared records,
 *                                            each with a read-only
 *                                            `missingRoots` derivation
 *  - POST   /codex-project/api/spaces      → create `{ workspaceId?, title?, roots }`
 *  - PUT    /codex-project/api/spaces/:id  → update `{ title?, roots, allowMissingRoots? }`
 *                                            (anchor settable; confirmed
 *                                            stale-root cleanup under
 *                                            allowMissingRoots, empty roots
 *                                            deletes the record)
 *  - DELETE /codex-project/api/spaces/:id  → remove
 *
 * Errors: 400 for invalid input (bad shape, missing root directory),
 * 404 for unknown ids, 405 for unknown routes/methods.
 * @module dsh-codex-project/spaces-api
 */

import type { SpaceInput, SpaceStore } from './space-store.ts'
import { SpaceStoreError } from './space-store.ts'
import { resolveSpaceRoots } from './space-config.ts'

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

/** Parse and shape-validate one request body into a SpaceInput (the wire boundary). */
function parseInput(body: unknown): SpaceInput {
  if (typeof body !== 'object' || body === null) {
    throw new SpaceStoreError('invalid', 'request body must be an object')
  }
  const record = body as Record<string, unknown>
  const title = record.title
  if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
    throw new SpaceStoreError('invalid', 'space title must be a non-empty string')
  }
  const workspaceId = record.workspaceId
  if (workspaceId !== undefined && (typeof workspaceId !== 'string' || workspaceId.trim() === '')) {
    throw new SpaceStoreError('invalid', 'space workspaceId must be a non-empty string')
  }
  const roots = record.roots
  const allowMissingRoots = record.allowMissingRoots
  if (allowMissingRoots !== undefined && typeof allowMissingRoots !== 'boolean') {
    throw new SpaceStoreError('invalid', 'space allowMissingRoots must be a boolean')
  }
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== 'string' || root === '')) {
    throw new SpaceStoreError('invalid', 'space roots must be an array of strings')
  }
  // Empty roots only make sense as the confirmed removal of a stale root
  // list — the store deletes the record in that case.
  if (roots.length === 0 && allowMissingRoots !== true) {
    throw new SpaceStoreError('invalid', 'space roots must not be empty')
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    roots: roots as string[],
    ...(allowMissingRoots === undefined ? {} : { allowMissingRoots }),
  }
}

/**
 * Dispatch one CRUD request.
 * @param store - the persisted store.
 * @param method - the HTTP method (uppercased).
 * @param pathname - the request path (`/codex-project/api/...`).
 * @param body - the parsed JSON body (POST/PUT).
 * @returns the response.
 */
export async function spacesApi(
  store: SpaceStore,
  method: string,
  pathname: string,
  body: unknown,
): Promise<ApiResponse> {
  try {
    if (pathname === '/codex-project/api/ping') {
      return ok({ ok: true, plugin: 'dsh-codex-project' })
    }
    if (pathname === '/codex-project/api/spaces') {
      if (method === 'GET') {
        // Each record is served with its read-only missingRoots derivation
        // (the config file itself is never rewritten by a GET).
        const spaces = (await store.list()).map((space) => ({
          ...space,
          missingRoots: resolveSpaceRoots(space).missingRoots,
        }))
        return ok({ ok: true, spaces })
      }
      if (method === 'POST') {
        const space = await store.create(parseInput(body))
        return json(201, { ok: true, space })
      }
      return json(405, { ok: false, error: 'method-not-allowed' })
    }
    const match = /^\/codex-project\/api\/spaces\/([^/]+)$/.exec(pathname)
    if (match !== null) {
      const id = match[1] ?? ''
      if (method === 'PUT') {
        const space = await store.update(id, parseInput(body))
        return ok({ ok: true, space })
      }
      if (method === 'DELETE') {
        await store.remove(id)
        return ok({ ok: true })
      }
      return json(405, { ok: false, error: 'method-not-allowed' })
    }
    return json(404, { ok: false, error: 'not-found' })
  } catch (error) {
    if (error instanceof SpaceStoreError) {
      const status = error.code === 'not-found' ? 404 : 400
      return json(status, { ok: false, error: error.message })
    }
    throw error
  }
}
