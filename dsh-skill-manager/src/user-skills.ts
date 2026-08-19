/**
 * User-scope disk skill discovery via node fs.
 *
 * `ctx.skills` is the canonical merged registry, but in a web profile whose
 * host provides a project-scoped `fs` service (e.g. `dsh-codex-project`), the
 * skill-filesystem provider reads every root through that `ctx.fs` and a
 * project sandbox cannot `resolve()` out-of-project roots such as
 * `~/.agents/skills` — so user-scope disk skills vanish from the snapshot.
 *
 * This module re-reads the two user roots (`~/.agents/skills` and
 * `$DSH_HOME/skills`) directly with node fs and parses the same frontmatter
 * contract DSH uses (name, description, `disable-model-invocation`,
 * `user-invocable`). The catalog merge keeps registry rows authoritative and
 * appends only user disk skills the registry did not surface; invocation
 * writes fall back to these disk locators when `ctx.skills.get(name)` cannot
 * see the skill.
 */
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { parseFrontmatterScalars } from './frontmatter.ts'

/** One user-scope disk skill locator + its resolved invocation policy. */
export interface DiskSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: SkillDefinition['source']
  readonly path: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** The two user-scope roots this module enumerates (source → directory). */
export function userSkillRoots(): ReadonlyArray<{ source: SkillDefinition['source']; path: string }> {
  const home = homedir()
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  return [
    { source: 'user-agents', path: join(home, '.agents', 'skills') },
    { source: 'user-dsh', path: join(dshHome, 'skills') },
  ]
}

/** Parse one skill file's text into a disk skill row, or `undefined` if invalid. */
export function parseDiskSkillFile(
  raw: string,
  path: string,
  source: SkillDefinition['source'],
): DiskSkill | undefined {
  const data = parseFrontmatterScalars(raw)
  if (data === undefined) return undefined
  const name = data.name
  const description = data.description
  if (typeof name !== 'string' || typeof description !== 'string') return undefined
  if (!isSkillName(name)) return undefined
  const whenToUse = typeof data.whenToUse === 'string' ? data.whenToUse : undefined
  return {
    name,
    description,
    whenToUse,
    source,
    path,
    modelInvocable: data['disable-model-invocation'] !== true,
    userInvocable: data['user-invocable'] !== false,
  }
}

/** Enumerate user-scope disk skills across every configured user root. */
export async function discoverUserSkills(): Promise<DiskSkill[]> {
  const out: DiskSkill[] = []
  for (const root of userSkillRoots()) {
    let entries
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const name = entry.name
      let filePath: string
      if (entry.isDirectory()) {
        filePath = join(root.path, name, 'SKILL.md')
      } else if (entry.isFile() && name.endsWith('.md')) {
        filePath = join(root.path, name)
      } else {
        continue
      }
      let raw: string
      try {
        raw = await readFile(filePath, 'utf8')
      } catch {
        continue
      }
      const skill = parseDiskSkillFile(raw, filePath, root.source)
      if (skill !== undefined) out.push(skill)
    }
  }
  return out
}

/** Find one user-scope disk skill by name, or `undefined`. */
export async function findDiskSkill(name: string): Promise<DiskSkill | undefined> {
  const all = await discoverUserSkills()
  return all.find((skill) => skill.name === name)
}
