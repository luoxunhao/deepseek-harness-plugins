/**
 * Project-space client tests: the native workspace 「…」 menu injection
 * (管理工作区 item) and the manage dialog it opens — shared-subdirectory
 * list with 添加/移除 for the owning workspace, the 设为主工作区 handover
 * when the workspace is a shared subdirectory of another record, and the
 * empty state creating the first record. Interactive flows (picker, session
 * start) are verified manually against the live GUI.
 */

// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SpacesApi, SpaceInput, SpaceRecord } from '../src/client/api.ts'
import type { ClientWorkspacesService, ClientWorkspaceView } from '../src/client/context.ts'
import { WorkspaceDialog } from '../src/client/workspace-dialog.tsx'
import { mountWorkspaceMenuManageEntry, MENU_MANAGE_SELECTOR, MENU_OPEN_DIRECTORY_SELECTOR, DIALOG_SELECTOR } from '../src/client/workspace-menu.ts'

const ROOT_A = 'E:\\proj-a'
const ROOT_B = 'D:\\proj-b'
const ROOT_C = 'E:\\proj-c'

/** The registered workspaces the fakes share. */
const WORKSPACES: ClientWorkspaceView[] = [
  { workspaceId: 'w1', path: ROOT_A, title: 'proj-a' },
  { workspaceId: 'w2', path: ROOT_B, title: 'proj-b' },
  { workspaceId: 'w3', path: ROOT_C, title: 'proj-c' },
]

/** A workspaces fake with a cached list snapshot and observable picker. */
function fakeWorkspaces(picked: string | null = null):
  { service: ClientWorkspacesService; picks: { count: number } } {
  const picks = { count: 0 }
  const snapshot = { items: [...WORKSPACES] }
  return {
    service: {
      list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
      pickDirectory: async () => { picks.count += 1; return picked },
      create: async () => ({ workspaceId: 'w-created' }),
    },
    picks,
  }
}

/** A spaces API fake around an in-memory record list. */
function fakeApi(initial: SpaceRecord[] = []):
  {
    api: SpacesApi
    records: SpaceRecord[]
    calls: Array<{ op: string; id?: string; input?: SpaceInput }>
    openedDirs: string[]
  } {
  const records = [...initial]
  const calls: Array<{ op: string; id?: string; input?: SpaceInput }> = []
  const openedDirs: string[] = []
  return {
    records,
    calls,
    openedDirs,
    api: {
      list: async () => [...records],
      create: async (input) => {
        calls.push({ op: 'create', input })
        const record: SpaceRecord = { id: `sp-${records.length + 1}`, ...input }
        records.push(record)
        return record
      },
      update: async (id, input) => {
        calls.push({ op: 'update', id, input })
        const record = records.find(candidate => candidate.id === id)
        if (record === undefined) throw new Error(`unknown record ${id}`)
        // Mirror the real store: absent fields are preserved.
        if (input.title !== undefined) record.title = input.title
        if (input.workspaceId !== undefined) record.workspaceId = input.workspaceId
        record.roots = input.roots
        return { ...record }
      },
      remove: async (id) => {
        calls.push({ op: 'remove', id })
        const at = records.findIndex(candidate => candidate.id === id)
        if (at >= 0) records.splice(at, 1)
      },
      openDirectory: async (path) => { openedDirs.push(path) },
    },
  }
}

/** Render with effects flushed (the dialog loads records in useEffect). */
async function renderWithEffects(node: ReactNode): Promise<string> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  await act(async () => {})
  const html = container.innerHTML
  root.unmount()
  container.remove()
  return html
}

/** Click one button by its text content. */
function clickButton(container: HTMLElement, text: string): void {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(text))
  expect(button, `button containing "${text}"`).toBeDefined()
  button!.click()
}

describe('workspace … menu injection', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  /** A fake open workspace row + its portalled menu popup (rects: popup just
   *  below the row, so the nearest-popup matcher finds it). The row carries
   *  its menu trigger as the first button, like the native row. */
  function fakeOpenMenu(): { row: HTMLElement; menu: HTMLElement; trigger: HTMLButtonElement } {
    const row = document.createElement('div')
    row.className = '_projectRow_hash _menuOpen_hash'
    const title = document.createElement('span')
    title.className = '_title_hash'
    title.textContent = 'proj-a'
    row.appendChild(title)
    const trigger = document.createElement('button')
    row.appendChild(trigger)
    document.body.appendChild(row)
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const viewport = document.createElement('div')
    viewport.setAttribute('role', 'presentation')
    menu.appendChild(viewport)
    document.body.appendChild(menu)
    const rowRect = { top: 100, bottom: 130, left: 50, right: 250, width: 200, height: 30, x: 50, y: 100 }
    const menuRect = { top: 134, bottom: 200, left: 50, right: 250, width: 200, height: 66, x: 50, y: 134 }
    row.getBoundingClientRect = () => rowRect as DOMRect
    menu.getBoundingClientRect = () => menuRect as DOMRect
    return { row, menu, trigger }
  }

  it('injects 打开本地目录 and 管理工作区 into the open workspace menu', async () => {
    const { menu } = fakeOpenMenu()
    const dispose = mountWorkspaceMenuManageEntry({ workspaces: fakeWorkspaces().service, api: fakeApi().api })
    await new Promise(resolve => setTimeout(resolve, 0))
    const openRow = menu.querySelector<HTMLElement>(MENU_OPEN_DIRECTORY_SELECTOR)
    const manageRow = menu.querySelector<HTMLElement>(MENU_MANAGE_SELECTOR)
    // Native-cell structure: menuitem buttons with a leading 16px icon + label.
    expect(openRow?.getAttribute('role')).toBe('menuitem')
    expect(openRow?.querySelector('svg')).not.toBeNull()
    expect(openRow?.textContent).toBe('打开本地目录')
    expect(manageRow?.getAttribute('role')).toBe('menuitem')
    expect(manageRow?.querySelector('svg')).not.toBeNull()
    expect(manageRow?.textContent).toBe('管理工作区')
    dispose()
  })


  it('opens the workspace folder on 打开本地目录 click', async () => {
    fakeOpenMenu()
    const escapeEvents: string[] = []
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') escapeEvents.push('escape') })
    const fake = fakeApi()
    const dispose = mountWorkspaceMenuManageEntry({ workspaces: fakeWorkspaces().service, api: fake.api })
    await new Promise(resolve => setTimeout(resolve, 0))
    const row = document.querySelector<HTMLElement>(MENU_OPEN_DIRECTORY_SELECTOR)!
    await act(async () => {
      row.click()
    })
    await act(async () => {})
    expect(escapeEvents).toEqual(['escape'])
    // The plugin-owned route receives the workspace's canonical path.
    expect(fake.openedDirs).toEqual([ROOT_A])
    dispose()
  })

  it('closes the native menu and opens the dialog on click', async () => {
    fakeOpenMenu()
    const escapeEvents: string[] = []
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') escapeEvents.push('escape') })
    const dispose = mountWorkspaceMenuManageEntry({ workspaces: fakeWorkspaces().service, api: fakeApi().api })
    await new Promise(resolve => setTimeout(resolve, 0))
    const item = document.querySelector<HTMLElement>(MENU_MANAGE_SELECTOR)!
    await act(async () => {
      item.click()
    })
    await act(async () => {})
    expect(escapeEvents).toEqual(['escape'])
    const dialog = document.querySelector<HTMLElement>(DIALOG_SELECTOR)
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('管理工作区「proj-a」')
    dispose()
  })

  it('does not inject while no workspace menu is open', async () => {
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    const dispose = mountWorkspaceMenuManageEntry({ workspaces: fakeWorkspaces().service, api: fakeApi().api })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(menu.querySelector(MENU_MANAGE_SELECTOR)).toBeNull()
    dispose()
  })

  it('intercepts the pointer-leave arm when the pointer moves onto the injected item', async () => {
    // The native closeOnPointerLeave grace arms on the pointerout that leaves
    // the trigger toward the item; the plugin intercepts it (the item lives
    // in a separate React root the native region cannot see). A document
    // bubble listener must therefore never observe that pointerout.
    const { row } = fakeOpenMenu()
    const dispose = mountWorkspaceMenuManageEntry({ workspaces: fakeWorkspaces().service, api: fakeApi().api })
    await new Promise(resolve => setTimeout(resolve, 0))
    const host = document.querySelector<HTMLElement>(MENU_MANAGE_SELECTOR)!.parentElement!
    let reachedDocument = false
    document.addEventListener('pointerout', () => { reachedDocument = true })
    row.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: host }))
    expect(reachedDocument).toBe(false)
    dispose()
  })

  it('mirrors the native grace close when the pointer leaves the item to the outside', async () => {
    vi.useFakeTimers()
    try {
      fakeOpenMenu()
      const escapeEvents: string[] = []
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') escapeEvents.push('escape') })
      const dispose = mountWorkspaceMenuManageEntry({ workspaces: fakeWorkspaces().service, api: fakeApi().api })
      await vi.advanceTimersByTimeAsync(0)
      const host = document.querySelector<HTMLElement>(MENU_MANAGE_SELECTOR)!.parentElement!
      // Leaving the menu region (relatedTarget = the page, not the popup or trigger).
      host.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
      await vi.advanceTimersByTimeAsync(210)
      expect(escapeEvents).toEqual(['escape'])
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the menu open when the pointer moves from the item back to the trigger', async () => {
    vi.useFakeTimers()
    try {
      const { trigger } = fakeOpenMenu()
      const escapeEvents: string[] = []
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') escapeEvents.push('escape') })
      const dispose = mountWorkspaceMenuManageEntry({ workspaces: fakeWorkspaces().service, api: fakeApi().api })
      await vi.advanceTimersByTimeAsync(0)
      const host = document.querySelector<HTMLElement>(MENU_MANAGE_SELECTOR)!.parentElement!
      host.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: trigger }))
      await vi.advanceTimersByTimeAsync(210)
      expect(escapeEvents).toEqual([])
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('WorkspaceDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const workspace = (): ClientWorkspaceView => WORKSPACES[0]!

  it('lists shared subdirectories of the owning workspace and removes one', async () => {
    const fake = fakeApi([
      { id: 'r1', workspaceId: 'w1', title: 'proj-a', roots: [ROOT_A, ROOT_B, ROOT_C] },
    ])
    const html = await renderWithEffects(createElement(WorkspaceDialog, {
      workspace: workspace(),
      api: fake.api,
      workspaces: fakeWorkspaces().service,
      onClose: () => {},
    }))
    expect(html).toContain('共享子目录')
    expect(html).toContain('主工作区')
    expect(html).toContain(ROOT_A)
    expect(html).toContain('proj-b')
    expect(html).toContain(ROOT_B)
    expect(html).toContain('proj-c')

    // Remove one shared subdirectory via its row's 移除 button.
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(WorkspaceDialog, {
        workspace: workspace(),
        api: fake.api,
        workspaces: fakeWorkspaces().service,
        onClose: () => {},
      }))
    })
    await act(async () => {})
    const removeButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[title="移除共享子目录"]'))
    expect(removeButtons).toHaveLength(2)
    await act(async () => {
      removeButtons[0]!.click()
    })
    await act(async () => {})
    expect(fake.records[0]!.roots).toEqual([ROOT_A, ROOT_C])
    root.unmount()
    container.remove()
  })

  it('adds a shared subdirectory through the native picker (existing record)', async () => {
    const fake = fakeApi([{ id: 'r1', workspaceId: 'w1', title: 'proj-a', roots: [ROOT_A] }])
    const picked = 'E:\\picked'
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(WorkspaceDialog, {
        workspace: workspace(),
        api: fake.api,
        workspaces: fakeWorkspaces(picked).service,
        onClose: () => {},
      }))
    })
    await act(async () => {})
    clickButton(container, '添加共享子目录')
    await act(async () => {})
    expect(fake.records[0]!.roots).toEqual([ROOT_A, picked])
    expect(fake.calls).toEqual([{ op: 'update', id: 'r1', input: { roots: [ROOT_A, picked] } }])
    root.unmount()
    container.remove()
  })

  it('creates the first record from the empty state', async () => {
    const fake = fakeApi([])
    const picked = 'E:\\first'
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(WorkspaceDialog, {
        workspace: workspace(),
        api: fake.api,
        workspaces: fakeWorkspaces(picked).service,
        onClose: () => {},
      }))
    })
    await act(async () => {})
    expect(container.textContent).toContain('还没有共享子目录')
    clickButton(container, '添加第一个共享子目录')
    await act(async () => {})
    expect(fake.records).toEqual([{ id: 'sp-1', workspaceId: 'w1', title: 'proj-a', roots: [ROOT_A, picked] }])
    expect(fake.calls).toEqual([{
      op: 'create',
      input: { workspaceId: 'w1', title: 'proj-a', roots: [ROOT_A, picked] },
    }])
    root.unmount()
    container.remove()
  })

  it('offers 设为主工作区 when the workspace is a shared subdirectory (parent handover)', async () => {
    const fake = fakeApi([
      { id: 'r1', workspaceId: 'w1', title: 'proj-a', roots: [ROOT_A, ROOT_B] },
    ])
    // w2 (proj-b) is a subdirectory of w1's record.
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(WorkspaceDialog, {
        workspace: WORKSPACES[1]!,
        api: fake.api,
        workspaces: fakeWorkspaces().service,
        onClose: () => {},
      }))
    })
    await act(async () => {})
    expect(container.textContent).toContain('此工作区作为共享子目录属于')
    expect(container.textContent).toContain('proj-a')
    clickButton(container, '设为主工作区')
    await act(async () => {})
    // The record's main seat moved to proj-b; proj-a stays as a subdirectory.
    expect(fake.records[0]).toEqual({ id: 'r1', workspaceId: 'w2', title: 'proj-a', roots: [ROOT_B, ROOT_A] })
    expect(fake.calls).toEqual([{
      op: 'update',
      id: 'r1',
      input: { workspaceId: 'w2', roots: [ROOT_B, ROOT_A] },
    }])
    root.unmount()
    container.remove()
  })

  it('closes on Escape', async () => {
    const closed: string[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(WorkspaceDialog, {
        workspace: workspace(),
        api: fakeApi([]).api,
        workspaces: fakeWorkspaces().service,
        onClose: () => { closed.push('closed') },
      }))
    })
    await act(async () => {})
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(closed).toEqual(['closed'])
    root.unmount()
    container.remove()
  })
})
