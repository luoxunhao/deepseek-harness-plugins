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
export const INVOCATION_KEYS = ['disable-model-invocation', 'user-invocable'] as const

export type InvocationFrontmatterKey = (typeof INVOCATION_KEYS)[number]

/** A partial raw-keyed write: omit a key to leave it untouched. */
export interface FrontmatterPatch {
  'disable-model-invocation'?: boolean
  'user-invocable'?: boolean
}

/** Split a skill file into its frontmatter head, interior lines, and tail. */
function frontmatterSlices(source: string): { head: string; lines: string[]; tail: string; eol: string } | undefined {
  const open = /^---(\r?\n)/.exec(source)
  if (open === null) return undefined
  const eol = open[1]!
  const head = open[0]
  const closing = source.indexOf(`${eol}---`, head.length)
  if (closing === -1) return undefined
  const inner = source.slice(head.length, closing)
  const tail = source.slice(closing)
  return { head, lines: inner.length === 0 ? [] : inner.split(eol), tail, eol }
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
export function setFrontmatterKey(
  source: string,
  key: InvocationFrontmatterKey,
  value: boolean | undefined,
): string | undefined {
  const block = frontmatterSlices(source)
  if (block === undefined) return undefined
  const { head, tail, eol } = block
  const pattern = new RegExp(`^${escapeRegex(key)}\\s*:.*$`)
  const index = block.lines.findIndex((line) => pattern.test(line))
  let lines = block.lines
  if (value === undefined) {
    if (index !== -1) lines = lines.filter((_, i) => i !== index)
  } else if (index !== -1) {
    lines = lines.map((line, i) => (i === index ? `${key}: ${value}` : line))
  } else {
    lines = [...lines, `${key}: ${value}`]
  }
  return head + lines.join(eol) + tail
}

/**
 * Apply a partial raw-keyed patch to a skill file: set each provided key,
 * leave omitted keys untouched. Fails (returns `undefined`) only when the
 * source has no frontmatter block.
 */
export function applyFrontmatterPatch(
  source: string,
  patch: FrontmatterPatch,
): string | undefined {
  let next = source
  for (const entry of Object.entries(patch) as [InvocationFrontmatterKey, boolean | undefined][]) {
    const [key, value] = entry
    const out = setFrontmatterKey(next, key, value)
    if (out === undefined) return undefined
    next = out
  }
  return next
}

/**
 * Return the instruction body that follows a skill file's frontmatter block
 * (the text after the closing `---`), or `undefined` when there is no
 * frontmatter. Callers trim as DSH does. Works on both LF and CRLF files.
 */
export function stripFrontmatterBody(source: string): string | undefined {
  const block = frontmatterSlices(source)
  if (block === undefined) return undefined
  // block.tail begins with `${eol}---`; drop that marker, keep the rest.
  return block.tail.slice(block.eol.length + '---'.length)
}

/**
 * Minimal scalar parser for a skill file's frontmatter. Skill frontmatter is
 * flat scalar YAML (`name`, `description`, `whenToUse`, `disable-model-invocation`,
 * `user-invocable`); this reads only top-level `key: value` lines and ignores
 * nested/indented content. Booleans are normalized from the YAML spellings
 * `true`/`false`/`yes`/`no`. Works on both LF and CRLF files.
 * @param source - the full skill file text.
 * @returns the parsed top-level scalar fields, or `undefined` without a block.
 */
export function parseFrontmatterScalars(source: string): Record<string, string | boolean> | undefined {
  const block = frontmatterSlices(source)
  if (block === undefined) return undefined
  const out: Record<string, string | boolean> = {}
  for (const line of block.lines) {
    if (line.length === 0 || line.startsWith(' ') || line.startsWith('\t')) continue
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1]!
    const raw = match[2]!.trim()
    if (/^(true|yes)$/i.test(raw)) out[key] = true
    else if (/^(false|no)$/i.test(raw)) out[key] = false
    else if (raw.length > 0) out[key] = raw
    else out[key] = ''
  }
  return out
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}