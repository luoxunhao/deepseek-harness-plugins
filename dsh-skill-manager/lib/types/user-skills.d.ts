import type { SkillDefinition } from '@deepseek-ai/dsh-skill';
/** One user-scope disk skill locator + its resolved invocation policy. */
export interface DiskSkill {
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly source: SkillDefinition['source'];
    readonly path: string;
    readonly modelInvocable: boolean;
    readonly userInvocable: boolean;
}
/** The two user-scope roots this module enumerates (source → directory). */
export declare function userSkillRoots(): ReadonlyArray<{
    source: SkillDefinition['source'];
    path: string;
}>;
/**
 * Walk up from `cwd` until a `.git` marker is found, mirroring DSH's
 * `findProjectRoot`. Returns `cwd` when no project marker exists above it.
 */
export declare function findProjectRoot(cwd: string): Promise<string>;
/**
 * The two project-scope roots of one workspace (source → directory under the
 * discovered project root). Mirrors DSH's skill-filesystem provider.
 */
export declare function projectSkillRoots(cwd: string): Promise<ReadonlyArray<{
    source: SkillDefinition['source'];
    path: string;
}>>;
/** Enumerate user-scope disk skills across every configured user root. */
export declare function discoverUserSkills(): Promise<DiskSkill[]>;
/** Enumerate one workspace's project-scope disk skills (project-dsh + project-agents). */
export declare function discoverProjectSkills(cwd: string): Promise<DiskSkill[]>;
/** Find one user-scope disk skill by name, or `undefined`. */
export declare function findDiskSkill(name: string): Promise<DiskSkill | undefined>;
/** Find one workspace's project-scope disk skill by name, or `undefined`. */
export declare function findProjectDiskSkill(cwd: string, name: string): Promise<DiskSkill | undefined>;
/** Parse one skill file's text into a disk skill row, or `undefined` if invalid. */
export declare function parseDiskSkillFile(raw: string, path: string, source: SkillDefinition['source']): DiskSkill | undefined;
