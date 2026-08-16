/**
 * Native workspace 「…」 menu injection: the workspace row's overflow menu is
 * ui-workspace code with hardcoded items (rename/delete) and an `onSelect`
 * that rejects unknown ids — so the plugin adds its own items at the DOM
 * level: a MutationObserver watches for the portalled `[role="menu"]` popup
 * that appears while a workspace row carries the `menuOpen` class, injects
 * a two-row block into the popup's viewport, and binds its own click
 * handlers (which never go through the native `onSelect`).
 *
 * Injected rows:
 *  - 打开本地目录 — opens the workspace's folder in the OS file manager via
 *    the plugin's own host route (`/codex-project/api/open-directory`, which
 *    spawns explorer.exe). Deliberately NOT `workspaces.openPath`:
 *    dsh-better-sidebar wraps that method into its sidebar editor, where a
 *    directory is meaningless (`"<path>" is a directory`).
 *  - 管理工作区 — opens the plugin's manage dialog (`WorkspaceDialog`),
 *    which lists the shared subdirectories and offers the 设为主工作区
 *    handover.
 *
 * Click flow: identify the workspace (row title → workspace registry) →
 * close the menu (Escape, the native document keydown listener) → run the
 * action.
 *
 * The popup unmounts on close, so the injected rows die with it — every
 * open re-injects (self-healing by construction). Keyboard navigation of
 * the native menu does not see the injected rows; mouse clicks work.
 *
 * The rows mirror the native menu cell structure and metrics (16px leading
 * icon + label, 40px min-height cell) so they render pixel-identical to the
 * native 重命名 row; the CSS lives in `styles.ts`.
 * @module dsh-codex-project/client/workspace-menu
 */

import { createElement, Fragment } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { IconFolderOpenOutline16, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import type { SpacesApi } from './api.ts'
import type { ClientWorkspaceView, ClientWorkspacesService } from './context.ts'
import { WorkspaceDialog } from './workspace-dialog.tsx'

/** The injected block's identity (idempotent per-popup injection). */
export const MENU_ACTIONS_SELECTOR = '[data-dsh-codex-project-menu-actions]'
/** The 管理工作区 row (kept for tests and direct queries). */
export const MENU_MANAGE_SELECTOR = '[data-dsh-codex-project-menu-manage]'
/** The 打开本地目录 row. */
export const MENU_OPEN_DIRECTORY_SELECTOR = '[data-dsh-codex-project-menu-open-directory]'
/** The dialog host's identity (one dialog at a time). */
export const DIALOG_SELECTOR = '[data-dsh-codex-project-dialog]'

/** The injected rows' labels. */
const MENU_OPEN_DIRECTORY_LABEL = '打开本地目录'
const MENU_MANAGE_LABEL = '管理工作区'

/**
 * Mirror of ui-primitives' POINTER_GRACE_MS: the workspace menu closes 200ms
 * after the pointer leaves its region unless it re-enters.
 */
const MENU_POINTER_GRACE_MS = 200

/** The open workspace row: the native row whose overflow menu is open. */
function openWorkspaceRow(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[class*="projectRow"][class*="menuOpen"]')
}

/** The portalled menu popup nearest to the open row (the workspace menu). */
function workspaceMenuPopup(row: HTMLElement): HTMLElement | null {
  const rowRect = row.getBoundingClientRect()
  let best: HTMLElement | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) {
    const rect = menu.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    const distance = Math.abs(rect.top - rowRect.bottom) + Math.abs(rect.left - rowRect.left)
    if (distance < bestDistance) {
      bestDistance = distance
      best = menu
    }
  }
  return best
}

/** The workspace owning the open row (matched by display title). */
function workspaceOfRow(row: HTMLElement, workspaces: ClientWorkspacesService): ClientWorkspaceView | undefined {
  const label = row.querySelector<HTMLElement>('[class*="title"]')?.textContent?.trim()
  if (label === undefined || label === '') return undefined
  return workspaces.list.getSnapshot().items.find(candidate => candidate.title === label)
}

/** Close the open native menu (its document-level Escape listener). */
function closeNativeMenu(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

/**
 * Mount the 「…」 menu injection (打开本地目录 + 管理工作区) and its manage
 * dialog.
 * @param deps - the workspaces service (identity) and the spaces API.
 * @returns the disposer.
 */
export function mountWorkspaceMenuManageEntry(deps: {
  workspaces: ClientWorkspacesService
  api: SpacesApi
}): () => void {
  const { workspaces, api } = deps
  let dialogRoot: Root | undefined
  let dialogHost: HTMLDivElement | undefined
  // Injected menu-item roots: unmounted on dispose so a popup still open at
  // teardown releases its React tree (the popup itself dies with the menu).
  const itemRoots = new Set<Root>()
  // Mirrored pointer-leave close timers, cleared at dispose.
  const pendingCloses = new Set<ReturnType<typeof setTimeout>>()

  /**
   * The workspace menu closes on pointer-leave (`closeOnPointerLeave`): the
   * native Menu treats the portaled list and the trigger as ONE React-tree
   * region, so moving the pointer between them never arms the 200ms grace
   * close. Our injected rows render from a separate React root — the host
   * div is a root-container boundary the enter/leave simulation cannot see
   * inside — so a pointer move onto a row looks like leaving the region and
   * arms a close that never gets cancelled (the menu vanishes while
   * hovering). Fix: intercept (document capture — the common ancestor of
   * the sidebar trigger and the portaled list) every `pointerout` whose
   * relatedTarget lands inside the injected host, so the arm event never
   * reaches React's delegated listener. Visual hovers are pure CSS `:hover`,
   * so nothing visible is affected.
   */
  let activeHost: HTMLElement | undefined
  const stopLeaveArm = (event: PointerEvent): void => {
    const related = event.relatedTarget
    if (related instanceof Node && activeHost?.contains(related) === true) event.stopPropagation()
  }
  document.addEventListener('pointerout', stopLeaveArm, true)

  const closeDialog = (): void => {
    dialogRoot?.unmount()
    dialogRoot = undefined
    dialogHost?.remove()
    dialogHost = undefined
  }

  const openDialog = (workspace: ClientWorkspaceView): void => {
    closeDialog()
    dialogHost = document.createElement('div')
    dialogHost.dataset.dshCodexProjectDialog = ''
    document.body.appendChild(dialogHost)
    dialogRoot = createRoot(dialogHost)
    dialogRoot.render(createElement(WorkspaceDialog, {
      workspace,
      api,
      workspaces,
      onClose: closeDialog,
    }))
  }

  /** One native-cell menu row: icon + label, self-bound click. */
  const menuRow = (
    idAttribute: string,
    label: string,
    icon: ReturnType<typeof createElement>,
    onClick: () => void,
  ): ReturnType<typeof createElement> => createElement(
    'button',
    {
      type: 'button',
      role: 'menuitem',
      [idAttribute]: '',
      className: 'dsh-cxp-menu-item',
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        onClick()
      },
    },
    createElement(
      Fragment,
      null,
      createElement('span', { className: 'dsh-cxp-menu-icon' }, icon),
      createElement('span', { className: 'dsh-cxp-menu-label' }, label),
    ),
  )

  const ensure = (): void => {
    if (typeof document === 'undefined') return
    const row = openWorkspaceRow()
    if (row === null) return
    const menu = workspaceMenuPopup(row)
    if (menu === null) return
    if (menu.querySelector(MENU_ACTIONS_SELECTOR) !== null) return
    const viewport = menu.querySelector<HTMLElement>('[role="presentation"]') ?? menu
    // The row's first button is the native menu trigger; its parent is the
    // Menu root span (the pointer-grace wrapper) — part of the menu region.
    const wrapper = row.querySelector('button')?.parentElement ?? undefined
    const host = document.createElement('div')
    host.dataset.dshCodexProjectMenuActions = ''
    const root = createRoot(host)
    itemRoots.add(root)
    // flushSync: the rows must be committed into the DOM before `ensure()`
    // returns — the dedup check on the next MutationObserver callback would
    // otherwise miss a still-pending (async-scheduled) React commit and
    // re-inject into the same popup, looping forever.
    flushSync(() => {
      root.render(createElement(
        Fragment,
        null,
        menuRow(
          'data-dsh-codex-project-menu-open-directory',
          MENU_OPEN_DIRECTORY_LABEL,
          createElement(IconFolderOpenOutline16, { size: 16 }),
          () => {
            const workspace = workspaceOfRow(row, workspaces)
            if (workspace === undefined) return
            closeNativeMenu()
            // Plugin-owned host route: spawns the OS file manager directly,
            // bypassing any openPath interception (better-sidebar routes
            // openPath into its sidebar editor, where directories error).
            void api.openDirectory(workspace.path).catch((error: unknown) => {
              console.error('[dsh-codex-project] open directory failed:', error)
            })
          },
        ),
        menuRow(
          'data-dsh-codex-project-menu-manage',
          MENU_MANAGE_LABEL,
          createElement(IconSettingsOutline16, { size: 16 }),
          () => {
            const workspace = workspaceOfRow(row, workspaces)
            if (workspace === undefined) return
            closeNativeMenu()
            openDialog(workspace)
          },
        ),
      ))
    })
    viewport.appendChild(host)
    activeHost = host

    // Exit direction: the wrapper cannot see the pointer leave through our
    // rows either, so mirror the native grace — leaving the menu region (the
    // popup or the trigger's wrapper) from a row arms the same close,
    // guarded so a stale timer never closes a later popup.
    const scheduleMenuClose = (): void => {
      const timer = setTimeout(() => {
        pendingCloses.delete(timer)
        if (menu.isConnected) closeNativeMenu()
      }, MENU_POINTER_GRACE_MS)
      pendingCloses.add(timer)
    }
    const onItemLeave = (event: PointerEvent): void => {
      const related = event.relatedTarget
      if (related instanceof Node && (menu.contains(related) || wrapper?.contains(related) === true)) return
      scheduleMenuClose()
    }
    const onItemEnter = (): void => {
      for (const timer of pendingCloses) clearTimeout(timer)
      pendingCloses.clear()
    }
    host.addEventListener('pointerout', onItemLeave)
    host.addEventListener('pointerover', onItemEnter)
    console.log('[dsh-codex-project] 打开本地目录/管理工作区 items injected into workspace menu')
  }

  const startWaitObserver = (): void => {
    if (document.body === null) {
      document.addEventListener('DOMContentLoaded', startWaitObserver, { once: true })
      return
    }
    observer.observe(document.body, { childList: true, subtree: true })
    ensure()
  }
  const observer = new MutationObserver(() => { ensure() })
  startWaitObserver()

  return () => {
    observer.disconnect()
    document.removeEventListener('pointerout', stopLeaveArm, true)
    closeDialog()
    for (const root of itemRoots) root.unmount()
    itemRoots.clear()
    for (const timer of pendingCloses) clearTimeout(timer)
    pendingCloses.clear()
  }
}
