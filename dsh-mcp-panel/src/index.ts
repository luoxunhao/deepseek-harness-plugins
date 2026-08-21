/**
 * dsh-mcp-panel — host half.
 *
 * Registers loopback-fenced JSON routes under /mcp-panel/api that manage the
 * plugin's managed block of MCP server rows in the profile's cordis.patch.yml:
 *
 *   GET    /mcp-panel/api/servers                       → { servers, externalServers, patch }
 *   PUT    /mcp-panel/api/servers/:serverName           → { server, reconciled }
 *   DELETE /mcp-panel/api/servers/:serverName           → { ok, reconciled }
 *   PUT    /mcp-panel/api/servers/:serverName/enabled   → { server, reconciled }
 *   POST   /mcp-panel/api/test                          → probe result
 *
 * The panel only produces configuration; the official
 * @deepseek-ai/dsh-mcp-client plugin owns connections, reconnections, and
 * tool registration. Secret values never cross the RPC boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  extractManagedRows,
  listMcpPatchRows,
  MANAGED_ROW_ID_PREFIX,
} from './patch-editor.ts'
import type { PatchRow } from './patch-editor.ts'
import { readPatchFile, writeManagedRows } from './patch-file.ts'
import { applyServerEdit, inputFromPatchRow, mcpServerInputSchema, patchRowToView, rowIdForServerName, serverNameFromRowId } from './mcp/model.ts'
import type { McpServerInput } from './mcp/model.ts'
import { z } from 'zod'
import { fiberPhaseOf, getLoaderEntry, mcpToolCount, waitForLoaderState } from './status.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { probeMcpServer } from './probe.ts'

export const name = '@luoxunhao/dsh-mcp-panel'
export const inject = ['webServer', 'tools', 'loader']

const API_PREFIX = '/mcp-panel/api'

/** 带状态码的路由错误：handleApi 顶层按码转 JSON。 */
class RouteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const savePayloadSchema = z.object({
  input: mcpServerInputSchema,
  previousServerName: z.string().optional(),
})

/** 定位本 profile 的 cordis.patch.yml：baseUrl（file: URL）优先，包位置兜底。 */
export function resolvePatchPath(ctx: Context): string {
  const base = (ctx as unknown as Record<string, unknown>).baseUrl
  if (typeof base === 'string' && base.length > 0) {
    try {
      const url = new URL(base)
      if (url.protocol === 'file:') return join(fileURLToPath(url), 'cordis.patch.yml')
    } catch {
      // fall through to package-location fallback
    }
  }
  const packageDir = fileURLToPath(new URL('../', import.meta.url))
  return join(resolve(packageDir, '../../..'), 'cordis.patch.yml')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  if (chunks.length === 0) return {} as T
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

interface ManagedRowSet {
  path: string
  raw: string
  managed: PatchRow[]
  external: PatchRow[]
}

async function readRows(ctx: Context): Promise<ManagedRowSet> {
  const path = resolvePatchPath(ctx)
  const raw = await readPatchFile(path)
  const blockRows = extractManagedRows(raw)
  // 所有权看 id 前缀：块内无前缀的行（手写混入）按外部行对待——只读。
  const managed = blockRows.filter(row => typeof row.id === 'string' && row.id.startsWith(MANAGED_ROW_ID_PREFIX))
  const managedIds = new Set(managed.map(row => row.id).filter((id): id is string => typeof id === 'string'))
  const external = listMcpPatchRows(raw).filter(row => typeof row.id !== 'string' || !managedIds.has(row.id))
  return { path, raw, managed, external }
}

/** view + 运行时装饰（相位/工具数）。loader 缺席时字段降级。 */
function decorate(ctx: Context, row: PatchRow, managed: boolean): Record<string, unknown> | undefined {
  const view = patchRowToView(row)
  if (view === undefined) return undefined
  const entry = typeof row.id === 'string' ? getLoaderEntry(ctx, row.id) : undefined
  const phase = fiberPhaseOf((entry?.fiber as Record<string, unknown> | undefined)?.state as number | undefined)
  return {
    ...view,
    managed,
    ...(phase === null ? {} : { phase }),
    toolCount: view.enabled ? mcpToolCount(ctx, view.serverName) : 0,
  }
}

function findManagedRow(rows: PatchRow[], serverName: string): PatchRow | undefined {
  return rows.find(row => serverNameFromRowId(row.id) === serverName || (row.config as Record<string, unknown> | undefined)?.serverName === serverName)
}

async function saveServer(ctx: Context, rawBody: unknown): Promise<Record<string, unknown>> {
  const parsed = savePayloadSchema.safeParse(rawBody)
  if (!parsed.success) throw new RouteError(400, `请求体不合法：${parsed.error.issues[0]?.message ?? String(parsed.error)}`)
  const { input, previousServerName } = parsed.data
  // 目标行的判定键：改名时是旧名，其余情况就是新名本身。
  const targetName = previousServerName ?? input.serverName
  const { managed, external } = await readRows(ctx)

  for (const row of external) {
    if ((row.config as Record<string, unknown> | undefined)?.serverName === input.serverName) {
      throw new RouteError(409, `serverName "${input.serverName}" 已被外部 MCP 行占用，请在 cordis.patch.yml 中手动处理`)
    }
  }
  for (const row of managed) {
    const name = (row.config as Record<string, unknown> | undefined)?.serverName
    const rowKey = serverNameFromRowId(row.id)
    if (name === input.serverName && rowKey !== targetName) {
      throw new RouteError(409, `serverName "${input.serverName}" 已存在`)
    }
  }

  const previous = findManagedRow(managed, targetName)
  if (previousServerName !== undefined && previous === undefined) {
    throw new RouteError(404, `要编辑的受管行不存在："${previousServerName}"`)
  }
  const enabled = previous !== undefined ? previous.disabled !== true : true

  const nextRow = applyServerEdit(previous, input, enabled)
  const nextRows = managed.filter(row => findManagedRow([row], targetName) === undefined)
  nextRows.push(nextRow)
  nextRows.sort((a, b) => String((a.config as Record<string, unknown>)?.serverName ?? '').localeCompare(String((b.config as Record<string, unknown>)?.serverName ?? '')))
  await writeManagedRows(resolvePatchPath(ctx), nextRows)

  const reconciled = enabled
    ? await waitForLoaderState(ctx, nextRow.id!, entry => entry !== undefined && entry.disabled !== true)
    : await waitForLoaderState(ctx, nextRow.id!, entry => entry !== undefined && entry.disabled === true)

  const server = decorate(ctx, nextRow, true)
  if (server === undefined) throw new RouteError(500, '写入成功但生成的 MCP 行无效')
  return { server, reconciled }
}

async function setServerEnabled(ctx: Context, serverName: string, enabled: boolean): Promise<Record<string, unknown>> {
  const { managed } = await readRows(ctx)
  const row = findManagedRow(managed, serverName)
  if (row === undefined) throw new RouteError(404, `MCP 行 "${serverName}" 不存在或不是面板受管行`)
  row.disabled = !enabled
  await writeManagedRows(resolvePatchPath(ctx), managed)
  const reconciled = enabled
    ? await waitForLoaderState(ctx, row.id!, entry => entry !== undefined && entry.disabled !== true)
    : await waitForLoaderState(ctx, row.id!, entry => entry !== undefined && entry.disabled === true)
  const server = decorate(ctx, row, true)
  if (server === undefined) throw new RouteError(500, '写入成功但生成的 MCP 行无效')
  return { server, reconciled }
}

async function removeServer(ctx: Context, serverName: string): Promise<Record<string, unknown>> {
  const { managed } = await readRows(ctx)
  const row = findManagedRow(managed, serverName)
  if (row === undefined) {
    throw new RouteError(404, `MCP 行 "${serverName}" 不存在或不是面板受管行（外部行请在 cordis.patch.yml 中手动删除）`)
  }
  const nextRows = managed.filter(candidate => candidate !== row)
  await writeManagedRows(resolvePatchPath(ctx), nextRows)
  const reconciled = await waitForLoaderState(ctx, row.id!, entry => entry === undefined)
  return { ok: true, reconciled }
}

/** 处理每个 /mcp-panel/api 请求：fence、路由、响应。 */
export async function handleApi(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isTrustedApiRequest(req, [])) {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://local')
  const path = url.pathname
  try {
    if (req.method === 'GET' && path === `${API_PREFIX}/servers`) {
      let patch: { path: string; ok: boolean; error: string | null } = { path: resolvePatchPath(ctx), ok: false, error: null }
      try {
        const { path: patchPath, managed, external } = await readRows(ctx)
        patch = { path: patchPath, ok: true, error: null }
        const servers = managed.map(row => decorate(ctx, row, true)).filter(Boolean)
        const externalServers = external.map(row => decorate(ctx, row, false)).filter(Boolean)
        sendJson(res, 200, { servers, externalServers, patch })
      } catch (error) {
        sendJson(res, 200, {
          servers: [],
          externalServers: [],
          patch: { ...patch, error: error instanceof Error ? error.message : String(error) },
        })
      }
      return
    }
    const serverMatch = /^\/mcp-panel\/api\/servers\/([^/]+)$/.exec(path)
    if (req.method === 'PUT' && serverMatch) {
      // URL 里的名字只是寻址便利；真正的目标行由 body 的 input/previousServerName 决定。
      const body = await readJson<unknown>(req)
      sendJson(res, 200, await saveServer(ctx, body))
      return
    }
    const enabledMatch = /^\/mcp-panel\/api\/servers\/([^/]+)\/enabled$/.exec(path)
    if (req.method === 'PUT' && enabledMatch) {
      const body = await readJson<{ enabled?: unknown }>(req)
      if (typeof body.enabled !== 'boolean') throw new RouteError(400, 'missing enabled boolean')
      sendJson(res, 200, await setServerEnabled(ctx, decodeURIComponent(enabledMatch[1] ?? ''), body.enabled))
      return
    }
    if (req.method === 'DELETE' && serverMatch) {
      const serverName = decodeURIComponent(serverMatch[1] ?? '')
      sendJson(res, 200, await removeServer(ctx, serverName))
      return
    }
    if (req.method === 'POST' && path === `${API_PREFIX}/test`) {
      const body = await readJson<Record<string, unknown>>(req)
      let input: McpServerInput
      if (typeof body.serverName === 'string' && !('transport' in body)) {
        const { managed, external } = await readRows(ctx)
        const row = [...managed, ...external].find(
          candidate =>
            (candidate.config as Record<string, unknown> | undefined)?.serverName === body.serverName ||
            serverNameFromRowId(candidate.id) === body.serverName,
        )
        if (row === undefined) throw new RouteError(404, `MCP 行 "${body.serverName}" 不存在`)
        input = inputFromPatchRow(row)
      } else {
        input = mcpServerInputSchema.parse(body)
      }
      sendJson(res, 200, await probeMcpServer(input))
      return
    }
    sendJson(res, 404, { error: `not found: ${req.method} ${path}` })
  } catch (error) {
    if (error instanceof RouteError) {
      sendJson(res, error.status, { error: error.message })
      return
    }
    if (error !== null && typeof error === 'object' && 'issues' in error) {
      sendJson(res, 400, { error: `请求体不合法：${String((error as { issues: Array<{ message?: string }> }).issues[0]?.message ?? '')}` })
      return
    }
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: `${API_PREFIX}`,
      handler: (req: IncomingMessage, res: ServerResponse) => handleApi(ctx, req, res),
    }),
  )
}
