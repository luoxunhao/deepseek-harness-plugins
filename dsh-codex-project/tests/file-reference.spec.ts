/**
 * File-reference chip source tests: the hidden `@` source carries the codec
 * that turns a chip's absolute path into the model-visible inline-code form,
 * and the insert helper dispatches a `slash/input-insert-reference` chip with
 * the file NAME as the display label.
 */

import { describe, expect, it } from 'vitest'

import type { ClientRuntimeContext, SidebarTabScope } from '../src/client/context.ts'
import {
  createFileReferenceSource,
  FILE_REF_SOURCE,
  insertFileReference,
} from '../src/client/file-reference.ts'

/** A source-shaped record with typed codec accessors for assertions. */
function sourceShape(): {
  trigger: string
  name: string
  codec: { clipboardText(ref: string): string; serialize(ref: string): Promise<string> }
} {
  return createFileReferenceSource() as {
    trigger: string
    name: string
    codec: { clipboardText(ref: string): string; serialize(ref: string): Promise<string> }
  }
}

describe('file-reference source', () => {
  it('registers under the @ trigger under the plugin source name', () => {
    const source = sourceShape()
    expect(source.trigger).toBe('@')
    expect(source.name).toBe(FILE_REF_SOURCE)
  })

  it('serializes the absolute path as inline code for the model context', async () => {
    const source = sourceShape()
    expect(await source.codec.serialize('E:\\proj\\readme.md')).toBe('`E:\\proj\\readme.md`')
    expect(source.codec.clipboardText('E:\\proj\\readme.md')).toBe('E:\\proj\\readme.md')
  })
})

describe('insertFileReference', () => {
  const scope: SidebarTabScope = { sessionId: 's1', cwd: 'E:\\proj' }

  it('dispatches a chip with the absolute path and the file-name label', () => {
    const chips: Array<{ reference: { source: string; ref: string; label: string }; span: unknown }> = []
    const ctx: ClientRuntimeContext = {
      get: () => ({ input: { for: () => ({ state: { getSnapshot: () => ({ draft: '', draftRev: 3 }) } }) } }),
      sessions: { scope: () => ({ emit: (_event: string, payload: unknown) => { chips.push(payload as never) } }) },
    }
    insertFileReference(ctx, scope, 'E:\\proj\\readme.md')
    expect(chips).toHaveLength(1)
    expect(chips[0]!.reference.source).toBe(FILE_REF_SOURCE)
    expect(chips[0]!.reference.ref).toBe('E:\\proj\\readme.md')
    expect(chips[0]!.reference.label).toBe('readme.md')
    expect(chips[0]!.span).toEqual({ start: 0, end: 0, draftRev: 3 })
  })

  it('no-ops when the conversation service is missing', () => {
    let emitted = false
    const ctx: ClientRuntimeContext = {
      get: () => undefined,
      sessions: { scope: () => ({ emit: () => { emitted = true } }) },
    }
    insertFileReference(ctx, scope, 'E:\\proj\\readme.md')
    expect(emitted).toBe(false)
  })
})