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
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { isModelInvocable, isSkillName, isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { applyFrontmatterPatch, stripFrontmatterBody } from './frontmatter.ts'
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

/** A single master enable flag driving BOTH model and user invocation in sync. */
export interface InvocationPatch {
  enabled: boolean
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
 * Translate the master enabled flag into the two raw frontmatter keys, always
 * writing BOTH keys so model and user invocation stay in sync. The model key
 * is negated: enabling writes `disable-model-invocation: false`, disabling
 * writes `disable-model-invocation: true`; the user key is positive:
 * `user-invocable: true` on enable, `false` on disable.
 */
function toFrontmatterPatch(patch: InvocationPatch): FrontmatterPatch {
  return {
    'disable-model-invocation': !patch.enabled,
    'user-invocable': patch.enabled,
  }
}

/**
 * Write one invocation policy change to a skill's own frontmatter file. The
 * single {@link InvocationPatch.enabled} flag sets model AND user invocation
 * together (both frontmatter keys are always written, in sync).
 * @param ctx - a context with the `skills` service ready.
 * @param name - the skill to edit (validated against the skill-name grammar).
 * @param patch - `{ enabled }`: true → both invocable, false → both disabled.
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

/**
 * Read one skill's instruction body. Prefers the registry-loaded definition
 * (`ctx.skills.get`); when the registry cannot surface a user-scope disk skill
 * (a project `fs` masks the user roots), falls back to reading the skill file
 * directly and stripping its frontmatter. The body is trimmed as DSH trims.
 * @param ctx - a context with the `skills` service ready.
 * @param name - the skill to read.
 * @param resolveDisk - user-disk locator (injectable for tests).
 * @returns the skill body, or `undefined` when the skill is unknown.
 */
export async function getSkillBody(
  ctx: Context,
  name: string,
  resolveDisk: (name: string) => Promise<DiskSkill | undefined> = findDiskSkill,
): Promise<string | undefined> {
  if (!isSkillName(name)) return undefined
  const def = await ctx.skills.get(name)
  if (def !== undefined) return def.content
  const disk = await resolveDisk(name)
  if (disk === undefined) return undefined
  const body = stripFrontmatterBody(await readFile(disk.path, 'utf8'))
  return body?.trim()
}

/**
 * Atomic replace: write a sibling temp file, then rename over the target. On
 * Windows a rename over an existing target can transiently fail with EPERM
 * when the target is momentarily held (real-time AV scanning, a brief watcher
 * handle); a few retries absorb that, and a final EPERM falls back to an
 * in-place overwrite, which Windows tolerates for an existing file. The target
 * is a tiny markdown file and DSH's watcher uses awaitWriteFinish, so the
 * in-place fallback cannot be mistaken for a partial write.
 */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.skill-manager-${process.pid}-${randomBytes(4).toString('hex')}.tmp`,
  )
  await writeFile(tmp, content, 'utf8')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rename(tmp, path)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
      if (attempt === 2) {
        await writeFile(path, content, 'utf8')
        await rm(tmp, { force: true })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
  }
}
