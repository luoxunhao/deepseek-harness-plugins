/**
 * Client-side spaces API: the fetch face over the host's
 * `/codex-project/api` routes (same-origin GUI, loopback-fenced host side).
 * Every call throws {@link SpacesApiError} with the server's error message
 * on a non-2xx response.
 * @module dsh-codex-project/client/api
 */

/** One workspace's additional writable directories as the host serves them. */
export interface WorkspaceDirs {
  /** Canonical main workspace path (matching anchor). */
  path: string
  /** Additional writable directories (absolute, may cross drives). */
  dirs: string[]
}

/** A failed dirs call: HTTP status plus the host's error message. */
export class SpacesApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SpacesApiError'
  }
}

/** The dirs API surface. */
export interface SpacesApi {
  /** All workspace records (id → { path, dirs }). */
  list(): Promise<Record<string, WorkspaceDirs>>
  /** One workspace's additional dirs. */
  getDirs(workspaceId: string): Promise<string[]>
  /** Replace one workspace's additional dirs. */
  setDirs(workspaceId: string, dirs: string[]): Promise<string[]>
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

/** Create the dirs API client against one base path. */
export function createSpacesApi(base = '/codex-project/api'): SpacesApi {
  const enc = encodeURIComponent
  return {
    list: async () => (await request<{ spaces: Record<string, WorkspaceDirs> }>(base, 'GET', '/dirs')).spaces,
    getDirs: async (workspaceId) => {
      const parsed = await request<{ dirs: string[] }>(base, 'GET', `/dirs?workspaceId=${enc(workspaceId)}`)
      return parsed.dirs
    },
    setDirs: async (workspaceId, dirs) => {
      const parsed = await request<{ dirs: string[] }>(base, 'PUT', '/dirs', { workspaceId, dirs })
      return parsed.dirs
    },
    openDirectory: async (path) => { await request<{ ok: boolean }>(base, 'POST', '/open-directory', { path }) },
  }
}
