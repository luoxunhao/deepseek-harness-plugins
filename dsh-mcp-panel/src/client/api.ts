/**
 * Typed fetch wrapper over the /mcp-panel JSON API. All calls are same-origin
 * (the web shell and the host routes share the dsh web server); the host's
 * loopback fence guards them. Secret values never travel in either direction:
 * lists carry keys only, edits send null (delete) / string (overwrite) /
 * omitted (keep).
 */

/** Reconnect policy (mirrors the official mcp-client config). */
export interface ReconnectConfig {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

/** One server row as the list endpoint returns it (secret-masked). */
export interface ServerView {
  serverName: string
  transport: 'stdio' | 'streamable-http' | 'unknown'
  enabled: boolean
  entryId?: string
  command?: string
  args?: string[]
  envKeys: string[]
  cwd?: string
  url?: string
  headerKeys: string[]
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: ReconnectConfig
  managed: boolean
  phase?: string
  toolCount: number
}

/** Secret patch semantics: null = delete key, string = overwrite, omitted = keep. */
export type SecretPatch = Record<string, string | null>

/** Editor input sent to PUT /servers/:name. */
export interface ServerInput {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: SecretPatch
  cwd?: string
  url?: string
  headers?: SecretPatch
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
  reconnect?: ReconnectConfig
}

/** Patch file health line. */
export interface PatchInfo {
  path: string
  ok: boolean
  error: string | null
}

export interface ProbeResult {
  ok: boolean
  toolNames: string[]
  error?: string
  elapsedMs?: number
}

/** One wire failure. */
export class McpPanelApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const json = text === '' ? {} : JSON.parse(text) as Record<string, unknown>
  if (!res.ok) {
    throw new McpPanelApiError(res.status, typeof json.error === 'string' ? json.error : `${res.status}`)
  }
  return json as T
}

/** The typed client API face exposed to the section component. */
export function createMcpPanelApi() {
  return {
    async list(): Promise<{ servers: ServerView[]; externalServers: ServerView[]; patch: PatchInfo }> {
      return request('GET', '/mcp-panel/api/servers')
    },

    save(input: ServerInput, previousServerName?: string): Promise<{ server: ServerView; reconciled: boolean }> {
      const body = previousServerName === undefined ? { input } : { input, previousServerName }
      return request('PUT', `/mcp-panel/api/servers/${encodeURIComponent(input.serverName)}`, body)
    },

    setEnabled(serverName: string, enabled: boolean): Promise<{ server: ServerView; reconciled: boolean }> {
      return request('PUT', `/mcp-panel/api/servers/${encodeURIComponent(serverName)}/enabled`, { enabled })
    },

    remove(serverName: string): Promise<{ ok: boolean; reconciled: boolean }> {
      return request('DELETE', `/mcp-panel/api/servers/${encodeURIComponent(serverName)}`)
    },

    testByInput(input: ServerInput): Promise<ProbeResult> {
      return request('POST', '/mcp-panel/api/test', input)
    },

    testByName(serverName: string): Promise<ProbeResult> {
      return request('POST', '/mcp-panel/api/test', { serverName })
    },
  }
}

export type McpPanelApi = ReturnType<typeof createMcpPanelApi>
