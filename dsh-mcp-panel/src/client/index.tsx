/**
 * dsh-mcp-panel — client half. Registers the MCP settings section that
 * manages the managed block of MCP server rows in the profile's
 * cordis.patch.yml (add/edit/toggle/delete/probe), with external mcp-client
 * rows shown read-only.
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
import { McpSection } from './McpSection.tsx'
import type { McpPanelSectionInjected } from './McpSection.tsx'
import { createMcpPanelApi } from './api.ts'
import { LOCALE_NS, attachLocale, t, zh, en } from './locales.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale']

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots, locale).
 */
export function apply(ctx: Context): void {
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => {
      offZh()
      offEn()
    }
  }, 'dsh-mcp-panel: dictionaries')

  const api = createMcpPanelApi()
  const injected = (): McpPanelSectionInjected => ({ api })

  // Register the section after the settings shell's section slot is live.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-panel',
    order: 110,
    label: () => t('nav'),
    inject: injected,
  }, McpSection))
}
