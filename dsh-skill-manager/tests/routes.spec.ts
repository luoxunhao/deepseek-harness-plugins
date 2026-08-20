import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

// Isolate host routes from the real user-scope disk skills: the route under
// test must be deterministic regardless of what lives in ~/.agents/skills.
vi.mock('../src/user-skills.ts', () => ({
  userSkillRoots: () => [],
  parseDiskSkillFile: (raw: string, path: string, source: string) => ({ name: 'x', description: 'd', source, path, modelInvocable: true, userInvocable: true }),
  discoverUserSkills: async () => [],
  findDiskSkill: async () => undefined,
  findProjectRoot: async (cwd: string) => cwd,
  projectSkillRoots: async (cwd: string) => [],
  discoverProjectSkills: async () => [],
  findProjectDiskSkill: async () => undefined,
}))
// Type-only: pulls the webServer service's Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** A tiny context with the two injected services and an effect bag. */
function miniCtx(
  skills: Context['skills'],
  webServer: Context['webServer'],
  logger: Context['logger'],
): Context {
  return {
    skills,
    webServer,
    logger,
    get: () => undefined,
    effect: (fn: () => unknown) => {
      const disposer = fn() as (() => void) | undefined
      return () => disposer?.()
    },
  } as unknown as Context
}

function fakeWebServer(): { webServer: Context['webServer']; routes: Array<{ kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }> } {
  const routes: Array<{ kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }> = []
  const webServer = {
    register: (route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }) => {
      routes.push(route)
      return () => {}
    },
  } as unknown as Context['webServer']
  return { webServer, routes }
}

function fakeSkills(defs: Map<string, { path: string; source: string }>, dir: string) {
  const skills = {
    async snapshot() {
      return {
        skills: [...defs.keys()].map(name => ({ name, description: 'desc' })),
        complete: true,
      }
    },
    async get(name: string) {
      const def = defs.get(name)
      if (def === undefined) return undefined
      const text = readFileSync(def.path, 'utf8')
      const disable = /^disable-model-invocation:\s*(true|false)$/m.exec(text)
      const user = /^user-invocable:\s*(true|false)$/m.exec(text)
      return {
        name,
        description: 'desc',
        content: '# ' + name,
        invocation: {
          modelInvocable: disable?.[1] !== 'true',
          userInvocable: user?.[1] !== 'false',
        },
        source: def.source,
        provider: 'fake',
        path: def.path,
      }
    },
  }
  void dir
  return skills as unknown as Context['skills']
}

function fakeReq(method: string, url: string): IncomingMessage {
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:3080' },
  } as unknown as IncomingMessage
  ;(req as unknown as { [Symbol.asyncIterator]: unknown })[Symbol.asyncIterator] = async function* () {}
  return req
}

function fakeRes() {
  const out = { status: 0, headers: {} as Record<string, unknown>, body: '' }
  const res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status
      if (headers) out.headers = headers
    },
    end: (body: unknown) => { out.body = String(body) },
  } as unknown as ServerResponse
  return { res, out }
}

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => unknown,
  req: IncomingMessage,
) {
  const { res, out } = fakeRes()
  await handler(req, res)
  return { out, body: JSON.parse(out.body || 'null') as Record<string, unknown> }
}

let dir: string
let defs: Map<string, { path: string; source: string }>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-manager-routes-'))
  defs = new Map()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeSkill(name: string, source = 'user-dsh'): string {
  const path = join(dir, name)
  writeFileSync(path, `---\nname: ${name}\ndescription: desc\n---\n\nbody\n`)
  defs.set(name, { path, source })
  return path
}

describe('host routes', () => {
  it('registers a single loopback-fenced prefix route under /skill-manager/api', () => {
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    expect(routes).toHaveLength(1)
    expect(routes[0]!.kind).toBe('prefix')
    expect(routes[0]!.path).toBe('/skill-manager/api')
  })

  it('serves the skill catalog on GET /skill-manager/api/skills', async () => {
    writeSkill('alpha')
    writeSkill('beta', 'bundled')
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const { out, body } = await invoke(routes[0]!.handler, fakeReq('GET', '/skill-manager/api/skills'))
    expect(out.status).toBe(200)
    const skills = body.skills as Array<{ name: string; source: string; toggleable: boolean }>
    expect(skills.map(s => s.name)).toEqual(['alpha', 'beta'])
    expect(skills.find(s => s.name === 'alpha')!.toggleable).toBe(true)
    expect(skills.find(s => s.name === 'beta')!.toggleable).toBe(false)
  })

  it('serves a skill body on GET /skill-manager/api/skills/:name/body', async () => {
    writeSkill('alpha')
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const { out, body } = await invoke(routes[0]!.handler, fakeReq('GET', '/skill-manager/api/skills/alpha/body'))
    expect(out.status).toBe(200)
    expect((body as { content: string }).content).toBe('# alpha')
  })

  it('writes invocation on PUT /skill-manager/api/skills/:name/invocation', async () => {
    const path = writeSkill('alpha')
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const req = fakeReq('PUT', '/skill-manager/api/skills/alpha/invocation')
    ;(req as unknown as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () { yield Buffer.from(JSON.stringify({ enabled: false })) }
    const { out, body } = await invoke(routes[0]!.handler, req)
    expect(out.status).toBe(200)
    const skill = (body as { skill: { modelInvocable: boolean; userInvocable: boolean } }).skill
    expect(skill.modelInvocable).toBe(false)
    expect(skill.userInvocable).toBe(false)
    expect(readFileSync(path, 'utf8')).toContain('disable-model-invocation: true')
    expect(readFileSync(path, 'utf8')).toContain('user-invocable: false')
  })

  it('rejects a PUT without an enabled boolean', async () => {
    writeSkill('alpha')
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const req = fakeReq('PUT', '/skill-manager/api/skills/alpha/invocation')
    ;(req as unknown as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () { yield Buffer.from(JSON.stringify({ modelInvocable: false })) }
    const { out } = await invoke(routes[0]!.handler, req)
    expect(out.status).toBe(400)
  })

  it('rejects a request from a non-loopback host', async () => {
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const req = fakeReq('GET', '/skill-manager/api/skills')
    req.headers.host = 'evil.example.com'
    const { out } = await invoke(routes[0]!.handler, req)
    expect(out.status).toBe(403)
  })

  it('returns 404 for an unknown route', async () => {
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const { out } = await invoke(routes[0]!.handler, fakeReq('GET', '/skill-manager/api/nope'))
    expect(out.status).toBe(404)
  })

  it('serves project-scope skills on GET /skill-manager/api/skills?scope=project&cwd=...', async () => {
    writeSkill('project-skill', 'project-dsh')
    writeSkill('user-skill')
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const { out, body } = await invoke(routes[0]!.handler, fakeReq('GET', '/skill-manager/api/skills?scope=project&cwd=%2Fworkspace'))
    expect(out.status).toBe(200)
    const skills = body.skills as Array<{ name: string }>
    expect(skills.map(s => s.name)).toEqual(['project-skill'])
  })

  it('rejects project scope without a cwd', async () => {
    writeSkill('project-skill', 'project-dsh')
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const { out } = await invoke(routes[0]!.handler, fakeReq('GET', '/skill-manager/api/skills?scope=project'))
    expect(out.status).toBe(400)
  })

  it('writes a project-scope skill on PUT with scope=project&cwd=...', async () => {
    const path = writeSkill('project-skill', 'project-dsh')
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const req = fakeReq('PUT', '/skill-manager/api/skills/project-skill/invocation?scope=project&cwd=%2Fworkspace')
    ;(req as unknown as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () { yield Buffer.from(JSON.stringify({ enabled: false })) }
    const { out, body } = await invoke(routes[0]!.handler, req)
    expect(out.status).toBe(200)
    const skill = (body as { skill: { modelInvocable: boolean; userInvocable: boolean } }).skill
    expect(skill.modelInvocable).toBe(false)
    expect(skill.userInvocable).toBe(false)
    expect(readFileSync(path, 'utf8')).toContain('disable-model-invocation: true')
    expect(readFileSync(path, 'utf8')).toContain('user-invocable: false')
  })

  it('serves the workspace list on GET /skill-manager/api/workspaces', async () => {
    const { webServer, routes } = fakeWebServer()
    apply(miniCtx(fakeSkills(defs, dir), webServer, { warn: () => {} } as never))
    const { out, body } = await invoke(routes[0]!.handler, fakeReq('GET', '/skill-manager/api/workspaces'))
    expect(out.status).toBe(200)
    expect(body.workspaces).toEqual([])
  })
})
