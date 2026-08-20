/**
 * Project-space DOM styles, injected once as a `<style>` tag (data-plugin
 * guarded). Attribute-scoped so nothing leaks into the rest of the GUI;
 * colors ride the dsh `--dsw-*` tokens so the entries follow the active
 * theme (light/dark/skins), mirroring the reference dsh-web-ui panels.
 * @module dsh-codex-project/client/styles
 */

/** The injected style tag's identity (idempotent injection). */
const TAG_ID = 'dsh-codex-project'

const CSS = `
/* --- native workspace 「…」 menu injected rows ---
   Mirrors ui-primitives Menu.module.css .item (min-h 40 / pad 8x10 /
   r10 / 14/22 / gap 8 / interactive-bg-hover) so 打开本地目录 and
   管理工作区 render pixel-identical to the native 重命名 row. */
[data-dsh-codex-project-menu-actions] .dsh-cxp-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  text-align: left;
}
[data-dsh-codex-project-menu-actions] .dsh-cxp-menu-item:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-dsh-codex-project-menu-actions] .dsh-cxp-menu-icon {
  display: inline-flex;
  flex: none;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-codex-project-menu-actions] .dsh-cxp-menu-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- 管理工作区 dialog --- */
[data-dsh-codex-project-dialog] .dsh-cxp-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}
[data-dsh-codex-project-dialog] .dsh-cxp-dialog {
  width: min(440px, calc(100vw - 48px));
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
[data-dsh-codex-project-dialog] .dsh-cxp-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: none;
}
[data-dsh-codex-project-dialog] .dsh-cxp-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-codex-project-dialog] .dsh-cxp-dialog-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[data-dsh-codex-project-dialog] .dsh-cxp-dialog-section {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  margin-bottom: 2px;
}
[data-dsh-codex-project-dialog] .dsh-cxp-dialog-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08));
  min-width: 0;
}
[data-dsh-codex-project-dialog] .dsh-cxp-dialog-empty {
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
  padding: 4px 2px;
}
[data-dsh-codex-project-dialog] .dsh-cxp-dialog-hint {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
  line-height: 1.5;
}
[data-dsh-codex-project-dialog] .dsh-cxp-panel-error {
  font-size: 12.5px;
  color: #e06c6c;
  word-break: break-all;
}
[data-dsh-codex-project-dialog] .dsh-cxp-root-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: none;
}
[data-dsh-codex-project-dialog] .dsh-cxp-root-path {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
[data-dsh-codex-project-dialog] .dsh-cxp-icon-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
[data-dsh-codex-project-dialog] .dsh-cxp-icon-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
  color: var(--dsw-alias-label-primary);
}
[data-dsh-codex-project-dialog] .dsh-cxp-icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* --- 项目文件夹 tab (rendered inside the better-sidebar panel) ---
   Rows mirror better-sidebar's explorer (34px rows, 8px radius, 22px indent,
   hover fill, hover-revealed @-reference button) via the same dsw tokens. */
[data-dsh-codex-project-tab] {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  font-size: var(--dsw-font-s-14, 14px);
  color: var(--dsw-alias-label-primary);
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 8px 0 12px;
  flex: none;
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-title {
  font-size: var(--dsw-font-s-14, 14px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-icon-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-icon-btn:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-primary);
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding-right: 6px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-row.dsh-cxp-tree-missing {
  cursor: default;
  opacity: 0.6;
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-icon {
  flex: none;
  width: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--dsw-font-s-14, 14px);
  color: var(--dsw-alias-label-primary);
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-symlink {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-codex-project-tab] .dsh-cxp-row-ref {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: 4px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 13px;
  opacity: 0;
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-row:hover .dsh-cxp-row-ref,
[data-dsh-codex-project-tab] .dsh-cxp-row-ref:focus-visible {
  opacity: 1;
}
[data-dsh-codex-project-tab] .dsh-cxp-row-ref:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-primary);
}
[data-dsh-codex-project-tab] .dsh-cxp-row-copied {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 24px;
  margin-left: 4px;
  padding: 0 6px;
  font-size: 12px;
  color: var(--dsw-alias-focus-ring, #4d8df0);
  white-space: nowrap;
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-note {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
  padding: 4px 8px;
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-note {
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
  padding: 10px 12px;
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-hint {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
  line-height: 1.5;
  padding: 0 12px;
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-error {
  color: #e06c6c;
  word-break: break-all;
}

/* --- Files-tab-like layout: header path input + main preview + right docked tree --- */
[data-dsh-codex-project-tab] .dsh-cxp-tab-path-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  outline: none;
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-path-input:focus {
  border-color: var(--dsw-alias-focus-ring, #4d8df0);
}
[data-dsh-codex-project-tab] .dsh-cxp-tab-body {
  display: flex;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-resize {
  flex: none;
  width: 5px;
  cursor: col-resize;
  background: transparent;
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-resize:hover {
  background: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-dock {
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--dsw-alias-border-l1);
  overflow: hidden;
}
[data-dsh-codex-project-tab] .dsh-cxp-tree-dock .dsh-cxp-tab-tree {
  padding: 4px 4px 4px 2px;
}

/* --- preview pane --- */
[data-dsh-codex-project-tab] .dsh-cxp-preview-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 24px;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-empty-hint {
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.8;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-open {
  flex: none;
  padding: 3px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  cursor: pointer;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-open:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-primary);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-note {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
  padding: 16px;
  text-align: center;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-error {
  color: #e06c6c;
  word-break: break-all;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-media {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 12px;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-pdf {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-binary {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-binary-icon {
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-binary-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-binary-hint {
  font-size: 11.5px;
  opacity: 0.8;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 5px 12px;
  border-radius: 7px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-download:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.16));
}

/* --- inline text editor (CodeMirror + preview modes) --- */
[data-dsh-codex-project-tab] .dsh-cxp-preview-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-filename {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-dirty {
  flex: none;
  font-size: 9px;
  color: var(--dsw-alias-focus-ring, #4d8df0);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-mode-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1));
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-mode-toggle button {
  padding: 2px 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-mode-toggle button.is-active {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-save {
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: var(--dsw-alias-focus-ring, #4d8df0);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-save:disabled {
  opacity: 0.45;
  cursor: default;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-saved {
  flex: none;
  font-size: 11.5px;
  color: #4fae5a;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-error {
  flex: none;
  font-size: 11.5px;
  color: #e06c6c;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-truncated {
  padding: 4px 10px;
  font-size: 11.5px;
  color: #c98a2b;
  background: color-mix(in srgb, #c98a2b 12%, transparent);
  flex: none;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-cm {
  height: 100%;
  min-height: 100%;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-cm[hidden] {
  display: none;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-cm .cm-editor {
  height: 100%;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-markdown {
  padding: 8px 14px 24px;
  font-size: 13px;
  line-height: 1.6;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-html {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
[data-dsh-codex-project-tab] .dsh-cxp-preview-code {
  margin: 0;
  padding: 10px 14px 24px;
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--dsw-alias-label-primary);
  white-space: pre;
  overflow: auto;
}
`

/** Inject the styles once; a repeated call is a no-op. */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
