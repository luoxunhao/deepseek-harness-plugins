import type { Context } from '@deepseek-ai/cordis';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';
import type { DiskSkill } from './user-skills.ts';
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
 * Assemble the full merged skill catalog as UI rows. Registry rows (the
 * canonical merged snapshot) are authoritative; user-scope disk skills the
 * registry cannot surface (project-scoped `ctx.fs` masks them) are appended.
 * @param ctx - a context with the `skills` service ready.
 * @param discoverDisk - disk-skill enumerator (injectable for tests).
 * @returns alphabetically sorted, invocation-resolved skill rows.
 */
export declare function listManagedSkills(ctx: Context, discoverDisk?: () => Promise<DiskSkill[]>): Promise<ManagedSkill[]>;
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
export declare function setInvocation(ctx: Context, name: string, patch: InvocationPatch, resolveDisk?: (name: string) => Promise<DiskSkill | undefined>): Promise<ManagedSkill>;
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
export declare function getSkillBody(ctx: Context, name: string, resolveDisk?: (name: string) => Promise<DiskSkill | undefined>): Promise<string | undefined>;
