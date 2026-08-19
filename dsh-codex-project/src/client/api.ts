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

/** The project a session sees (mirror of the host's ProjectView). */
export interface ProjectView {
  workspaceId: string
  /** Canonical main workspace root (== the session cwd). */
  path: string
  /** Surviving additional writable dirs. */
  dirs: string[]
  /** Configured dirs that no longer exist (stale roots). */
  missingDirs: string[]
}

/** One project-tree row (mirror of the host's ProjectEntry). */
export interface ProjectEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  isSymlink: boolean
  broken: boolean
}

/** One listed directory level (mirror of the host's ProjectListing). */
export interface ProjectListing {
  path: string
  entries: ProjectEntry[]
  truncated: boolean
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
  /**
   * The project anchored at a session cwd (main root + shared dirs), or null
   * when no record anchors that cwd (the 项目文件夹 tab's empty state).
   */
  project(cwd: string): Promise<ProjectView | null>
  /**
   * List one directory level of a project root (fenced to the project's roots
   * on the host). `cwd` resolves the project; `path` is the absolute dir.
   */
  listDir(cwd: string, path: string): Promise<ProjectListing>
  /**
   * Read a text file (fenced to the project roots). `cwd` resolves the
   * project; `path` is the absolute file. Long files are capped on the host
   * and flagged via `truncated`.
   */
  readFile(cwd: string, path: string): Promise<{ content: string; truncated: boolean }>
  /** Write a text file (fenced to the project roots), creating parents. */
  writeFile(cwd: string, path: string, content: string): Promise<void>
  /** Raw media URL (image/PDF in the inline preview); GET bytes. */
  fileUrl(cwd: string, path: string): string
  /** Raw media URL that forces a download disposition. */
  downloadUrl(cwd: string, path: string): string
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
    project: async (cwd) => {
      const parsed = await request<{ project: ProjectView | null }>(base, 'GET', `/project?cwd=${enc(cwd)}`)
      return parsed.project
    },
    listDir: async (cwd, path) => {
      const parsed = await request<ProjectListing>(base, 'GET', `/list?cwd=${enc(cwd)}&path=${enc(path)}`)
      return parsed
    },
    readFile: async (cwd, path) => {
      const parsed = await request<{ content: string; truncated: boolean }>(base, 'GET', `/read?cwd=${enc(cwd)}&path=${enc(path)}`)
      return parsed
    },
    writeFile: async (cwd, path, content) => {
      await request<{ ok: boolean }>(base, 'POST', '/write', { cwd, path, content })
    },
    fileUrl: (cwd, path) => `${base}/file?cwd=${enc(cwd)}&path=${enc(path)}`,
    downloadUrl: (cwd, path) => `${base}/file?cwd=${enc(cwd)}&path=${enc(path)}&download=1`,
  }
}
