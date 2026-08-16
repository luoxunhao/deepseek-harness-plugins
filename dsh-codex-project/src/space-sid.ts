/**
 * The workspace's write SID derivation. Kept apart from `dirs-config.ts`
 * (which the seam and the fs provider import) so those bundles never pull
 * in the windows-acl/koffi dependency — only the confinement runner needs
 * the SID.
 * @module dsh-codex-project/space-sid
 */

import { join } from 'node:path'

import { workspaceWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl'

import { dirsConfigDirectory } from './dirs-config.ts'

/**
 * The workspace's write SID: derived from the config file's canonical
 * directory plus the workspace id — a distinct identity per workspace that
 * never collides with any single root's workspace SID (a core session
 * granted only its own workspace SID cannot follow a workspace root's ACE
 * into another root of the recorded set).
 */
export function workspaceDirsWriteSid(workspaceId: string): string {
  return workspaceWriteSid(join(dirsConfigDirectory(), 'workspaces', workspaceId))
}
