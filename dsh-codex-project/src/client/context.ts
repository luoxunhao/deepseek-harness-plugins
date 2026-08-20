/**
 * Client-half Context for dsh-codex-project. The client runtime's Context
 * is a local face: upstream `declare module 'cordis'` augmentations do not
 * reach it, so the plugin declares the services it uses structurally (see
 * DSH-better-sidebar/src/context-types.ts for the full pattern). Only the
 * slices the plugin touches are restated; drift from upstream is contained
 * to this file.
 */

/** One registered workspace row (subset of the wire WorkspaceView). */
export interface ClientWorkspaceView {
  workspaceId: string
  /** Canonical directory path (host-side realpath canon). */
  path: string
  /** Display title (defaults to the path basename at create). */
  title: string
}

/** The workspace registry snapshot the dialog reads for record identities. */
export interface ClientWorkspaceListState {
  items: readonly ClientWorkspaceView[]
}

/** The workspaces-service face the client bundle consumes (subset of the real surface). */
export interface ClientWorkspacesService {
  /** The workspace registry feed (record main-workspace identities). */
  list: {
    getSnapshot(): ClientWorkspaceListState
    subscribe(fn: () => void): () => void
  }
  /** Open the Host's native directory picker. */
  pickDirectory(): Promise<string | null>
  /**
   * Register an existing path as a core Workspace (idempotent). Returns the
   * wire `WorkspaceView` — its id field is `workspaceId`.
   */
  create(input: { path: string }): Promise<{ workspaceId: string }>
}

/**
 * The better-sidebar service face the project tab consumes — restated
 * structurally like the workspaces slice (upstream augmentations do not reach
 * this bundle). Only `registerTab` is used; the descriptor shape matches the
 * documented TabDescriptor subset better-sidebar expects, so the runtime call
 * stays type-compatible. `ctx.betterSidebar` is OPTIONAL: the tab registers
 * only when better-sidebar is installed.
 */
export interface SidebarTabDescriptor {
  id: string
  title: string | (() => string)
  icon?: unknown
  order?: number
  single?: boolean
  component: (props: SidebarTabComponentProps) => unknown
}

/** The better-sidebar client service face (subset actually consumed). */
export interface BetterSidebarService {
  registerTab(descriptor: SidebarTabDescriptor): () => void
}

/** One session scope: the session id plus its working directory. */
export interface SidebarTabScope {
  sessionId: string
  cwd?: string
}

/**
 * The props better-sidebar passes to a registered tab's `component`. Only the
 * slices the tab touches are restated: the client `ctx` (for the composer
 * draft) and the session `scope`.
 */
export interface SidebarTabComponentProps {
  ctx: ClientRuntimeContext
  scope: SidebarTabScope
}

/**
 * The client runtime context face the tab consumes: the conversation service
 * (`get('conversation')`) plus the session registry — both reached lazily so
 * a missing service degrades to a logged no-op, never a crash.
 */
export interface ClientRuntimeContext {
  get(service: string): unknown
  sessions: { scope(sessionId: string): unknown }
}

/** The composer draft input face (subset of the conversation service). */
export interface DraftInput {
  input: {
    for(sessionScope: unknown): {
      state: { getSnapshot(): { draft: string; draftRev: number } }
      setDraft(text: string): void
    }
  }
}

/**
 * One inline file-reference chip the plugin injects into the composer. The
 * draft holds one placeholder per chip; the owner supplies the user-facing
 * projections at insert time (label = the chip text, clipboardText = the
 * copy/persistence form), and a registered source's codec serializes `ref`
 * into the model context on submit. `source` must name a registered source.
 */
export interface FileReferenceInsert {
  source: string
  ref: string
  label: string
  clipboardText: string
}

/** The zero-width insertion span (current draft end + CAS revision). */
export interface FileReferenceSpan {
  start: number
  end: number
  draftRev: number
}

/** The client input-trigger service face (subset actually consumed). */
export interface ClientInputTriggerService {
  registerSource(source: unknown): () => void
}

/** The client cordis context for this plugin. */
export interface Context {
  workspaces: ClientWorkspacesService
  /** The better-sidebar service, present only when that plugin is installed. */
  betterSidebar?: BetterSidebarService
  /** The input-trigger roster, present only when that plugin is installed. */
  inputTriggers?: ClientInputTriggerService
  /** Register a fiber teardown callback (cordis Context face). */
  effect(callback: () => void | (() => void), name?: string): void
}
