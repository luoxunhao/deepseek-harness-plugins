/**
 * dsh-skill-manager — host half.
 *
 * Registers loopback-fenced JSON routes under /skill-manager/api that serve
 * the merged skill catalog and write per-skill invocation policy back to the
 * skill's own frontmatter file:
 *
 *   GET  /skill-manager/api/skills                       → { skills }
 *   GET  /skill-manager/api/skills/:name/body            → { content }
 *   PUT  /skill-manager/api/skills/:name/invocation      → { skill }
 *        body: { modelInvocable?, userInvocable? }
 *
 * Reads ride the public `ctx.skills` read API (snapshot + get). Writes accept
 * only a skill NAME from the client; the target path is resolved server-side
 * from `ctx.skills.get(name).path`, so a client can never direct a write to an
 * arbitrary location. Everything is a pure catalog/browse/edit surface — no
 * skill content is created, deleted, or moved here.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer service's Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from './trust-fence.ts'
import { getSkillBody, listManagedSkills, setInvocation, SkillWriteError } from './skills.ts'

export const name = 'dsh-skill-manager'
export const inject = ['skills', 'webServer']

const API_PREFIX = '/skill-manager/api'
/** Routes that can never be read-only browse targets of a trusted host. */
const TRUSTED_HOSTS: readonly string[] = []

/** The PUT body: a single master enable flag for BOTH model and user. */
interface ToggleRequestBody {
  enabled?: boolean
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
      sendJson(res, 200, { skills: await listManagedSkills(ctx) })
      return
    }
    const bodyMatch = /^\/skill-manager\/api\/skills\/([^/]+)\/body$/.exec(path)
    if (req.method === 'GET' && bodyMatch) {
      const name = decodeURIComponent(bodyMatch[1] ?? '')
      const content = await getSkillBody(ctx, name)
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
      const body = await readJson<ToggleRequestBody>(req)
      const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined
      if (enabled === undefined) {
        sendJson(res, 400, { error: 'missing enabled boolean' })
        return
      }
      const skill = await setInvocation(ctx, name, { enabled })
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
