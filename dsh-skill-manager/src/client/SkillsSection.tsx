/**
 * The skill-manager settings section: the merged skill catalog as rows, each
 * expandable to read the skill's instruction body, and each offering two
 * independent invocation toggles (model / user) — offered only for skills
 * that are toggleable (a disk file this plugin may edit). Reads and writes
 * ride the injected {@link SkillManagerApi} face; the read-only sources
 * (bundled, runtime) render with a 只读 marker and disabled switches.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ManagedSkill, SkillManagerApi } from './api.ts'
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
  model?: boolean
  user?: boolean
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

/** One rendered catalog row. */
function SkillRow({
  skill,
  api,
}: {
  skill: ManagedSkill
  api: SkillManagerApi
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
    api.getBody(skill.name)
      .then(setBody)
      .catch((error: unknown) => setBodyError(error instanceof Error ? error.message : String(error)))
  }, [expanded, body, api, skill.name])

  const onToggle = useCallback((field: 'modelInvocable' | 'userInvocable', value: boolean) => {
    setPending(prev => ({ ...prev, [field]: value }))
    const patch = field === 'modelInvocable' ? { modelInvocable: value } : { userInvocable: value }
    api.setInvocation(skill.name, patch)
      .then(() => {
        setPending(prev => ({ ...prev, [field]: undefined }))
      })
      .catch(() => {
        setPending(prev => ({ ...prev, [field]: undefined }))
        setBodyError(t('toggleFailed'))
      })
  }, [api, skill.name])

  const modelOn = skill.modelInvocable
  const userOn = skill.userInvocable

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
            checked={modelOn}
            onChange={(e) => onToggle('modelInvocable', e.target.checked)}
          />
          <label style={toggleLabel}>
            <span style={toggleTitle}>{t('modelInvocationTitle')}</span>
            <span style={toggleDesc}>{t('modelInvocationDesc')}</span>
          </label>
          <span style={toggleDesc}>{modelOn ? t('enabled') : t('disabled')}</span>
        </div>
        <div style={toggleRow}>
          <input
            type="checkbox"
            disabled={!skill.toggleable}
            checked={userOn}
            onChange={(e) => onToggle('userInvocable', e.target.checked)}
          />
          <label style={toggleLabel}>
            <span style={toggleTitle}>{t('userInvocationTitle')}</span>
            <span style={toggleDesc}>{t('userInvocationDesc')}</span>
          </label>
          <span style={toggleDesc}>{userOn ? t('enabled') : t('disabled')}</span>
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
 * The section body: catalog header with a manual refresh plus the skill rows.
 */
export function SkillsSection(props: SkillManagerSectionProps): ReactNode {
  const { api } = props
  const [skills, setSkills] = useState<ManagedSkill[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const load = useCallback(() => {
    setError(null)
    setPending(true)
    api.list()
      .then(setSkills)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(false))
  }, [api])

  useEffect(() => { load() }, [load])

  return (
    <section style={card}>
      <div style={refreshRow}>
        <p style={meta}>{t('intro')}</p>
        <button type="button" style={linkButton} onClick={load}>
          {pending ? t('loading') : t('refresh')}
        </button>
      </div>

      {error !== null ? <div style={errorText}>{error}</div> : null}
      {skills === null && error === null
        ? <div style={meta}>{t('loading')}</div>
        : null}
      {skills !== null && skills.length === 0
        ? <div style={meta}>{t('empty')}</div>
        : null}
      {skills === null ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {skills.map(skill => <SkillRow key={skill.name} skill={skill} api={api} />)}
        </div>
      )}
    </section>
  )
}
