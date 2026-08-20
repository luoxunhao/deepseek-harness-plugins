/**
 * dsh-codex-project client half: injects the 管理工作区 entry into the
 * native workspace 「…」 menu (DOM-level, self-healing) and mounts the
 * manage dialog it opens. When better-sidebar is installed it ALSO registers
 * the 项目文件夹 tab — a multi-root file tree of the project (main root +
 * shared dirs) with a read-only inline preview.
 *
 * The DOM-level injection follows the dsh-web-ui family precedent: the
 * workspace menu popup is React-managed native code with no extension
 * point, so the item is injected per popup-open and self-binds its click.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — an
 * external plugin must not take the GUI down.
 */
import { createElement } from 'react'
import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import type { Context } from './context.ts'
import { createSpacesApi } from './api.ts'
import { createFileReferenceSource } from './file-reference.ts'
import { mountWorkspaceMenuManageEntry } from './workspace-menu.ts'
import { ProjectTab } from './project-tab.tsx'
import { injectStyles } from './styles.ts'

/** Services required before mounting (provided by the client runtime; the
 *  cordis context proxy refuses undeclared service access). `betterSidebar`
 *  is OPTIONAL: the tab registers only when better-sidebar is installed. */
export const inject = ['workspaces', 'betterSidebar', 'inputTriggers']

/** Apply claim: a duplicated client injection must not mount a second entry. */
let claimed = false

/**
 * Client plugin body.
 * @param ctx - the client cordis context (workspaces).
 */
export function apply(ctx: Context): void {
  if (claimed) return
  claimed = true
  ctx.effect(() => () => { claimed = false }, 'dsh-codex-project: apply claim')

  const api = createSpacesApi()
  const disposers: Array<() => void> = []
  const mount = (name: string, install: () => (() => void) | undefined): void => {
    try {
      const dispose = install()
      if (dispose !== undefined) disposers.push(dispose)
    } catch (error) {
      console.error(`[dsh-codex-project] ${name} mount failed:`, error)
    }
  }
  mount('styles', () => injectStyles())
  if (ctx.inputTriggers !== undefined) {
    mount('file-reference source', () => ctx.inputTriggers!.registerSource(createFileReferenceSource()))
  }
  mount('workspace … menu entry', () => mountWorkspaceMenuManageEntry({
    workspaces: ctx.workspaces,
    api,
  }))
  if (ctx.betterSidebar !== undefined) {
    mount('项目文件夹 tab', () => ctx.betterSidebar!.registerTab({
      id: 'codex-project:project',
      title: () => '项目文件夹',
      icon: createElement(IconFolderOpenOutline16, { size: 16 }),
      order: 45,
      single: true,
      component: ({ ctx: tabCtx, scope }) => createElement(ProjectTab, {
        ctx: tabCtx,
        api,
        scope,
      }),
    }))
  } else {
    console.log('[dsh-codex-project] better-sidebar not installed; skipping 项目文件夹 tab')
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-codex-project: ui mounts')
}
