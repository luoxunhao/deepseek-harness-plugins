import { describe, expect, it } from 'vitest'
import { extractManagedRows, replaceManagedBlock, validatePatchText } from '../src/patch-editor.ts'

describe('patch 编辑器·纯函数', () => {
  it('replaceManagedBlock 只动受管块，块外字节逐字保留', () => {
    const raw = [
      '# 用户自己的注释，一个字都不能动',
      '- insert:',
      '    - id: my-plugin',
      '      name: some/other-plugin',
      '# >>> dsh-mcp-panel:mcp:begin',
      '- insert:',
      '    - id: mcp-panel-old',
      '      name: "@deepseek-ai/dsh-mcp-client"',
      '      config:',
      '        serverName: old',
      '# <<< dsh-mcp-panel:mcp:end',
      '',
      '# 尾部注释也要原样保留',
      '',
    ].join('\n')

    const next = replaceManagedBlock(raw, [
      {
        id: 'mcp-panel-alpha',
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'alpha', transport: 'stdio', command: 'node' },
      },
    ])

    // 块外：头部与尾部逐字节一致
    expect(next).toContain('# 用户自己的注释，一个字都不能动')
    expect(next).toContain('    - id: my-plugin')
    expect(next).toContain('      name: some/other-plugin')
    expect(next).toContain('# 尾部注释也要原样保留')
    expect(next.endsWith('# 尾部注释也要原样保留\n'))
    // 块内：旧行没了，新行在
    expect(next).not.toContain('mcp-panel-old')
    expect(next).toContain('mcp-panel-alpha')
    expect(next).toContain('serverName: alpha')
    // 标记仍成对
    expect(next.indexOf('# >>> dsh-mcp-panel:mcp:begin')).toBeLessThan(
      next.indexOf('# <<< dsh-mcp-panel:mcp:end'),
    )
  })

  it('无标记的 [] 模板文件：追加受管块，[] 被替换为块序列', () => {
    const next = replaceManagedBlock('[]\n', [
      { id: 'mcp-panel-a', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a' } },
    ])
    expect(next).not.toContain('[]')
    expect(next.startsWith('# >>> dsh-mcp-panel:mcp:begin\n')).toBe(true)
    expect(() => validatePatchText(next)).not.toThrow()
  })

  it('删除全部受管行后只剩注释的文件补回 []，保持合法顶层数组', () => {
    const withBlock = replaceManagedBlock('[]\n', [
      { id: 'mcp-panel-a', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a' } },
    ])
    const emptied = replaceManagedBlock(withBlock, [])
    expect(() => validatePatchText(emptied)).not.toThrow()
    expect(extractManagedRows(emptied)).toHaveLength(0)
  })

  it('begin/end 标记不成对时明确报错，绝不静默改写', () => {
    const onlyBegin = '# >>> dsh-mcp-panel:mcp:begin\n- insert: []\n'
    expect(() => replaceManagedBlock(onlyBegin, [])).toThrow(/成对/)
    const onlyEnd = '# <<< dsh-mcp-panel:mcp:end\n'
    expect(() => extractManagedRows(onlyEnd)).toThrow(/成对/)
  })

  it('CRLF 文件：块外行（含 \r）逐字节保留', () => {
    const raw = [
      '- insert:',
      '    - id: keep-me',
      '      name: some/plugin',
      '# >>> dsh-mcp-panel:mcp:begin',
      '# <<< dsh-mcp-panel:mcp:end',
    ].join('\r\n')

    const next = replaceManagedBlock(raw, [
      { id: 'mcp-panel-a', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a' } },
    ])
    expect(next).toContain('- id: keep-me\r\n')
    expect(next).toContain('# >>> dsh-mcp-panel:mcp:begin\r\n')
  })

  it('extractManagedRows 读回刚写入的受管行（往返一致）', () => {
    const raw = replaceManagedBlock('[]\n', [
      {
        id: 'mcp-panel-alpha',
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'alpha', transport: 'stdio', command: 'node' },
      },
    ])
    const rows = extractManagedRows(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('mcp-panel-alpha')
    expect((rows[0]?.config as Record<string, unknown>).serverName).toBe('alpha')
  })
})
