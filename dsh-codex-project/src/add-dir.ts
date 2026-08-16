/**
 * The `add-dir` model tool: the Claude Code `/add-dir` equivalent inside
 * dsh. The model requests a directory; the user confirms through the dsh
 * approval seam (`ctx.approval.request` — the dialog and audit are core
 * capabilities, the plugin only asks); on `'allowed-once'` the directory is
 * added to the ADDITIONAL writable dirs of the calling session's workspace
 * and persisted. It is a root addition only — no file reads, no command
 * execution; everything beyond the write is the model's own work.
 *
 * @module dsh-codex-project/add-dir
 */

import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

import { DirsStoreError } from './dirs-store.ts'
import type { DirsStore } from './dirs-store.ts'

/** Structural mirror of the plugin deps the tool needs (wired in index.ts). */
export interface AddDirToolDeps {
  /** Resolve the owning workspace id of a session cwd. */
  resolveWorkspaceId(cwd: string): string | undefined
  /** Ask the user to confirm via the dsh approval seam. */
  requestApproval(agent: Agent, path: string, signal: AbortSignal): Promise<ApprovalOutcome>
  /** Persist the added directory. */
  store: DirsStore
}

/** Wire-safe result of one add-dir call. */
export interface AddDirResult {
  ok: boolean
  /** The updated additional-dir list on success; absent on failure. */
  dirs?: string[]
  reason?: string
}

/**
 * Build the model-facing `add-dir` tool.
 * @param deps - resolution + approval + persistence.
 * @returns the tool definition (register with `ctx.tools`).
 */
export function defineAddDirTool(deps: AddDirToolDeps) {
  return defineTool({
    name: 'add-dir',
    description: 'Add an additional directory to the current workspace\'s writable set. ' +
      'After user confirmation, you may READ and WRITE files under the given directory.',
    parameters: {
      path: { type: 'string', description: 'Absolute path of an existing directory to add.' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', required: true },
          dirs: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value: AddDirResult): ContentBlock[] => {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    isConcurrencySafe: () => false,
    execute: async ({ path }, exec): Promise<AddDirResult> => {
      if (typeof path !== 'string' || !isAbsolute(path)) {
        return { ok: false, reason: 'path must be an absolute existing directory' }
      }
      const agent = exec.agent
      const cwd = agent?.session.header.cwd
      if (cwd === undefined) return { ok: false, reason: 'session has no working directory' }
      const workspaceId = deps.resolveWorkspaceId(cwd)
      if (workspaceId === undefined) {
        return { ok: false, reason: 'session is not inside a registered workspace' }
      }
      let isDirectory = false
      try {
        isDirectory = statSync(path).isDirectory()
      } catch {
        // Missing or unreadable → reject below.
      }
      if (!isDirectory) return { ok: false, reason: `not an existing directory: ${path}` }
      if (agent === undefined) return { ok: false, reason: 'no caller agent for approval' }
      const outcome = await deps.requestApproval(agent, path, exec.signal)
      if (outcome !== 'allowed-once') return { ok: false, reason: `approval ${outcome}` }
      try {
        const records = await deps.store.load()
        const record = records[workspaceId]
        const existing = record?.dirs ?? []
        const dirs = existing.includes(path) ? existing : [...existing, path]
        const saved = await deps.store.setDirs(workspaceId, dirs)
        return { ok: true, dirs: saved.dirs }
      } catch (error) {
        if (error instanceof DirsStoreError) return { ok: false, reason: error.message }
        throw error
      }
    },
  })
}
