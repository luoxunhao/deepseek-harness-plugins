/**
 * dsh-skill-manager — host half.
 *
 * Registers loopback-fenced JSON routes under /skill-manager/api that serve
 * the merged skill catalog and write per-skill invocation policy back to the
 * skill's own frontmatter file:
 *
 *   GET  /skill-manager/api/skills?scope=user|project&cwd=<dir>   → { skills }
 *   GET  /skill-manager/api/workspaces                             → { workspaces }
 *   GET  /skill-manager/api/skills/:name/body?scope=&cwd=          → { content }
 *   PUT  /skill-manager/api/skills/:name/invocation?scope=&cwd=    → { skill }
 *        body: { enabled }
 *
 * `scope` selects user-level vs one workspace's project-level skills; `cwd`
 * (the workspace directory) is required for project scope and is the only
 * client-supplied path — it is never a write target, only a lookup scope.
 * Reads ride the public `ctx.skills` read API (snapshot + get). Writes accept
 * only a skill NAME from the client; the target path is resolved server-side
 * from `ctx.skills.get(name, { cwd }).path`, so a client can never direct a
 * write to an arbitrary location. Everything is a pure catalog/browse/edit
 * surface — no skill content is created, deleted, or moved here.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer service's Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from './trust-fence.ts'
import {
  getSkillBody,
  listManagedSkills,
  listWorkspaces,
  setInvocation,
  SkillWriteError,
} from './skills.ts'
import type { SkillScope } from './skills.ts'

export const name = 'dsh-skill-manager'
export const inject = ['skills', 'webServer']

const API_PREFIX = '/skill-manager/api'
/** Routes that can never be read-only browse targets of a trusted host. */
const TRUSTED_HOSTS: readonly string[] = []

/** The PUT body: a single master enable flag for BOTH model and user. */
interface ToggleRequestBody {
  enabled?: boolean
}

/** Derive the requested skill scope from query params (`scope`, `cwd`). */
function scopeFromQuery(url: URL): SkillScope | undefined {
  if (url.searchParams.get('scope') === 'project') {
    const cwd = url.searchParams.get('cwd')
    if (cwd === null || cwd === '') return undefined
    return { kind: 'project', cwd }
  }
  return { kind: 'user' }
}

/** Handle every /skill-manager/api request: fence, route, respond. */
async function handleApi(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!isTrustedApiRequest(req, TRUSTED_HOSTS)) {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://local')
  const path = url.pathname
  try {
    if (req.method === 'GET' && path === `${API_PREFIX}/skills`) {
      const scope = scopeFromQuery(url)
      if (scope === undefined) {
        sendJson(res, 400, { error: 'missing cwd for project scope' })
        return
      }
      sendJson(res, 200, { skills: await listManagedSkills(ctx, { scope }) })
      return
    }
    if (req.method === 'GET' && path === `${API_PREFIX}/workspaces`) {
      sendJson(res, 200, { workspaces: listWorkspaces(ctx) })
      return
    }
    const bodyMatch = /^\/skill-manager\/api\/skills\/([^/]+)\/body$/.exec(path)
    if (req.method === 'GET' && bodyMatch) {
      const name = decodeURIComponent(bodyMatch[1] ?? '')
      const scope = scopeFromQuery(url)
      if (scope === undefined) {
        sendJson(res, 400, { error: 'missing cwd for project scope' })
        return
      }
      const content = await getSkillBody(ctx, name, { scope })
      if (content === undefined) {
        sendJson(res, 404, { error: `unknown skill: ${name}` })
        return
      }
      sendJson(res, 200, { content })
      return
    }
    const toggleMatch = /^\/skill-manager\/api\/skills\/([^/]+)\/invocation$/.exec(path)
    if (req.method === 'PUT' && toggleMatch) {
      const name = decodeURIComponent(toggleMatch[1] ?? '')
      const scope = scopeFromQuery(url)
      if (scope === undefined) {
        sendJson(res, 400, { error: 'missing cwd for project scope' })
        return
      }
      const body = await readJson<ToggleRequestBody>(req)
      const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined
      if (enabled === undefined) {
        sendJson(res, 400, { error: 'missing enabled boolean' })
        return
      }
      const skill = await setInvocation(ctx, name, { enabled }, { scope })
      sendJson(res, 200, { skill })
      return
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    if (error instanceof SkillWriteError) {
      sendJson(res, 400, { error: error.message })
      return
    }
    ctx.logger.warn(`[dsh-skill-manager] route error: ${error instanceof Error ? error.stack : String(error)}`)
    sendJson(res, 500, { error: 'internal error', detail: error instanceof Error ? error.message : String(error) })
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson<T>(req: IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/**
 * Plugin body: register the loopback-fenced API routes. Disposal of the
 * returned effect unregisters them (HMR-safe).
 * @param ctx - a context with `skills` and `webServer` ready.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => handleApi(ctx, req, res),
    }),
    'dsh-skill-manager: api routes',
  )
}
