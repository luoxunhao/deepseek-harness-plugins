/**
 * The skill-manager settings section: the merged skill catalog as rows, each
 * expandable to read the skill's instruction body, and each offering a single
 * enable toggle that drives model AND user invocation together (offered only
 * for skills that are toggleable — a disk file this plugin may edit). Reads
 * and writes ride the injected {@link SkillManagerApi} face; the read-only
 * sources (bundled, runtime) render with a 只读 marker and a disabled switch.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ManagedSkill, SkillManagerApi, SkillScope, Workspace } from './api.ts'
import { t } from './locales.ts'

/** Registration-side business face for the section. */
export interface SkillManagerSectionInjected {
  api: SkillManagerApi
}

/** Full section component props (runtime + owner + injected face). */
export type SkillManagerSectionProps =
  PropsRuntime<'settings.section'>
  & InjectFace<SkillManagerSectionInjected>

interface PendingToggles {
  enabled?: boolean
}

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}
const rowCard: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  borderRadius: '10px',
  padding: '10px 12px',
}
const rowHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
}
const nameLine: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontWeight: 600,
}
const badge: React.CSSProperties = {
  fontSize: '11px',
  padding: '1px 7px',
  borderRadius: '999px',
  border: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  color: 'var(--dsw-alias-text-muted, #6b6b76)',
}
const readOnlyBadge: React.CSSProperties = {
  ...badge,
  color: '#b15c00',
  borderColor: '#e5b16a',
}
const desc: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: '13px',
  color: 'var(--dsw-alias-text-muted, #6b6b76)',
}
const toggles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  marginTop: '10px',
  borderTop: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  paddingTop: '10px',
}
const toggleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
}
const toggleLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
  flex: 1,
}
const toggleTitle: React.CSSProperties = { fontWeight: 500 }
const toggleDesc: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--dsw-alias-text-muted, #6b6b76)',
}
const meta: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--dsw-alias-text-muted, #6b6b76)',
  wordBreak: 'break-all',
}
const bodyBox: React.CSSProperties = {
  marginTop: '10px',
  padding: '10px',
  fontSize: '13px',
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  background: 'var(--dsw-alias-bg-layer-2, #f5f5f7)',
  borderRadius: '8px',
  maxHeight: '320px',
  overflow: 'auto',
}
const errorText: React.CSSProperties = { color: '#c0392b', fontSize: '13px' }
const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '0',
  color: 'var(--dsw-accent, #2563eb)',
  cursor: 'pointer',
  fontSize: '13px',
}
const refreshRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}
const tabs: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  borderBottom: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  paddingBottom: '6px',
}
const tab: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '4px 10px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--dsw-alias-text-muted, #6b6b76)',
}
const tabActive: React.CSSProperties = {
  ...tab,
  color: 'var(--dsw-accent, #2563eb)',
  background: 'var(--dsw-accent-soft, rgba(37,99,235,0.12))',
  fontWeight: 600,
}
const select: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '8px',
  border: '1px solid var(--dsw-alias-border-base, #e2e2e8)',
  fontSize: '13px',
  background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  color: 'inherit',
}

/** One rendered catalog row. */
function SkillRow({
  skill,
  api,
  scope,
  cwd,
  onChange,
}: {
  skill: ManagedSkill
  api: SkillManagerApi
  scope: SkillScope
  cwd?: string
  onChange: (next: ManagedSkill) => void
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState<string | null>(null)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingToggles>({})

  const toggleBody = useCallback(() => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (body !== null) return
    setBodyError(null)
    api.getBody(skill.name, scope, cwd)
      .then(setBody)
      .catch((error: unknown) => setBodyError(error instanceof Error ? error.message : String(error)))
  }, [expanded, body, api, skill.name, scope, cwd])

  const onToggle = useCallback((enabled: boolean) => {
    setPending({ enabled })
    api.setInvocation(skill.name, { enabled }, scope, cwd)
      .then((next) => {
        setPending({})
        onChange(next)
      })
      .catch(() => {
        setPending({})
        setBodyError(t('toggleFailed'))
      })
  }, [api, skill.name, onChange, scope, cwd])

  // The single master toggle reflects BOTH invocation flags in sync.
  const enabled = skill.modelInvocable && skill.userInvocable

  return (
    <div style={rowCard}>
      <div style={rowHeader}>
        <div>
          <div style={nameLine}>
            <span>{skill.name}</span>
            {skill.toggleable ? null : <span style={readOnlyBadge}>{t('readOnly')}</span>}
            <span style={badge}>{skill.source}</span>
          </div>
          {skill.description !== '' ? <p style={desc}>{skill.description}</p> : null}
        </div>
        <button type="button" style={linkButton} onClick={toggleBody}>
          {expanded ? t('hideBody') : t('viewBody')}
        </button>
      </div>

      <div style={toggles}>
        <div style={toggleRow}>
          <input
            type="checkbox"
            disabled={!skill.toggleable}
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <label style={toggleLabel}>
            <span style={toggleTitle}>{t('invocationTitle')}</span>
            <span style={toggleDesc}>{t('invocationDesc')}</span>
          </label>
          <span style={toggleDesc}>{enabled ? t('enabled') : t('disabled')}</span>
        </div>
      </div>

      {skill.path !== undefined && skill.toggleable
        ? (
          <p style={{ ...meta, margin: '8px 0 0' }}>
            {t('path')}: {skill.path}
          </p>
        )
        : null}

      {expanded
        ? (
          <div style={bodyBox}>
            {bodyError !== null
              ? <div style={errorText}>{bodyError}</div>
              : body ?? t('loading')}
          </div>
        )
        : null}
    </div>
  )
}

/**
 * The section body: a user/project tab switcher, a workspace dropdown for the
 * project tab, a refresh action, and the skill rows for the active scope.
 */
export function SkillsSection(props: SkillManagerSectionProps): ReactNode {
  const { api } = props
  const [scope, setScope] = useState<SkillScope>('user')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null)
  const [skills, setSkills] = useState<ManagedSkill[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const selectedWs = workspaces.find((ws) => ws.id === selectedWsId)

  const load = useCallback((target: SkillScope, ws?: Workspace) => {
    setError(null)
    setPending(true)
    if (target === 'project' && ws === undefined) {
      setSkills([])
      setPending(false)
      return
    }
    const start = Date.now()
    api.list(target, target === 'project' ? ws?.path : undefined)
      .then((list) => {
        setSkills(list)
        // Keep loading indicator visible for at least 300ms so the user sees feedback
        const elapsed = Date.now() - start
        if (elapsed < 300) {
          setTimeout(() => setPending(false), 300 - elapsed)
        } else {
          setPending(false)
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setPending(false)
      })
  }, [api])

  useEffect(() => {
    api.listWorkspaces()
      .then((list) => {
        setWorkspaces(list)
        if (list.length > 0) setSelectedWsId(list[0]!.id)
      })
      .catch(() => setWorkspaces([]))
    load('user')
  }, [api, load])

  const switchScope = useCallback((next: SkillScope) => {
    setScope(next)
    if (next === 'project') {
      load('project', workspaces.find((ws) => ws.id === selectedWsId))
    } else {
      load('user')
    }
  }, [load, workspaces, selectedWsId])

  const onWorkspaceChange = useCallback((id: string) => {
    setSelectedWsId(id)
    load('project', workspaces.find((ws) => ws.id === id))
  }, [load, workspaces])

  const refresh = useCallback(() => {
    if (scope === 'project') {
      load('project', workspaces.find((ws) => ws.id === selectedWsId))
    } else {
      load('user')
    }
  }, [scope, load, workspaces, selectedWsId])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const onImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file === undefined) return
    setImporting(true)
    setImportMsg(null)
    try {
      const buf = await file.arrayBuffer()
      const result = await api.importZip(buf, scope, scope === 'project' ? selectedWs?.path : undefined)
      setImportMsg(`${t('importSuccess')}: ${result.name}`)
      refresh()
    } catch {
      setImportMsg(t('importFailed'))
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [api, scope, selectedWs, refresh])

  return (
    <section style={card}>
      <div style={tabs}>
        <button type="button" style={scope === 'user' ? tabActive : tab} onClick={() => switchScope('user')}>
          {t('userTab')}
        </button>
        <button type="button" style={scope === 'project' ? tabActive : tab} onClick={() => switchScope('project')}>
          {t('projectTab')}
        </button>
      </div>

      {scope === 'project'
        ? (
          <div style={refreshRow}>
            <label style={{ ...meta, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {t('workspace')}
              <select
                style={select}
                value={selectedWsId ?? ''}
                onChange={(e) => onWorkspaceChange(e.target.value)}
              >
                {workspaces.length === 0
                  ? <option value="">{t('noWorkspaces')}</option>
                  : workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>{ws.title} — {ws.path}</option>
                  ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={onImportFile} />
              <button type="button" style={linkButton} disabled={importing} onClick={() => fileInputRef.current?.click()}>
                {importing ? t('loading') : t('import')}
              </button>
              <button type="button" style={linkButton} onClick={refresh}>
                {pending ? t('loading') : t('refresh')}
              </button>
            </div>
          </div>
        )
        : (
          <div style={refreshRow}>
            <p style={meta}>{t('intro')}</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={onImportFile} />
              <button type="button" style={linkButton} disabled={importing} onClick={() => fileInputRef.current?.click()}>
                {importing ? t('loading') : t('import')}
              </button>
              <button type="button" style={linkButton} onClick={refresh}>
                {pending ? t('loading') : t('refresh')}
              </button>
            </div>
          </div>
        )}

      {error !== null ? <div style={errorText}>{error}</div> : null}
      {importMsg !== null ? <div style={{ ...meta, color: importMsg.startsWith(t('importSuccess')) ? '#16a34a' : '#c0392b' }}>{importMsg}</div> : null}
      {skills === null && error === null
        ? <div style={meta}>{t('loading')}</div>
        : null}
      {skills !== null && skills.length === 0 && error === null
        ? <div style={meta}>{scope === 'project' ? t('projectEmpty') : t('empty')}</div>
        : null}
      {skills === null ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {skills.map(skill => (
            <SkillRow
              key={skill.name}
              skill={skill}
              api={api}
              scope={scope}
              cwd={scope === 'project' ? selectedWs?.path : undefined}
              onChange={(next) => setSkills(prev => prev?.map(row => row.name === next.name ? next : row) ?? null)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
