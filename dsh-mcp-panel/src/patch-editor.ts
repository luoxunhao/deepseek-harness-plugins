/**
 * dsh-mcp-panel —— profile cordis.patch.yml 受管块编辑器（纯函数半区）。
 *
 * 面板只读写 begin/end 标记之间的 MCP 行；标记之外的内容逐字节保留。
 * 文件层的原子写见同目录 file.ts（S2）。
 */
import { parseDocument, stringify } from 'yaml'

export const MANAGED_BLOCK_BEGIN = '# >>> dsh-mcp-panel:mcp:begin'
export const MANAGED_BLOCK_END = '# <<< dsh-mcp-panel:mcp:end'
/** 官方 MCP 客户端插件名：受管行与外部行都是它的加载行。 */
export const MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client'
/** 受管行 id 前缀：面板所有权在磁盘上的唯一凭证。 */
export const MANAGED_ROW_ID_PREFIX = 'mcp-panel-'

/** Loader patch 行（宽松形状；受管块只包含 insert 列表）。 */
export interface PatchRow {
  id?: string
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
  [key: string]: unknown
}

/** 校验整份 patch 文本：可解析且顶层是数组。不解出/写回任何值。 */
export function validatePatchText(raw: string): void {
  const doc = parseDocument(raw, { logLevel: 'silent' })
  if (doc.errors.length > 0) {
    throw new Error(`cordis.patch.yml 解析失败：${String(doc.errors[0]?.message ?? doc.errors[0])}`)
  }
  if (!Array.isArray(doc.toJS())) throw new Error('cordis.patch.yml 顶层必须是 YAML 数组')
}

/** 把 YAML 解析出的顶层条目拍平成 patch 行。 */
function flattenPatchRows(entries: unknown): PatchRow[] {
  const rows: PatchRow[] = []
  if (!Array.isArray(entries)) return rows
  const pushRow = (value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    const row = value as Record<string, unknown>
    if (typeof row.id === 'string' || typeof row.name === 'string') {
      const normalized: PatchRow = { ...row }
      if (typeof row.id !== 'string') delete normalized.id
      if (typeof row.name !== 'string') delete normalized.name
      if (typeof row.disabled !== 'boolean') delete normalized.disabled
      if (row.config === null || typeof row.config !== 'object' || Array.isArray(row.config)) delete normalized.config
      rows.push(normalized)
    }
  }
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (Array.isArray(record.insert)) {
      for (const row of record.insert) pushRow(row)
    } else {
      pushRow(record)
    }
  }
  return rows
}

function blockRange(raw: string): { start: number; end: number } | undefined {
  const begin = raw.indexOf(MANAGED_BLOCK_BEGIN)
  const end = raw.indexOf(MANAGED_BLOCK_END)
  if (begin < 0 && end < 0) return undefined
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error('cordis.patch.yml 中 dsh-mcp-panel 受管块标记不完整（begin/end 必须成对）')
  }
  return { start: begin, end }
}

/** 提取 begin/end 标记之间的受管行；无标记返回空数组。 */
export function extractManagedRows(raw: string): PatchRow[] {
  const range = blockRange(raw)
  if (range === undefined) return []
  const blockStart = raw.indexOf('\n', range.start)
  if (blockStart < 0 || blockStart > range.end) throw new Error('cordis.patch.yml 受管块格式损坏')
  const doc = parseDocument(raw.slice(blockStart + 1, range.end), { logLevel: 'silent' })
  if (doc.errors.length > 0) {
    throw new Error(`受管块解析失败：${String(doc.errors[0]?.message ?? doc.errors[0])}`)
  }
  const parsed = doc.toJS()
  if (!Array.isArray(parsed)) throw new Error('受管块内容必须是 YAML 数组')
  return flattenPatchRows(parsed)
}

/** 解析整份 patch 并返回其中所有 MCP 客户端行（不区分是否受管）。 */
export function listMcpPatchRows(raw: string): PatchRow[] {
  const doc = parseDocument(raw, { logLevel: 'silent' })
  if (doc.errors.length > 0) return []
  if (!Array.isArray(doc.toJS())) return []
  return flattenPatchRows(doc.toJS()).filter(row => row.name === MCP_PLUGIN_NAME)
}

/** 生成受管块文本（无行时为空字符串）。 */
export function generateManagedBlock(rows: PatchRow[]): string {
  if (rows.length === 0) return ''
  const body = stringify([{ insert: rows }], { indent: 2, lineWidth: 0 })
  return `${MANAGED_BLOCK_BEGIN}\n${body}${MANAGED_BLOCK_END}\n`
}

/** 文件主 EOL 检测：出现过 \r\n 即按 CRLF 文件对待，块文本随之换行。 */
function eolOf(raw: string): '\r\n' | '\n' {
  return raw.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * 替换受管块；无标记且要写入行时追加到文件末尾。标记之外的所有字节原样保留。
 */
export function replaceManagedBlock(raw: string, rows: PatchRow[]): string {
  const range = blockRange(raw)
  const eol = eolOf(raw)
  const block = generateManagedBlock(rows).replaceAll('\n', eol)

  if (range !== undefined) {
    const lineStart = raw.lastIndexOf('\n', range.start - 1) + 1
    const afterEnd = raw.indexOf('\n', range.end)
    const lineEnd = afterEnd < 0 ? raw.length : afterEnd + 1
    const next = raw.slice(0, lineStart) + block + raw.slice(lineEnd)
    if (block !== '') return next
    // 删除最后一批受管行后，原文件可能只剩注释（或原先就是 `[]` 模板）；
    // 此时必须补回流式空数组，否则 patch 文件不再是合法顶层数组。
    const meaningful = next
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line !== '' && !line.startsWith('#'))
    if (meaningful.length === 0) return `${next.replace(/\s*$/, '')}${eol}[]${eol}`
    return next
  }

  if (block === '') return raw
  // 空 profile 模板是流式空数组 `[]`：直接追加块序列会变成 `[] - insert`，
  // 必须在追加前把 `[]` 替换为受管块序列。
  const lines = raw.split(/\r?\n/)
  const meaningful = lines.map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#'))
  if (meaningful.length === 1 && meaningful[0] === '[]') {
    const index = raw.lastIndexOf('[]')
    return raw.slice(0, index) + block + raw.slice(index + 2)
  }
  const prefix = raw.length === 0 ? '' : raw.endsWith('\n') ? eol : eol + eol
  return raw + prefix + block
}
