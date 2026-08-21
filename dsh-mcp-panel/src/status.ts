/**
 * dsh-mcp-panel —— MCP 行运行时状态读取（loader entry + 工具计数）。
 *
 * loader 是可选依赖：服务缺席或形状变化时全部降级为「未知」，面板退化为
 * 纯配置视图，绝不因此 5xx。
 */

const FIBER_PHASE: Record<number, string | null> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

export type McpFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

export function fiberPhaseOf(state: number | undefined | null): McpFiberPhase {
  if (typeof state !== 'number') return null
  const phase = FIBER_PHASE[state]
  return phase === undefined ? null : (phase as McpFiberPhase)
}

export function getLoaderEntry(ctx: unknown, id: string): Record<string, unknown> | undefined {
  try {
    const loader = (ctx as Record<string, unknown>).loader as { entries?: () => Iterable<unknown> } | undefined
    if (loader === undefined || typeof loader.entries !== 'function') return undefined
    for (const entry of loader.entries()) {
      const record = entry as Record<string, unknown>
      if (record.id === id) return record
    }
    return undefined
  } catch {
    return undefined
  }
}

export function mcpToolCount(ctx: unknown, serverName: string): number {
  try {
    const tools = (ctx as Record<string, unknown>).tools as { schemas?: () => unknown } | undefined
    if (tools === undefined || typeof tools.schemas !== 'function') return 0
    const prefix = `mcp__${serverName}__`
    const schemas = tools.schemas()
    return Array.isArray(schemas)
      ? schemas.filter(schema => typeof (schema as { name?: unknown })?.name === 'string' && String((schema as { name?: unknown }).name).startsWith(prefix))
          .length
      : 0
  } catch {
    return 0
  }
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * 写入 patch 后轮询 loader，直到 entry 满足 predicate 或超时（默认 3s）。
 * 超时返回 false——文件已写成功，调和失败只影响确认，不算操作失败。
 */
export async function waitForLoaderState(
  ctx: unknown,
  id: string,
  predicate: (entry: Record<string, unknown> | undefined) => boolean,
  timeoutMs = 3000,
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const entry = getLoaderEntry(ctx, id)
    if (predicate(entry)) return true
    await delay(200)
  }
  return false
}
