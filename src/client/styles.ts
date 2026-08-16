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
/* --- native workspace 「…」 menu injected item ---
   Mirrors ui-primitives Menu.module.css .item (min-h 40 / pad 8x10 /
   r10 / 14/22 / gap 8 / interactive-bg-hover) so 管理工作区 renders
   pixel-identical to the native 重命名 row. */
[data-dsh-codex-project-menu-manage] {
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
[data-dsh-codex-project-menu-manage]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-dsh-codex-project-menu-manage] .dsh-cxp-menu-manage-icon {
  display: inline-flex;
  flex: none;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-codex-project-menu-manage] .dsh-cxp-menu-manage-label {
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
