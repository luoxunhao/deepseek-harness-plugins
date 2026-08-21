import { Buffer } from 'node:buffer';
export interface SkillPackageEntry {
    readonly name: string;
    readonly size: number;
}
export interface SkillPackageValidationOk {
    readonly ok: true;
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly entries: readonly SkillPackageEntry[];
}
export interface SkillPackageValidationFail {
    readonly ok: false;
    readonly errors: readonly string[];
}
export type SkillPackageValidationResult = SkillPackageValidationOk | SkillPackageValidationFail;
export interface SkillPackageImportOk {
    readonly ok: true;
    readonly name: string;
    readonly path: string;
}
export interface SkillPackageImportFail {
    readonly ok: false;
    readonly errors: readonly string[];
}
export type SkillPackageImportResult = SkillPackageImportOk | SkillPackageImportFail;
/** Validate a zip buffer as a skill package. */
export declare function validateSkillPackage(zipBuf: Buffer): Promise<SkillPackageValidationResult>;
/** Import a validated skill package into a target root directory. */
export declare function importSkillPackage(zipBuf: Buffer, targetRoot: string, overwrite?: boolean): Promise<SkillPackageImportResult>;
