/**
 * The 管理工作区 dialog: the plugin's own small popup (rendered into
 * `document.body`, closed by Escape / outside click / the close button) that
 * manages one workspace's ADDITIONAL writable directories.
 *
 * Face: shows the workspace's own path (read-only) plus its additional-dir
 * list (each removable) and an 添加 button (native directory picker). No
 * main-workspace/handover/subdirectory concepts — the model is simply
 * "workspace → [extra writable dirs]".
 * @module dsh-codex-project/client/workspace-dialog
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconCloseOutline16, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import type { SpacesApi } from './api.ts'
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
 * @param props - the workspace, the dirs API, the workspaces service, and the close callback.
 */
export function WorkspaceDialog(props: WorkspaceDialogProps): ReactNode {
  const { workspace, api, workspaces, onClose } = props
  const [dirs, setDirs] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      setDirs(await api.getDirs(workspace.workspaceId))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  useEffect(() => { void refresh() }, [api, workspace.workspaceId])

  // Escape closes the dialog (native listener, like the workspace menus).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

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

  const addDirectory = (): Promise<void> => run(async () => {
    const picked = await workspaces.pickDirectory()
    if (picked === null) return
    const current = dirs ?? []
    if (current.some(candidate => samePath(candidate, picked))) return
    await api.setDirs(workspace.workspaceId, [...current, picked])
  })

  const removeDirectory = (root: string): Promise<void> => run(async () => {
    const current = dirs ?? []
    await api.setDirs(workspace.workspaceId, current.filter(candidate => !samePath(candidate, root)))
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
          {dirs === null && <div className="dsh-cxp-dialog-empty">加载中…</div>}

          {dirs !== null && (
            <div>
              <div className="dsh-cxp-dialog-section">工作区</div>
              <div className="dsh-cxp-dialog-row">
                <span className="dsh-cxp-root-label">主目录</span>
                <span className="dsh-cxp-root-path">{workspace.path}</span>
              </div>
              <div className="dsh-cxp-dialog-section">附加可写目录（会话可读写这些目录）</div>
              {dirs.map(root => (
                <div key={root} className="dsh-cxp-dialog-row">
                  <span className="dsh-cxp-root-label">{basename(root)}</span>
                  <span className="dsh-cxp-root-path">{root}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="dsh-cxp-icon-btn"
                    title="移除附加目录"
                    disabled={busy}
                    onClick={() => { void removeDirectory(root) }}
                  >
                    <IconTrashOutline16 />
                  </button>
                </div>
              ))}
              {dirs.length === 0 && (
                <div className="dsh-cxp-dialog-empty">还没有附加可写目录。</div>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { void addDirectory() }}>
                <IconPlusOutline16 /> 添加附加目录
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
