/**
 * Session context reminder: make the model aware of the additional
 * writable-dir record it works under. Folded into the step that claims the
 * session's first user message and again whenever the record changes — the
 * injection is TEXT-IDEMPOTENT instead of one-shot: each pre-step computes
 * the current reminder and compares it with the plugin reminder already on
 * the surface; only a different text is injected. This gives refreshes on
 * directory-set changes (add-dir or the manage dialog) for free, because a
 * changed set changes the text, with no explicit change events.
 *
 * The reminder carries one short `<system-reminder>` block listing the
 * workspace's main path plus its additional writable directories — and
 * nothing else. The copy deliberately makes no permission claim (a
 * directory added by the USER is framing, not an entitlement assertion);
 * plus a vanished dir is skipped silently. AGENTS.md summaries are NOT
 * injected: file content is the model's own tool work.
 *
 * Dedup: `hasIdenticalInjection` compares the full message content — a
 * resumed session whose surface already carries an identical plugin
 * message is not re-seeded; one carrying a stale (different) list gets the
 * current text folded after its next user message.
 * @module dsh-codex-project/context-injection
 */

import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

import { loadWorkspaceDirs, matchingWorkspace, requireCanonicalDirectory, tryCanonicalDirectory } from './dirs-config.ts'
import type { WorkspaceDirs } from './dirs-config.ts'

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

/**
 * The model-facing `<system-reminder>` text describing one workspace's
 * writable set: the main workspace path plus every additional dir. Roots are
 * shown in their configured (canonical-ish) spelling; the current-workspace
 * marker compares canonical forms. Directory list only: no permission
 * claim, no file contents, missing dirs silently skipped.
 * English copy on purpose — the reminder is model-facing prompt text.
 * @param workspaceId - the owning workspace.
 * @param record - the workspace's persisted record.
 * @param canonicalWorkspace - the canonical session workspace.
 * @returns the reminder text, one `<system-reminder>` block.
 */
export function composeWorkspaceContextText(
  workspaceId: string,
  record: WorkspaceDirs,
  canonicalWorkspace: string,
): string {
  const lines = [
    `- ${record.path}${tryCanonicalDirectory(record.path) === canonicalWorkspace ? ' (current session workspace)' : ''}`,
  ]
  for (const dir of record.dirs) if (tryCanonicalDirectory(dir) !== undefined) lines.push(`- ${dir}`)
  return [
    REMINDER_OPEN,
    `[Workspace sharing] The current session workspace (${workspaceId}) is associated with these directories:`,
    ...lines,
    REMINDER_CLOSE,
  ].join('\n')
}

/**
 * Whether the session surface already carries an identical injection from
 * this plugin. Compares the model-facing content and the plugin source tag;
 * a resumed session keeps its earlier reminder instead of stacking a new one
 * when nothing changed.
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
 * Build the reminder for a session cwd, or `undefined` when the workspace is
 * outside every record / has no surviving additional dir.
 * @param cwd - the session's working directory.
 * @returns the reminder user message, or undefined when nothing applies.
 */
export function computeWorkspaceReminder(cwd: string | undefined): UserMessage | undefined {
  if (cwd === undefined) return undefined
  const canonicalWorkspace = requireCanonicalDirectory('session workspace', cwd)
  const match = matchingWorkspace(loadWorkspaceDirs(), canonicalWorkspace)
  if (match === undefined || match.roots.length <= 1) return undefined
  const records = loadWorkspaceDirs()
  const record = records[match.workspaceId]
  if (record === undefined) return undefined
  return createUserMessage({
    content: [{ type: 'text', text: composeWorkspaceContextText(match.workspaceId, record, canonicalWorkspace) }],
    source: { kind: 'plugin', plugin: PLUGIN_NAME },
  })
}

/**
 * Fold the reminder into a proposed step, right after the claimed batch, but
 * only when the current text differs from what is already on the surface —
 * the text-idempotent contract that also refreshes after a directory-set
 * change. No-op when the step is rejected, claims no user messages, no
 * record matches, or an identical reminder already sits on the surface.
 * @param decision - the pre-step decision produced so far.
 * @param claimed - the messages this step claimed from the inbox.
 * @param session - the live session (dedup).
 * @returns the (possibly rewritten) decision.
 */
export function foldWorkspaceContext(
  decision: PreStepDecision,
  claimed: readonly UserMessage[],
  session: InjectionSession,
): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  if (claimed.length === 0) return decision
  const reminder = computeWorkspaceReminder(session.header.cwd)
  if (reminder === undefined) return decision
  if (hasIdenticalInjection(session, reminder)) return decision
  const lastClaimedIndex = decision.messages.findLastIndex(message => claimed.includes(message))
  const insertAt = lastClaimedIndex >= 0 ? lastClaimedIndex + 1 : decision.messages.length
  return { kind: 'enter', messages: decision.messages.toSpliced(insertAt, 0, reminder) }
}
