/**
 * Minimal, dependency-free frontmatter reader/writer for skill files.
 *
 * dsh's skill-filesystem provider reads the invocation policy from two
 * canonical boolean keys (skill-filesystem/src/index.ts, parseInvocationPolicy):
 *   disable-model-invocation: true   → modelInvocable false
 *   user-invocable: false            → userInvocable false
 * Both absent default to the permissive state. Editing a skill's policy is
 * therefore exactly the act of adding or removing these two scalar keys.
 * Note the model key is NEGATED relative to the user-facing boolean: writing
 * `disable-model-invocation: true` DISABLES model invocation.
 *
 * This module edits the frontmatter at the text level so nothing else in the
 * file — other metadata keys, the instruction body — is touched; the only
 * bytes that change are the two policy lines. There is deliberately no YAML
 * dependency: the value is always a YAML scalar `true`/`false`, and the
 * target keys are always top-level `key: value` lines (the schema's own
 * parser rejects non-boolean values, so this writer can never emit something
 * the reader will reject). A file without a leading `---\n...\n---` block is
 * refused (skill files always carry frontmatter: name + description are
 * required).
 *
 * Both LF (`\n`) and CRLF (`\r\n`) files are supported: the frontmatter
 * opening/closing delimiters and the interior lines are recognized with
 * either newline, and the file's own newline style is preserved on write.
 */
/** The two canonical raw frontmatter keys this plugin may write. */
export declare const INVOCATION_KEYS: readonly ["disable-model-invocation", "user-invocable"];
export type InvocationFrontmatterKey = (typeof INVOCATION_KEYS)[number];
/** A partial raw-keyed write: omit a key to leave it untouched. */
export interface FrontmatterPatch {
    'disable-model-invocation'?: boolean;
    'user-invocable'?: boolean;
}
/**
 * Set (or remove, with `value === undefined`) one raw invocation key in a
 * skill file's frontmatter. Everything except the affected key's line is
 * preserved byte-for-byte (including the file's newline style).
 * @param source - the full skill file text.
 * @param key - which raw frontmatter key to edit.
 * @param value - the boolean to write, or `undefined` to remove the key.
 * @returns the rewritten text, or `undefined` when the source has no
 *   frontmatter block (callers must not write such files).
 */
export declare function setFrontmatterKey(source: string, key: InvocationFrontmatterKey, value: boolean | undefined): string | undefined;
/**
 * Apply a partial raw-keyed patch to a skill file: set each provided key,
 * leave omitted keys untouched. Fails (returns `undefined`) only when the
 * source has no frontmatter block.
 */
export declare function applyFrontmatterPatch(source: string, patch: FrontmatterPatch): string | undefined;
/**
 * Return the instruction body that follows a skill file's frontmatter block
 * (the text after the closing `---`), or `undefined` when there is no
 * frontmatter. Callers trim as DSH does. Works on both LF and CRLF files.
 */
export declare function stripFrontmatterBody(source: string): string | undefined;
/**
 * Minimal scalar parser for a skill file's frontmatter. Skill frontmatter is
 * flat scalar YAML (`name`, `description`, `whenToUse`, `disable-model-invocation`,
 * `user-invocable`); this reads only top-level `key: value` lines and ignores
 * nested/indented content. Booleans are normalized from the YAML spellings
 * `true`/`false`/`yes`/`no`. Works on both LF and CRLF files.
 * @param source - the full skill file text.
 * @returns the parsed top-level scalar fields, or `undefined` without a block.
 */
export declare function parseFrontmatterScalars(source: string): Record<string, string | boolean> | undefined;
