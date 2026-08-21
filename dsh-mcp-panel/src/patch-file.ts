/**
 * dsh-mcp-panel —— patch 文件层：读、校验、替换受管块、原子写回。
 *
 * v1 无 CLI，写方只有 host 进程一个，因此不设锁文件；并发兜底靠
 * 「读-改-写前整文件校验 + 同目录临时文件 rename 原子替换」。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { replaceManagedBlock, validatePatchText } from './patch-editor.ts'
import type { PatchRow } from './patch-editor.ts'

/** 读取 patch 文件；缺失/读失败统一带路径报错。 */
export async function readPatchFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`无法读取 cordis.patch.yml（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 同目录临时文件 + rename 原子写；Windows 上 rename 覆盖失败时退化为 rm+rename。 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.dsh-mcp-panel-tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
  try {
    await writeFile(temp, content, 'utf8')
    try {
      await rename(temp, path)
    } catch (error) {
      const code = error !== null && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
      if (code === undefined || !['EPERM', 'EEXIST', 'EACCES'].includes(code)) throw error
      await rm(path, { force: true })
      await rename(temp, path)
    }
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

/**
 * 读取 patch 文件、替换受管块、校验、原子写回。
 * 返回写回后的完整文本。
 */
export async function writeManagedRows(path: string, rows: PatchRow[]): Promise<string> {
  const raw = await readPatchFile(path)
  const next = replaceManagedBlock(raw, rows)
  validatePatchText(next)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, next)
  return next
}
