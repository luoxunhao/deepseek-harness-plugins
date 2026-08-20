/**
 * 项目文件夹 tab tests: project resolution drives the empty state, the root
 * rows (main + shared + missing), lazy per-directory listing on expand, file
 * preview inline on click, inline editor host mounting, and right-click
 * "用文件管理器打开".
 */

// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectEntry, ProjectListing, ProjectView, SpacesApi } from '../src/client/api.ts'
import type { ClientRuntimeContext } from '../src/client/context.ts'
import { ProjectTab } from '../src/client/project-tab.tsx'

const ROOT_A = 'E:\\proj'
const ROOT_B = 'D:\\shared'
const ROOT_MISSING = 'E:\\gone'

const PROJECT: ProjectView = {
  workspaceId: 'w1',
  path: ROOT_A,
  dirs: [ROOT_B],
  missingDirs: [ROOT_MISSING],
}

/** A fake SpacesApi around a project + per-dir listings, recording calls. */
function fakeApi(project: ProjectView | null, listings: Record<string, ProjectListing> = {}): {
  api: SpacesApi
  openedDirs: string[]
  listed: Array<{ cwd: string; path: string }>
  read: Array<{ cwd: string; path: string }>
} {
  const openedDirs: string[] = []
  const listed: Array<{ cwd: string; path: string }> = []
  const read: Array<{ cwd: string; path: string }> = []
  return {
    openedDirs,
    listed,
    read,
    api: {
      list: async () => ({}),
      getDirs: async () => [],
      setDirs: async (_id, dirs) => [...dirs],
      openDirectory: async (path) => { openedDirs.push(path) },
      project: async () => project,
      listDir: async (cwd, path) => {
        listed.push({ cwd, path })
        return listings[path] ?? { path, entries: [], truncated: false }
      },
      readFile: async (cwd, path) => {
        read.push({ cwd, path })
        return { content: '# hello', truncated: false }
      },
      writeFile: async () => {},
      fileUrl: (_cwd, path) => `/file?path=${encodeURIComponent(path)}`,
      downloadUrl: (_cwd, path) => `/file?path=${encodeURIComponent(path)}&download=1`,
    },
  }
}

const scope = { sessionId: 's1', cwd: ROOT_A }

/** A fake client runtime ctx recording dispatched file-reference chips. */
function fakeCtx(): { ctx: ClientRuntimeContext; chips: Array<{ ref: string; label: string }> } {
  const chips: Array<{ ref: string; label: string }> = []
  const scopeOf: Record<string, unknown> = {}
  const ctx: ClientRuntimeContext = {
    get: (service) => service === 'conversation'
      ? {
          input: {
            for: (_actx: unknown) => ({
              state: { getSnapshot: () => ({ draft: '', draftRev: 0 }) },
              setDraft: (_text: string) => {},
            }),
          },
        }
      : undefined,
    sessions: {
      scope: (sessionId) => {
        const actx = scopeOf[sessionId] ??= {
          sessionId,
          emit: (_event: string, payload: unknown) => {
            const { reference } = payload as { reference: { ref: string; label: string } }
            chips.push({ ref: reference.ref, label: reference.label })
          },
        }
        return actx
      },
    },
  }
  return { ctx, chips }
}

/** Render the tab and return the mounted `[data-dsh-codex-project-tab]` node.
 *  The tree is kept mounted until afterEach so React's event delegation (rooted
 *  at the container) stays alive for click/contextmenu dispatch. */
const mounted: Array<{ root: Root; container: HTMLElement }> = []
async function renderTab(api: SpacesApi, ctx: ClientRuntimeContext): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ProjectTab, { ctx, api, scope }))
  })
  await act(async () => {})
  mounted.push({ root, container })
  const tab = container.querySelector<HTMLElement>('[data-dsh-codex-project-tab]')
  expect(tab).toBeDefined()
  return tab!
}

/** Find a tree row whose text content includes `text`. */
function rowByText(tab: HTMLElement, text: string): HTMLElement {
  const row = Array.from(tab.querySelectorAll<HTMLElement>('[data-is-dir], [data-is-file], [data-is-missing]'))
    .find(candidate => candidate.textContent?.includes(text))
  expect(row, `row containing "${text}"`).toBeDefined()
  return row!
}

describe('ProjectTab', () => {
  afterEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => { root.unmount() })
      container.remove()
    }
    document.body.innerHTML = ''
  })

  it('shows the session cwd as a single root when no project is configured', async () => {
    const fake = fakeApi(null)
    const tab = await renderTab(fake.api, fakeCtx().ctx)
    expect(tab.textContent).not.toContain('没有项目共享配置')
    expect(tab.textContent).toContain('proj')
  })

  it('renders the main root, shared dir, and a missing-dir flag', async () => {
    const fake = fakeApi(PROJECT)
    const tab = await renderTab(fake.api, fakeCtx().ctx)
    expect(tab.textContent).toContain('proj (主)')
    expect(tab.textContent).toContain('shared')
    expect(tab.textContent).toContain('(⚠ directory missing)')
    expect(rowByText(tab, '(⚠ directory missing)').hasAttribute('data-is-missing')).toBe(true)
  })

  it('loads a directory level lazily on expand', async () => {
    const listing: ProjectListing = {
      path: ROOT_A,
      entries: [
        { name: 'src', path: `${ROOT_A}\\src`, isDir: true, hidden: false, isSymlink: false, broken: false },
        { name: 'readme.md', path: `${ROOT_A}\\readme.md`, isDir: false, hidden: false, isSymlink: false, broken: false },
      ],
      truncated: false,
    }
    const fake = fakeApi(PROJECT, { [ROOT_A]: listing })
    const tab = await renderTab(fake.api, fakeCtx().ctx)
    await act(async () => {
      rowByText(tab, 'proj (主)').click()
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(fake.listed).toEqual([{ cwd: ROOT_A, path: ROOT_A }])
    expect(tab.textContent).toContain('src')
    expect(tab.textContent).toContain('readme.md')
  })

  it('previews a file inline on click (no editor jump)', async () => {
    const listing: ProjectListing = {
      path: ROOT_A,
      entries: [
        { name: 'readme.md', path: `${ROOT_A}\\readme.md`, isDir: false, hidden: false, isSymlink: false, broken: false },
      ],
      truncated: false,
    }
    const fake = fakeApi(PROJECT, { [ROOT_A]: listing })
    const tab = await renderTab(fake.api, fakeCtx().ctx)
    await act(async () => {
      rowByText(tab, 'proj (主)').click()
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await act(async () => {
      rowByText(tab, 'readme.md').click()
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(fake.read).toEqual([{ cwd: ROOT_A, path: `${ROOT_A}\\readme.md` }])
    // Text files show the filename in the editor toolbar, not a duplicate header.
    expect(tab.querySelector('.dsh-cxp-preview-title')).toBeNull()
    expect(tab.querySelector('.dsh-cxp-preview-filename')?.textContent).toContain('readme.md')
  })

  it('keeps the inline editor host mounted and reveals it on 编辑', async () => {
    const listing: ProjectListing = {
      path: ROOT_A,
      entries: [
        { name: 'readme.md', path: `${ROOT_A}\\readme.md`, isDir: false, hidden: false, isSymlink: false, broken: false },
      ],
      truncated: false,
    }
    const fake = fakeApi(PROJECT, { [ROOT_A]: listing })
    const tab = await renderTab(fake.api, fakeCtx().ctx)
    await act(async () => {
      rowByText(tab, 'proj (主)').click()
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await act(async () => {
      rowByText(tab, 'readme.md').click()
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    // Markdown starts in preview mode; the CodeMirror host is always mounted
    // (hidden via the `hidden` attribute) so the view is created on mount and
    // the edit toggle never renders a blank page.
    const cmHost = tab.querySelector<HTMLElement>('.dsh-cxp-preview-cm')
    expect(cmHost).not.toBeNull()
    expect(cmHost!.hasAttribute('hidden')).toBe(true)
    await act(async () => {
      const editButton = Array.from(tab.querySelectorAll('button')).find(b => b.textContent?.trim() === '编辑')
      expect(editButton).toBeDefined()
      editButton!.click()
    })
    expect(cmHost!.hasAttribute('hidden')).toBe(false)
  })

  it('references a file in chat via the hover @ button', async () => {
    const listing: ProjectListing = {
      path: ROOT_A,
      entries: [
        { name: 'readme.md', path: `${ROOT_A}\\readme.md`, isDir: false, hidden: false, isSymlink: false, broken: false },
      ],
      truncated: false,
    }
    const fake = fakeApi(PROJECT, { [ROOT_A]: listing })
    const runtime = fakeCtx()
    const tab = await renderTab(fake.api, runtime.ctx)
    await act(async () => {
      rowByText(tab, 'proj (主)').click()
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const fileRow = rowByText(tab, 'readme.md')
    const refButton = fileRow.querySelector<HTMLElement>('.dsh-cxp-row-ref')
    expect(refButton).toBeDefined()
    await act(async () => {
      refButton!.click()
    })
    expect(runtime.chips).toEqual([{ ref: `${ROOT_A}\\readme.md`, label: 'readme.md' }])
  })

  it('opens the context menu on right-click (用文件管理器打开 item present)', async () => {
    const fake = fakeApi(PROJECT)
    const tab = await renderTab(fake.api, fakeCtx().ctx)
    await act(async () => {
      rowByText(tab, 'proj (主)').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(tab.ownerDocument.body.textContent).toContain('用文件管理器打开')
  })

  it('surfaces a project-fetch error instead of crashing', async () => {
    const fake = fakeApi(null)
    fake.api.project = async () => { throw new Error('boom') }
    const tab = await renderTab(fake.api, fakeCtx().ctx)
    expect(tab.textContent).toContain('boom')
  })
})
