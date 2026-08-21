/**
 * Typed fetch wrapper over the /skill-manager JSON API. All calls are same
 * origin (the web shell and the host routes share the dsh web server); the
 * host's loopback fence guards them. Failures surface as
 * {@link SkillManagerApiError} with the HTTP status and the host's wire text.
 */
/** One catalog row (mirrors the host ManagedSkill shape). */
export interface ManagedSkill {
    name: string;
    description: string;
    whenToUse?: string;
    source: string;
    provider: string;
    modelInvocable: boolean;
    userInvocable: boolean;
    toggleable: boolean;
    path?: string;
}
/** A single master enable flag driving BOTH model and user invocation. */
export interface InvocationPatch {
    enabled: boolean;
}
/** A workspace entry (id/path/title) for the project-level workspace dropdown. */
export interface Workspace {
    id: string;
    path: string;
    title: string;
}
/** One wire failure. */
export declare class SkillManagerApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/** A skill scope: user-level, or one workspace's project-level (by cwd). */
export type SkillScope = 'user' | 'project';
/** The typed client API face exposed to the section component. */
export declare function createSkillManagerApi(): {
    /** List the skill catalog for a scope (user, or one workspace's project skills). */
    list(scope: SkillScope, cwd?: string): Promise<ManagedSkill[]>;
    /** List the host's registered workspaces for the project-level dropdown. */
    listWorkspaces(): Promise<Workspace[]>;
    /** Read one skill's instruction body for a scope. */
    getBody(name: string, scope?: SkillScope, cwd?: string): Promise<string>;
    /** Enable/disable a skill's invocation for a scope (sets model AND user together). */
    setInvocation(name: string, patch: InvocationPatch, scope?: SkillScope, cwd?: string): Promise<ManagedSkill>;
    /** Import a skill from a zip binary. Returns the imported skill's name and path. */
    importZip(zipBuf: ArrayBuffer, scope?: SkillScope, cwd?: string, overwrite?: boolean): Promise<{
        name: string;
        path: string;
    }>;
};
export type SkillManagerApi = ReturnType<typeof createSkillManagerApi>;
