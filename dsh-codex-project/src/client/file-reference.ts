/**
 * File-reference chips for the 项目文件夹 tab. Referencing a file no longer
 * drops plain text into the composer — it injects a proper reference chip via
 * the conversation input's scoped `slash/input-insert-reference` event. The
 * chip shows the FILE NAME (`label`) in the composer, and on submit the
 * registered source's codec serializes the ABSOLUTE path (inline-code form, the
 * harness's recognized file-tool path) into the model context — so the model
 * sees the real file, not a chat-box string.
 *
 * The source is registered (hidden) into `ctx.inputTriggers` so its codec is
 * resolvable by name; its candidate group is empty (renders nothing in the
 * @-menu). All types are restated structurally — the client bundle's purity
 * gate forbids value-importing the input-trigger package.
 * @module dsh-codex-project/client/file-reference
 */

import type {
  ClientRuntimeContext,
  DraftInput,
  FileReferenceInsert,
  FileReferenceSpan,
  SidebarTabScope,
} from './context.ts'
import { basename } from './paths.ts'

/** The registered source name; the chip's `source` routes here for serialization. */
export const FILE_REF_SOURCE = 'codex-project:file'

/** The conversation input event the composer hub listens for on a session scope. */
const INSERT_REFERENCE_EVENT = 'slash/input-insert-reference'

/**
 * The hidden `@` file source: contributes no menu candidates (empty group
 * renders nothing), exists only so the chip's codec is resolvable by name.
 */
export function createFileReferenceSource(): unknown {
  return {
    trigger: '@',
    name: FILE_REF_SOURCE,
    order: 999,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      // The copy / persistence projection of one chip.
      clipboardText: (ref: string) => ref,
      // The model-visible form: the absolute path as inline code (the harness's
      // recognized file-tool path), so it lands in context as a file reference.
      serialize: (ref: string) => Promise.resolve(`\`${ref}\``),
    },
  }
}

/**
 * Inject one file-reference chip into the session composer draft. The chip is
 * appended at the current draft end; its label is the file name and its
 * absolute path travels as `ref`. Degrades to a logged no-op when the
 * conversation service, session scope, or input shell is unavailable.
 */
export function insertFileReference(
  ctx: ClientRuntimeContext,
  scope: SidebarTabScope,
  path: string,
): void {
  try {
    const actx = ctx.sessions?.scope(scope.sessionId)
    if (actx === undefined) return
    const conversation = ctx.get?.('conversation') as DraftInput | undefined
    if (conversation === undefined) return
    const input = conversation.input?.for(actx)
    if (input === undefined) return
    const state = input.state.getSnapshot()
    const span: FileReferenceSpan = {
      start: state.draft.length,
      end: state.draft.length,
      draftRev: state.draftRev,
    }
    const reference: FileReferenceInsert = {
      source: FILE_REF_SOURCE,
      ref: path,
      label: basename(path),
      clipboardText: path,
    }
    const sessionCtx = actx as { emit(event: string, payload: unknown): unknown }
    sessionCtx.emit(INSERT_REFERENCE_EVENT, { reference, span })
  } catch (error) {
    console.warn('[dsh-codex-project] file reference insert failed:', error)
  }
}