/**
 * dsh-codex-project host half: the /codex-project/api JSON routes plus the
 * sandbox seam wiring — sessions inside a multi-root codex project confine
 * through the plugin's runner (`lib/runner.js`), which grants a space-level
 * SID on every root under one restricted token (workspace-write, never
 * danger-full-access). Everything outside a multi-root space keeps the core
 * sandbox behavior bit-identical (see `src/seam.ts`).
 *
 * The full feature (wayfinder tickets) layers on top: codex-project config
 * CRUD, session→space mapping, the multi-root fs fence (ctx.fs provider
 * replacing fs-sandbox) and the settings-page + sidebar UI. Every route
 * passes the same browser-trust fence as the /api gateway — the skeleton
 * checks loopback Host only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'

import { foldSpaceContext } from './context-injection.ts'
import { wrapSandboxConfine } from './seam.ts'
import { migrateSpacesToSubspaces } from './space-migration.ts'
import { SpaceStore } from './space-store.ts'
import { spacesApi } from './spaces-api.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-codex-project'

/** Services required before mounting: the webserver routes, the session
 * store, and the workspace registry (the record anchor source; injecting it
 * also waits for its bootstrap so the lazy migration sees the full table). */
export const inject = ['webServer', 'sessions', 'workspaceRegistry']

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

/**
 * Plugin body: register the /codex-project/api JSON routes (config CRUD over
 * the spaces data file) and wrap the sandbox confine in the codex-project
 * routing.
 * @param ctx - the host cordis context (webServer, sessions).
 */
export function apply(ctx: Context): void {
  const store = new SpaceStore()

  // Lazy old-format → subspace migration: anchor anchor-less space records to
  // their host workspace (path-matched) and move the host root to roots[0].
  // Idempotent; runs on every startup until every record is anchored.
  try {
    migrateSpacesToSubspaces(ctx.workspaceRegistry)
  } catch (error) {
    ctx.logger.warn('dsh-codex-project: record migration failed: %o', error)
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
      const result = await spacesApi(store, request.method ?? 'GET', url.pathname, body)
      writeJson(response, result.status, result.body)
    },
  }), 'dsh-codex-project: api routes')

  // Seed model-facing context once per session: on the pre-step that claims
  // the session's first user message, fold the shared-record directory list
  // in right AFTER the claimed batch — the dsh "system reminder after the
  // first user message" placement (same `agent/pre-step` mechanism
  // agent-instructions/tool-skill use). The reminder is a neutral
  // `<system-reminder>` directory list: no file contents, no permission
  // claims. `next()` runs first; a fold failure keeps the original decision.
  const foldedSessions = new WeakSet<object>()
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    try {
      return foldSpaceContext(decision, messages, agent.session, foldedSessions)
    } catch (error) {
      ctx.logger.warn('dsh-codex-project: session context fold failed: %o', error)
      return decision
    }
  })

  // Route sandbox confine through the multi-root runner when the session's
  // workspace belongs to a multi-root space. `ctx.get` keeps sandbox an
  // optional dependency: hosts without the sandbox service still get the
  // routes and UI, they just keep the core confinement behavior.
  const sandbox = ctx.get('sandbox')
  if (sandbox !== undefined) {
    const runnerPath = fileURLToPath(new URL('../lib/runner.js', import.meta.url))
    ctx.effect(() => wrapSandboxConfine(sandbox, runnerPath), 'dsh-codex-project: sandbox confine routing')
  }
}
