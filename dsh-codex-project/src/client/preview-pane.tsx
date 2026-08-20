/**
 * The 项目文件夹 tab's inline preview pane: given an absolute file path, it
 * fetches and renders the right viewer — image (plain `<img>` over the /file
 * route), PDF (native browser viewer over a Blob URL), binary (download
 * button), or the CodeMirror text editor (markdown/html preview, code edit).
 * Text content is read through /read; a NUL-byte first chunk flips a
 * "text" file to the binary download viewer.
 * @module dsh-codex-project/client/preview-pane
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCodeOutline16, IconDownloadOutline16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import type { SpacesApi } from './api.ts'
import { basename } from './paths.ts'
import { looksBinary, viewerKindForPath, type ViewerKind } from './viewer.ts'
import { TextEditor } from './text-editor.tsx'

/** The props of the preview pane. */
export interface PreviewPaneProps {
  api: SpacesApi
  cwd: string
  path: string
}

/** A native-browser PDF viewer over a Blob URL (mirrors better-sidebar). */
function PdfView(props: { url: string; title: string }): ReactNode {
  const { url, title } = props
  return (
    <div className="dsh-cxp-preview-media">
      <iframe className="dsh-cxp-preview-pdf" title={title} src={url} />
    </div>
  )
}

/**
 * The preview pane body for one open file.
 * @param props - the dirs API, the session cwd, and the file path to preview.
 */
export function PreviewPane(props: PreviewPaneProps): ReactNode {
  const { api, cwd, path } = props
  const kind: ViewerKind = viewerKindForPath(path)
  const [load, setLoad] = useState<
    | { status: 'loading' }
    | { status: 'ready' }
    | { status: 'error'; message: string }
  >({ status: 'loading' })
  /** The fetched text content (markdown/html/code). */
  const [content, setContent] = useState('')
  const [truncated, setTruncated] = useState(false)
  /** Binary override discovered from the first read chunk. */
  const [binary, setBinary] = useState(kind === 'binary')
  /** PDF: the Blob URL once fetched. */
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    setContent('')
    setTruncated(false)
    setBinary(kind === 'binary')
    setPdfUrl(null)
    if (objectUrlRef.current !== null) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null }

    void (async () => {
      try {
        if (kind === 'image') {
          setLoad({ status: 'ready' })
          return
        }
        if (kind === 'pdf') {
          const response = await fetch(api.fileUrl(cwd, path), { signal: controller.signal })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const bytes = await response.arrayBuffer()
          if (cancelled) return
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
          objectUrlRef.current = url
          setPdfUrl(url)
          setLoad({ status: 'ready' })
          return
        }
        const result = await api.readFile(cwd, path)
        if (cancelled) return
        if (looksBinary(result.content)) { setBinary(true); setLoad({ status: 'ready' }); return }
        setContent(result.content)
        setTruncated(result.truncated)
        setLoad({ status: 'ready' })
      } catch (error) {
        if (cancelled) return
        setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [api, cwd, path, kind])

  // Release the PDF blob URL on unmount.
  useEffect(() => () => {
    if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  // Text kinds show the filename in the editor toolbar (next to 预览/编辑);
  // image/PDF/binary have no other title bar, so keep the header for them.
  const isText = kind === 'markdown' || kind === 'html' || kind === 'code'
  const header = (
    <div className="dsh-cxp-preview-header">
      <span className="dsh-cxp-preview-title" title={path}>{basename(path)}</span>
    </div>
  )

  let body: ReactNode
  if (load.status === 'loading') {
    body = <div className="dsh-cxp-preview-note">加载中…</div>
  } else if (load.status === 'error') {
    body = (
      <div className="dsh-cxp-preview-note dsh-cxp-preview-error">
        <IconWarningOutline16 size={14} /> {load.message}
      </div>
    )
  } else if (binary) {
    body = (
      <div className="dsh-cxp-preview-binary">
        <span className="dsh-cxp-preview-binary-icon"><IconCodeOutline16 size={18} /></span>
        <div className="dsh-cxp-preview-binary-name">{basename(path)}</div>
        <div className="dsh-cxp-preview-binary-hint">该文件为二进制，无法在此预览</div>
        <a className="dsh-cxp-preview-download" href={api.downloadUrl(cwd, path)}>
          <IconDownloadOutline16 size={14} /> 下载
        </a>
      </div>
    )
  } else if (kind === 'image') {
    body = (
      <div className="dsh-cxp-preview-media">
        <img className="dsh-cxp-preview-image" src={api.fileUrl(cwd, path)} alt={basename(path)} />
      </div>
    )
  } else if (kind === 'pdf' && pdfUrl !== null) {
    body = <PdfView url={pdfUrl} title={basename(path)} />
  } else {
    const textKind: 'markdown' | 'html' | 'code' = kind === 'markdown' ? 'markdown' : kind === 'html' ? 'html' : 'code'
    body = <TextEditor api={api} cwd={cwd} path={path} content={content} truncated={truncated} kind={textKind} />
  }

  return (
    <div className="dsh-cxp-preview-pane" data-kind={kind}>
      {!isText && header}
      {body}
    </div>
  )
}