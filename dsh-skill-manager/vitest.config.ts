import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
