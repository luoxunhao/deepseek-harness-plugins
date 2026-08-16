import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    server: {
      deps: {
        // The npm-published ui-primitives lib bundles css side-effect imports
        // (katex styles); inlining routes them through Vite's transform, which
        // stubs css (the default `css: false`).
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/],
      },
    },
  },
  resolve: {
    // Inlining primitives must not fork React: one instance for components,
    // renderers, and the primitives' own hooks.
    dedupe: ['react', 'react-dom'],
  },
})
