/**
 * The 管理工作区 dialog: the plugin's own small popup (rendered into
 * `document.body`, closed by Escape / outside click / the close button) that
 * manages one workspace's shared-directory record.
 *
 * Three faces, decided by where the workspace sits in the records:
 *  - the workspace OWNS a record (`workspaceId` match): show its shared
 *    subdirectory list with 添加/移除;
 *  - the workspace is a shared SUBDIRECTORY of another record (its path is
 *    in that record's roots): show the parent and offer 设为主工作区 — the
 *    parent-variable operation, implemented as a record handover: the
 *    record's anchor becomes this workspace and its root moves to roots[0],
 *    the former main root staying in the record as a subdirectory;
 *  - no record at all: empty state, 添加第一个子目录 creates the record
 *    (`roots = [workspace.path, picked]`).
 * @module dsh-codex-project/client/workspace-dialog
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconCloseOutline16, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import type { SpacesApi, SpaceRecord } from './api.ts'
import type { ClientWorkspaceView, ClientWorkspacesService } from './context.ts'
import { basename, samePath } from './paths.ts'

/** The dialog's injected face. */
export interface WorkspaceDialogProps {
  /** The workspace whose 「…」 menu was clicked. */
  workspace: ClientWorkspaceView
  api: SpacesApi
  workspaces: ClientWorkspacesService
  /** Close the dialog. */
  onClose(): void
}

/**
 * The manage-dialog body.
 * @param props - the workspace, the spaces API, the workspaces service, and the close callback.
 */
export function WorkspaceDialog(props: WorkspaceDialogProps): ReactNode {
  const { workspace, api, workspaces, onClose } = props
  const [records, setRecords] = useState<SpaceRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      setRecords(await api.list())
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  useEffect(() => { void refresh() }, [api])

  // Escape closes the dialog (native listener, like the workspace menus).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  const own = records?.find(record => record.workspaceId === workspace.workspaceId) ?? null
  const parent = records?.find(record =>
    record.workspaceId !== workspace.workspaceId
    && record.roots.some(root => samePath(root, workspace.path))) ?? null
  const parentMain = parent !== null
    ? workspaces.list.getSnapshot().items.find(item => item.workspaceId === parent.workspaceId) ?? null
    : null

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await operation()
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const addSubdirectory = (): Promise<void> => run(async () => {
    const picked = await workspaces.pickDirectory()
    if (picked === null) return
    if (own !== null) {
      if (own.roots.some(root => samePath(root, picked))) return
      await api.update(own.id, { roots: [...own.roots, picked] })
      return
    }
    await api.create({
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      roots: [workspace.path, picked],
    })
  })

  const removeSubdirectory = (root: string): Promise<void> => run(async () => {
    if (own === null) return
    const roots = own.roots.filter(candidate => !samePath(candidate, root))
    if (roots.length === 0) throw new Error('至少保留主工作区根目录')
    await api.update(own.id, { roots })
  })

  /** The parent-variable operation: hand the record's main seat to this workspace. */
  const makeMain = (): Promise<void> => run(async () => {
    if (parent === null) return
    const roots = [workspace.path, ...parent.roots.filter(root => !samePath(root, workspace.path))]
    await api.update(parent.id, { workspaceId: workspace.workspaceId, roots })
  })

  return (
    <div
      className="dsh-cxp-dialog-overlay"
      data-dsh-codex-project-dialog
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dsh-cxp-dialog" role="dialog" aria-label={`管理工作区：${workspace.title}`}>
        <div className="dsh-cxp-dialog-header">
          <span className="dsh-cxp-dialog-title">管理工作区「{workspace.title}」</span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose} title="关闭">
            <IconCloseOutline16 />
          </Button>
        </div>
        <div className="dsh-cxp-dialog-body">
          {error !== null && <div className="dsh-cxp-panel-error">{error}</div>}
          {records === null && <div className="dsh-cxp-dialog-empty">加载中…</div>}

          {records !== null && own !== null && (
            <div>
              <div className="dsh-cxp-dialog-section">共享子目录（该工作区的会话可读写这些目录）</div>
              <div className="dsh-cxp-dialog-row">
                <IconPlusOutline16 />
                <span className="dsh-cxp-root-label">主工作区</span>
                <span className="dsh-cxp-root-path">{own.roots[0]}</span>
              </div>
              {own.roots.slice(1).map(root => (
                <div key={root} className="dsh-cxp-dialog-row">
                  <span className="dsh-cxp-root-label">{basename(root)}</span>
                  <span className="dsh-cxp-root-path">{root}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="dsh-cxp-icon-btn"
                    title="移除共享子目录"
                    disabled={busy}
                    onClick={() => { void removeSubdirectory(root) }}
                  >
                    <IconTrashOutline16 />
                  </button>
                </div>
              ))}
              {own.roots.length === 1 && (
                <div className="dsh-cxp-dialog-empty">还没有共享子目录。</div>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { void addSubdirectory() }}>
                <IconPlusOutline16 /> 添加共享子目录
              </Button>
            </div>
          )}

          {records !== null && own === null && parent !== null && (
            <div>
              <div className="dsh-cxp-dialog-section">此工作区作为共享子目录属于</div>
              <div className="dsh-cxp-dialog-row">
                <span className="dsh-cxp-root-label">{parentMain?.title ?? parent.workspaceId ?? '未命名工作区'}</span>
                <span className="dsh-cxp-root-path">{parent.roots[0]}</span>
              </div>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => { void makeMain() }}>
                设为主工作区
              </Button>
              <div className="dsh-cxp-dialog-hint">设为主后，此工作区接管该共享集合（原主工作区成为共享子目录）。</div>
            </div>
          )}

          {records !== null && own === null && parent === null && (
            <div>
              <div className="dsh-cxp-dialog-empty">该工作区还没有共享子目录。</div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { void addSubdirectory() }}>
                <IconPlusOutline16 /> 添加第一个共享子目录
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
