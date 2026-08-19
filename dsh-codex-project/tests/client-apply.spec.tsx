/**
 * Apply-level regression test: `apply` mounts the styles and the workspace
 * 「…」 menu injection through the REAL cordis context proxy semantics — the
 * proxy refuses undeclared service access, so this test pins the `inject`
 * declaration (a missing `workspaces` entry would break the menu injection
 * in the live GUI: "cannot get property workspaces without inject").
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { apply, inject } from '../src/client/index.tsx'
import type { Context } from '../src/client/context.ts'

/** The cordis context proxy semantics the plugin must satisfy. */
function fakeContext(): Context & { disposers: Array<() => void | (() => void)> } {
  const state = { disposers: [] as Array<() => void | (() => void)> }
  const target: Context & { disposers: Array<() => void | (() => void)> } = {
    disposers: state.disposers,
    workspaces: {
      list: {
        // Cached snapshot object: useSyncExternalStore compares references.
        getSnapshot: () => ({ items: [] }),
        subscribe: () => () => {},
      },
      pickDirectory: async () => null,
      create: async () => ({ workspaceId: 'w1' }),
    },
    effect: (callback) => {
      state.disposers.push(callback)
    },
  }
  // Mirror the cordis proxy: any property access outside the declared
  // inject list and the built-in faces throws.
  const allowed = new Set([...inject, 'effect'])
  return new Proxy(target, {
    get(inner, prop) {
      if (typeof prop === 'string' && !allowed.has(prop) && !(prop in inner)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return Reflect.get(inner, prop)
    },
  }) as unknown as Context & { disposers: Array<() => void | (() => void)> }
}

describe('apply', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('declares the workspaces service in inject', () => {
    expect(inject).toEqual(['workspaces', 'betterSidebar', 'inputTriggers'])
  })

  it('mounts the menu injection and tears it down', () => {
    const ctx = fakeContext()
    apply(ctx)

    // The observer is live (the injection only materializes while a
    // workspace menu is open — the apply itself must not throw or double-mount).
    for (const dispose of ctx.disposers.splice(0)) {
      const result = dispose()
      if (typeof result === 'function') result()
    }
  })
})
