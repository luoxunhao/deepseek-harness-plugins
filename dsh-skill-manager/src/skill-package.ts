/**
 * Skill package (zip) validation and import.
 *
 * A "skill package" is a zip file whose entries form a skill directory:
 * the zip root is either the skill directory itself (SKILL.md at root) or a
 * single top-level directory that contains the skill directory. All entries
 * after stripping the directory shell are extracted into the target root
 * under `<name>/`, where `name` comes from the SKILL.md frontmatter.
 *
 * Security: zip-slip (../), absolute paths, drive letters, symlinks/hardlinks
 * are all rejected. Size and entry-count limits guard against resource abuse.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import yauzl from 'yauzl'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { parseFrontmatterScalars } from './frontmatter.ts'

/** Limits for imported skill packages. */
const MAX_TOTAL_SIZE = 10 * 1024 * 1024   // 10 MB uncompressed
const MAX_ENTRY_COUNT = 200
const MAX_SINGLE_FILE = 5 * 1024 * 1024    // 5 MB

export interface SkillPackageEntry {
  readonly name: string
  readonly size: number
}

export interface SkillPackageValidationOk {
  readonly ok: true
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly entries: readonly SkillPackageEntry[]
}

export interface SkillPackageValidationFail {
  readonly ok: false
  readonly errors: readonly string[]
}

export type SkillPackageValidationResult = SkillPackageValidationOk | SkillPackageValidationFail

export interface SkillPackageImportOk {
  readonly ok: true
  readonly name: string
  readonly path: string
}

export interface SkillPackageImportFail {
  readonly ok: false
  readonly errors: readonly string[]
}

export type SkillPackageImportResult = SkillPackageImportOk | SkillPackageImportFail

/** Open a zip buffer and return all non-directory entries. */
function openZip(buf: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zipfile) => {
      if (err !== null) reject(err)
      else resolve(zipfile)
    })
  })
}

/** Read all entries from an opened zip file. */
function readAllEntries(zipfile: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = []
    zipfile.on('entry', (entry) => {
      entries.push(entry)
      zipfile.readEntry()
    })
    zipfile.on('end', () => resolve(entries))
    zipfile.on('error', reject)
    zipfile.readEntry()
  })
}

/** Read an entry's content as a Buffer. */
function readEntryContent(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err !== null) return reject(err)
      const chunks: Buffer[] = []
      stream!.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream!.on('end', () => resolve(Buffer.concat(chunks)))
      stream!.on('error', reject)
    })
  })
}

/** Reject unsafe entry names: zip-slip, absolute paths, drive letters. */
function hasUnsafePath(name: string): boolean {
  if (/^[/\\]/.test(name)) return true
  if (/^[A-Za-z]:/.test(name)) return true
  const parts = name.split(/[/\\]/)
  return parts.some((p) => p === '..' || p === '')
}

/**
 * Detect a single top-level directory shell. If ALL non-directory entries
 * contain a subdirectory separator and share the same first path component,
 * strip it.
 */
function stripDirectoryShell(fileNames: string[]): string[] {
  if (fileNames.length === 0) return fileNames
  // Only strip if ALL entries contain a / or \ (they're in subdirectories)
  const hasSubdir = fileNames.every((n) => n.includes('/') || n.includes('\\'))
  if (!hasSubdir) return fileNames
  const firstComponents = fileNames.map((n) => n.split(/[/\\]/)[0])
  const unique = [...new Set(firstComponents)]
  if (unique.length === 1) {
    const prefix = unique[0]!
    return fileNames.map((n) => {
      const rest = n.slice(prefix.length)
      return rest.startsWith('/') || rest.startsWith('\\') ? rest.slice(1) : rest
    })
  }
  return fileNames
}

/** Validate a zip buffer as a skill package. */
export async function validateSkillPackage(zipBuf: Buffer): Promise<SkillPackageValidationResult> {
  const errors: string[] = []
  let zipfile: yauzl.ZipFile
  try {
    zipfile = await openZip(zipBuf)
  } catch {
    return { ok: false, errors: ['invalid zip file'] }
  }

  let rawEntries: yauzl.Entry[]
  try {
    rawEntries = await readAllEntries(zipfile)
  } catch {
    return { ok: false, errors: ['invalid zip file'] }
  }
  const fileEntries = rawEntries.filter((e) => !e.fileName.endsWith('/'))

  // Entry count limit
  if (fileEntries.length > MAX_ENTRY_COUNT) {
    errors.push(`too many entries: ${fileEntries.length} (max ${MAX_ENTRY_COUNT})`)
  }

  // Size checks
  let totalSize = 0
  for (const entry of fileEntries) {
    totalSize += entry.uncompressedSize
    if (entry.uncompressedSize > MAX_SINGLE_FILE) {
      errors.push(`file too large: ${entry.fileName} (${entry.uncompressedSize} bytes, max ${MAX_SINGLE_FILE})`)
    }
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    errors.push(`total size too large: ${totalSize} bytes (max ${MAX_TOTAL_SIZE})`)
  }

  // Security: reject unsafe paths
  for (const entry of fileEntries) {
    if (hasUnsafePath(entry.fileName)) {
      errors.push(`unsafe path: ${entry.fileName}`)
    }
  }

  // Reject symlinks/hardlinks
  for (const entry of rawEntries) {
    if (entry.fileName.endsWith('/')) continue
    const unixMode = (entry.externalFileAttributes >> 16) & 0xFFFF
    if ((unixMode & 0xF000) === 0xA000) {
      errors.push(`symlink not allowed: ${entry.fileName}`)
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  // Strip directory shell
  const shellStripped = stripDirectoryShell(fileEntries.map((e) => e.fileName))

  // Find SKILL.md
  const skillMdIndex = shellStripped.findIndex((n) => n === 'SKILL.md')
  if (skillMdIndex === -1) {
    return { ok: false, errors: ['missing SKILL.md'] }
  }

  // Read SKILL.md
  const skillMdEntry = fileEntries[skillMdIndex]!
  const content = await readEntryContent(zipfile, skillMdEntry)
  const text = content.toString('utf8')

  // Parse frontmatter
  const data = parseFrontmatterScalars(text)
  if (data === undefined) {
    return { ok: false, errors: ['SKILL.md has no frontmatter block'] }
  }

  const name = data.name
  if (typeof name !== 'string' || !isSkillName(name)) {
    return { ok: false, errors: [`invalid skill name: ${String(name)}`] }
  }

  const description = data.description
  if (typeof description !== 'string' || description.trim().length === 0) {
    return { ok: false, errors: ['missing or empty description'] }
  }

  // Build entries list (all files, including SKILL.md)
  const entries: SkillPackageEntry[] = fileEntries.map((e, i) => ({
    name: shellStripped[i]!,
    size: e.uncompressedSize,
  }))

  return {
    ok: true,
    name,
    description,
    whenToUse: typeof data.whenToUse === 'string' ? data.whenToUse : undefined,
    entries,
  }
}

/** Write content to a file atomically (temp + rename). */
async function atomicWrite(targetPath: string, content: Buffer): Promise<void> {
  const dir = dirname(targetPath)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.import-${process.pid}-${randomBytes(4).toString('hex')}.tmp`)
  await writeFile(tmp, content)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rename(tmp, targetPath)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw err
      if (attempt === 2) {
        await writeFile(targetPath, content)
        return
      }
      await new Promise((r) => setTimeout(r, 60))
    }
  }
}

/** Import a validated skill package into a target root directory. */
export async function importSkillPackage(
  zipBuf: Buffer,
  targetRoot: string,
  overwrite?: boolean,
): Promise<SkillPackageImportResult> {
  const validation = await validateSkillPackage(zipBuf)
  if (!validation.ok) return validation

  const name = validation.name
  const skillDir = join(targetRoot, name)

  // Collision check
  if (existsSync(skillDir)) {
    if (overwrite !== true) {
      return { ok: false, errors: [`skill already exists: ${name}`] }
    }
    // Remove existing before overwriting
    const { rmSync } = await import('node:fs')
    rmSync(skillDir, { recursive: true, force: true })
  }

  await mkdir(targetRoot, { recursive: true })

  // Re-open zip and extract (we need the zipfile handle again)
  const zipfile = await openZip(zipBuf)
  const rawEntries = await readAllEntries(zipfile)
  const fileEntries = rawEntries.filter((e) => !e.fileName.endsWith('/'))
  const shellStripped = stripDirectoryShell(fileEntries.map((e) => e.fileName))

  for (let i = 0; i < fileEntries.length; i++) {
    const entry = fileEntries[i]!
    const relativePath = shellStripped[i]!
    const targetPath = join(skillDir, relativePath)
    const content = await readEntryContent(zipfile, entry)
    await atomicWrite(targetPath, content)
  }

  return { ok: true, name, path: skillDir }
}
