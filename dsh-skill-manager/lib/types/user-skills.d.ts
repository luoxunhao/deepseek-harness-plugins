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
/** Parse one skill file's text into a disk skill row, or `undefined` if invalid. */
export declare function parseDiskSkillFile(raw: string, path: string, source: SkillDefinition['source']): DiskSkill | undefined;
/** Enumerate user-scope disk skills across every configured user root. */
export declare function discoverUserSkills(): Promise<DiskSkill[]>;
/** Find one user-scope disk skill by name, or `undefined`. */
export declare function findDiskSkill(name: string): Promise<DiskSkill | undefined>;
