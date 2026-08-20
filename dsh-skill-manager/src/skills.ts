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
import { discoverProjectSkills, discoverUserSkills, findDiskSkill, findProjectDiskSkill, parseDiskSkillFile } from './user-skills.ts'
import type { DiskSkill } from './user-skills.ts'

/** Skill sources that must never be written by this plugin (no disk file of ours). */
const NON_TOGGLEABLE_SOURCES: readonly SkillDefinition['source'][] = ['bundled', 'runtime']

/** Skill sources that belong to a workspace's project scope. */
const PROJECT_SOURCES: readonly SkillDefinition['source'][] = ['project-dsh', 'project-agents']

/** Whether a source is a project-scope bucket. */
function isProjectSource(source: SkillDefinition['source']): boolean {
  return PROJECT_SOURCES.includes(source)
}

/**
 * Which skill scope a listing/read/write targets. `user` is the global
 * user-scope catalog; `project` is one workspace's project-scope skills, whose
 * registry lookup must carry the workspace `cwd`.
 */
export type SkillScope =
  | { readonly kind: 'user' }
  | { readonly kind: 'project'; readonly cwd: string }

/** Injectable disk-locator seams for {@link listManagedSkills} (tests). */
export interface SkillListDeps {
  readonly discoverUser?: () => Promise<DiskSkill[]>
  readonly discoverProject?: (cwd: string) => Promise<DiskSkill[]>
}

/** Injectable disk-locator seams for reads/writes (tests). */
export interface SkillLocatorDeps {
  readonly findUser?: (name: string) => Promise<DiskSkill | undefined>
  readonly findProject?: (cwd: string, name: string) => Promise<DiskSkill | undefined>
}

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
 * Assemble the merged skill catalog as UI rows for one scope. User scope reads
 * the canonical no-cwd snapshot (project roots are not scanned without a
 * cwd) plus user-scope disk skills the registry cannot surface. Project scope
 * reads the registry with the workspace `cwd` and keeps only project-scope
 * rows, plus project-scope disk skills the registry cannot surface.
 * @param ctx - a context with the `skills` service ready.
 * @param deps - optional disk-locator seams (defaults to real discovery).
 * @returns alphabetically sorted, invocation-resolved skill rows.
 */
export async function listManagedSkills(
  ctx: Context,
  deps: SkillListDeps & { scope?: SkillScope } = {},
): Promise<ManagedSkill[]> {
  const discoverUser = deps.discoverUser ?? discoverUserSkills
  const discoverProject = deps.discoverProject ?? discoverProjectSkills
  const scope = deps.scope ?? { kind: 'user' }

  const summary = await (scope.kind === 'project'
    ? ctx.skills.snapshot({ cwd: scope.cwd })
    : ctx.skills.snapshot())

  const rows: ManagedSkill[] = []
  for (const entry of summary.skills) {
    if (!isSkillName(entry.name)) continue
    const def = await (scope.kind === 'project'
      ? ctx.skills.get(entry.name, { cwd: scope.cwd })
      : ctx.skills.get(entry.name))
    if (def === undefined) continue
    if (scope.kind === 'project' && !isProjectSource(def.source)) continue
    if (scope.kind === 'user' && isProjectSource(def.source)) continue
    rows.push(toManagedSkill(def))
  }

  const diskRows = (scope.kind === 'project'
    ? await discoverProject(scope.cwd)
    : await discoverUser()).map(diskToManagedSkill)
  const merged = mergeManagedSkills(rows, diskRows)
  return scope.kind === 'project'
    ? merged.filter((row) => isProjectSource(row.source))
    : merged.filter((row) => !isProjectSource(row.source))
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
 * together (both frontmatter keys are always written, in sync). The write
 * target is the skill's own discovered path for the given scope: user scope
 * resolves through `ctx.skills.get(name)`, project scope through
 * `ctx.skills.get(name, { cwd })`, each with a disk-locator fallback.
 * @param ctx - a context with the `skills` service ready.
 * @param name - the skill to edit (validated against the skill-name grammar).
 * @param patch - `{ enabled }`: true → both invocable, false → both disabled.
 * @param deps - optional disk-locator seams and scope (defaults to user scope).
 * @returns the refreshed skill row after the write.
 * @throws {@link SkillWriteError} when the name is invalid, the skill is
 *   unknown, not toggleable, or its file carries no frontmatter.
 */
export async function setInvocation(
  ctx: Context,
  name: string,
  patch: InvocationPatch,
  deps: SkillLocatorDeps & { scope?: SkillScope } = {},
): Promise<ManagedSkill> {
  const findUser = deps.findUser ?? findDiskSkill
  const findProject = deps.findProject ?? findProjectDiskSkill
  const scope = deps.scope ?? { kind: 'user' }
  if (!isSkillName(name)) {
    throw new SkillWriteError(`invalid skill name: ${name}`)
  }
  const def = await (scope.kind === 'project'
    ? ctx.skills.get(name, { cwd: scope.cwd })
    : ctx.skills.get(name))
  if (def !== undefined && isToggleable(def)) {
    const path = def.path as string
    const raw = await readFile(path, 'utf8')
    const next = applyFrontmatterPatch(raw, toFrontmatterPatch(patch))
    if (next === undefined) {
      throw new SkillWriteError(`skill file has no frontmatter block: ${path}`)
    }
    await atomicWrite(path, next)
    const updated = await (scope.kind === 'project'
      ? ctx.skills.get(name, { cwd: scope.cwd })
      : ctx.skills.get(name))
    if (updated === undefined) {
      throw new SkillWriteError(`skill vanished after write: ${name}`)
    }
    return toManagedSkill(updated)
  }
  const disk = scope.kind === 'project'
    ? await findProject(scope.cwd, name)
    : await findUser(name)
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
 * Read one skill's instruction body for a scope. Prefers the registry-loaded
 * definition (`ctx.skills.get`, with the workspace `cwd` in project scope);
 * when the registry cannot surface a disk skill, falls back to reading the
 * skill file directly and stripping its frontmatter. The body is trimmed as
 * DSH trims.
 * @param ctx - a context with the `skills` service ready.
 * @param name - the skill to read.
 * @param deps - optional disk-locator seams and scope (defaults to user scope).
 * @returns the skill body, or `undefined` when the skill is unknown.
 */
export async function getSkillBody(
  ctx: Context,
  name: string,
  deps: SkillLocatorDeps & { scope?: SkillScope } = {},
): Promise<string | undefined> {
  const findUser = deps.findUser ?? findDiskSkill
  const findProject = deps.findProject ?? findProjectDiskSkill
  const scope = deps.scope ?? { kind: 'user' }
  if (!isSkillName(name)) return undefined
  const def = await (scope.kind === 'project'
    ? ctx.skills.get(name, { cwd: scope.cwd })
    : ctx.skills.get(name))
  if (def !== undefined) return def.content
  const disk = scope.kind === 'project'
    ? await findProject(scope.cwd, name)
    : await findUser(name)
  if (disk === undefined) return undefined
  const body = stripFrontmatterBody(await readFile(disk.path, 'utf8'))
  return body?.trim()
}

/** A workspace entry surfaced by the host's workspace registry. */
export interface WorkspaceEntry {
  readonly id: string
  readonly path: string
  readonly title: string
}

/**
 * List the host's registered workspaces for the project-level workspace
 * dropdown. Reads `ctx.workspaceRegistry` when present (optional dependency);
 * an absent registry yields an empty list so the plugin still works without it.
 */
export function listWorkspaces(ctx: Context): WorkspaceEntry[] {
  const registry = typeof ctx.get === 'function'
    ? ctx.get('workspaceRegistry')
    : undefined
  if (registry === undefined || typeof registry.list !== 'function') return []
  return registry.list().map((workspace: { id: string; path: string; title: string }) => ({
    id: workspace.id,
    path: workspace.path,
    title: workspace.title,
  }))
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
