import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, constants } from 'node:zlib'
import { compressZstdFrame } from '../src/zstd.ts'
import { readRawPage } from '../src/raw-page.ts'

const roots: string[] = []
const header = '{"type":"session","version":0,"id":"physical-races","createdAt":1,"delegationDepth":0}\n'
const limits = { headerMaxBytes: 4096, windowLogMax: 25 }
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fileFixture(bytes: Buffer | string) {
  const root = await mkdtemp(join(tmpdir(), 'arx-raw-page-race-')); roots.push(root)
  const path = join(root, 'session')
  await writeFile(path, bytes)
  return open(path, 'r+')
}
function readObserver(file: FileHandle, before: (position: number, length: number) => Promise<void>) {
  const original = file.read.bind(file)
  return vi.spyOn(file, 'read').mockImplementation(async (...args) => {
    const values: readonly unknown[] = args
    await before(Number(values[3]), Number(values[2]))
    return await Reflect.apply(original, file, args) as Awaited<ReturnType<FileHandle['read']>>
  })
}
describe('bounded pages over real changing files and native frames', () => {
  it.each(['frame-header', 'block-header', 'decoder-input'] as const)(
    'does not publish plaintext after actual file truncation at %s', async (stage) => {
      const bytes = await compressZstdFrame(header)
      const file = await fileFixture(bytes)
      let truncated = false
      const observer = readObserver(file, async (position, length) => {
        const matches = stage === 'frame-header' ? position === 5
          : stage === 'block-header' ? position === 6 && length === 3
            : position === 0 && length > 5
        if (!truncated && matches) {
          truncated = true
          await file.truncate(stage === 'frame-header' ? 5 : stage === 'block-header' ? 7 : 0)
        }
      })
      try {
        await expect(readRawPage(file, bytes.length, 'zstd', 0, 400, limits)).rejects.toThrow()
        expect(truncated).toBe(true)
        expect((await file.stat()).size).toBe(stage === 'frame-header' ? 5 : stage === 'block-header' ? 7 : 0)
      } finally { observer.mockRestore(); await file.close() }
    })
  it.each([new Error('native frame cancelled'), 'non-error cancellation reason'])(
    'cancels the active native decoder without publishing a page for reason %s', async (reason) => {
      const bytes = await compressZstdFrame(header)
      const file = await fileFixture(bytes)
      const controller = new AbortController()
      let cancelled = false
      const observer = readObserver(file, (position, length) => {
        if (!cancelled && position === 0 && length > 5) {
          cancelled = true
          controller.abort(reason)
        }
        return Promise.resolve()
      })
      try {
        await expect(readRawPage(file, bytes.length, 'zstd', 0, 400, limits, controller.signal))
          .rejects.toThrow(reason instanceof Error ? reason.message : 'aborted')
        expect(cancelled).toBe(true)
        expect((await file.stat()).size).toBe(bytes.length)
      } finally { observer.mockRestore(); await file.close() }
    })
  it('accepts existing native frames with optional checksum and a non-single-segment recorded content size', async () => {
    const encode = (text: string, checksum: number) => zstdCompressSync(Buffer.from(text),
      { params: { [constants.ZSTD_c_checksumFlag]: checksum, [constants.ZSTD_c_contentSizeFlag]: 1 } })
    const first = encode(header, 0)
    const text = '{"text":"' + 'x'.repeat(300) + '"}\n'
    const encoded = encode(text, 1)
    const descriptor = encoded[4]
    if (descriptor === undefined || (descriptor & 0x20) === 0 || (descriptor >>> 6) !== 1) {
      throw new Error('native fixture did not encode its recorded two-byte content size')
    }
    const middle = Buffer.concat([encoded.subarray(0, 4), Buffer.from([descriptor & ~0x20, 0]),
      encoded.subarray(5)])
    const bytes = Buffer.concat([first, middle])
    const file = await fileFixture(bytes)
    try {
      const result = await readRawPage(file, bytes.length, 'zstd', 0, 400, limits)
      expect(result.content).toBe(header + text)
      expect(result.nextOffset).toBeUndefined()
      expect(result.metrics.decodedBytes).toBe(Buffer.byteLength(header + text))
    } finally { await file.close() }
  })
  it('lets the native decoder reject an advertised content size that differs from the actual frame before a page is published', async () => {
    const encoded = zstdCompressSync(Buffer.from(header),
      { params: { [constants.ZSTD_c_checksumFlag]: 1, [constants.ZSTD_c_contentSizeFlag]: 1 } })
    const descriptor = encoded[4], recorded = encoded[5]
    if (descriptor === undefined || recorded === undefined || (descriptor & 0x20) === 0
      || (descriptor >>> 6) !== 0 || recorded >= 255) throw new Error('native one-byte content-size fixture unavailable')
    encoded[5] = recorded + 1
    const file = await fileFixture(encoded)
    try {
      const reading = readRawPage(file, encoded.length, 'zstd', 0, 400, limits)
      await expect(reading).rejects.toThrow('Data corruption detected')
      await expect(reading).rejects.toMatchObject({ code: 'ZSTD_error_corruption_detected' })
    } finally { await file.close() }
  })
  it('rejects an invalid UTF-8 leading byte and never replaces it with a replacement character', async () => {
    const bytes = Buffer.concat([Buffer.from(header), Buffer.from([97, 98, 99, 255, 10])])
    const file = await fileFixture(bytes)
    try {
      await expect(readRawPage(file, bytes.length, 'none', header.length, 4, limits)).rejects.toThrow()
    } finally { await file.close() }
  })
  it('does not expose a headerless plaintext tail after a real truncate between header and end reads', async () => {
    const bytes = Buffer.from(header + '{"complete":true}\n')
    const file = await fileFixture(bytes)
    let truncated = false
    const observer = readObserver(file, async (position, length) => {
      if (!truncated && position === bytes.length - 1 && length === 1) {
        truncated = true
        await file.truncate(0)
      }
    })
    try {
      const result = await readRawPage(file, bytes.length, 'none', 0, 400, limits)
      expect(truncated).toBe(true)
      expect(result.content).toBe('')
      expect(result.nextOffset).toBeUndefined()
      expect((await file.stat()).size).toBe(0)
    } finally { observer.mockRestore(); await file.close() }
  })
})
