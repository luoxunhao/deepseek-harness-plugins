import { afterAll, describe, expect, it } from 'vitest'
import { parseDiskSkillFile, userSkillRoots } from '../src/user-skills.ts'

const FM = (extra = ''): string =>
  `---\nname: probe\ndescription: A probe skill\n${extra}---\n\nbody\n`

describe('userSkillRoots', () => {
  const saved = process.env.DSH_HOME
  afterAll(() => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  })

  it('points user-agents at ~/.agents/skills', () => {
    const roots = userSkillRoots()
    expect(roots[0]!.source).toBe('user-agents')
    expect(roots[0]!.path).toContain('.agents')
  })

  it('honors DSH_HOME for the user-dsh root', () => {
    process.env.DSH_HOME = 'C:\\custom\\dsh'
    const roots = userSkillRoots()
    const userDsh = roots.find((r) => r.source === 'user-dsh')!
    expect(userDsh.path).toBe('C:\\custom\\dsh\\skills')
  })
})

describe('parseDiskSkillFile', () => {
  it('parses name, description and permissive invocation', () => {
    const skill = parseDiskSkillFile(FM(), 'C:\\u\\probe.md', 'user-agents')
    expect(skill).toMatchObject({
      name: 'probe',
      description: 'A probe skill',
      source: 'user-agents',
      path: 'C:\\u\\probe.md',
      modelInvocable: true,
      userInvocable: true,
    })
  })

  it('reads disable-model-invocation and user-invocable', () => {
    const skill = parseDiskSkillFile(
      FM('disable-model-invocation: true\nuser-invocable: false\n'),
      'C:\\u\\probe.md',
      'user-dsh',
    )
    expect(skill!.modelInvocable).toBe(false)
    expect(skill!.userInvocable).toBe(false)
    expect(skill!.source).toBe('user-dsh')
  })

  it('returns undefined without a frontmatter block', () => {
    expect(parseDiskSkillFile('# no fm\nbody', 'C:\\u\\probe.md', 'user-agents')).toBeUndefined()
  })

  it('returns undefined for an invalid skill name', () => {
    const raw = `---\nname: Not A Skill\ndescription: d\n---\n\nbody\n`
    expect(parseDiskSkillFile(raw, 'C:\\u\\x.md', 'user-agents')).toBeUndefined()
  })

  it('returns undefined when name or description is missing', () => {
    expect(parseDiskSkillFile(`---\nname: probe\n---\n\nbody\n`, 'C:\\u\\x.md', 'user-agents')).toBeUndefined()
    expect(parseDiskSkillFile(`---\ndescription: d\n---\n\nbody\n`, 'C:\\u\\x.md', 'user-agents')).toBeUndefined()
  })

  it('reads whenToUse', () => {
    const skill = parseDiskSkillFile(FM('whenToUse: Use when probing\n'), 'C:\\u\\probe.md', 'user-agents')
    expect(skill!.whenToUse).toBe('Use when probing')
  })
})