import { describe, expect, it } from 'vitest'
import {
  applyServerEdit,
  mergeSecretPatch,
  mcpServerInputSchema,
  patchRowToView,
  toOfficialConfig,
} from '../src/mcp/model.ts'
import type { PatchRow } from '../src/patch-editor.ts'

function stdioRow(config: Record<string, unknown>, disabled = false): PatchRow {
  return { id: `mcp-panel-${config.serverName}`, name: '@deepseek-ai/dsh-mcp-client', ...(disabled ? { disabled: true } : {}), config }
}

describe('配置模型·密钥脱敏', () => {
  it('mergeSecretPatch：null 删 key、字符串覆盖、缺省保留旧值', () => {
    const previous = { TOKEN: 'old', GONE: 'x', KEEP: 'y' }
    const merged = mergeSecretPatch(previous, { TOKEN: 'new', GONE: null })
    expect(merged).toEqual({ TOKEN: 'new', KEEP: 'y' })
    expect(mergeSecretPatch(undefined, { A: 'a' })).toEqual({ A: 'a' })
    expect(mergeSecretPatch(previous, undefined)).toEqual(previous)
  })

  it('patchRowToView 只回 key 不回值；启停取自 disabled 标志', () => {
    const view = patchRowToView(
      stdioRow({
        serverName: 'files',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'super-secret' },
        cwd: '',
      }),
    )
    expect(view).toBeDefined()
    expect(view?.envKeys).toEqual(['API_KEY'])
    expect(JSON.stringify(view)).not.toContain('super-secret')
    expect(view?.enabled).toBe(true)
    expect(view?.command).toBe('node')
    expect(view?.args).toEqual(['server.js'])
  })

  it('applyServerEdit：编辑输入缺省的 key 保留旧值，null 显式删除', () => {
    const previous = stdioRow({
      serverName: 'files',
      transport: 'stdio',
      command: 'node',
      args: [],
      env: { API_KEY: 'super-secret', OLD: 'v' },
      cwd: '',
    })
    const next = applyServerEdit(
      previous,
      mcpServerInputSchema.parse({
        serverName: 'files',
        transport: 'stdio',
        command: 'npx',
        args: ['new'],
        env: { API_KEY: 'rotated', OLD: null },
        cwd: '',
      }),
    )
    expect((next.config as Record<string, unknown>).env).toEqual({ API_KEY: 'rotated' })
  })
})

describe('配置模型·schema 与官方形状', () => {
  it('serverName 拒绝非法字符与超长', () => {
    expect(mcpServerInputSchema.safeParse({ transport: 'stdio', serverName: 'bad name!', command: 'x' }).success).toBe(false)
    expect(mcpServerInputSchema.safeParse({ transport: 'stdio', serverName: 'a'.repeat(33), command: 'x' }).success).toBe(false)
    expect(mcpServerInputSchema.safeParse({ transport: 'stdio', serverName: 'ok-Name_1', command: 'x' }).success).toBe(true)
  })

  it('toOfficialConfig 产出官方 dsh-mcp-client 接受的形状（含默认值）', () => {
    const input = mcpServerInputSchema.parse({ transport: 'streamable-http', serverName: 'web', url: 'https://mcp.example.com/mcp' })
    const official = toOfficialConfig(input)
    expect(official).toMatchObject({
      serverName: 'web',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: {},
      toolCallTimeoutMs: 60000,
      failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
    })
  })
})
