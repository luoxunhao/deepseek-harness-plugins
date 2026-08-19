import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isToggleable, listManagedSkills, setInvocation, toManagedSkill, SkillWriteError } from '../src/skills.ts'
import type { ManagedSkill } from '../src/skills.ts'
import type { Context } from '@deepseek-ai/cordis'

/** Minimal ctx.skills + logger surface, backable by real files. */
function makeFakeCtx(defs: Map<string, { path?: string; source: string }>) {
  const readInvocation = (path: string | undefined): { modelInvocable: boolean; userInvocable: boolean } => {
    if (path === undefined) return { modelInvocable: true, userInvocable: true }
    const text = readFileSync(path, 'utf8')
    const disable = /^disable-model-invocation:\s*(true|false)$/m.exec(text)
    const user = /^user-invocable:\s*(true|false)$/m.exec(text)
    return {
      modelInvocable: disable?.[1] !== 'true',
      userInvocable: user?.[1] !== 'false',
    }
  }
  const ctx = {
    skills: {
      async snapshot() {
        const skills = [...defs.entries()].map(([name, def]) => ({
          name,
          description: 'desc',
          invocation: readInvocation(def.path),
        }))
        return { skills, complete: true }
      },
      async get(name: string) {
        const def = defs.get(name)
        if (def === undefined) return undefined
        return {
          name,
          description: 'desc',
          content: 'body',
          invocation: readInvocation(def.path),
          source: def.source,
          provider: 'fake',
          path: def.path,
        }
      },
    },
    logger: { warn: () => {} },
  }
  return ctx as unknown as Context
}

let dir: string
let defs: Map<string, { path?: string; source: string }>

function writeSkill(name: string, frontmatter: string): string {
  const path = join(dir, name)
  writeFileSync(path, frontmatter)
  defs.set(name, { path, source: 'user-dsh' })
  return path
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-manager-'))
  defs = new Map()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const FM = (name: string): string => `---\nname: ${name}\ndescription: desc\n---\n\nbody\n`

describe('isToggleable', () => {
  it('is true for a filesystem skill', () => {
    expect(isToggleable({ path: '/a/b.md', source: 'user-dsh' } as never)).toBe(true)
  })
  it('is false when bundled', () => {
    expect(isToggleable({ path: '/a/b.md', source: 'bundled' } as never)).toBe(false)
  })
  it('is false when runtime', () => {
    expect(isToggleable({ path: '/a/b.md', source: 'runtime' } as never)).toBe(false)
  })
  it('is false without a disk path', () => {
    expect(isToggleable({ source: 'custom' } as never)).toBe(false)
  })
})

describe('toManagedSkill', () => {
  it('maps invocation to booleans and toggleability', () => {
    const row = toManagedSkill({
      name: 'x',
      description: 'd',
      content: 'b',
      invocation: { modelInvocable: false, userInvocable: true },
      source: 'user-dsh',
      provider: 'p',
      path: '/a/x.md',
    } as never)
    expect(row.modelInvocable).toBe(false)
    expect(row.userInvocable).toBe(true)
    expect(row.toggleable).toBe(true)
    expect(row.path).toBe('/a/x.md')
  })
})

describe('listManagedSkills', () => {
  it('returns a sorted catalog resolved from the registry', async () => {
    writeSkill('b', FM('b'))
    writeSkill('a', FM('a'))
    const ctx = makeFakeCtx(defs)
    const rows: ManagedSkill[] = await listManagedSkills(ctx, async () => [])
    expect(rows.map(r => r.name)).toEqual(['a', 'b'])
  })

  it('appends user disk skills the registry cannot surface', async () => {
    writeSkill('a', FM('a'))
    const ctx = makeFakeCtx(defs)
    const disk = {
      name: 'disk-skill',
      description: 'd',
      source: 'user-agents' as const,
      path: '/u/disk-skill.md',
      modelInvocable: true,
      userInvocable: true,
    }
    const rows = await listManagedSkills(ctx, async () => [disk])
    expect(rows.map(r => r.name)).toEqual(['a', 'disk-skill'])
    const diskRow = rows.find(r => r.name === 'disk-skill')!
    expect(diskRow.toggleable).toBe(true)
    expect(diskRow.source).toBe('user-agents')
  })

  it('keeps the registry row authoritative over a same-name disk row', async () => {
    writeSkill('a', FM('a'))
    const ctx = makeFakeCtx(defs)
    const disk = {
      name: 'a',
      description: 'disk-description',
      source: 'user-agents' as const,
      path: '/u/a.md',
      modelInvocable: false,
      userInvocable: false,
    }
    const rows = await listManagedSkills(ctx, async () => [disk])
    const row = rows.find(r => r.name === 'a')!
    expect(row.description).toBe('desc')
    expect(row.modelInvocable).toBe(true)
  })
})

describe('setInvocation', () => {
  const noDisk = async () => undefined

  it('writes modelInvocable=false as disable-model-invocation: true', async () => {
    const path = writeSkill('review', FM('review'))
    const ctx = makeFakeCtx(defs)
    const row = await setInvocation(ctx, 'review', { modelInvocable: false }, noDisk)
    expect(row.modelInvocable).toBe(false)
    expect(readFileSync(path, 'utf8')).toContain('disable-model-invocation: true')
    expect(readFileSync(path, 'utf8')).toContain('body')
  })

  it('writes userInvocable=false as user-invocable: false', async () => {
    const path = writeSkill('review', FM('review'))
    const ctx = makeFakeCtx(defs)
    const row = await setInvocation(ctx, 'review', { userInvocable: false }, noDisk)
    expect(row.userInvocable).toBe(false)
    expect(readFileSync(path, 'utf8')).toContain('user-invocable: false')
  })

  it('restores the permissive state by removing the keys', async () => {
    const path = writeSkill('review', `---\nname: review\ndescription: desc\ndisable-model-invocation: true\nuser-invocable: false\n---\n\nbody\n`)
    const ctx = makeFakeCtx(defs)
    const row = await setInvocation(ctx, 'review', { modelInvocable: true, userInvocable: true }, noDisk)
    expect(row.modelInvocable).toBe(true)
    expect(row.userInvocable).toBe(true)
    const text = readFileSync(path, 'utf8')
    expect(text).not.toContain('disable-model-invocation')
    expect(text).not.toContain('user-invocable')
    expect(text).toContain('name: review')
    expect(text).toContain('body')
  })

  it('rejects an invalid skill name', async () => {
    const ctx = makeFakeCtx(defs)
    await expect(setInvocation(ctx, 'Not A Skill!', { modelInvocable: false }, noDisk))
      .rejects.toBeInstanceOf(SkillWriteError)
  })

  it('rejects an unknown skill', async () => {
    const ctx = makeFakeCtx(defs)
    await expect(setInvocation(ctx, 'missing', { modelInvocable: false }, noDisk))
      .rejects.toBeInstanceOf(SkillWriteError)
  })

  it('rejects a bundled skill', async () => {
    const path = join(dir, 'builtin')
    writeFileSync(path, FM('builtin'))
    defs.set('builtin', { path, source: 'bundled' })
    const ctx = makeFakeCtx(defs)
    await expect(setInvocation(ctx, 'builtin', { modelInvocable: false }, noDisk))
      .rejects.toBeInstanceOf(SkillWriteError)
  })

  it('rejects a skill without a frontmatter block', async () => {
    writeFileSync(join(dir, 'noFm'), '# no frontmatter\nbody')
    defs.set('noFm', { path: join(dir, 'noFm'), source: 'user-dsh' })
    const ctx = makeFakeCtx(defs)
    await expect(setInvocation(ctx, 'noFm', { modelInvocable: false }, noDisk))
      .rejects.toBeInstanceOf(SkillWriteError)
  })

  it('writes a user disk skill the registry cannot see', async () => {
    const diskPath = join(dir, 'disk-skill')
    writeFileSync(diskPath, FM('disk-skill'))
    const ctx = makeFakeCtx(defs)
    const disk = { name: 'disk-skill', path: diskPath, source: 'user-agents' }
    const row = await setInvocation(ctx, 'disk-skill', { userInvocable: false }, async () => disk as never)
    expect(row.userInvocable).toBe(false)
    expect(row.source).toBe('user-agents')
    expect(readFileSync(diskPath, 'utf8')).toContain('user-invocable: false')
  })
})
