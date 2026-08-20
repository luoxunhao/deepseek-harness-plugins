/**
 * The inline code/markdown/html file editor for the 项目文件夹 tab's preview
 * pane: a CodeMirror 6 editor with line wrapping, extension-keyed syntax
 * highlighting, a dirty dot and Ctrl/Cmd+S save (through the plugin's /write
 * route), plus a preview/edit toggle for markdown (MarkdownText from the
 * shared primitives) and html (sandboxed iframe). The parent preview pane
 * fetches the content through /read and passes it in props; this component
 * only edits and saves — it never fetches.
 *
 * CodeMirror and the language packages are plain (non-`@deepseek-ai`)
 * dependencies, so they are inlined into the plugin's client bundle — the
 * purity gate only rejects value-imports of other `@deepseek-ai` runtime
 * symbols.
 * @module dsh-codex-project/client/text-editor
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView as CodeMirrorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { python } from '@codemirror/lang-python'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { php } from '@codemirror/lang-php'
import { xml } from '@codemirror/lang-xml'
import { javascript } from '@codemirror/lang-javascript'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

import type { SpacesApi } from './api.ts'
import { extensionOf } from './viewer.ts'
import { basename } from './paths.ts'

/** The sandbox tokens of the HTML preview iframe (opaque origin, no parent). */
const HTML_IFRAME_SANDBOX = 'allow-scripts allow-popups allow-downloads allow-modals'

type ViewMode = 'preview' | 'edit'

/** The props of the text editor: already-fetched content plus the save API. */
export interface TextEditorProps {
  api: SpacesApi
  cwd: string
  path: string
  content: string
  truncated: boolean
  kind: 'markdown' | 'html' | 'code'
}

/** A CodeMirror 6 language for a file extension (null → plain text). */
function languageForPath(path: string): ReturnType<typeof markdown> | null {
  switch (extensionOf(path)) {
    case 'md': case 'markdown': case 'mdx': return markdown()
    case 'html': case 'htm': return html()
    case 'css': case 'scss': case 'less': return css()
    case 'json': case 'jsonc': return json()
    case 'yaml': case 'yml': return yaml()
    case 'py': return python()
    case 'c': case 'h': case 'cpp': case 'cc': case 'hpp': return cpp()
    case 'go': return go()
    case 'java': return java()
    case 'rs': return rust()
    case 'sql': return sql()
    case 'php': return php()
    case 'xml': case 'svg': return xml()
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'mjs': case 'cjs':
      return javascript({ typescript: /\.(tsx?|mts|cjs)$/i.test(path), jsx: /\.(tsx|jsx)$/i.test(path) })
    default: return null
  }
}

/** A theme that follows the host's dsw tokens (light/dark both work). */
const cmTheme = CodeMirrorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-primary)', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Consolas, monospace)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--dsw-alias-label-primary)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-tertiary)', border: 'none', paddingRight: '6px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-focus-ring, #4d8df0) 22%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--dsw-alias-label-primary)' },
})

/**
 * The code/markdown/html editor. Markdown/html start in preview mode
 * (rendered output); code files start in edit mode. The CodeMirror view is
 * created once per file path and kept alive, so toggling modes never loses an
 * un-saved draft; `content` re-seeds the view only when the file changes.
 *
 * The CodeMirror host is ALWAYS mounted (hidden via CSS in preview mode) so
 * the view-creation effect runs on mount regardless of the initial mode —
 * keying it on `mode` or rendering the host only in edit mode would leave the
 * editor blank until the file changes.
 */
export function TextEditor(props: TextEditorProps): ReactNode {
  const { api, cwd, path, content, truncated, kind } = props
  const [mode, setMode] = useState<ViewMode>(kind === 'code' ? 'edit' : 'preview')
  /** The on-disk text (last saved / as-read); the editor diff-reports against it. */
  const [base, setBase] = useState(content)
  const baseRef = useRef(content)
  const [draft, setDraft] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<CodeMirrorView | null>(null)
  /** The latest read content, so the per-file effect sees current props. */
  const contentRef = useRef(content)
  contentRef.current = content

  const language = useMemo(() => languageForPath(path), [path])

  // Create/recreate the CodeMirror view only when the file changes. Keep it
  // mounted across mode toggles (preview hides it via CSS) to preserve drafts.
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    viewRef.current?.destroy()
    const updateListener = CodeMirrorView.updateListener.of(update => {
      if (!update.docChanged) return
      const next = update.state.doc.toString()
      setDraft(next)
      setDirty(next !== baseRef.current)
    })
    const state = EditorState.create({
      doc: contentRef.current,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle),
        cmTheme,
        updateListener,
        language ?? [],
      ],
    })
    const view = new CodeMirrorView({ state, parent: host })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [path, language])

  const shown = dirty && draft !== null ? draft : base

  const save = async (): Promise<void> => {
    if (!dirty || saveState === 'saving') return
    setSaveState('saving')
    try {
      await api.writeFile(cwd, path, shown)
      setBase(shown)
      baseRef.current = shown
      setDraft(null)
      setDirty(false)
      setSaveState('saved')
    } catch (error) {
      setSaveState('failed')
      console.error('[dsh-codex-project] save failed:', error)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const previewable = kind === 'markdown' || kind === 'html'
  const inEdit = mode === 'edit'

  return (
    <div className="dsh-cxp-preview-editor" data-kind={kind}>
      <div className="dsh-cxp-preview-toolbar">
        <span className="dsh-cxp-preview-filename" title={path}>{basename(path)}</span>
        {dirty && <span className="dsh-cxp-preview-dirty" title="未保存的更改">●</span>}
        <span style={{ flex: 1 }} />
        {previewable && (
          <div className="dsh-cxp-preview-mode-toggle" role="group">
            <button
              type="button"
              className={!inEdit ? 'is-active' : ''}
              onClick={() => { setMode('preview') }}
            >预览</button>
            <button
              type="button"
              className={inEdit ? 'is-active' : ''}
              onClick={() => { setMode('edit') }}
            >编辑</button>
          </div>
        )}
        {inEdit && (
          <button
            type="button"
            className="dsh-cxp-preview-save"
            disabled={!dirty || saveState === 'saving'}
            onClick={() => { void save() }}
          >
            {saveState === 'saving' ? '保存中…' : '保存'}
          </button>
        )}
        {saveState === 'saved' && <span className="dsh-cxp-preview-saved">已保存</span>}
        {saveState === 'failed' && <span className="dsh-cxp-preview-error">保存失败</span>}
      </div>
      {truncated && (
        <div className="dsh-cxp-preview-truncated">文件过大，仅显示前 4 MB（只读部分内容）</div>
      )}
      <div className="dsh-cxp-preview-body">
        {/* The CodeMirror host stays mounted in every mode (hidden via CSS in
            preview) so the editor is created once on mount and never renders
            blank when toggling to edit. */}
        <div
          className="dsh-cxp-preview-cm"
          ref={hostRef}
          data-cm-editor
          hidden={!inEdit}
        />
        {!inEdit && kind === 'markdown' && (
          <div className="dsh-cxp-preview-markdown"><MarkdownText text={shown} /></div>
        )}
        {!inEdit && kind === 'html' && (
          <iframe className="dsh-cxp-preview-html" title={path} sandbox={HTML_IFRAME_SANDBOX} srcDoc={shown} />
        )}
      </div>
    </div>
  )
}