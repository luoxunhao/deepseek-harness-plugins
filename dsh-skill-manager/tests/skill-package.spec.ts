import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { crc32 } from 'node:zlib'
import * as yazl from 'yazl'
import { validateSkillPackage, importSkillPackage } from '../src/skill-package.ts'

/** Build a minimal valid zip buffer from an array of { name, content } entries. */
function createTestZip(entries: Array<{ name: string; content: string }>): Buffer {
  return new Promise((resolve) => {
    const zip = new yazl.ZipFile()
    for (const entry of entries) {
      zip.addBuffer(Buffer.from(entry.content, 'utf8'), entry.name, { mode: 0o644 })
    }
    zip.end()
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  }) as unknown as Buffer
}

/**
 * Build a raw zip buffer WITHOUT path validation — for testing zip-slip and
 * absolute-path rejection in the validator. Uses the ZIP format directly:
 * [local file headers] [central directory] [end of central directory].
 */
function createRawZip(entries: Array<{ name: string; content: string }>): Buffer {
  const parts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const dataBuf = Buffer.from(entry.content, 'utf8')
    const crc = crc32(dataBuf) >>> 0

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuf.length)
    localHeader.writeUInt32LE(0x04034b50, 0)  // signature
    localHeader.writeUInt16LE(20, 4)           // version needed
    localHeader.writeUInt16LE(0, 6)            // flags
    localHeader.writeUInt16LE(0, 8)            // compression: stored
    localHeader.writeUInt16LE(0, 10)           // mod time
    localHeader.writeUInt16LE(0, 12)           // mod date
    localHeader.writeUInt32LE(crc, 14)         // crc32
    localHeader.writeUInt32LE(dataBuf.length, 18) // compressed size
    localHeader.writeUInt32LE(dataBuf.length, 22) // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26) // filename length
    localHeader.writeUInt16LE(0, 28)           // extra length
    nameBuf.copy(localHeader, 30)

    parts.push(localHeader, dataBuf)

    // Central directory header
    const centralHeader = Buffer.alloc(46 + nameBuf.length)
    centralHeader.writeUInt32LE(0x02014b50, 0) // signature
    centralHeader.writeUInt16LE(20, 4)          // version made by
    centralHeader.writeUInt16LE(20, 6)          // version needed
    centralHeader.writeUInt16LE(0, 8)           // flags
    centralHeader.writeUInt16LE(0, 10)          // compression
    centralHeader.writeUInt16LE(0, 12)          // mod time
    centralHeader.writeUInt16LE(0, 14)          // mod date
    centralHeader.writeUInt32LE(crc, 16)        // crc32
    centralHeader.writeUInt32LE(dataBuf.length, 20) // compressed size
    centralHeader.writeUInt32LE(dataBuf.length, 24) // uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28) // filename length
    centralHeader.writeUInt16LE(0, 30)          // extra length
    centralHeader.writeUInt16LE(0, 32)          // comment length
    centralHeader.writeUInt16LE(0, 34)          // disk number
    centralHeader.writeUInt16LE(0, 36)          // internal attrs
    centralHeader.writeUInt32LE(0, 38)          // external attrs
    centralHeader.writeUInt32LE(offset, 42)     // local header offset
    nameBuf.copy(centralHeader, 46)

    centralParts.push(centralHeader)
    offset += localHeader.length + dataBuf.length
  }

  const centralDirOffset = offset
  const centralDirSize = centralParts.reduce((s, b) => s + b.length, 0)

  // End of central directory
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)  // signature
  eocd.writeUInt16LE(0, 4)            // disk number
  eocd.writeUInt16LE(0, 6)            // central dir disk
  eocd.writeUInt16LE(entries.length, 8)  // entries on this disk
  eocd.writeUInt16LE(entries.length, 10) // total entries
  eocd.writeUInt32LE(centralDirSize, 12) // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16) // central dir offset
  eocd.writeUInt16LE(0, 20)           // comment length

  return Buffer.concat([...parts, ...centralParts, eocd])
}

function validSkillMd(name = 'my-skill', extra = ''): string {
  return `---\nname: ${name}\ndescription: A test skill\n---\n\n# ${name}\nInstructions here.${extra}\n`
}

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'skm-test-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('validateSkillPackage', () => {
  it('returns ok with the skill name from a valid flat zip (SKILL.md at root)', async () => {
    const zip = await createTestZip([{ name: 'SKILL.md', content: validSkillMd() }])
    const result = await validateSkillPackage(zip)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('my-skill')
      expect(result.description).toBe('A test skill')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]!.name).toBe('SKILL.md')
    }
  })

  it('returns ok from a zip with a single top-level directory shell', async () => {
    const zip = await createTestZip([
      { name: 'my-skill/SKILL.md', content: validSkillMd() },
      { name: 'my-skill/references/notes.md', content: '# Notes\nSome notes.\n' },
    ])
    const result = await validateSkillPackage(zip)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('my-skill')
      expect(result.entries).toHaveLength(2)
    }
  })

  it('returns error when SKILL.md is missing', async () => {
    const zip = await createTestZip([{ name: 'readme.md', content: '# Hello\n' }])
    const result = await validateSkillPackage(zip)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('SKILL.md')]))
    }
  })

  it('returns error when skill name is invalid', async () => {
    const zip = await createTestZip([{ name: 'SKILL.md', content: validSkillMd('Bad_Name') }])
    const result = await validateSkillPackage(zip)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('invalid skill name')]))
    }
  })

  it('returns error when description is missing', async () => {
    const zip = await createTestZip([{ name: 'SKILL.md', content: '---\nname: my-skill\n---\n\nbody\n' }])
    const result = await validateSkillPackage(zip)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('description')]))
    }
  })

  it('rejects zip-slip paths with ..', async () => {
    const zip = createRawZip([{ name: '../evil.md', content: 'bad\n' }])
    const result = await validateSkillPackage(zip)
    expect(result.ok).toBe(false)
  })

  it('rejects absolute paths', async () => {
    const zip = createRawZip([{ name: '/etc/passwd', content: 'bad\n' }])
    const result = await validateSkillPackage(zip)
    expect(result.ok).toBe(false)
  })
})

describe('importSkillPackage', () => {
  it('creates a skill directory from a valid flat zip', async () => {
    const zip = await createTestZip([{ name: 'SKILL.md', content: validSkillMd('import-me') }])
    const result = await importSkillPackage(zip, dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('import-me')
      const { readFileSync } = await import('node:fs')
      const content = readFileSync(join(dir, 'import-me', 'SKILL.md'), 'utf8')
      expect(content).toContain('name: import-me')
      expect(content).toContain('Instructions here.')
    }
  })

  it('creates a skill directory from a zipped directory shell', async () => {
    const zip = await createTestZip([
      { name: 'my-skill/SKILL.md', content: validSkillMd('dir-skill') },
      { name: 'my-skill/references/notes.md', content: '# Notes\n' },
    ])
    const result = await importSkillPackage(zip, dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const { readFileSync, existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'dir-skill', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(dir, 'dir-skill', 'references', 'notes.md'))).toBe(true)
      expect(readFileSync(join(dir, 'dir-skill', 'SKILL.md'), 'utf8')).toContain('name: dir-skill')
    }
  })

  it('rejects a skill that already exists without overwrite', async () => {
    const zip = await createTestZip([{ name: 'SKILL.md', content: validSkillMd('dup-skill') }])
    const r1 = await importSkillPackage(zip, dir)
    expect(r1.ok).toBe(true)
    const r2 = await importSkillPackage(zip, dir)
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.errors).toEqual(expect.arrayContaining([expect.stringContaining('already exists')]))
    }
  })

  it('replaces an existing skill when overwrite is true', async () => {
    const zip1 = await createTestZip([{ name: 'SKILL.md', content: validSkillMd('rep-skill') }])
    const r1 = await importSkillPackage(zip1, dir)
    expect(r1.ok).toBe(true)
    const zip2 = await createTestZip([{ name: 'SKILL.md', content: validSkillMd('rep-skill', '\n\nUpdated body.\n') }])
    const r2 = await importSkillPackage(zip2, dir, true)
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      const { readFileSync } = await import('node:fs')
      expect(readFileSync(join(dir, 'rep-skill', 'SKILL.md'), 'utf8')).toContain('Updated body.')
    }
  })
})
