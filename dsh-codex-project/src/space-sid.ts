/**
 * The space's write SID derivation. Kept apart from `space-config.ts`
 * (which the seam and the fs provider import) so those bundles never pull
 * in the windows-acl/koffi dependency — only the confinement runner needs
 * the SID.
 * @module dsh-codex-project/space-sid
 */

import { join } from 'node:path'

import { workspaceWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl'

import { spaceConfigDirectory } from './space-config.ts'
import type { SpaceRecord } from './space-config.ts'

/**
 * The space's write SID: derived from the config file's canonical directory
 * plus the space id — a distinct identity per space that never collides with
 * any single root's workspace SID (a core session granted only its own
 * workspace SID cannot follow a space root's ACE into another root of the
 * space).
 */
export function spaceWriteSid(space: SpaceRecord): string {
  return workspaceWriteSid(join(spaceConfigDirectory(), 'spaces', space.id))
}
