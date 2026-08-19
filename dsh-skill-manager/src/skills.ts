/**
 * Skill catalog assembly and per-skill invocation writes over `ctx.skills`.
 *
 * The registry (`@deepseek-ai/dsh-skill`) owns discovery, merging, and the
 * resolved invocation policy; this module only READS the catalog through the
 * public read API (snapshot + get) and WRITES back the two frontmatter keys
 * at the skill's own discovered disk path. There is no provider/root
 * enumeration and no write root configuration: the write target for a skill
 * is always `ctx.skills.get(name).path`, so a client can never steer a write
 * to an arbitrary location — only the skill name crosses the wire.
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { isModelInvocable, isSkillName, isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { applyFrontmatterPatch } from './frontmatter.ts'
import type { FrontmatterPatch } from './frontmatter.ts'
import { discoverUserSkills, findDiskSkill, parseDiskSkillFile } from './user-skills.ts'
import type { DiskSkill } from './user-skills.ts'

/** Skill sources that must never be written by this plugin (no disk file of ours). */
const NON_TOGGLEABLE_SOURCES: readonly SkillDefinition['source'][] = ['bundled', 'runtime']

/** One catalog row the UI renders. */
export interface ManagedSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: SkillDefinition['source']
  readonly provider: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  /** Whether a toggle is offered (has a disk file we are allowed to edit). */
  readonly toggleable: boolean
  /** Absolute file path when the skill came from disk (the toggle target). */
  readonly path?: string
}

/** A user-facing write failure (skill unknown, not toggleable, no frontmatter). */
export class SkillWriteError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/** A semantic invocation change: omitted keys stay untouched. */
export interface InvocationPatch {
  modelInvocable?: boolean
  userInvocable?: boolean
}

/** Whether a skill may be toggled: it has a disk path and is not read-only by source. */
export function isToggleable(def: SkillDefinition): boolean {
  if (def.path === undefined) return false
  return !NON_TOGGLEABLE_SOURCES.includes(def.source as SkillDefinition['source'])
}

/** Shape one loaded skill into the UI row. */
export function toManagedSkill(def: SkillDefinition): ManagedSkill {
  return {
    name: def.name,
    description: def.description,
    whenToUse: def.whenToUse,
    source: def.source,
    provider: def.provider,
    modelInvocable: isModelInvocable(def),
    userInvocable: isUserInvocable(def),
    toggleable: isToggleable(def),
    path: def.path,
  }
}

/** Shape one user-scope disk skill into the UI row (always toggleable). */
function diskToManagedSkill(skill: DiskSkill): ManagedSkill {
  return {
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    source: skill.source,
    provider: skill.source,
    modelInvocable: skill.modelInvocable,
    userInvocable: skill.userInvocable,
    toggleable: true,
    path: skill.path,
  }
}

/**
 * Merge registry rows with user disk rows. Registry rows are authoritative
 * (the merged winning candidates); a disk row only fills a name the registry
 * did not surface. Result is alphabetically sorted.
 */
export function mergeManagedSkills(registry: readonly ManagedSkill[], disk: readonly ManagedSkill[]): ManagedSkill[] {
  const byName = new Map(registry.map((row) => [row.name, row]))
  for (const row of disk) {
    if (!byName.has(row.name)) byName.set(row.name, row)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Assemble the full merged skill catalog as UI rows. Registry rows (the
 * canonical merged snapshot) are authoritative; user-scope disk skills the
 * registry cannot surface (project-scoped `ctx.fs` masks them) are appended.
 * @param ctx - a context with the `skills` service ready.
 * @param discoverDisk - disk-skill enumerator (injectable for tests).
 * @returns alphabetically sorted, invocation-resolved skill rows.
 */
export async function listManagedSkills(
  ctx: Context,
  discoverDisk: () => Promise<DiskSkill[]> = discoverUserSkills,
): Promise<ManagedSkill[]> {
  const { skills } = await ctx.skills.snapshot()
  const rows: ManagedSkill[] = []
  for (const summary of skills) {
    if (!isSkillName(summary.name)) continue
    const def = await ctx.skills.get(summary.name)
    if (def === undefined) continue
    rows.push(toManagedSkill(def))
  }
  const diskRows = (await discoverDisk()).map(diskToManagedSkill)
  return mergeManagedSkills(rows, diskRows)
}

/**
 * Translate a semantic invocation patch into the raw frontmatter keys. The
 * model key is negated: `modelInvocable: false` means "disable model
 * invocation" → `disable-model-invocation: true`; `modelInvocable: true`
 * (the permissive default) removes the key entirely. `userInvocable: false`
 * writes `user-invocable: false`; `true` removes the key.
 */
function toFrontmatterPatch(patch: InvocationPatch): FrontmatterPatch {
  const out: FrontmatterPatch = {}
  if (patch.modelInvocable !== undefined) {
    out['disable-model-invocation'] = patch.modelInvocable ? undefined : true
  }
  if (patch.userInvocable !== undefined) {
    out['user-invocable'] = patch.userInvocable ? undefined : false
  }
  return out
}

/**
 * Write one invocation policy change to a skill's own frontmatter file.
 * @param ctx - a context with the `skills` service ready.
 * @param name - the skill to edit (validated against the skill-name grammar).
 * @param patch - which policy keys to set; omitted keys stay untouched.
 * @param resolveDisk - user-disk locator (injectable for tests).
 * @returns the refreshed skill row after the write.
 * @throws {@link SkillWriteError} when the name is invalid, the skill is
 *   unknown, not toggleable, or its file carries no frontmatter.
 */
export async function setInvocation(
  ctx: Context,
  name: string,
  patch: InvocationPatch,
  resolveDisk: (name: string) => Promise<DiskSkill | undefined> = findDiskSkill,
): Promise<ManagedSkill> {
  if (!isSkillName(name)) {
    throw new SkillWriteError(`invalid skill name: ${name}`)
  }
  const def = await ctx.skills.get(name)
  if (def !== undefined && isToggleable(def)) {
    const path = def.path as string
    const raw = await readFile(path, 'utf8')
    const next = applyFrontmatterPatch(raw, toFrontmatterPatch(patch))
    if (next === undefined) {
      throw new SkillWriteError(`skill file has no frontmatter block: ${path}`)
    }
    await atomicWrite(path, next)
    const updated = await ctx.skills.get(name)
    if (updated === undefined) {
      throw new SkillWriteError(`skill vanished after write: ${name}`)
    }
    return toManagedSkill(updated)
  }
  const disk = await resolveDisk(name)
  if (disk !== undefined) {
    const raw = await readFile(disk.path, 'utf8')
    const next = applyFrontmatterPatch(raw, toFrontmatterPatch(patch))
    if (next === undefined) {
      throw new SkillWriteError(`skill file has no frontmatter block: ${disk.path}`)
    }
    await atomicWrite(disk.path, next)
    const refreshed = parseDiskSkillFile(await readFile(disk.path, 'utf8'), disk.path, disk.source)
    if (refreshed === undefined) {
      throw new SkillWriteError(`skill vanished after write: ${name}`)
    }
    return diskToManagedSkill(refreshed)
  }
  if (def === undefined) {
    throw new SkillWriteError(`unknown skill: ${name}`)
  }
  throw new SkillWriteError(`skill is not toggleable: ${name} (source: ${def.source})`)
}

/** Atomic replace: write a sibling temp file, then rename over the target. */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.skill-manager-${process.pid}-${randomBytes(4).toString('hex')}.tmp`,
  )
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}
