/**
 * Standalone build config for the dsh-presets-liangshen plugin.
 *
 * Host-only plugin (no src/client entry), so only the node half is emitted:
 * the preset sync + announcement builds to lib/. This mirrors the
 * dsh-web-ui shared `clientLibraryConfig` defaults (esm, node, es2024) but is
 * self-contained — it does not import the family repo's shared/tsdown.client.ts.
 * The cordis framework and the system-prompt service resolve at runtime from the
 * dsh profile tree, never from this repo's install, so they stay external.
 */
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/** Module id this bundle registers under; must BE the package name. */
const PLUGIN_ID: string = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).name

export default defineConfig({
  name: PLUGIN_ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-system-prompt'],
})