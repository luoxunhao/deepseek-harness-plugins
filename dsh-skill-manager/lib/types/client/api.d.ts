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
/** A partial invocation write (omitted keys stay untouched). */
export interface InvocationPatch {
    modelInvocable?: boolean;
    userInvocable?: boolean;
}
/** One wire failure. */
export declare class SkillManagerApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/** The typed client API face exposed to the section component. */
export declare function createSkillManagerApi(): {
    /** List the full merged skill catalog. */
    list(): Promise<ManagedSkill[]>;
    /** Read one skill's instruction body. */
    getBody(name: string): Promise<string>;
    /** Write one skill's invocation policy; returns the refreshed row. */
    setInvocation(name: string, patch: InvocationPatch): Promise<ManagedSkill>;
};
export type SkillManagerApi = ReturnType<typeof createSkillManagerApi>;
