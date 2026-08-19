/**
 * dsh-skill-manager — client half. Registers the 技能 settings section that
 * browses the merged skill catalog and toggles per-skill invocation policy.
 *
 * The section registers into the native 'settings.section' slot (declared by
 * @deepseek-ai/dsh-client-ui-settings) through the slots runtime, and reads
 * the Host language through the locale service for live zh/en copy.
 */
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'
import { SkillsSection } from './SkillsSection.tsx'
import type { SkillManagerSectionInjected } from './SkillsSection.tsx'
import { createSkillManagerApi } from './api.ts'
import { LOCALE_NS, attachLocale, t, zh, en } from './locales.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale']

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots, locale).
 */
export function apply(ctx: Context): void {
  // Attach the locale service so module-level t() resolves the Host preference
  // (and switches live). Register the dictionaries; disposers run on fiber
  // disposal, so re-activation (HMR) re-registers cleanly.
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'dsh-skill-manager: dictionaries')

  const api = createSkillManagerApi()
  const injected = (): SkillManagerSectionInjected => ({ api })

  // Register the section after the settings shell's section slot is live.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skill-manager',
    order: 100,
    label: () => t('nav'),
    inject: injected,
  }, SkillsSection))
}
