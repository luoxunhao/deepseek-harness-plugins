/**
 * 项目文件夹 tab (registered into better-sidebar): a Files-tab-like panel of
 * the project anchored at the current session's cwd — the main workspace root
 * plus every shared additional dir (cross-drive). The layout mirrors the
 * better-sidebar Files tab: a path input box on top, the project file tree
 * docked on the right (drag-resizable, toggleable), and an inline preview of
 * the selected file on the left (image/PDF/markdown/html/code/binary). The
 * preview is read-only — inline markdown/html/code rendering, no editor jump,
 * no editing. Right-clicking a row opens a context menu (open the folder
 * locally, copy the relative / absolute path, or reference the file in chat
 * as a chip that shows the file name and carries its absolute path into the
 * model context); hovering a row reveals the @-reference button.
 *
 * With no shared config the tab falls back to the session's own working
 * directory as a single root, so the tree always has content. The tree is
 * self-contained (the client bundle's purity gate forbids value-importing
 * better-sidebar's FileTree): each directory loads its level lazily through
 * the plugin's own /list route, fenced to the project roots on the host; file
 * previews go through the plugin's /read, /write, and /file routes.
 * @module dsh-codex-project/client/project-tab
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  IconCodeOutline16,
  IconCopyOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconFolderOpenOutline16,
  IconLinkOutline16,
  IconPanelLeftOutline16,
  IconRefreshOutline16,
  IconWarningOutline16,
  Menu,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'

import type { ProjectEntry, ProjectListing, ProjectView, SpacesApi } from './api.ts'
import type { ClientRuntimeContext, SidebarTabScope } from './context.ts'
import { insertFileReference } from './file-reference.ts'
import { basename, relativePath, resolvePath } from './paths.ts'
import { PreviewPane } from './preview-pane.tsx'

/** The tab's render props: the client ctx, the dirs API, and the session scope. */
export interface ProjectTabProps {
  ctx: ClientRuntimeContext
  api: SpacesApi
  scope: SidebarTabScope
}

/** One top-level project root. */
type RootRow = { path: string; kind: 'main' | 'shared' | 'missing' }

/** How long the row's "已复制" label stays after a successful copy. */
const COPIED_MS = 1200

/** Default / bounds of the docked tree width. */
const DEFAULT_TREE_WIDTH = 300
const MIN_TREE_WIDTH = 180
const MAX_TREE_WIDTH = 640

/** A context-menu target: the row path, whether it is a file, plus the cursor position. */
type RowMenuState = { path: string; isFile: boolean; x: number; y: number } | null

/**
 * The 项目文件夹 tab body.
 * @param props - the client ctx, the dirs API, the better-sidebar service, and the session scope.
 */
export function ProjectTab(props: ProjectTabProps): ReactNode {
  const { ctx, api, scope } = props
  const cwd = scope.cwd
  const [project, setProject] = useState<ProjectView | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** The row whose path was just copied ("已复制" replaces its @ button). */
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  /** The open context menu: the target row path plus the cursor position. */
  const [rowMenu, setRowMenu] = useState<RowMenuState>(null)
  /** The file currently previewed inline (null = the empty/welcome state). */
  const [openPath, setOpenPath] = useState<string | null>(null)
  /** The path input box value. */
  const [pathInput, setPathInput] = useState(cwd ?? '')
  /** Whether the docked tree is visible (toggleable from the header). */
  const [treeVisible, setTreeVisible] = useState(true)
  /** The docked tree width (drag-resizable via the gutter). */
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH)

  const refresh = useCallback(async () => {
    if (cwd === undefined || cwd === '') {
      setProject(null)
      return
    }
    try {
      setProject(await api.project(cwd))
      setError(null)
    } catch (reason) {
      setProject(undefined)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [api, cwd])

  useEffect(() => { void refresh() }, [refresh, reloadKey])

  /** Open a file in the inline preview (and mirror it into the path box). */
  const openFile = useCallback((path: string) => {
    setOpenPath(path)
    setPathInput(path)
  }, [])

  const openDir = useCallback((path: string) => {
    void api.openDirectory(path).catch((reason) => {
      console.error('[dsh-codex-project] open directory failed:', reason)
    })
  }, [api])

  /** Resolve the path box (relative → absolute under the cwd) and preview it. */
  const goToPath = useCallback((input: string) => {
    if (cwd === undefined || cwd === '') return
    const resolved = resolvePath(cwd, input)
    setOpenPath(resolved)
    setPathInput(resolved)
  }, [cwd])

  /** Copy `text`; on success flip the row's copied label for a moment. */
  const copyPath = useCallback((text: string, path: string): void => {
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopiedPath(path)
      window.setTimeout(() => {
        setCopiedPath(current => current === path ? null : current)
      }, COPIED_MS)
    })
  }, [])

  const reference = useCallback((path: string) => {
    insertFileReference(ctx, scope, path)
  }, [ctx, scope])

  /** The hover-revealed @-reference button (or the transient "已复制" label). */
  const rowAction = (path: string): ReactNode => {
    if (copiedPath === path) return <span className="dsh-cxp-row-copied">已复制</span>
    return (
      <button
        type="button"
        className="dsh-cxp-row-ref"
        aria-label="在对话中引用"
        title="在对话中引用"
        onClick={(event) => {
          event.stopPropagation()
          reference(path)
        }}
      >
        @
      </button>
    )
  }

  const openRowMenu = (event: MouseEvent, path: string, isFile: boolean): void => {
    event.preventDefault()
    event.stopPropagation()
    setRowMenu({ path, isFile, x: event.clientX, y: event.clientY })
  }

  const startResize = (event: MouseEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startW = treeWidth
    const onMove = (ev: globalThis.MouseEvent): void => {
      setTreeWidth(Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, startW + startX - ev.clientX)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const header = (
    <div className="dsh-cxp-tab-header">
      <span className="dsh-cxp-tab-title">项目文件夹</span>
      <input
        className="dsh-cxp-tab-path-input"
        value={pathInput}
        placeholder="输入文件路径，回车预览"
        spellCheck={false}
        title="输入文件路径，回车在左侧预览（支持绝对路径或相对 cwd 的路径）"
        onChange={(event) => { setPathInput(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') goToPath(pathInput)
        }}
      />
      <button type="button" className="dsh-cxp-tab-icon-btn" title={treeVisible ? '隐藏文件树' : '显示文件树'} onClick={() => { setTreeVisible(visible => !visible) }}>
        <IconPanelLeftOutline16 />
      </button>
      <button type="button" className="dsh-cxp-tab-icon-btn" title="刷新" onClick={() => { setReloadKey(key => key + 1) }}>
        <IconRefreshOutline16 />
      </button>
    </div>
  )

  let body: ReactNode
  if (error !== null) {
    body = <div className="dsh-cxp-tab-note dsh-cxp-tab-error">{error}</div>
  } else if (project === undefined) {
    body = <div className="dsh-cxp-tab-note">加载中…</div>
  } else {
    // With no shared config, fall back to the session's own working directory
    // as a single root — the tree always has something to show.
    const roots: RootRow[] = project === null
      ? (cwd === undefined || cwd === '' ? [] : [{ path: cwd, kind: 'main' as const }])
      : [
        { path: project.path, kind: 'main' },
        ...project.dirs.map(path => ({ path, kind: 'shared' as const })),
        ...project.missingDirs.map(path => ({ path, kind: 'missing' as const })),
      ]
    const tree = (
      <div className="dsh-cxp-tab-tree">
        {roots.length === 0 ? (
          <div className="dsh-cxp-tab-note">等待工作区…</div>
        ) : roots.map(root => {
          if (root.kind === 'missing') {
            return <MissingRow key={root.path} path={root.path} />
          }
          const name = root.kind === 'main' && project !== null ? `${basename(root.path)} (主)` : basename(root.path)
          return (
            <DirNode
              key={root.path}
              api={api}
              cwd={cwd!}
              path={root.path}
              name={name}
              depth={0}
              defaultOpen={false}
              onOpenFile={openFile}
              onOpenDir={openDir}
              rowAction={rowAction}
              openRowMenu={openRowMenu}
            />
          )
        })}
      </div>
    )
    body = (
      <div className="dsh-cxp-tab-body">
        <div className="dsh-cxp-preview-main">
          {openPath !== null && cwd !== undefined
            ? <PreviewPane key={openPath} api={api} cwd={cwd} path={openPath} />
            : (
              <div className="dsh-cxp-preview-empty">
                <div className="dsh-cxp-preview-empty-title">从文件树或上方路径框选择一个文件</div>
                <div className="dsh-cxp-preview-empty-hint">在左侧内联预览；图片 / PDF / Markdown / HTML / 代码均可直接查看与编辑</div>
              </div>
            )}
        </div>
        {treeVisible && (
          <>
            <div className="dsh-cxp-tree-resize" onPointerDown={startResize} title="拖动调整文件树宽度" />
            <div className="dsh-cxp-tree-dock" style={{ width: treeWidth }}>
              {tree}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="dsh-cxp-tab" data-dsh-codex-project-tab>
      {header}
      {body}
      {/* One shared context menu, positioned at the right-click cursor (portal
          so the tree's overflow clip cannot crop it). */}
      <Menu
        open={rowMenu !== null}
        onClose={() => { setRowMenu(null) }}
        items={[
          { id: 'open-dir', label: '用文件管理器打开', icon: <IconFolderOpenOutline16 size={14} /> },
          { id: 'relative', label: '复制相对路径', icon: <IconCopyOutline16 size={14} /> },
          { id: 'absolute', label: '复制绝对路径', icon: <IconCopyOutline16 size={14} /> },
          { id: 'reference', label: '添加到对话（@引用）', icon: <IconCodeOutline16 size={14} /> },
        ]}
        onSelect={(id) => {
          const target = rowMenu
          if (target === null) return
          setRowMenu(null)
          if (id === 'open-dir') { openDir(target.path); return }
          if (id === 'reference') { reference(target.path); return }
          copyPath(
            id === 'relative' ? relativePath(cwd ?? '', target.path) : target.path,
            target.path,
          )
        }}
        portal
        align="start"
        getAnchorRect={() => (rowMenu === null ? null : new DOMRect(rowMenu.x, rowMenu.y, 0, 0))}
        anchor={<span />}
      />
    </div>
  )
}

/** A stale (missing) root row: flagged, never expandable. */
function MissingRow(props: { path: string }): ReactNode {
  const { path } = props
  return (
    <div className="dsh-cxp-tree-row dsh-cxp-tree-missing" data-is-missing>
      <span className="dsh-cxp-tree-icon"><IconWarningOutline16 size={14} /></span>
      <span className="dsh-cxp-tree-name">{basename(path)} (⚠ directory missing)</span>
    </div>
  )
}

/** A directory row: expands on click to load its children lazily. */
function DirNode(props: {
  api: SpacesApi
  cwd: string
  path: string
  name: string
  depth: number
  defaultOpen: boolean
  onOpenFile: (path: string) => void
  onOpenDir: (path: string) => void
  rowAction: (path: string) => ReactNode
  openRowMenu: (event: MouseEvent, path: string, isFile: boolean) => void
}): ReactNode {
  const {
    api, cwd, path, name, depth, defaultOpen, onOpenFile, onOpenDir,
    rowAction, openRowMenu,
  } = props
  const [expanded, setExpanded] = useState(defaultOpen)
  const [listing, setListing] = useState<ProjectListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Deliberately keyed only on expand/cwd/path: adding `loading`/`listing`
  // would re-run this effect on the very state updates it makes, whose
  // cleanup would cancel the in-flight request before it resolves.
  useEffect(() => {
    if (!expanded || listing !== null || loading) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void api.listDir(cwd, path).then((result) => {
      if (cancelled) return
      setListing(result)
      setLoading(false)
    }).catch((reason) => {
      if (cancelled) return
      setLoadError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [expanded, api, cwd, path])

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className="dsh-cxp-tree-row dsh-cxp-tree-dir"
        data-is-dir
        style={{ paddingLeft: depth * 22 + 6 }}
        onClick={() => { setExpanded(prev => !prev) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setExpanded(prev => !prev)
          }
        }}
        onContextMenu={(event) => { openRowMenu(event, path, false) }}
      >
        <span className="dsh-cxp-tree-icon">{expanded ? <IconFolderOpen16 size={14} /> : <IconFolderClose16 size={14} />}</span>
        <span className="dsh-cxp-tree-name">{name}</span>
        {rowAction(path)}
      </div>
      {expanded && (
        <div>
          {loading && <div className="dsh-cxp-tree-note" style={{ paddingLeft: (depth + 1) * 22 + 6 }}>加载中…</div>}
          {loadError !== null && <div className="dsh-cxp-tree-note dsh-cxp-tab-error" style={{ paddingLeft: (depth + 1) * 22 + 6 }}>{loadError}</div>}
          {listing !== null && listing.entries.map(entry =>
            entry.isDir
              ? (
                <DirNode
                  key={entry.path}
                  api={api}
                  cwd={cwd}
                  path={entry.path}
                  name={entry.name}
                  depth={depth + 1}
                  defaultOpen={false}
                  onOpenFile={onOpenFile}
                  onOpenDir={onOpenDir}
                  rowAction={rowAction}
                  openRowMenu={openRowMenu}
                />
              )
              : (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  depth={depth + 1}
                  onOpenFile={onOpenFile}
                  rowAction={rowAction}
                  openRowMenu={openRowMenu}
                />
              ),
          )}
        </div>
      )}
    </div>
  )
}

/** A file row: opens the inline preview on click. */
function FileRow(props: {
  entry: ProjectEntry
  depth: number
  onOpenFile: (path: string) => void
  rowAction: (path: string) => ReactNode
  openRowMenu: (event: MouseEvent, path: string, isFile: boolean) => void
}): ReactNode {
  const { entry, depth, onOpenFile, rowAction, openRowMenu } = props
  return (
    <div
      role="button"
      tabIndex={0}
      className="dsh-cxp-tree-row dsh-cxp-tree-file"
      data-is-file
      style={{ paddingLeft: depth * 22 + 6 }}
      title={entry.broken ? `${entry.path}（符号链接已失效）` : entry.path}
      onClick={() => { onOpenFile(entry.path) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenFile(entry.path)
        }
      }}
      onContextMenu={(event) => { openRowMenu(event, entry.path, true) }}
    >
      <span className="dsh-cxp-tree-icon"><IconCodeOutline16 size={14} /></span>
      <span className="dsh-cxp-tree-name">{entry.name}</span>
      {entry.isSymlink && <IconLinkOutline16 size={12} className="dsh-cxp-tree-symlink" />}
      {rowAction(entry.path)}
    </div>
  )
}