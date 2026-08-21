import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { probeMcpServer } from '../src/probe.ts'

const FIXTURE = fileURLToPath(new URL('./mcp-server-fixture.mjs', import.meta.url))

describe('探测器', () => {
  it('stdio：真实握手并列出工具后断开', { timeout: 30_000 }, async () => {
    const result = await probeMcpServer({
      serverName: 'fixture',
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    })
    expect(result.ok).toBe(true)
    expect(result.toolNames).toContain('hello')
  })

  it('不存在的命令：ok=false 带错误信息，不抛异常', { timeout: 30_000 }, async () => {
    const result = await probeMcpServer({
      serverName: 'nope',
      transport: 'stdio',
      command: 'definitely-not-a-real-command-xyz',
      args: [],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    })
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('拒绝连接的 HTTP 端点：ok=false', { timeout: 30_000 }, async () => {
    const result = await probeMcpServer({
      serverName: 'dead-http',
      transport: 'streamable-http',
      url: 'http://127.0.0.1:9/mcp',
      headers: {},
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    })
    expect(result.ok).toBe(false)
  })
})
