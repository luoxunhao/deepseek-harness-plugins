/**
 * Client-side spaces API: the fetch face over the host's
 * `/codex-project/api` routes (same-origin GUI, loopback-fenced host side).
 * Every call throws {@link SpacesApiError} with the server's error message
 * on a non-2xx response.
 * @module dsh-codex-project/client/api
 */

/** One shared-directory record as the host serves it (roots[0] = main root). */
export interface SpaceRecord {
  id: string
  /** The owning (main) workspace, when known. */
  workspaceId?: string
  title?: string
  roots: string[]
}

/** The editable fields of one record. */
export interface SpaceInput {
  title?: string
  workspaceId?: string
  roots: string[]
}

/** A failed spaces call: HTTP status plus the host's error message. */
export class SpacesApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SpacesApiError'
  }
}

/** The spaces API surface. */
export interface SpacesApi {
  /** The configured shared-directory records. */
  list(): Promise<SpaceRecord[]>
  /** Create a record. */
  create(input: SpaceInput): Promise<SpaceRecord>
  /** Replace one record's editable fields (anchor settable — the 设为主 operation). */
  update(id: string, input: SpaceInput): Promise<SpaceRecord>
  /** Remove one record. */
  remove(id: string): Promise<void>
  /**
   * Open one local directory in the OS file manager (plugin-owned route —
   * bypasses any openPath interception by other plugins).
   */
  openDirectory(path: string): Promise<void>
}

async function request<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new SpacesApiError(0, `网络请求失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const parsed = await response.json() as { error?: unknown }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {
      // non-JSON error body: keep the status message
    }
    throw new SpacesApiError(response.status, message)
  }
  return (await response.json()) as T
}

/** Create the spaces API client against one base path. */
export function createSpacesApi(base = '/codex-project/api'): SpacesApi {
  const enc = encodeURIComponent
  return {
    list: async () => (await request<{ spaces: SpaceRecord[] }>(base, 'GET', '/spaces')).spaces,
    create: async (input) => (await request<{ space: SpaceRecord }>(base, 'POST', '/spaces', input)).space,
    update: async (id, input) => (await request<{ space: SpaceRecord }>(base, 'PUT', `/spaces/${enc(id)}`, input)).space,
    remove: async (id) => { await request<{ ok: boolean }>(base, 'DELETE', `/spaces/${enc(id)}`) },
    openDirectory: async (path) => { await request<{ ok: boolean }>(base, 'POST', '/open-directory', { path }) },
  }
}
