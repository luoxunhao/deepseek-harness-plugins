import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  composeSpaceContextText,
  computeSpaceReminder,
  foldSpaceContext,
  hasIdenticalInjection,
  PLUGIN_NAME,
  type FoldedSessions,
} from '../src/context-injection.ts'
import type { SpaceRecord } from '../src/space-config.ts'

/** A minimal fake session surface: header cwd + event log. */
function fakeSession(cwd: string | undefined, surfaceNodes: number[] = [], events: SessionEvent[] = []) {
  return {
    header: { cwd },
    surface: { nodes: surfaceNodes },
    events,
  }
}

/** A fake session event shaped like a 'user/message' surface event. */
function userMessageEvent(contentText: string, plugin = PLUGIN_NAME): SessionEvent {
  return {
    type: 'user/message',
    data: { content: [{ type: 'text', text: contentText }], source: { kind: 'plugin', plugin } },
  } as unknown as SessionEvent
}

/** A bare user message shaped like `createUserMessage` output. */
function message(text: string): UserMessage {
  return {
    id: `m-${text.length}-${Math.random()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN_NAME },
  } as unknown as UserMessage
}

/** An enter decision carrying the given messages. */
function enter(...messages: UserMessage[]) {
  return { kind: 'enter' as const, messages: [...messages] }
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-codex-project-test-'))
const rootA = join(dir, 'root-a')
const rootB = join(dir, 'root-b')
const elsewhere = join(dir, 'elsewhere')
const configPath = join(dir, 'spaces.json')

const space = (roots: string[], title = '测试空间'): SpaceRecord => ({ id: 'space-1', title, roots })

function writeConfig(spaces: SpaceRecord[]) {
  writeFileSync(configPath, JSON.stringify({ spaces }), 'utf8')
}

beforeEach(() => {
  mkdirSync(rootA, { recursive: true })
  mkdirSync(rootB, { recursive: true })
  mkdirSync(elsewhere, { recursive: true })
  process.env.DSH_CODEX_PROJECT_CONFIG = configPath
})

afterEach(() => {
  delete process.env.DSH_CODEX_PROJECT_CONFIG
})

describe('composeSpaceContextText', () => {
  it('renders a <system-reminder> block listing every associated directory, current one marked', () => {
    const text = composeSpaceContextText(space([rootA, rootB], '我的空间'), rootA)
    expect(text.startsWith('<system-reminder>')).toBe(true)
    expect(text.endsWith('</system-reminder>')).toBe(true)
    expect(text).toContain('Workspace sharing')
    expect(text).toContain('associated with these directories')
    expect(text).toContain(`${rootA} (current session workspace)`)
    expect(text).toContain(`- ${rootB}`)
  })

  it('marks the current workspace by canonical comparison, not configured spelling', () => {
    // The configured root is spelled in the wrong case; the canonical workspace
    // still wins the marker (Windows lookups are case-insensitive).
    const text = composeSpaceContextText(space([rootA.toLowerCase(), rootB]), rootA)
    expect(text).toContain(`${rootA.toLowerCase()} (current session workspace)`)
    expect(text).not.toContain(`${rootB} (current session workspace)`)
  })

  it('never claims permissions: the model discovers the boundary by trying', () => {
    const text = composeSpaceContextText(space([rootA, rootB]), rootA)
    expect(text).not.toContain('permission')
    expect(text).not.toContain('writable')
    expect(text).not.toContain('read/write')
    expect(text).not.toContain('读写权限')
    expect(text).not.toContain('可读写')
    expect(text).not.toContain('权限')
    expect(text).not.toContain('共享工作区')
  })

  it('never embeds file contents (AGENTS.md summaries are out of scope)', () => {
    const text = composeSpaceContextText(space([rootA, rootB]), rootA)
    expect(text).not.toContain('AGENTS')
    expect(text).not.toMatch(/```/)
  })
})

describe('hasIdenticalInjection', () => {
  const probe = message('same')

  it('detects an identical injection already on the surface', () => {
    const session = fakeSession(rootA, [0], [userMessageEvent('same')])
    expect(hasIdenticalInjection(session, probe)).toBe(true)
  })

  it('returns false when the surface content differs', () => {
    const session = fakeSession(rootA, [0], [userMessageEvent('different')])
    expect(hasIdenticalInjection(session, probe)).toBe(false)
  })

  it('returns false when the surface message came from another plugin', () => {
    const session = fakeSession(rootA, [0], [userMessageEvent('same', 'other-plugin')])
    expect(hasIdenticalInjection(session, probe)).toBe(false)
  })

  it('returns false on an empty surface', () => {
    expect(hasIdenticalInjection(fakeSession(rootA), probe)).toBe(false)
  })
})

describe('computeSpaceReminder', () => {
  it('builds a user-role plugin message listing the record roots', () => {
    writeConfig([space([rootA, rootB])])
    const reminder = computeSpaceReminder(rootA)
    expect(reminder).toBeDefined()
    expect(reminder!.role).toBe('user')
    expect(reminder!.source).toEqual({ kind: 'plugin', plugin: PLUGIN_NAME })
    const text = (reminder!.content[0] as { type: 'text'; text: string } | undefined)?.text
    expect(text).toContain(rootA)
    expect(text).toContain(rootB)
  })

  it('returns undefined for a single-root space', () => {
    writeConfig([space([rootA])])
    expect(computeSpaceReminder(rootA)).toBeUndefined()
  })

  it('returns undefined for a workspace outside every space', () => {
    writeConfig([space([rootA, rootB])])
    expect(computeSpaceReminder(elsewhere)).toBeUndefined()
  })

  it('returns undefined when no spaces are configured', () => {
    writeConfig([])
    expect(computeSpaceReminder(rootA)).toBeUndefined()
  })

  it('returns undefined without a session cwd', () => {
    writeConfig([space([rootA, rootB])])
    expect(computeSpaceReminder(undefined)).toBeUndefined()
  })
})

describe('foldSpaceContext', () => {
  const folders = (): FoldedSessions => {
    const seen = new Set<object>()
    return { has: target => seen.has(target), add: target => { seen.add(target) } }
  }

  it('folds the reminder right after the claimed user message', () => {
    writeConfig([space([rootA, rootB])])
    const user = message('hello')
    const folded = foldSpaceContext(enter(user), [user], fakeSession(rootA), folders())
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(2)
    expect(folded.messages[0]).toBe(user)
    const text = (folded.messages[1]!.content[0] as { type: 'text'; text: string }).text
    expect(text.startsWith('<system-reminder>')).toBe(true)
    expect(text).toContain(rootA)
    expect(text).toContain(rootB)
  })

  it('folds after the whole claimed batch when several messages were claimed', () => {
    writeConfig([space([rootA, rootB])])
    const first = message('first')
    const second = message('second')
    const folded = foldSpaceContext(enter(first, second), [first, second], fakeSession(rootA), folders())
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages.map(item => item.content)).toEqual([
      first.content,
      second.content,
      expect.anything(),
    ])
  })

  it('keeps driver-appended runtime context after the reminder', () => {
    writeConfig([space([rootA, rootB])])
    const user = message('hello')
    const runtime = message('runtime-context')
    const folded = foldSpaceContext(enter(user, runtime), [user], fakeSession(rootA), folders())
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    // Order: claimed batch, reminder, then the runtime context.
    expect(folded.messages[0]).toBe(user)
    expect((folded.messages[1]!.content[0] as { type: 'text'; text: string }).text).toContain('<system-reminder>')
    expect(folded.messages[2]).toBe(runtime)
  })

  it('does not fold a rejected step', () => {
    writeConfig([space([rootA, rootB])])
    const user = message('hello')
    const decision = { kind: 'reject' as const }
    expect(foldSpaceContext(decision, [user], fakeSession(rootA), folders())).toBe(decision)
  })

  it('does not fold a step that claimed no user messages', () => {
    writeConfig([space([rootA, rootB])])
    const folded = foldSpaceContext(enter(), [], fakeSession(rootA), folders())
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(0)
  })

  it('seeds each session at most once', () => {
    writeConfig([space([rootA, rootB])])
    const session = fakeSession(rootA)
    const foldedSessions = folders()
    const user = message('hello')
    const first = foldSpaceContext(enter(user), [user], session, foldedSessions)
    expect(first.kind).toBe('enter')
    const second = foldSpaceContext(enter(user), [user], session, foldedSessions)
    expect(second.kind).toBe('enter')
    if (first.kind !== 'enter' || second.kind !== 'enter') return
    expect(first.messages).toHaveLength(2)
    expect(second.messages).toHaveLength(1)
  })

  it('does not fold a second copy when an identical reminder is already on the surface', () => {
    writeConfig([space([rootA, rootB])])
    const user = message('hello')
    const text = composeSpaceContextText(space([rootA, rootB]), rootA)
    const resumed = fakeSession(rootA, [0], [userMessageEvent(text)])
    const folded = foldSpaceContext(enter(user), [user], resumed, folders())
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(1)
  })

  it('does not fold for a single-root space (only multi-root records apply)', () => {
    writeConfig([space([rootA])])
    const user = message('hello')
    const folded = foldSpaceContext(enter(user), [user], fakeSession(rootA), folders())
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(1)
  })

  it('does not fold without a session cwd', () => {
    writeConfig([space([rootA, rootB])])
    const user = message('hello')
    const folded = foldSpaceContext(enter(user), [user], fakeSession(undefined), folders())
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(1)
  })
})
