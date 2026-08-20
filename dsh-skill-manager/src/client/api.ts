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

/** One wire failure. */
export class SkillManagerApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** The typed client API face exposed to the section component. */
export function createSkillManagerApi() {
  return {
    /** List the full merged skill catalog. */
    async list(): Promise<ManagedSkill[]> {
      const res = await fetch('/skill-manager/api/skills')
      if (!res.ok) throw await apiError('list', res)
      const data = (await res.json()) as { skills: ManagedSkill[] }
      return data.skills
    },

    /** Read one skill's instruction body. */
    async getBody(name: string): Promise<string> {
      const res = await fetch(`/skill-manager/api/skills/${encodeURIComponent(name)}/body`)
      if (!res.ok) throw await apiError('getBody', res)
      const data = (await res.json()) as { content: string }
      return data.content
    },

    /** Enable/disable a skill's invocation (sets model AND user together). */
    async setInvocation(name: string, patch: InvocationPatch): Promise<ManagedSkill> {
      const res = await fetch(`/skill-manager/api/skills/${encodeURIComponent(name)}/invocation`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: patch.enabled }),
      })
      if (!res.ok) throw await apiError('setInvocation', res)
      const data = (await res.json()) as { skill: ManagedSkill }
      return data.skill
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
