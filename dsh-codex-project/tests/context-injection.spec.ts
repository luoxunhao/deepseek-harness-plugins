import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  composeWorkspaceContextText,
  computeWorkspaceReminder,
  foldWorkspaceContext,
  hasIdenticalInjection,
  PLUGIN_NAME,
} from '../src/context-injection.ts'
import type { WorkspaceDirs } from '../src/dirs-config.ts'

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
const configPath = join(dir, 'dirs.json')

const record = (path: string, dirs: string[]): WorkspaceDirs => ({ path, dirs })

function writeConfig(workspaces: Record<string, WorkspaceDirs>) {
  writeFileSync(configPath, JSON.stringify({ workspaces }), 'utf8')
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

describe('composeWorkspaceContextText', () => {
  it('renders a <system-reminder> block listing the workspace and every dir', () => {
    const text = composeWorkspaceContextText('w1', record(rootA, [rootB]), rootA)
    expect(text.startsWith('<system-reminder>')).toBe(true)
    expect(text.endsWith('</system-reminder>')).toBe(true)
    expect(text).toContain('Workspace sharing')
    expect(text).toContain('associated with these directories')
    expect(text).toContain(`${rootA} (current session workspace)`)
    expect(text).toContain(`- ${rootB}`)
  })

  it('marks the current workspace by canonical comparison, not configured spelling', () => {
    // The configured path is spelled in the wrong case; the canonical workspace
    // still wins the marker (Windows lookups are case-insensitive).
    const text = composeWorkspaceContextText('w1', record(rootA.toLowerCase(), [rootB]), rootA)
    expect(text).toContain(`- ${rootA.toLowerCase()} (current session workspace)`)
    expect(text).not.toContain(`- ${rootB.toLowerCase()} (current session workspace)`)
  })

  it('silently skips vanished dirs without a missing marker', () => {
    const vanished = join(dir, 'vanished')
    const text = composeWorkspaceContextText('w1', record(rootA, [vanished, rootB]), rootA)
    expect(text).toContain(`- ${rootB}`)
    expect(text).not.toContain(vanished)
    expect(text).not.toContain('missing')
  })

  it('never claims permissions: the model discovers the boundary by trying', () => {
    const text = composeWorkspaceContextText('w1', record(rootA, [rootB]), rootA)
    expect(text).not.toContain('permission')
    expect(text).not.toContain('writable')
    expect(text).not.toContain('read/write')
    expect(text).not.toContain('读写权限')
    expect(text).not.toContain('可读写')
    expect(text).not.toContain('权限')
    expect(text).not.toContain('共享工作区')
  })

  it('never embeds file contents (AGENTS.md summaries are out of scope)', () => {
    const text = composeWorkspaceContextText('w1', record(rootA, [rootB]), rootA)
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

describe('computeWorkspaceReminder', () => {
  it('builds a user-role plugin message listing the record roots', () => {
    writeConfig({ w1: record(rootA, [rootB]) })
    const reminder = computeWorkspaceReminder(rootA)
    expect(reminder).toBeDefined()
    expect(reminder!.role).toBe('user')
    expect(reminder!.source).toEqual({ kind: 'plugin', plugin: PLUGIN_NAME })
    const text = (reminder!.content[0] as { type: 'text'; text: string } | undefined)?.text
    expect(text).toContain(rootA)
    expect(text).toContain(rootB)
  })

  it('returns undefined for a record without additional dirs', () => {
    writeConfig({ w1: record(rootA, []) })
    expect(computeWorkspaceReminder(rootA)).toBeUndefined()
  })

  it('returns undefined for a workspace outside every record', () => {
    writeConfig({ w1: record(rootA, [rootB]) })
    expect(computeWorkspaceReminder(elsewhere)).toBeUndefined()
  })

  it('returns undefined when no records are configured', () => {
    writeConfig({})
    expect(computeWorkspaceReminder(rootA)).toBeUndefined()
  })

  it('returns undefined without a session cwd', () => {
    writeConfig({ w1: record(rootA, [rootB]) })
    expect(computeWorkspaceReminder(undefined)).toBeUndefined()
  })
})

describe('foldWorkspaceContext', () => {
  it('folds the reminder right after the claimed user message', () => {
    writeConfig({ w1: record(rootA, [rootB]) })
    const user = message('hello')
    const folded = foldWorkspaceContext(enter(user), [user], fakeSession(rootA))
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
    writeConfig({ w1: record(rootA, [rootB]) })
    const first = message('first')
    const second = message('second')
    const folded = foldWorkspaceContext(enter(first, second), [first, second], fakeSession(rootA))
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages.map(item => item.content)).toEqual([
      first.content,
      second.content,
      expect.anything(),
    ])
  })

  it('keeps driver-appended runtime context after the reminder', () => {
    writeConfig({ w1: record(rootA, [rootB]) })
    const user = message('hello')
    const runtime = message('runtime-context')
    const folded = foldWorkspaceContext(enter(user, runtime), [user], fakeSession(rootA))
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages[0]).toBe(user)
    expect((folded.messages[1]!.content[0] as { type: 'text'; text: string }).text).toContain('<system-reminder>')
    expect(folded.messages[2]).toBe(runtime)
  })

  it('does not fold a rejected step', () => {
    writeConfig({ w1: record(rootA, [rootB]) })
    const user = message('hello')
    const decision = { kind: 'reject' as const }
    expect(foldWorkspaceContext(decision, [user], fakeSession(rootA))).toBe(decision)
  })

  it('does not fold a step that claimed no user messages', () => {
    writeConfig({ w1: record(rootA, [rootB]) })
    const folded = foldWorkspaceContext(enter(), [], fakeSession(rootA))
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(0)
  })

  it('seeds the reminder despite prior identical-injection short-circuit happening per text', () => {
    // Fold is text-idempotent: identical text already on the surface short-circuits.
    writeConfig({ w1: record(rootA, [rootB]) })
    const user = message('hello')
    const text = composeWorkspaceContextText('w1', record(rootA, [rootB]), rootA)
    const resumed = fakeSession(rootA, [0], [userMessageEvent(text)])
    const folded = foldWorkspaceContext(enter(user), [user], resumed)
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(1)
  })

  it('re-injects when the directory list changed since the last injection', () => {
    // The surface carries the OLD text (before rootB was added), so the new
    // text differs and folds again — this powers refresh-on-change.
    const oldText = composeWorkspaceContextText('w1', record(rootA, []), rootA)
    // Now the config has rootB too; the freshly computed text differs.
    writeConfig({ w1: record(rootA, [rootB]) })
    const user = message('hello')
    const session = fakeSession(rootA, [0], [userMessageEvent(oldText)])
    const folded = foldWorkspaceContext(enter(user), [user], session)
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(2)
    const text = (folded.messages[1]!.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain(rootB)
  })

  it('does not fold for a record without dirs (only multiple-dir records apply)', () => {
    writeConfig({ w1: record(rootA, []) })
    const user = message('hello')
    const folded = foldWorkspaceContext(enter(user), [user], fakeSession(rootA))
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(1)
  })

  it('does not fold without a session cwd', () => {
    writeConfig({ w1: record(rootA, [rootB]) })
    const user = message('hello')
    const folded = foldWorkspaceContext(enter(user), [user], fakeSession(undefined))
    expect(folded.kind).toBe('enter')
    if (folded.kind !== 'enter') return
    expect(folded.messages).toHaveLength(1)
  })
})
