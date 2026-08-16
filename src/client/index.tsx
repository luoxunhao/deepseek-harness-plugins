/**
 * dsh-codex-project client half: injects the 管理工作区 entry into the
 * native workspace 「…」 menu (DOM-level, self-healing) and mounts the
 * manage dialog it opens. Everything rides the native UI — no sidebar shell,
 * no panels: the plugin only adds the menu item and the dialog.
 *
 * The DOM-level injection follows the dsh-web-ui family precedent: the
 * workspace menu popup is React-managed native code with no extension
 * point, so the item is injected per popup-open and self-binds its click.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — an
 * external plugin must not take the GUI down.
 */
import type { ClientConnectionHandle, Context } from './context.ts'
import { createSpacesApi } from './api.ts'
import { mountWorkspaceMenuManageEntry } from './workspace-menu.ts'
import { injectStyles } from './styles.ts'

/** Services required before mounting (provided by the client runtime; the
 * cordis context proxy refuses undeclared service access). */
export const inject = ['workspaces']

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
  const connection = ctx.get<ClientConnectionHandle>('connection') ?? undefined
  mount('workspace … menu entry', () => mountWorkspaceMenuManageEntry({
    workspaces: ctx.workspaces,
    api,
    // Native-open gating mirrors the shell's own "Show in folder": shown
    // only on a loopback page whose Host handshake reports canOpenPath.
    // Absent connection service (tests, minimal hosts) defaults to shown —
    // the action fails safely through openPath's rejection.
    canOpenPath: () => connection === undefined
      || (connection.isLoopback && connection.hostDescription.getSnapshot()?.canOpenPath === true),
  }))
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-codex-project: ui mounts')
}
