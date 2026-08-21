/**
 * The mcp-panel settings section: managed MCP server rows (toggle, edit,
 * delete, probe) plus a read-only external-rows list and the patch-file
 * health line. The add/edit dialog covers both transports with an advanced
 * collapsible for timeout/failOnStartupError/reconnect; secret values are
 * write-only in the dialog (blank = keep, explicit ✕ = delete).
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpPanelApi, ProbeResult, ServerInput, ServerView } from './api.ts'
import { t } from './locales.ts'

/** Registration-side business face for the section. */
export interface McpPanelSectionInjected {
  api: McpPanelApi
}

/** Full section component props (runtime + owner + injected face). */
export type McpPanelSectionProps =
  PropsRuntime<'settings.section'>
  & InjectFace<McpPanelSectionInjected>

interface SecretPair {
  key: string
  value: string
  /** 编辑既有行时勾选 = 发 null 删除该 key。 */
  removed?: boolean
  /** 该 key 来自已存行（值未知，脱敏）。 */
  existing?: boolean
}

interface FormState {
  previousServerName?: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command: string
  argsText: string
  cwd: string
  envPairs: SecretPair[]
  url: string
  headerPairs: SecretPair[]
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnectEnabled: boolean
  reconnectInitialDelayMs: number
  reconnectMaxDelayMs: number
  reconnectMaxAttempts: number
}

function emptyForm(): FormState {
  return {
    serverName: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    cwd: '',
    envPairs: [],
    url: '',
    headerPairs: [],
    toolCallTimeoutMs: 60000,
    failOnStartupError: false,
    reconnectEnabled: true,
    reconnectInitialDelayMs: 500,
    reconnectMaxDelayMs: 30000,
    reconnectMaxAttempts: 10,
  }
}

function formFromView(view: ServerView): FormState {
  const base = emptyForm()
  return {
    ...base,
    previousServerName: view.serverName,
    serverName: view.serverName,
    transport: view.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    command: view.command ?? '',
    argsText: (view.args ?? []).join('\n'),
    cwd: view.cwd ?? '',
    envPairs: view.envKeys.map(key => ({ key, value: '', existing: true })),
    url: view.url ?? '',
    headerPairs: view.headerKeys.map(key => ({ key, value: '', existing: true })),
    toolCallTimeoutMs: view.toolCallTimeoutMs,
    failOnStartupError: view.failOnStartupError,
    reconnectEnabled: view.reconnect.enabled,
    reconnectInitialDelayMs: view.reconnect.initialDelayMs,
    reconnectMaxDelayMs: view.reconnect.maxDelayMs,
    reconnectMaxAttempts: view.reconnect.maxAttempts,
  }
}

/** 表单 → wire 输入。existing 且留空的密钥不发（保留旧值）；removed 发 null。 */
function formToInput(form: FormState): ServerInput {
  const pairsToPatch = (pairs: SecretPair[]): Record<string, string | null> | undefined => {
    const patch: Record<string, string | null> = {}
    for (const pair of pairs) {
      const key = pair.key.trim()
      if (key === '') continue
      if (pair.removed === true) patch[key] = null
      else if (pair.value !== '') patch[key] = pair.value
      // existing + 留空 + 未删除 → 不出现 = 保留旧值
    }
    return Object.keys(patch).length === 0 ? undefined : patch
  }
  const common: ServerInput = {
    serverName: form.serverName.trim(),
    transport: form.transport,
    toolCallTimeoutMs: form.toolCallTimeoutMs,
    failOnStartupError: form.failOnStartupError,
    reconnect: {
      enabled: form.reconnectEnabled,
      initialDelayMs: form.reconnectInitialDelayMs,
      maxDelayMs: form.reconnectMaxDelayMs,
      maxAttempts: form.reconnectMaxAttempts,
    },
  }
  if (form.transport === 'stdio') {
    return {
      ...common,
      command: form.command.trim(),
      args: form.argsText.split('\n').map(line => line.trimStart()).filter(line => line !== ''),
      env: pairsToPatch(form.envPairs),
      cwd: form.cwd.trim(),
    }
  }
  return {
    ...common,
    url: form.url.trim(),
    headers: pairsToPatch(form.headerPairs),
  }
}

const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '12px' }
const intro: React.CSSProperties = { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-text-muted, #6b6b76)' }
const rowCard: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  borderRadius: '10px',
  padding: '10px 12px',
}
const rowHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px' }
const nameLine: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }
const badge: React.CSSProperties = {
  fontSize: '11px',
  padding: '1px 7px',
  borderRadius: '999px',
  border: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  color: 'var(--dsw-alias-text-muted, #6b6b76)',
}
const okBadge: React.CSSProperties = { ...badge, color: '#1a7f37', borderColor: '#7cc98f' }
const offBadge: React.CSSProperties = { ...badge, color: '#b15c00', borderColor: '#e5b16a' }
const detail: React.CSSProperties = { margin: '4px 0 0', fontSize: '12px', color: 'var(--dsw-alias-text-muted, #6b6b76)', wordBreak: 'break-all' }
const actions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }
const button: React.CSSProperties = {
  font: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
  borderRadius: '6px',
  padding: '3px 10px',
  border: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  background: 'none',
  color: 'inherit',
}
const primaryButton: React.CSSProperties = { ...button, background: 'var(--dsw-accent, #2563eb)', borderColor: 'var(--dsw-accent, #2563eb)', color: '#fff' }
const dangerButton: React.CSSProperties = { ...button, color: '#c0392b' }
const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}
const dialog: React.CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  border: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  borderRadius: '12px',
  width: '520px',
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: '85vh',
  overflowY: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  color: 'inherit',
}
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: 'var(--dsw-alias-text-muted, #6b6b76)' }
const input: React.CSSProperties = {
  font: 'inherit',
  fontSize: '13px',
  padding: '5px 8px',
  borderRadius: '8px',
  border: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  color: 'inherit',
}
const textarea: React.CSSProperties = { ...input, minHeight: '56px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }
const fieldRow: React.CSSProperties = { display: 'flex', gap: '8px' }
const pairRow: React.CSSProperties = { display: 'flex', gap: '6px', alignItems: 'center' }
const errorText: React.CSSProperties = { color: '#c0392b', fontSize: '13px', margin: 0 }
const okText: React.CSSProperties = { color: '#1a7f37', fontSize: '13px', margin: 0 }

/** 一组密钥键值行（env / headers 共用）。 */
function PairEditor({ pairs, onChange, valuePlaceholder }: {
  pairs: SecretPair[]
  onChange: (next: SecretPair[]) => void
  valuePlaceholder: string
}): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {pairs.map((pair, index) => (
        <div key={`${pair.key}-${index}`} style={pairRow}>
          <input
            style={{ ...input, flex: 2 }}
            value={pair.key}
            placeholder="KEY"
            disabled={pair.existing === true}
            onChange={event => {
              const next = [...pairs]
              next[index] = { ...pair, key: event.target.value }
              onChange(next)
            }}
          />
          <input
            style={{ ...input, flex: 3 }}
            type="password"
            autoComplete="off"
            value={pair.value}
            placeholder={valuePlaceholder}
            onChange={event => {
              const next = [...pairs]
              next[index] = { ...pair, value: event.target.value, removed: false }
              onChange(next)
            }}
          />
          <button
            type="button"
            style={pair.removed === true ? offBadge : button}
            title={t('delete')}
            onClick={() => {
              if (pair.existing === true) {
                // 已存 key：标记删除（发 null），再点一次撤销。
                const next = [...pairs]
                next[index] = { ...pair, removed: pair.removed !== true }
                onChange(next)
              } else {
                onChange(pairs.filter((_, i) => i !== index))
              }
            }}
          >
            {pair.removed === true ? t('disabled') : '✕'}
          </button>
        </div>
      ))}
      <div>
        <button type="button" style={button} onClick={() => onChange([...pairs, { key: '', value: '' }])}>
          {t('addPair')}
        </button>
      </div>
    </div>
  )
}

/** 新增/编辑对话框。 */
function ServerDialog({ api, form, onClose, onSaved }: {
  api: McpPanelApi
  form: FormState
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  const [state, setState] = useState<FormState>(form)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const save = useCallback(() => {
    setBusy(true)
    setError(null)
    api.save(formToInput(state), state.previousServerName)
      .then(() => {
        onSaved()
        onClose()
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      })
  }, [api, state, onSaved, onClose])

  const test = useCallback(() => {
    setBusy(true)
    setProbe(null)
    setError(null)
    api.testByInput(formToInput(state))
      .then((result) => {
        setProbe(result)
        setBusy(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      })
  }, [api, state])

  return (
    <div style={overlay} onClick={onClose}>
      {/* 点击遮罩关闭；点对话框本身不冒泡 */}
      <div style={dialog} onClick={event => event.stopPropagation()}>
        <div style={fieldRow}>
          <label style={{ ...fieldLabel, flex: 1 }}>
            {t('serverName')}
            <input
              style={input}
              value={state.serverName}
              placeholder={t('serverNameHint')}
              disabled={state.previousServerName !== undefined && state.serverName === state.previousServerName ? false : state.previousServerName !== undefined}
              onChange={event => setState({ ...state, serverName: event.target.value })}
            />
          </label>
          <label style={{ ...fieldLabel, flex: 1 }}>
            {t('transport')}
            <select
              style={input}
              value={state.transport}
              onChange={event => setState({ ...state, transport: event.target.value as FormState['transport'] })}
            >
              <option value="stdio">{t('transportStdio')}</option>
              <option value="streamable-http">{t('transportHttp')}</option>
            </select>
          </label>
        </div>

        {state.transport === 'stdio'
          ? (
              <>
                <label style={fieldLabel}>
                  {t('command')}
                  <input style={input} value={state.command} onChange={event => setState({ ...state, command: event.target.value })} />
                </label>
                <label style={fieldLabel}>
                  {t('args')}
                  <textarea style={textarea} value={state.argsText} placeholder={t('argsHint')} onChange={event => setState({ ...state, argsText: event.target.value })} />
                </label>
                <label style={fieldLabel}>
                  {t('env')}
                  <PairEditor pairs={state.envPairs} onChange={envPairs => setState({ ...state, envPairs })} valuePlaceholder={t('pairValuePlaceholder')} />
                </label>
                <label style={fieldLabel}>
                  {t('cwd')}
                  <input style={input} value={state.cwd} onChange={event => setState({ ...state, cwd: event.target.value })} />
                </label>
              </>
            )
          : (
              <>
                <label style={fieldLabel}>
                  {t('url')}
                  <input style={input} value={state.url} placeholder="https://…/mcp" onChange={event => setState({ ...state, url: event.target.value })} />
                </label>
                <label style={fieldLabel}>
                  {t('headers')}
                  <PairEditor pairs={state.headerPairs} onChange={headerPairs => setState({ ...state, headerPairs })} valuePlaceholder={t('pairValuePlaceholder')} />
                </label>
              </>
            )}

        <div>
          <button type="button" style={button} onClick={() => setAdvancedOpen(open => !open)}>
            {advancedOpen ? '▾' : '▸'} {t('advanced')}
          </button>
        </div>
        {advancedOpen
          ? (
              <>
                <label style={fieldLabel}>
                  {t('toolCallTimeoutMs')}
                  <input
                    style={input}
                    type="number"
                    min={1}
                    value={state.toolCallTimeoutMs}
                    onChange={event => setState({ ...state, toolCallTimeoutMs: Number(event.target.value) || 60000 })}
                  />
                </label>
                <label style={{ ...fieldLabel, flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="checkbox"
                    checked={state.failOnStartupError}
                    onChange={event => setState({ ...state, failOnStartupError: event.target.checked })}
                  />
                  {t('failOnStartupError')}
                </label>
                <label style={{ ...fieldLabel, flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="checkbox"
                    checked={state.reconnectEnabled}
                    onChange={event => setState({ ...state, reconnectEnabled: event.target.checked })}
                  />
                  {t('reconnect')}
                </label>
                {state.reconnectEnabled
                  ? (
                      <div style={fieldRow}>
                        <label style={{ ...fieldLabel, flex: 1 }}>
                          {t('reconnectInitial')}
                          <input
                            style={input}
                            type="number"
                            min={1}
                            value={state.reconnectInitialDelayMs}
                            onChange={event => setState({ ...state, reconnectInitialDelayMs: Number(event.target.value) || 500 })}
                          />
                        </label>
                        <label style={{ ...fieldLabel, flex: 1 }}>
                          {t('reconnectMax')}
                          <input
                            style={input}
                            type="number"
                            min={1}
                            value={state.reconnectMaxDelayMs}
                            onChange={event => setState({ ...state, reconnectMaxDelayMs: Number(event.target.value) || 30000 })}
                          />
                        </label>
                        <label style={{ ...fieldLabel, flex: 1 }}>
                          {t('reconnectAttempts')}
                          <input
                            style={input}
                            type="number"
                            min={1}
                            value={state.reconnectMaxAttempts}
                            onChange={event => setState({ ...state, reconnectMaxAttempts: Number(event.target.value) || 10 })}
                          />
                        </label>
                      </div>
                    )
                  : null}
              </>
            )
          : null}

        {error !== null ? <p style={errorText}>{error}</p> : null}
        {probe !== null
          ? (
              probe.ok
                ? <p style={okText}>{t('probeOk', { count: probe.toolNames.length, ms: probe.elapsedMs ?? 0 })}</p>
                : <p style={errorText}>{`${t('probeFailed')}：${probe.error ?? ''}`}</p>
            )
          : null}

        <div style={actions}>
          <button type="button" style={button} disabled={busy} onClick={test}>{busy ? t('testing') : t('test')}</button>
          <button type="button" style={button} onClick={onClose}>{t('cancel')}</button>
          <button type="button" style={primaryButton} disabled={busy} onClick={save}>{busy ? t('saving') : t('save')}</button>
        </div>
      </div>
    </div>
  )
}

/** 单个受管服务器行。 */
function ManagedServerRow({ server, api, onChanged }: {
  server: ServerView
  api: McpPanelApi
  onChanged: () => void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const run = useCallback((action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    action()
      .then(onChanged)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }, [onChanged])

  const detailParts = [
    server.transport === 'stdio'
      ? [server.command, ...(server.args ?? [])].join(' ')
      : server.url,
    server.envKeys.length > 0 ? `env: ${server.envKeys.join(', ')}` : undefined,
    server.headerKeys.length > 0 ? `headers: ${server.headerKeys.join(', ')}` : undefined,
  ].filter((part): part is string => typeof part === 'string' && part !== '')

  return (
    <div style={rowCard}>
      <div style={rowHeader}>
        <span style={{ ...nameLine, opacity: server.enabled ? 1 : 0.55 }}>
          {server.serverName}
        </span>
        <span style={badge}>{server.transport}</span>
        {server.enabled ? <span style={okBadge}>{t('enabled')}</span> : <span style={offBadge}>{t('disabled')}</span>}
        {server.phase !== undefined ? <span style={badge}>{server.phase}</span> : null}
        {server.enabled && server.toolCount > 0 ? <span style={badge}>{t('tools', { count: server.toolCount })}</span> : null}
        <span style={actions}>
          <button type="button" style={button} disabled={busy} onClick={() => run(() => api.testByName(server.serverName))}>
            {t('test')}
          </button>
          <button type="button" style={button} disabled={busy} onClick={() => run(() => api.setEnabled(server.serverName, !server.enabled))}>
            {server.enabled ? t('disabled') : t('enabled')}
          </button>
          <button type="button" style={button} disabled={busy} onClick={() => setConfirming(true)}>{t('edit')}</button>
          {confirming
            ? (
                <>
                  <button
                    type="button"
                    style={dangerButton}
                    disabled={busy}
                    onClick={() => {
                      run(() => api.remove(server.serverName))
                      setConfirming(false)
                    }}
                  >
                    {t('deleteConfirm', { name: server.serverName })}
                  </button>
                  <button type="button" style={button} onClick={() => setConfirming(false)}>{t('cancel')}</button>
                </>
              )
            : (
                <button type="button" style={dangerButton} disabled={busy} onClick={() => setConfirming(true)}>{t('delete')}</button>
              )}
        </span>
      </div>
      {detailParts.map(part => <p key={part} style={detail}>{part}</p>)}
      {error !== null ? <p style={errorText}>{error}</p> : null}
    </div>
  )
}

/**
 * The section body: refresh row, patch health line, managed rows, external
 * read-only rows, and the add/edit dialog.
 */
export function McpSection(props: McpPanelSectionProps): ReactNode {
  const { api } = props
  const [servers, setServers] = useState<ServerView[] | null>(null)
  const [externalServers, setExternalServers] = useState<ServerView[]>([])
  const [patch, setPatch] = useState<{ path: string; ok: boolean; error: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogForm, setDialogForm] = useState<FormState | null>(null)

  const load = useCallback(() => {
    setError(null)
    api.list()
      .then(result => {
        setServers(result.servers)
        setExternalServers(result.externalServers)
        setPatch(result.patch)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div style={section}>
      <div style={rowHeader}>
        <p style={intro}>{t('intro')}</p>
        <span style={actions}>
          <button type="button" style={primaryButton} onClick={() => setDialogForm(emptyForm())}>{t('add')}</button>
          <button type="button" style={button} onClick={load}>{t('refresh')}</button>
        </span>
      </div>

      {patch !== null
        ? (
            <p style={detail}>
              {`${t('patchPath')}: ${patch.path}`}
              {patch.ok ? '' : ` — ${t('patchError')}: ${patch.error ?? ''}`}
            </p>
          )
          : null}
      {error !== null ? <p style={errorText}>{error}</p> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {(servers ?? []).map(server => (
          <ManagedServerRow key={server.entryId ?? server.serverName} server={server} api={api} onChanged={load} />
        ))}
        {servers !== null && servers.length === 0 ? <p style={intro}>{t('empty')}</p> : null}
        {servers === null && error === null ? <p style={intro}>{t('loading')}</p> : null}
      </div>

      {externalServers.length > 0
        ? (
            <>
              <p style={{ ...intro, fontWeight: 600 }}>{t('external')}</p>
              <p style={intro}>{t('externalHint')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {externalServers.map(server => (
                  <div key={server.entryId ?? server.serverName} style={{ ...rowCard, opacity: 0.65 }}>
                    <div style={rowHeader}>
                      <span style={nameLine}>{server.serverName}</span>
                      <span style={badge}>{server.transport}</span>
                      {server.enabled ? <span style={okBadge}>{t('enabled')}</span> : <span style={offBadge}>{t('disabled')}</span>}
                      {server.phase !== undefined ? <span style={badge}>{server.phase}</span> : null}
                    </div>
                    <p style={detail}>
                      {server.transport === 'stdio'
                        ? [server.command, ...(server.args ?? [])].join(' ')
                        : server.url}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )
        : null}

      {dialogForm !== null
        ? (
            <ServerDialog
              api={api}
              form={dialogForm}
              onClose={() => setDialogForm(null)}
              onSaved={load}
            />
          )
        : null}
    </div>
  )
}
