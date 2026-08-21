/**
 * Minimal zh/en copy for the mcp-panel settings section. Same mechanism as
 * dsh-skill-manager: attachLocale + t() resolving the Host language live.
 */

/** The zh dictionary (also registered under {@link LOCALE_NS}). */
export const zh = {
  nav: 'MCP',
  intro: '管理 MCP 服务器连接配置；真正的连接由官方 mcp-client 插件完成',
  refresh: '刷新',
  loading: '加载中…',
  empty: '没有受管的服务器',
  error: '加载失败',
  managed: '受管服务器',
  external: '外部行（只读）',
  externalHint: '受管块之外的 mcp-client 行，本面板不修改；请直接编辑 cordis.patch.yml',
  add: '添加服务器',
  edit: '编辑',
  delete: '删除',
  deleteConfirm: '确定删除服务器「{name}」？配置将从 cordis.patch.yml 移除。',
  test: '测试连接',
  testing: '测试中…',
  probeOk: '连接成功，{count} 个工具（{ms}ms）',
  probeFailed: '连接失败',
  enabled: '已启用',
  disabled: '已停用',
  save: '保存',
  cancel: '取消',
  saving: '保存中…',
  saveFailed: '保存失败',
  opFailed: '操作失败',
  serverName: '服务器名',
  serverNameHint: '1-32 位字母、数字、下划线或连字符',
  transport: '传输方式',
  transportStdio: 'Stdio（本地命令）',
  transportHttp: 'HTTP（streamable-http）',
  command: '命令',
  args: '参数',
  argsHint: '每行一个参数',
  env: '环境变量',
  cwd: '工作目录',
  url: 'URL',
  headers: '请求头',
  pairValuePlaceholder: '值（留空保留旧值）',
  addPair: '添加',
  advanced: '高级',
  toolCallTimeoutMs: '工具调用超时（毫秒）',
  failOnStartupError: '启动失败时中断加载',
  reconnect: '自动重连',
  reconnectInitial: '首次重试延迟（毫秒）',
  reconnectMax: '最大重试间隔（毫秒）',
  reconnectAttempts: '最大尝试次数',
  phase: '状态',
  tools: '{count} 个工具',
  patchPath: '配置文件',
  patchError: 'patch 文件读取失败',
  stdioOnly: 'stdio',
  httpOnly: 'http',
} as const

/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
export const en: Record<keyof typeof zh, string> = {
  nav: 'MCP',
  intro: 'Manage MCP server connection configs; connections are owned by the official mcp-client plugin',
  refresh: 'Refresh',
  loading: 'Loading…',
  empty: 'No managed servers',
  error: 'Failed to load',
  managed: 'Managed servers',
  external: 'External rows (read-only)',
  externalHint: 'mcp-client rows outside the managed block are never modified; edit cordis.patch.yml directly',
  add: 'Add server',
  edit: 'Edit',
  delete: 'Delete',
  deleteConfirm: 'Delete server "{name}"? Its config will be removed from cordis.patch.yml.',
  test: 'Test connection',
  testing: 'Testing…',
  probeOk: 'Connected, {count} tool(s) in {ms}ms',
  probeFailed: 'Connection failed',
  enabled: 'Enabled',
  disabled: 'Disabled',
  save: 'Save',
  cancel: 'Cancel',
  saving: 'Saving…',
  saveFailed: 'Failed to save',
  opFailed: 'Operation failed',
  serverName: 'Server name',
  serverNameHint: '1-32 chars: letters, digits, underscore or hyphen',
  transport: 'Transport',
  transportStdio: 'Stdio (local command)',
  transportHttp: 'HTTP (streamable-http)',
  command: 'Command',
  args: 'Arguments',
  argsHint: 'One argument per line',
  env: 'Environment variables',
  cwd: 'Working directory',
  url: 'URL',
  headers: 'Headers',
  pairValuePlaceholder: 'value (leave blank to keep old)',
  addPair: 'Add',
  advanced: 'Advanced',
  toolCallTimeoutMs: 'Tool call timeout (ms)',
  failOnStartupError: 'Fail activation on startup error',
  reconnect: 'Auto-reconnect',
  reconnectInitial: 'Initial retry delay (ms)',
  reconnectMax: 'Max retry delay (ms)',
  reconnectAttempts: 'Max attempts',
  phase: 'Status',
  tools: '{count} tool(s)',
  patchPath: 'Config file',
  patchError: 'Failed to read patch file',
  stdioOnly: 'stdio',
  httpOnly: 'http',
}

/** The dictionary namespace this plugin owns in the DSH locale registry. */
export const LOCALE_NS = 'mcpPanel'

/** The DSH locale service attached by the client apply (absent → browser detection). */
let localeService: { getSnapshot(): { active: string } } | undefined

/** Attach (or detach, with undefined) the DSH locale service. */
export function attachLocale(service: { getSnapshot(): { active: string } } | undefined): void {
  localeService = service
}

function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

export type CopyKey = keyof typeof zh

/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const dict = activeLocale().toLowerCase().startsWith('zh') ? zh : en
  let text = dict[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}
