/**
 * Session context reminder: make the model aware of the shared-directory
 * record it works under — once per session, folded into the step that claims
 * the session's first user message, right AFTER the claimed batch. That is
 * the canonical dsh "system reminder after the first user message" placement
 * (`agent/pre-step` decision rewriting, the same mechanism
 * `@deepseek-ai/dsh-agent-instructions` and `@deepseek-ai/dsh-tool-skill`
 * use), so the reminder reaches the model in the SAME request as the first
 * user message instead of a later standalone step.
 *
 * The reminder carries one short `<system-reminder>` block listing the
 * record's directories — the main workspace root plus the shared
 * subdirectories — and nothing else. The copy deliberately makes no
 * permission claim: the model discovers the actual read/write boundary by
 * trying. AGENTS.md summaries are NOT injected: file content is the model's
 * own tool work, and full-file context would pollute every session for
 * projects the model may never touch.
 *
 * Dedup: a session whose surface already carries an identical plugin message
 * (a resumed session) is not seeded again; the one-shot per-session marker
 * stops re-folding within one session. Restarts therefore never accumulate
 * copies, and a session that resumed with an older (non-identical) reminder
 * gets the current text folded after its next user message.
 * @module dsh-codex-project/context-injection
 */

import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

import { canonicalRoots, loadSpaces, matchingMultiRootSpace, requireCanonicalDirectory } from './space-config.ts'
import type { SpaceRecord } from './space-config.ts'

/** The plugin's identity in injected message sources. */
export const PLUGIN_NAME = 'dsh-codex-project'

/** The dsh `<system-reminder>` framing convention (agent-instructions, tool-skill). */
const REMINDER_OPEN = '<system-reminder>'
const REMINDER_CLOSE = '</system-reminder>'

/**
 * The minimal session surface the fold reads: header cwd, surface
 * sequences, and the event log. Structural on purpose — the real `Session`
 * satisfies it, and tests can build fixtures without a full Session.
 */
export interface InjectionSession {
  readonly header: { readonly cwd?: string }
  readonly surface: { readonly nodes: readonly number[] }
  readonly events: readonly SessionEvent[]
}

/** The one-shot fold marker: any object-keyed set works (a `WeakSet` in production). */
export interface FoldedSessions {
  has(target: object): boolean
  add(target: object): void
}

/**
 * The model-facing `<system-reminder>` text describing one subspace: the
 * current workspace plus every root of the subspace (the host workspace root
 * first, then the extra roots), with the current one marked. Roots are shown
 * in their configured form; the current-workspace marker compares canonical
 * forms, so casing or separator differences cannot hide the current
 * workspace. The directory list only: no permission claim, no file contents.
 * English copy on purpose — the reminder is model-facing prompt text.
 * @param space - the owning multi-root shared-workspace record.
 * @param canonicalWorkspace - the canonical session workspace.
 * @returns the reminder text, one `<system-reminder>` block.
 */
export function composeSpaceContextText(space: SpaceRecord, canonicalWorkspace: string): string {
  const canonical = canonicalRoots(space)
  const currentIndex = canonical.indexOf(canonicalWorkspace)
  const currentRoot = currentIndex >= 0 ? space.roots[currentIndex] : canonicalWorkspace
  const lines = space.roots.map((root, index) => (
    index === currentIndex ? `- ${root} (current session workspace)` : `- ${root}`
  ))
  return [
    REMINDER_OPEN,
    `[Workspace sharing] The current session workspace ${currentRoot} is associated with these directories:`,
    ...lines,
    REMINDER_CLOSE,
  ].join('\n')
}

/**
 * Whether the session surface already carries an identical injection from
 * this plugin. Compares the model-facing content and the plugin source tag;
 * a resumed session keeps its earlier reminder instead of stacking a new one.
 * @param session - the live session.
 * @param message - the message about to be folded in.
 * @returns true when an equivalent message is already on the surface.
 */
export function hasIdenticalInjection(session: InjectionSession, message: UserMessage): boolean {
  for (const seq of session.surface.nodes) {
    const event = session.events[seq]
    if (event?.type !== 'user/message') continue
    const source = event.data.source
    if (source?.kind !== 'plugin' || source.plugin !== PLUGIN_NAME) continue
    if (JSON.stringify(event.data.content) === JSON.stringify(message.content)) return true
  }
  return false
}

/**
 * Build the space reminder for a session cwd, or `undefined` when the
 * workspace is outside every multi-root shared record.
 * @param cwd - the session's working directory.
 * @returns the reminder user message, or undefined when nothing applies.
 */
export function computeSpaceReminder(cwd: string | undefined): UserMessage | undefined {
  if (cwd === undefined) return undefined
  const canonicalWorkspace = requireCanonicalDirectory('session workspace', cwd)
  const space = matchingMultiRootSpace(loadSpaces(), canonicalWorkspace)
  if (space === undefined) return undefined
  return createUserMessage({
    content: [{ type: 'text', text: composeSpaceContextText(space, canonicalWorkspace) }],
    source: { kind: 'plugin', plugin: PLUGIN_NAME },
  })
}

/**
 * Fold the space reminder into a proposed step, right after the claimed
 * batch. No-op when the step is rejected, claims no user messages (a wake or
 * tool continuation without a direct message), the session was already
 * seeded, no multi-root space matches, or an identical reminder already sits
 * on the surface. The reminder enters BEFORE any driver-appended runtime
 * context, so the direct prompt and the reminder precede machine-owned
 * context — the same ordering agent-instructions uses.
 * @param decision - the pre-step decision produced so far.
 * @param claimed - the messages this step claimed from the inbox.
 * @param session - the live session (dedup + reminder derivation).
 * @param foldedSessions - per-session one-shot marker set.
 * @returns the (possibly rewritten) decision.
 */
export function foldSpaceContext(
  decision: PreStepDecision,
  claimed: readonly UserMessage[],
  session: InjectionSession,
  foldedSessions: FoldedSessions,
): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  if (claimed.length === 0) return decision
  if (foldedSessions.has(session)) return decision
  const reminder = computeSpaceReminder(session.header.cwd)
  if (reminder === undefined) return decision
  if (hasIdenticalInjection(session, reminder)) return decision
  foldedSessions.add(session)
  const lastClaimedIndex = decision.messages.findLastIndex(message => claimed.includes(message))
  const insertAt = lastClaimedIndex >= 0 ? lastClaimedIndex + 1 : decision.messages.length
  return { kind: 'enter', messages: decision.messages.toSpliced(insertAt, 0, reminder) }
}
