/**
 * dsh-codex-project host half: the add-dir plugin. The persisted model is a
 * workspace → additional-writable-dirs map (`~/.dsh-codex-project/dirs.json`
 * or `$DSH_CODEX_PROJECT_CONFIG`); sessions of a workspace that owns at
 * least one extra dir confine through the multi-root runner (workspace-level
 * SID granted on path + dirs under workspace-write), the model can add dirs
 * via the `add-dir` tool (user-confirmed through the core approval seam),
 * and a `<system-reminder>` keeps the current directory list visible and
 * refreshed on changes. Everything outside a recorded workspace (or a record
 * with no dirs) keeps the core sandbox behavior bit-identical (see
 * `src/seam.ts`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-user-approval'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

import { foldWorkspaceContext } from './context-injection.ts'
import { wrapSandboxConfine } from './seam.ts'
import { openDirectoryRequest } from './open-directory.ts'
import { migrateLegacySpaces } from './dirs-migration.ts'
import { DirsStore } from './dirs-store.ts'
import type { WorkspaceRegistryFace } from './dirs-store.ts'
import { dirsApi } from './dirs-api.ts'
import { defineAddDirTool } from './add-dir.ts'
import type { AddDirToolDeps } from './add-dir.ts'

/** Plugin identity for cordis.yml rows. */
export const name = '@luoxunhao/dsh-codex-project'

/** Services required before mounting: webServer, sessions, workspace registry, tools, approval. */
export const inject = ['webServer', 'sessions', 'workspaceRegistry', 'tools', 'approval']

/** Structural mirror of the workspace registry (see dirs-store.ts). */
declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceRegistry: WorkspaceRegistryFace
  }
}

/** Skeleton trust fence: loopback Host only; the full fence follows the /api gateway's trust source. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const host = request.headers.host ?? ''
  const hostname = host.split(':')[0] ?? ''
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

/** Read one JSON request body (POST/PUT); GET/DELETE carry none. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== 'POST' && request.method !== 'PUT') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/** Canonicalize a registry path (vanished → undefined). */
function canonicalOf(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    return undefined
  }
}

/**
 * Plugin body: migrate legacy spaces once, serve the /codex-project/api
 * routes, refresh the session reminder (text-idempotent), register the
 * add-dir tool, and wrap the sandbox confine.
 * @param ctx - the host cordis context (webServer, sessions, workspaceRegistry, tools, approval).
 */
export function apply(ctx: Context): void {
  const store = new DirsStore()

  // One-time legacy migration (old spaces.json → new dirs structure).
  try {
    migrateLegacySpaces(ctx.workspaceRegistry, (message) => { ctx.logger.warn(message) })
  } catch (error) {
    ctx.logger.warn('dsh-codex-project: legacy migration failed: %o', error)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/codex-project/api',
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (!isLoopbackRequest(request)) {
        writeJson(response, 403, { ok: false, error: 'forbidden' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const body = await readJsonBody(request)
      // 打开本地目录: plugin-owned native action (spawns the OS file manager).
      if (url.pathname === '/codex-project/api/open-directory') {
        if (request.method !== 'POST') {
          writeJson(response, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const opened = openDirectoryRequest(body)
        writeJson(response, opened.status, opened.body)
        return
      }
      const result = await dirsApi(store, ctx.workspaceRegistry, request.method ?? 'GET', `${url.pathname}${url.search}`, body)
      if (result.raw !== undefined) {
        response.writeHead(result.status, {
          'content-type': result.contentType ?? 'application/octet-stream',
          ...result.headers,
        })
        response.end(result.raw)
        return
      }
      writeJson(response, result.status, result.body)
    },
  }), 'dsh-codex-project: api routes')

  // Seed/refresh model-facing context: text-idempotent fold after claimed
  // user messages; a dir-set change naturally changes the text → refresh.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    try {
      return foldWorkspaceContext(decision, messages, agent.session)
    } catch (error) {
      ctx.logger.warn('dsh-codex-project: session context fold failed: %o', error)
      return decision
    }
  })

  // Register the add-dir model tool (user confirmation via the core
  // approval seam — dialog and audit are dsh core, the plugin only asks).
  const deps: AddDirToolDeps = {
    resolveWorkspaceId: (cwd) => {
      const canonical = canonicalOf(cwd)
      if (canonical === undefined) return undefined
      return ctx.workspaceRegistry.list()
        .find(w => canonicalOf(w.path) === canonical)?.id
    },
    requestApproval: (agent: Agent, path: string, signal: AbortSignal): Promise<ApprovalOutcome> => {
      return ctx.approval.request({
        agent,
        toolName: 'add-dir',
        reason: `add ${path} to this workspace's additional writable directories?`,
        signal,
      })
    },
    store,
  }
  const tool = defineAddDirTool(deps)
  ctx.effect(() => ctx.tools.register(tool), 'dsh-codex-project: add-dir tool')

  // Route sandbox confine through the multi-root runner for recorded workspaces.
  const sandbox = ctx.get('sandbox')
  if (sandbox !== undefined) {
    const runnerPath = fileURLToPath(new URL('../lib/runner.js', import.meta.url))
    ctx.effect(() => wrapSandboxConfine(sandbox, runnerPath), 'dsh-codex-project: sandbox confine routing')
  }
}
