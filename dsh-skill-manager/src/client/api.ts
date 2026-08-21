/**
 * Typed fetch wrapper over the /skill-manager JSON API. All calls are same
 * origin (the web shell and the host routes share the dsh web server); the
 * host's loopback fence guards them. Failures surface as
 * {@link SkillManagerApiError} with the HTTP status and the host's wire text.
 */

/** One catalog row (mirrors the host ManagedSkill shape). */
export interface ManagedSkill {
  name: string
  description: string
  whenToUse?: string
  source: string
  provider: string
  modelInvocable: boolean
  userInvocable: boolean
  toggleable: boolean
  path?: string
}

/** A single master enable flag driving BOTH model and user invocation. */
export interface InvocationPatch {
  enabled: boolean
}

/** A workspace entry (id/path/title) for the project-level workspace dropdown. */
export interface Workspace {
  id: string
  path: string
  title: string
}

/** One wire failure. */
export class SkillManagerApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Build the query string for a skill scope (cwd only for project scope). */
function scopeQuery(scope: SkillScope, cwd?: string): string {
  const params = new URLSearchParams()
  params.set('scope', scope)
  if (scope === 'project' && cwd !== undefined && cwd !== '') params.set('cwd', cwd)
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/** A skill scope: user-level, or one workspace's project-level (by cwd). */
export type SkillScope = 'user' | 'project'

/** The typed client API face exposed to the section component. */
export function createSkillManagerApi() {
  return {
    /** List the skill catalog for a scope (user, or one workspace's project skills). */
    async list(scope: SkillScope, cwd?: string): Promise<ManagedSkill[]> {
      const res = await fetch(`/skill-manager/api/skills${scopeQuery(scope, cwd)}`)
      if (!res.ok) throw await apiError('list', res)
      const data = (await res.json()) as { skills: ManagedSkill[] }
      return data.skills
    },

    /** List the host's registered workspaces for the project-level dropdown. */
    async listWorkspaces(): Promise<Workspace[]> {
      const res = await fetch('/skill-manager/api/workspaces')
      if (!res.ok) throw await apiError('listWorkspaces', res)
      const data = (await res.json()) as { workspaces: Workspace[] }
      return data.workspaces
    },

    /** Read one skill's instruction body for a scope. */
    async getBody(name: string, scope: SkillScope = 'user', cwd?: string): Promise<string> {
      const res = await fetch(`/skill-manager/api/skills/${encodeURIComponent(name)}/body${scopeQuery(scope, cwd)}`)
      if (!res.ok) throw await apiError('getBody', res)
      const data = (await res.json()) as { content: string }
      return data.content
    },

    /** Enable/disable a skill's invocation for a scope (sets model AND user together). */
    async setInvocation(name: string, patch: InvocationPatch, scope: SkillScope = 'user', cwd?: string): Promise<ManagedSkill> {
      const res = await fetch(`/skill-manager/api/skills/${encodeURIComponent(name)}/invocation${scopeQuery(scope, cwd)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: patch.enabled }),
      })
      if (!res.ok) throw await apiError('setInvocation', res)
      const data = (await res.json()) as { skill: ManagedSkill }
      return data.skill
    },

    /** Import a skill from a zip binary. Returns the imported skill's name and path. */
    async importZip(zipBuf: ArrayBuffer, scope: SkillScope = 'user', cwd?: string, overwrite = false): Promise<{ name: string; path: string }> {
      const params = new URLSearchParams(scopeQuery(scope, cwd).replace(/^\?/, ''))
      if (overwrite) params.set('overwrite', 'true')
      const qs = params.toString()
      const url = `/skill-manager/api/skills/import${qs !== '' ? `?${qs}` : ''}`
      const res = await fetch(url, { method: 'POST', body: zipBuf })
      if (!res.ok) throw await apiError('importZip', res)
      return (await res.json()) as { name: string; path: string }
    },
  }
}

export type SkillManagerApi = ReturnType<typeof createSkillManagerApi>

async function apiError(method: string, res: Response): Promise<SkillManagerApiError> {
  let text = ''
  try {
    const body = (await res.json()) as { error?: string }
    text = body.error ?? ''
  } catch {
    text = await res.text().catch(() => '')
  }
  const message = text !== '' ? text : `${method}: HTTP ${res.status}`
  return new SkillManagerApiError(res.status, message)
}
