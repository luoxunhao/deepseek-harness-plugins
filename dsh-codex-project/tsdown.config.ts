/**
 * tsdown build for dsh-codex-project: the host-half lib (lib/index.js, ESM
 * node) plus one browser client bundle (lib/client.js, CJS closure factory
 * registering with the package-name id `dsh-codex-project` — client-modules
 * compose keys on the package name; keep it in sync with package.json
 * `name`).
 *
 * The client bundle replicates the official DSH client-bundle preset:
 * - externals resolve through the loader module table at runtime (react,
 *   cordis, slots — the PLATFORM_MODULES seed list),
 * - everything else is inlined into the bundle,
 * - the purity gate rejects any other @deepseek-ai value import: cross-plugin
 *   collaboration goes through cordis services, never value imports,
 * - the artifact registers itself via window.__ModuleLoader__.load({id,
 *   factory}) with the (require) => exports CJS closure shape.
 *
 * Types ship from lib/types (tsc -p tsconfig.build.json), not from tsdown.
 */
import { builtinModules, createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** A rolldown plugin as tsdown's config accepts it. */
type BuildPlugin = NonNullable<UserConfig['plugins']>

/**
 * Runtime packages the host bundles must NOT inline: their classes and
 * errors must stay the host's module singletons (instanceof identity across
 * the plugin boundary), and the windows-acl package drags in the koffi
 * native loader. Everything else inlines.
 */
function neverBundle(...packages: string[]): UserConfig['deps'] {
  return {
    neverBundle: (id: string) => packages.some((name) => id === name || id.startsWith(`${name}/`)),
  }
}

/** The client-bundle purity gate: only platform modules may be value-imported. */
function purityGatePlugin(): BuildPlugin {
  const nodeBuiltins = new Set([
    ...builtinModules,
    ...builtinModules.map(id => `node:${id}`),
  ])
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (nodeBuiltins.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table`,
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module — cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased)`,
      )
    },
  }
}

/** One client bundle build for the plugin id. */
function clientBundle(): UserConfig {
  return {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      'import.meta.resolve': 'undefined',
    },
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
      },
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGatePlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@luoxunhao/dsh-codex-project", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  }
}

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    // clean stays off: the build script removes lib/ wholesale before tsc.
    clean: false,
  },
  {
    // The confinement runner: a standalone script the seam spawns as
    // `[node, lib/runner.js, <bwrap-style args>]`. The windows-acl package
    // stays external — it is a runtime dependency resolved from the plugin's
    // install (bundling it would drag in the koffi native loader).
    entry: { runner: 'src/runner.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: neverBundle('@deepseek-ai/dsh-sandbox-windows-acl'),
  },
  {
    // The fs provider entry (installed by the bundle patch in place of
    // fs-sandbox). The fs/sandbox packages stay external so FsError and the
    // service classes keep host module identity; space-config inlines.
    entry: { fs: 'src/fs.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: neverBundle('@deepseek-ai/dsh-fs', '@deepseek-ai/dsh-fs-sandbox', '@deepseek-ai/dsh-sandbox'),
  },
  clientBundle(),
] satisfies UserConfig[]
