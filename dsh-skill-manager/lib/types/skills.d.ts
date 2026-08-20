import type { Context } from '@deepseek-ai/cordis';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';
import type { DiskSkill } from './user-skills.ts';
/**
 * Which skill scope a listing/read/write targets. `user` is the global
 * user-scope catalog; `project` is one workspace's project-scope skills, whose
 * registry lookup must carry the workspace `cwd`.
 */
export type SkillScope = {
    readonly kind: 'user';
} | {
    readonly kind: 'project';
    readonly cwd: string;
};
/** Injectable disk-locator seams for {@link listManagedSkills} (tests). */
export interface SkillListDeps {
    readonly discoverUser?: () => Promise<DiskSkill[]>;
    readonly discoverProject?: (cwd: string) => Promise<DiskSkill[]>;
}
/** Injectable disk-locator seams for reads/writes (tests). */
export interface SkillLocatorDeps {
    readonly findUser?: (name: string) => Promise<DiskSkill | undefined>;
    readonly findProject?: (cwd: string, name: string) => Promise<DiskSkill | undefined>;
}
/** One catalog row the UI renders. */
export interface ManagedSkill {
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly source: SkillDefinition['source'];
    readonly provider: string;
    readonly modelInvocable: boolean;
    readonly userInvocable: boolean;
    /** Whether a toggle is offered (has a disk file we are allowed to edit). */
    readonly toggleable: boolean;
    /** Absolute file path when the skill came from disk (the toggle target). */
    readonly path?: string;
}
/** A user-facing write failure (skill unknown, not toggleable, no frontmatter). */
export declare class SkillWriteError extends Error {
    constructor(message: string);
}
/** A single master enable flag driving BOTH model and user invocation in sync. */
export interface InvocationPatch {
    enabled: boolean;
}
/** Whether a skill may be toggled: it has a disk path and is not read-only by source. */
export declare function isToggleable(def: SkillDefinition): boolean;
/** Shape one loaded skill into the UI row. */
export declare function toManagedSkill(def: SkillDefinition): ManagedSkill;
/**
 * Merge registry rows with user disk rows. Registry rows are authoritative
 * (the merged winning candidates); a disk row only fills a name the registry
 * did not surface. Result is alphabetically sorted.
 */
export declare function mergeManagedSkills(registry: readonly ManagedSkill[], disk: readonly ManagedSkill[]): ManagedSkill[];
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
export declare function listManagedSkills(ctx: Context, deps?: SkillListDeps & {
    scope?: SkillScope;
}): Promise<ManagedSkill[]>;
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
export declare function setInvocation(ctx: Context, name: string, patch: InvocationPatch, deps?: SkillLocatorDeps & {
    scope?: SkillScope;
}): Promise<ManagedSkill>;
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
export declare function getSkillBody(ctx: Context, name: string, deps?: SkillLocatorDeps & {
    scope?: SkillScope;
}): Promise<string | undefined>;
/** A workspace entry surfaced by the host's workspace registry. */
export interface WorkspaceEntry {
    readonly id: string;
    readonly path: string;
    readonly title: string;
}
/**
 * List the host's registered workspaces for the project-level workspace
 * dropdown. Reads `ctx.workspaceRegistry` when present (optional dependency);
 * an absent registry yields an empty list so the plugin still works without it.
 */
export declare function listWorkspaces(ctx: Context): WorkspaceEntry[];
