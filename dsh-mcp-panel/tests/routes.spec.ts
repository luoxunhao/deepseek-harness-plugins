import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApi } from '../src/index.ts'
import { extractManagedRows } from '../src/patch-editor.ts'
import { probeMcpServer } from '../src/probe.ts'

vi.mock('../src/probe.ts', () => ({
  probeMcpServer: vi.fn(async () => ({ ok: true, toolNames: ['x'] })),
}))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-panel-routes-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const PATCH_RAW = [
  '- insert:',
  '    - id: user-row',
  '      name: some/plugin',
  '# >>> dsh-mcp-panel:mcp:begin',
  '- insert:',
  '    - id: mcp-panel-alpha',
  '      name: "@deepseek-ai/dsh-mcp-client"',
  '      config:',
  '        serverName: alpha',
  '        transport: stdio',
  '        command: node',
  '        args:',
  '          - server.js',
  '        env:',
  '          API_KEY: super-secret',
  '        cwd: ""',
  '    - id: hand-written',
  '      name: "@deepseek-ai/dsh-mcp-client"',
  '      config:',
  '        serverName: beta',
  '        transport: streamable-http',
  '        url: https://mcp.example.com/mcp',
  '# <<< dsh-mcp-panel:mcp:end',
  '',
].join('\n')

/** 假 loader：一条 active 的受管行条目。 */
function fakeCtx(): Context {
  return {
    baseUrl: pathToFileURL(dir).href,
    loader: {
      entries: () => [{ id: 'mcp-panel-alpha', fiber: { state: 2 }, disabled: false }],
    },
    tools: {
      schemas: () => [{ name: 'mcp__alpha__read_file' }, { name: 'unrelated_tool' }],
    },
    logger: { info() {}, warn() {}, error() {} },
    get: () => undefined,
    effect: (fn: () => unknown) => {
      const disposer = fn() as (() => void) | undefined
      return () => disposer?.()
    },
  } as unknown as Context
}

function fakeReq(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = { host: '127.0.0.1:3080' },
): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  const iterator = {
    async *[Symbol.asyncIterator]() {
      yield* chunks
    },
  }
  return Object.assign(iterator, { method, url, headers }) as unknown as IncomingMessage
}

function fakeRes(): { res: ServerResponse; status: () => number; text: () => Promise<string> } {
  let statusCode = 0
  const body: Buffer[] = []
  const res = {
    setStatusCode(code: number) {
      statusCode = code
    },
    writeHead(code: number) {
      statusCode = code
      return res
    },
    setHeader() {},
    end(chunk?: Buffer | string) {
      if (chunk !== undefined) body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'))
    },
  } as unknown as ServerResponse
  return {
    res,
    status: () => statusCode,
    text: async () => Buffer.concat(body).toString('utf8'),
  }
}

describe('路由层·GET servers', () => {
  it('列出受管行与外部行：装饰相位与工具数，密钥值从不出现在响应里', async () => {
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_RAW, 'utf8')
    const { res, status, text } = fakeRes()

    await handleApi(fakeCtx(), fakeReq('GET', '/mcp-panel/api/servers'), res)

    expect(status()).toBe(200)
    const json = JSON.parse(await text()) as {
      servers: Array<Record<string, unknown>>
      externalServers: Array<Record<string, unknown>>
      patch: { ok: boolean; error: string | null }
    }
    expect(json.patch.ok).toBe(true)

    expect(json.servers).toHaveLength(1)
    const alpha = json.servers[0] ?? {}
    expect(alpha.serverName).toBe('alpha')
    expect(alpha.managed).toBe(true)
    expect(alpha.enabled).toBe(true)
    expect(alpha.phase).toBe('active')
    expect(alpha.toolCount).toBe(1)
    expect(alpha.envKeys).toEqual(['API_KEY'])

    expect(json.externalServers).toHaveLength(1)
    expect(json.externalServers[0]?.serverName).toBe('beta')
    expect(json.externalServers[0]?.managed).toBe(false)

    // 密钥值永不过 RPC
    expect(await text()).not.toContain('super-secret')
  })

  it('patch 文件缺失：200 + patch.ok=false 带错误信息，不炸整个列表', async () => {
    const { res, status, text } = fakeRes()
    await handleApi(fakeCtx(), fakeReq('GET', '/mcp-panel/api/servers'), res)
    expect(status()).toBe(200)
    const json = JSON.parse(await text()) as { servers: unknown[]; patch: { ok: boolean; error: string | null } }
    expect(json.servers).toEqual([])
    expect(json.patch.ok).toBe(false)
    expect(json.patch.error).toContain('cordis.patch.yml')
  })
})

describe('路由层·PUT 保存', () => {
  const stdioInput = {
    serverName: 'alpha',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { API_KEY: 'rotated' },
    cwd: '',
  }

  it('编辑既有受管行：落盘生效、响应脱敏、调和字段存在', async () => {
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_RAW, 'utf8')
    const { res, status, text } = fakeRes()

    await handleApi(fakeCtx(), fakeReq('PUT', '/mcp-panel/api/servers/alpha', { input: stdioInput }), res)

    expect(status()).toBe(200)
    const json = JSON.parse(await text()) as { server: Record<string, unknown>; reconciled: boolean }
    expect(json.server.serverName).toBe('alpha')
    expect(typeof json.reconciled).toBe('boolean')

    const raw = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    const rows = extractManagedRows(raw)
    expect(rows).toHaveLength(1)
    expect((rows[0]?.config as Record<string, unknown>).env).toEqual({ API_KEY: 'rotated' })
  })

  it('新建：无 previousServerName 时追加新受管行，块外内容保留', async () => {
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_RAW, 'utf8')
    const { res, status } = fakeRes()

    await handleApi(
      fakeCtx(),
      fakeReq('PUT', '/mcp-panel/api/servers/gamma', {
        input: { serverName: 'gamma', transport: 'streamable-http', url: 'https://x.example.com/mcp' },
      }),
      res,
    )

    expect(status()).toBe(200)
    const raw = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    const names = extractManagedRows(raw).map(row => (row.config as Record<string, unknown>).serverName)
    expect(names).toContain('gamma')
    expect(names).toContain('alpha')
    expect(raw).toContain('user-row')
  })

  it('改名：previousServerName 指向旧行，旧行让位新行', async () => {
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_RAW, 'utf8')
    const { res, status } = fakeRes()

    await handleApi(
      fakeCtx(),
      fakeReq('PUT', '/mcp-panel/api/servers/alpha2', {
        input: { ...stdioInput, serverName: 'alpha2' },
        previousServerName: 'alpha',
      }),
      res,
    )

    expect(status()).toBe(200)
    const raw = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    const names = extractManagedRows(raw).map(row => (row.config as Record<string, unknown>).serverName)
    expect(names).toEqual(['alpha2'])
  })

  it('serverName 与外部行撞车：4xx 明确报错，文件不动', async () => {
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_RAW, 'utf8')
    const before = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    const { res, status, text } = fakeRes()

    await handleApi(
      fakeCtx(),
      fakeReq('PUT', '/mcp-panel/api/servers/beta', {
        input: { serverName: 'beta', transport: 'streamable-http', url: 'https://x.example.com/mcp' },
      }),
      res,
    )

    expect(status()).toBe(409)
    expect(JSON.parse(await text())).toHaveProperty('error')
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toBe(before)
  })
})

describe('路由层·启停与删除', () => {
  it('PUT enabled=false：行落盘 disabled 标志，配置保留', async () => {
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_RAW, 'utf8')
    const { res, status } = fakeRes()

    await handleApi(fakeCtx(), fakeReq('PUT', '/mcp-panel/api/servers/alpha/enabled', { enabled: false }), res)

    expect(status()).toBe(200)
    const rows = extractManagedRows(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.disabled).toBe(true)
    expect((rows[0]?.config as Record<string, unknown>).command).toBe('node')
  })

  it('DELETE 受管行：从磁盘消失；外部行不可删（404）', async () => {
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_RAW, 'utf8')
    await handleApi(fakeCtx(), fakeReq('DELETE', '/mcp-panel/api/servers/alpha'), fakeRes().res)
    let rows = extractManagedRows(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'))
    expect(rows).toHaveLength(0)

    const { res, status } = fakeRes()
    await handleApi(fakeCtx(), fakeReq('DELETE', '/mcp-panel/api/servers/beta'), res)
    expect(status()).toBe(404)
  })
})

describe('路由层·探测分发与信任 fence', () => {
  it('POST test 按 serverName 分发到已存行的完整输入（含密钥值）', async () => {
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_RAW, 'utf8')
    vi.mocked(probeMcpServer).mockClear()
    const { res, status } = fakeRes()

    await handleApi(fakeCtx(), fakeReq('POST', '/mcp-panel/api/test', { serverName: 'alpha' }), res)

    expect(status()).toBe(200)
    expect(probeMcpServer).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(probeMcpServer).mock.calls[0]?.[0] as Record<string, unknown>
    // 本机探测用完整输入：密钥值在进程内可用，但依然不过 RPC
    expect(arg.env).toEqual({ API_KEY: 'super-secret' })
  })

  it('非 loopback Host：403 拒绝', async () => {
    const { res, status } = fakeRes()
    await handleApi(fakeCtx(), fakeReq('GET', '/mcp-panel/api/servers', undefined, { host: 'evil.example.com' }), res)
    expect(status()).toBe(403)
  })
})
