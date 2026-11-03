import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { zstdCompressSync, constants } from 'node:zlib'
import { join } from 'node:path'
import { compressZstdFrame } from '../src/zstd.ts'
import { readRawPage } from '../src/raw-page.ts'
import type { JsonlCompression } from '../src/format.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const limits = { headerMaxBytes: 4096, windowLogMax: 25 }
const header = '{"type":"session","version":0,"id":"range","createdAt":1,"delegationDepth":0}\n'
async function artifact(bytes: Buffer | string, compression: JsonlCompression) {
  const root = await mkdtemp(join(tmpdir(), 'arx-jsonl-range-')); roots.push(root)
  const path = join(root, 'session')
  await writeFile(path, bytes)
  return { path,
    async page(offset = 0, maxBytes = 128 * 1024, signal?: AbortSignal, bounds = limits) {
      const file = await open(path, 'r')
      try { return await readRawPage(file, (await file.stat()).size, compression, offset, maxBytes, bounds, signal) }
      finally { await file.close() }
    },
  }
}

describe('bounded JSONL physical pages', () => {
  it('reads only a bounded prefix from a 10 MiB uncompressed artifact', async () => {
    const body = header + '{"text":"' + 'á🧪'.repeat(Math.ceil(10 * 1024 * 1024 / 6)) + '"}\n'
    const source = Buffer.from(body)
    const fixture = await artifact(source, 'none')
    const page = await fixture.page()
    expect(page.header).toBe(header.trimEnd())
    expect(Buffer.byteLength(page.content)).toBeLessThanOrEqual(128 * 1024)
    expect(page.metrics.readBytes).toBeLessThanOrEqual(132 * 1024 + 1)
    expect(page.metrics.retainedBytes).toBeLessThanOrEqual(128 * 1024 + header.length)
    expect(page.metrics.decodedBytes).toBe(0)
    expect(Buffer.from(page.content)).toEqual(source.subarray(0, Buffer.byteLength(page.content)))
    expect(page.nextOffset).toBe(Buffer.byteLength(page.content))
    expect(page.content).not.toContain('\ufffd')
    const next = await fixture.page(page.nextOffset, 400)
    expect(Buffer.from(next.content)).toEqual(source.subarray(page.nextOffset, page.nextOffset! + Buffer.byteLength(next.content)))
  })
  it('discards a torn final plain record and handles end offsets without recovering or replaying it', async () => {
    const fixture = await artifact(header + '{"complete":true}\n{"torn', 'none')
    const page = await fixture.page(0, 400)
    expect(page.content).toBe(header + '{"complete":true}\n')
    expect(page.nextOffset).toBeUndefined()
    expect((await fixture.page(Buffer.byteLength(page.content), 400)).content).toBe('')
    await expect(fixture.page(Buffer.byteLength(page.content) + 1, 400)).rejects.toThrow('invalid raw artifact offset')
  })
  it('rejects malformed UTF-8, invalid cursor boundaries and bounded header exhaustion', async () => {
    const fixture = await artifact(Buffer.concat([Buffer.from(header), Buffer.from('á🧪\n')]), 'none')
    await expect(fixture.page(header.length + 1, 400)).rejects.toThrow('invalid raw artifact offset')
    const bad = await artifact(Buffer.concat([Buffer.from(header), Buffer.from([0xff, 10])]), 'none')
    await expect(bad.page()).rejects.toThrow()
    const hugeHeader = await artifact('x'.repeat(8192) + '\n', 'none')
    await expect(hugeHeader.page()).rejects.toThrow('header')
    const noHeader = await artifact('unfinished', 'none')
    await expect(noHeader.page()).rejects.toThrow('header')
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) await expect(fixture.page(value)).rejects.toThrow('offset')
    await expect(fixture.page(0, 3)).rejects.toThrow('offset')
    const abort = new AbortController(); abort.abort(new Error('fixture cancelled'))
    await expect(fixture.page(0, 400, abort.signal)).rejects.toThrow('fixture cancelled')
  })
  it('streams a 10 MiB checksummed frame while retaining only the 128 KiB page', async () => {
    const giant = Buffer.from('{"text":"' + 'á🧪'.repeat(Math.ceil(10 * 1024 * 1024 / 6)) + '"}\n')
    const first = await compressZstdFrame(header)
    const frame = await compressZstdFrame(giant)
    const fixture = await artifact(Buffer.concat([first, frame]), 'zstd')
    const page = await fixture.page()
    expect(page.content).not.toContain('\ufffd')
    expect(Buffer.from(page.content)).toEqual(Buffer.concat([Buffer.from(header), giant]).subarray(0, Buffer.byteLength(page.content)))
    expect(page.metrics.decodedBytes).toBe(header.length + giant.length)
    expect(page.metrics.retainedBytes).toBeLessThanOrEqual(128 * 1024 + header.length)
    expect(page.metrics.maxDecodedChunkBytes).toBeLessThanOrEqual(128 * 1024)
    const small = await fixture.page(0, 400)
    expect(Buffer.byteLength(small.content)).toBeLessThanOrEqual(400)
    expect(small.metrics.retainedBytes).toBeLessThanOrEqual(400 + header.length)
  })
  it('refuses a corrupted checksum located after a giant frame page prefix', async () => {
    const first = await compressZstdFrame(header)
    const frame = await compressZstdFrame('{"text":"' + 'x'.repeat(10 * 1024 * 1024) + '"}\n')
    frame[frame.length - 1] = frame[frame.length - 1]! ^ 1
    const fixture = await artifact(Buffer.concat([first, frame]), 'zstd')
    await expect(fixture.page(0, 400)).rejects.toThrow()
    await expect(fixture.page(0, 128 * 1024)).rejects.toThrow()
  })
  it('does not validate later unrequested frames and omits a torn final frame', async () => {
    const first = await compressZstdFrame(header)
    const secondText = '{"text":"' + 'x'.repeat(1024) + '"}\n'
    const second = await compressZstdFrame(secondText)
    const third = await compressZstdFrame('{"later":true}\n'); third[third.length - 1] = third[third.length - 1]! ^ 1
    const fixture = await artifact(Buffer.concat([first, second, third]), 'zstd')
    const page = await fixture.page(0, 400)
    expect(page.content).toBe((header + secondText).slice(0, 400))
    expect(page.metrics.decodedBytes).toBe(header.length + secondText.length)
    await expect(fixture.page(header.length + secondText.length, 400)).rejects.toThrow()
    const torn = await artifact(Buffer.concat([first, second, third.subarray(0, -5)]), 'zstd')
    expect((await torn.page(0, 2048)).content).toBe(header + secondText)
    expect((await torn.page(header.length + secondText.length, 400)).content).toBe('')
    await expect(torn.page(header.length + secondText.length + 1, 400)).rejects.toThrow('offset')
  })
  it('rejects invalid framing and malformed independently encoded headers', async () => {
    for (const bytes of [Buffer.alloc(5), Buffer.from([0x28,0xb5,0x2f,0xfd,0x18])]) {
      await expect((await artifact(bytes, 'zstd')).page()).rejects.toThrow('corrupt')
    }
    for (const bytes of [Buffer.alloc(0), Buffer.from([0x28,0xb5,0x2f,0xfd]), Buffer.from([0x28,0xb5,0x2f,0xfd,0x20])]) {
      await expect((await artifact(bytes, 'zstd')).page()).rejects.toThrow('header-less')
    }
    const multiline = await artifact(await compressZstdFrame(header + '{}\n'), 'zstd')
    await expect(multiline.page()).rejects.toThrow('one header line')
    const huge = await artifact(await compressZstdFrame('x'.repeat(8192) + '\n'), 'zstd')
    await expect(huge.page()).rejects.toThrow('header')
    const boundary = await artifact(Buffer.concat([await compressZstdFrame(header),
      await compressZstdFrame('record without newline')]), 'zstd')
    await expect(boundary.page()).rejects.toThrow('final record boundary')
  })
  it('accepts all complete UTF-8 widths and trims a boundary within a three-byte code point', async () => {
    const fixture = await artifact(header + 'á€🧪\n', 'none')
    expect((await fixture.page(header.length, 4)).content).toBe('á')
    expect((await fixture.page(header.length + 2, 4)).content).toBe('€')
    expect((await fixture.page(header.length + 5, 4)).content).toBe('🧪')
    const tail = await artifact(header + 'x'.repeat(2 * 64 * 1024), 'none')
    expect((await tail.page()).content).toBe(header)
    const largeHeader = await artifact('x'.repeat(5000) + '\n{}\n', 'none')
    expect((await largeHeader.page(0, 128 * 1024, undefined, { ...limits, headerMaxBytes: 8192 })).header).toBe('x'.repeat(5000))
  })
  it('handles advertised sizes after actual file truncation without publishing an incomplete header', async () => {
    for (const compression of ['none', 'zstd'] as const) {
      const bytes = compression === 'none' ? Buffer.from(header) : await compressZstdFrame(header)
      const fixture = await artifact(bytes, compression)
      const file = await open(fixture.path, 'r+')
      try {
        const size = (await file.stat()).size
        await file.truncate(0)
        await expect(readRawPage(file, size, compression, 0, 400, limits)).rejects.toThrow('header')
      } finally { await file.close() }
    }
  })
  it('refuses reserved blocks, oversized content-size offsets and every truncated frame boundary', async () => {
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
    const first = await compressZstdFrame(header)
    const descriptor = Buffer.from([0xe4])
    const oversized = Buffer.alloc(9); oversized[0] = 0x60; oversized.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1)
    await expect((await artifact(Buffer.concat([magic, descriptor, oversized]), 'zstd')).page()).rejects.toThrow('safe byte offsets')
    const reserved = Buffer.concat([magic, Buffer.from([0x20, 0, 7, 0, 0])])
    await expect((await artifact(Buffer.concat([first, reserved]), 'zstd')).page(0, 2048)).rejects.toThrow('reserved block type')
    for (const descriptor of [0x04, 0x24, 0x44, 0x84, 0xc4, 0x05, 0x06, 0x07]) {
      const torn = Buffer.concat([magic, Buffer.from([descriptor, 0x60])])
      await expect((await artifact(torn, 'zstd')).page()).rejects.toThrow('header')
    }
    const frame = await compressZstdFrame('{}\n')
    for (const cut of [1, 2, 3, 4, 5, 6]) {
      const fixture = await artifact(Buffer.concat([first, frame.subarray(0, -cut)]), 'zstd')
      expect((await fixture.page(0, 2048)).content).toBe(header)
    }
  })
  it('seeks across native frames with recorded content sizes and preserves an exact end page', async () => {
    const encode = (text: string) => zstdCompressSync(Buffer.from(text),
      { params: { [constants.ZSTD_c_checksumFlag]: 1, [constants.ZSTD_c_contentSizeFlag]: 1 } })
    const first = encode(header), middleText = '{"text":"' + 'x'.repeat(2048) + '"}\n', middle = encode(middleText)
    const finalText = '{}\n', final = encode(finalText)
    const fixture = await artifact(Buffer.concat([first, middle, final]), 'zstd')
    const page = await fixture.page(header.length + middleText.length, 4)
    expect(page.content).toBe(finalText); expect(page.nextOffset).toBeUndefined()
    expect(page.metrics.decodedBytes).toBe(header.length + finalText.length)
    const exact = await artifact(Buffer.concat([encode(header), encode('abc\n')]), 'zstd')
    expect((await exact.page(header.length, 4)).nextOffset).toBeUndefined()
    const after = await artifact(Buffer.concat([encode(header), encode('abc\n'), encode('{}\n')]), 'zstd')
    expect((await after.page(header.length, 4)).nextOffset).toBe(header.length + 4)
  })

})
