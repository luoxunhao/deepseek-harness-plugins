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
  /**
   * Open a filesystem path with the Host operating system's default
   * application — the same face the shell's "Show in folder" uses. Pass
   * `<dir>/.` to open a directory itself in the file manager. Rejects when
   * the Host cannot open the path (never leaves the page).
   */
  openPath(path: string): Promise<void>
}

/** The connection-service face (subset): host facts for native-capability gating. */
export interface ClientConnectionHandle {
  /** Whether the current page authority is loopback. */
  readonly isLoopback: boolean
  /** Latest connected-generation Host description (absent before connect). */
  readonly hostDescription: {
    getSnapshot(): { canOpenPath: boolean } | undefined
  }
}

/** The client cordis context for this plugin. */
export interface Context {
  workspaces: ClientWorkspacesService
  /** Present when the client runtime's connection service is mounted. */
  connection?: ClientConnectionHandle
  /** Read an optional service by name (cordis Context face). */
  get<T = unknown>(name: string): T | undefined
  /** Register a fiber teardown callback (cordis Context face). */
  effect(callback: () => void | (() => void), name?: string): void
}
