import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractManagedRows } from '../src/patch-editor.ts'
import { writeManagedRows } from '../src/patch-file.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-panel-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('patch 编辑器·文件层', () => {
  it('writeManagedRows 把受管行落盘，读回一致且块外保留', async () => {
    const path = join(dir, 'cordis.patch.yml')
    const original = '- insert:\n    - id: user-row\n      name: some/plugin\n'
    writeFileSync(path, original, 'utf8')

    await writeManagedRows(path, [
      { id: 'mcp-panel-a', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a' } },
    ])

    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('user-row')
    expect(extractManagedRows(raw)).toHaveLength(1)
  })

  it('patch 文件不存在时报带路径的错', async () => {
    const path = join(dir, 'missing', 'cordis.patch.yml')
    await expect(writeManagedRows(path, [])).rejects.toThrow(/cordis\.patch\.yml/)
  })
})

