/**
 * dsh-mcp-panel —— MCP 临时连接探针。
 *
 * 用一次真实连接（握手 + 列工具后立即断开）验证服务器可达。不写 patch、
 * 不注册 DSH 工具；与行是否保存、是否启用无关——未保存的表单输入也可探测。
 * env 合成口径与官方 mcp-client 一致：scrubbed 父环境 + 用户 env。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { mcpServerInputSchema } from './mcp/model.ts'
import type { McpServerInput } from './mcp/model.ts'

export interface ProbeResult {
  ok: boolean
  toolNames: string[]
  error?: string
  elapsedMs?: number
}

const PROBE_TIMEOUT_MS = 15_000

function stringMap(value: Record<string, string | null> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value ?? {})) if (typeof item === 'string') out[key] = item
  return out
}

function createTransport(input: McpServerInput) {
  if (input.transport === 'stdio') {
    return new StdioClientTransport({
      command: input.command,
      args: input.args,
      env: {
        ...scrubbedParentEnv(),
        ...stringMap(input.env),
      },
      cwd: input.cwd === '' ? undefined : input.cwd,
    })
  }
  return new StreamableHTTPClientTransport(new URL(input.url), {
    requestInit: { headers: stringMap(input.headers) },
  })
}

export async function probeMcpServer(raw: unknown, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  let input: McpServerInput
  try {
    input = mcpServerInputSchema.parse(raw)
  } catch (error) {
    return { ok: false, toolNames: [], error: `配置无效：${error instanceof Error ? error.message : String(error)}` }
  }

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const client = new Client({ name: 'dsh-mcp-panel', version: '0.1.0' })
  let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined
  try {
    transport = createTransport(input)
    await raceWithAbort(client.connect(transport), controller.signal)
    const toolNames: string[] = []
    let cursor: string | undefined
    do {
      const page = await raceWithAbort(
        client.listTools(cursor === undefined ? undefined : { cursor }, { signal: controller.signal }),
        controller.signal,
      )
      for (const tool of page.tools) {
        if (typeof tool.name === 'string') toolNames.push(tool.name)
      }
      cursor = page.nextCursor
    } while (cursor !== undefined && cursor !== '')
    return { ok: true, toolNames, elapsedMs: Date.now() - started }
  } catch (error) {
    const reason = controller.signal.aborted
      ? `连接测试超时（${timeoutMs}ms）`
      : error instanceof Error
        ? error.message
        : String(error)
    return { ok: false, toolNames: [], error: reason, elapsedMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
    await Promise.allSettled([client.close().catch(() => {}), transport?.close().catch(() => {})])
  }
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'))
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = () => rejectPromise(new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        rejectPromise(error)
      },
    )
  })
}
