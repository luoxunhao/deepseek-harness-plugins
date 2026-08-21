/**
 * Minimal zh/en copy for the skill-manager settings section. Copy follows the
 * DSH i18n system: the client apply attaches the locale service through
 * {@link attachLocale}, and `t()` resolves the active locale from it (the
 * Host-backed preference wins over the raw browser language and switches
 * live). Without an attached service (standalone/test compositions) the
 * browser language is used. The dictionaries are also registered into the
 * DSH locale registry under {@link LOCALE_NS}.
 */

/** The zh dictionary (also registered under {@link LOCALE_NS}). */
export const zh = {
  nav: '技能',
  intro: '浏览当前生效的技能目录，并逐个开关技能的调用策略',
  refresh: '刷新',
  loading: '加载中…',
  empty: '没有可用的技能',
  error: '加载失败',
  toggleFailed: '保存失败',
  source: '来源',
  provider: '提供方',
  path: '文件路径',
  readOnly: '只读',
  invocationTitle: '启用',
  invocationDesc: '同时控制模型可调用与用户可调用',
  enabled: '已启用',
  disabled: '已关闭',
  viewBody: '查看正文',
  hideBody: '收起正文',
  bodyLoadFailed: '正文加载失败',
  toggles: '调用策略',
  userTab: '用户级',
  projectTab: '项目级',
  workspace: '工作区',
  selectWorkspace: '选择工作区',
  noWorkspaces: '没有可用的工作区',
  projectEmpty: '当前工作区没有项目级技能',
  import: '导入技能',
  importTitle: '从 zip 文件导入技能包',
  importSuccess: '导入成功',
  importFailed: '导入失败',
  importConflict: '同名技能已存在',
} as const

/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
export const en: Record<keyof typeof zh, string> = {
  nav: 'Skills',
  intro: 'Browse the merged skill catalog and toggle each skill\'s invocation policy',
  refresh: 'Refresh',
  loading: 'Loading…',
  empty: 'No skills available',
  error: 'Failed to load',
  toggleFailed: 'Failed to save',
  source: 'Source',
  provider: 'Provider',
  path: 'File path',
  readOnly: 'Read-only',
  invocationTitle: 'Enable',
  invocationDesc: 'Controls both model-invocable and user-invocable',
  enabled: 'On',
  disabled: 'Off',
  viewBody: 'View body',
  hideBody: 'Hide body',
  bodyLoadFailed: 'Failed to load body',
  toggles: 'Invocation policy',
  userTab: 'User-level',
  projectTab: 'Project-level',
  workspace: 'Workspace',
  selectWorkspace: 'Select workspace',
  noWorkspaces: 'No workspaces available',
  projectEmpty: 'This workspace has no project-level skills',
  import: 'Import skill',
  importTitle: 'Import a skill package from a zip file',
  importSuccess: 'Imported successfully',
  importFailed: 'Import failed',
  importConflict: 'A skill with the same name already exists',
}

/**
 * The dictionary namespace this plugin owns in the DSH locale registry.
 */
export const LOCALE_NS = 'skillManager'

/** The DSH locale service attached by the client apply (absent → browser detection). */
let localeService: { getSnapshot(): { active: string } } | undefined

/**
 * Attach (or detach, with undefined) the DSH locale service. The section
 * re-renders on locale switches because the shell re-renders the settings
 * panel on a ledger bump; the plain `t()` reads the attached service.
 */
export function attachLocale(service: { getSnapshot(): { active: string } } | undefined): void {
  localeService = service
}

/** The active locale id ('zh' | 'en'). */
function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

/** Translate a copy key in the active locale (zh → zh, else en). */
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
