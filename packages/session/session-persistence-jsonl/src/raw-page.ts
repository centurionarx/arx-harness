/**
 * Bounded raw-artifact pages over the existing JSONL/Zstandard format. Only
 * overlapping complete frames are decoded; their checksum is verified before
 * any plaintext is returned.
 * @module arx-session-persistence-jsonl/raw-page
 */
import type { FileHandle } from 'node:fs/promises'
import { PassThrough, Readable } from 'node:stream'
import { constants, createZstdDecompress } from 'node:zlib'
import type { JsonlCompression } from './format.ts'

const INPUT_CHUNK_BYTES = 64 * 1024
const HEADER_CHUNK_BYTES = 4096
const ZSTD_MAGIC = 0xfd2fb528

/** Configured bounds apply independently of the log's logical size. */
export interface RawPageLimits {
  readonly headerMaxBytes: number
  readonly windowLogMax: number
}
/** Physical diagnostics used by the real-file bounded-read tests. */
export interface RawPageMetrics {
  readBytes: number
  decodedBytes: number
  maxDecodedChunkBytes: number
  retainedBytes: number
}
/** A page's header and UTF-8 range retain no other conversation body. */
export interface RawPage {
  readonly header: string
  readonly content: string
  readonly nextOffset?: number
  readonly metrics: RawPageMetrics
}
interface Frame {
  readonly start: number
  readonly end: number
  readonly contentSize?: number
}

function cursorError(): never { throw new Error('invalid raw artifact offset') }

/** Read a bounded number of bytes, treating a short stable file as a torn tail. */
async function bytesAt(file: FileHandle, start: number, length: number, metrics: RawPageMetrics, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  const target = Buffer.allocUnsafe(length)
  let received = 0
  while (received < length) {
    signal?.throwIfAborted()
    const read = await file.read(target, received, length - received, start + received)
    metrics.readBytes += read.bytesRead
    if (read.bytesRead === 0) break
    received += read.bytesRead
  }
  return target.subarray(0, received)
}

/** Locate one complete frame using only its small header and block boundaries. */
async function frameAt(file: FileHandle, start: number, size: number, metrics: RawPageMetrics,
  signal?: AbortSignal): Promise<Frame | undefined> {
  if (size - start < 5) return undefined
  const prefix = await bytesAt(file, start, 5, metrics, signal)
  if (prefix.length !== 5) return undefined
  if (prefix.readUInt32LE(0) !== ZSTD_MAGIC) throw new Error('corrupt Zstandard session log: invalid frame magic')
  const descriptor = (prefix[4] as number)
  if ((descriptor & 0x18) !== 0) throw new Error('corrupt Zstandard session log: reserved frame-header bit')
  const singleSegment = (descriptor & 0x20) !== 0
  const contentSizeFlag = descriptor >>> 6
  const dictionaryFlag = descriptor & 3
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
  const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  if (size - start - 5 < headerBytes) return undefined
  const header = await bytesAt(file, start + 5, headerBytes, metrics, signal)
  if (header.length !== headerBytes) return undefined
  let contentSize: number | undefined
  if (contentSizeBytes !== 0) {
    const cursor = (singleSegment ? 0 : 1) + dictionaryBytes
    const encoded = contentSizeBytes === 8 ? header.readBigUInt64LE(cursor) : BigInt(header.readUIntLE(cursor, contentSizeBytes))
    const adjusted = encoded + (contentSizeBytes === 2 ? 256n : 0n)
    if (adjusted > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Zstandard content size exceeds safe byte offsets')
    contentSize = Number(adjusted)
  }
  let end = start + 5 + headerBytes
  for (;;) {
    if (size - end < 3) return undefined
    const block = await bytesAt(file, end, 3, metrics, signal)
    if (block.length !== 3) return undefined
    const value = block.readUIntLE(0, 3)
    const blockType = (value >>> 1) & 3
    if (blockType === 3) throw new Error('corrupt Zstandard session log: reserved block type')
    const payloadBytes = blockType === 1 ? 1 : value >>> 3
    end += 3
    if (size - end < payloadBytes) return undefined
    end += payloadBytes
    if ((value & 1) !== 0) break
  }
  if ((descriptor & 4) !== 0) {
    if (size - end < 4) return undefined
    end += 4
  }
  return { start, end, ...(contentSize === undefined ? {} : { contentSize }) }
}

/** Decode a single complete frame with bounded stream buffers, including its CRC. */
async function decodeFrame(file: FileHandle, frame: Frame, limits: RawPageLimits, metrics: RawPageMetrics,
  accept: (chunk: Buffer, offset: number) => void, signal?: AbortSignal): Promise<number> {
  async function* physical(): AsyncIterable<Buffer> {
    for (let position = frame.start; position < frame.end;) {
      const chunk = await bytesAt(file, position, Math.min(INPUT_CHUNK_BYTES, frame.end - position), metrics, signal)
      if (chunk.length === 0) throw new Error('Zstandard frame changed during read')
      position += chunk.length
      yield chunk
    }
  }
  const input = Readable.from(physical(), { objectMode: false, highWaterMark: INPUT_CHUNK_BYTES })
  const decoder = createZstdDecompress({
    chunkSize: INPUT_CHUNK_BYTES,
    params: { [constants.ZSTD_d_windowLogMax]: limits.windowLogMax },
  })
  const output = new PassThrough({ highWaterMark: INPUT_CHUNK_BYTES })
  decoder.on('error', error => output.destroy(error))
  const abort = () => {
    const error = signal?.reason instanceof Error ? signal.reason : new Error('aborted')
    input.destroy(error)
    decoder.destroy(error)
    output.destroy(error)
  }
  signal?.addEventListener('abort', abort, { once: true })
  input.on('error', error => decoder.destroy(error))
  input.pipe(decoder).pipe(output)
  let decoded = 0
  try {
    for await (const value of output) {
      signal?.throwIfAborted()
      const chunk = value as Buffer
      metrics.maxDecodedChunkBytes = Math.max(metrics.maxDecodedChunkBytes, chunk.length)
      metrics.decodedBytes += chunk.length
      accept(chunk, decoded)
      decoded += chunk.length
    }
    // The native decoder validates any advertised content size and the frame checksum.
    return decoded
  } finally {
    signal?.removeEventListener('abort', abort)
    input.destroy()
    decoder.destroy()
    output.destroy()
  }
}

/** Finish only a complete UTF-8 code point; invalid encodings never become text. */
function utf8Page(buffer: Buffer): Buffer {
  if (buffer.length === 0) return buffer
  if (((buffer[0] as number) & 0xc0) === 0x80) cursorError()
  let start = buffer.length - 1
  while (start > 0 && ((buffer[start] as number) & 0xc0) === 0x80) start--
  const leading = (buffer[start] as number)
  const width = leading < 0x80 ? 1 : (leading & 0xe0) === 0xc0 ? 2 : (leading & 0xf0) === 0xe0 ? 3 : (leading & 0xf8) === 0xf0 ? 4 : 1
  const complete = start + width > buffer.length ? buffer.subarray(0, start) : buffer
  new TextDecoder('utf-8', { fatal: true }).decode(complete)
  return complete
}

async function plainHeader(file: FileHandle, size: number, limits: RawPageLimits, metrics: RawPageMetrics,
  signal?: AbortSignal): Promise<string> {
  const parts: Buffer[] = []
  let total = 0
  while (total < Math.min(size, limits.headerMaxBytes)) {
    const chunk = await bytesAt(file, total, Math.min(HEADER_CHUNK_BYTES, size - total, limits.headerMaxBytes - total), metrics, signal)
    if (chunk.length === 0) break
    const newline = chunk.indexOf(10)
    if (newline >= 0) {
      parts.push(chunk.subarray(0, newline))
      metrics.retainedBytes = Math.max(metrics.retainedBytes, total + newline)
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))
    }
    parts.push(chunk)
    total += chunk.length
  }
  throw new Error('raw artifact header exceeds page header limit or is incomplete')
}

/** Ignore an incomplete final record; plainHeader has already proven the size hint positive. */
async function plainCommittedEnd(file: FileHandle, size: number, metrics: RawPageMetrics, signal?: AbortSignal): Promise<number> {
  const final = await bytesAt(file, size - 1, 1, metrics, signal)
  if (final[0] === 10) return size
  let position = size
  while (position > 0) {
    const start = Math.max(0, position - INPUT_CHUNK_BYTES)
    const chunk = await bytesAt(file, start, position - start, metrics, signal)
    const newline = chunk.lastIndexOf(10)
    if (newline >= 0) return start + newline + 1
    position = start
  }
  return 0
}

/**
 * Read one UTF-8 page. Zstandard CRC validation can read/decode more than the
 * page when an existing append frame is large; retained plaintext stays bounded.
 * @param file - Already opened backend-owned artifact.
 * @param size - Stable physical file size.
 * @param compression - Existing provider encoding.
 * @param offset - Decoded UTF-8 byte offset.
 * @param maxBytes - Maximum retained conversation bytes.
 * @param limits - Header and native decoder window limits.
 * @param signal - Optional cancellation.
 * @returns A complete-frame page and physical diagnostic counters.
 */
export async function readRawPage(file: FileHandle, size: number, compression: JsonlCompression, offset: number,
  maxBytes: number, limits: RawPageLimits, signal?: AbortSignal): Promise<RawPage> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 4) cursorError()
  signal?.throwIfAborted()
  const metrics: RawPageMetrics = { readBytes: 0, decodedBytes: 0, maxDecodedChunkBytes: 0, retainedBytes: 0 }
  if (compression === 'none') {
    const header = await plainHeader(file, size, limits, metrics, signal)
    const committedEnd = await plainCommittedEnd(file, size, metrics, signal)
    if (offset > committedEnd) cursorError()
    const chunk = await bytesAt(file, offset, Math.min(maxBytes, committedEnd - offset), metrics, signal)
    const page = utf8Page(chunk)
    metrics.retainedBytes += chunk.length
    return { header, content: page.toString('utf8'),
      ...(offset + page.length < committedEnd ? { nextOffset: offset + page.length } : {}), metrics }
  }
  const page = Buffer.allocUnsafe(maxBytes)
  let retained = 0
  let logical = 0
  let position = 0
  let header: string | undefined
  let hasNext = false
  while (position < size) {
    const frame = await frameAt(file, position, size, metrics, signal)
    if (frame === undefined) break
    const isHeader = position === 0
    if (!isHeader && frame.contentSize !== undefined && logical + frame.contentSize <= offset) {
      logical += frame.contentSize
      position = frame.end
      continue
    }
    const headerParts: Buffer[] = []
    let headerBytes = 0
    let lastByte: number | undefined
    const length = await decodeFrame(file, frame, limits, metrics, (chunk, local) => {
      lastByte = chunk[chunk.length - 1]
      if (isHeader) {
        headerBytes += chunk.length
        if (headerBytes > limits.headerMaxBytes) throw new Error('raw artifact header exceeds page header limit')
        headerParts.push(Buffer.from(chunk))
      }
      const from = Math.max(0, offset - logical - local)
      const to = Math.min(chunk.length, offset + maxBytes - logical - local)
      if (to > from) retained += chunk.copy(page, retained, from, to)
      metrics.retainedBytes = Math.max(metrics.retainedBytes, headerBytes + retained)
    }, signal)
    if (isHeader) {
      const bytes = Buffer.concat(headerParts)
      if (bytes.length === 0 || bytes.indexOf(10) !== bytes.length - 1) throw new Error('corrupt Zstandard session log: first frame is not one header line')
      header = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1))
    }
    if (length !== 0 && lastByte !== 10) throw new Error('corrupt Zstandard session log: complete frame lacks final record boundary')
    logical += length
    position = frame.end
    if (logical >= offset + maxBytes) {
      hasNext = logical > offset + maxBytes || position < size
      break
    }
  }
  if (header === undefined) throw new Error('empty or header-less Zstandard session log')
  if (offset > logical) cursorError()
  const complete = utf8Page(page.subarray(0, retained))
  hasNext ||= complete.length < retained
  return { header, content: complete.toString('utf8'), ...(hasNext ? { nextOffset: offset + complete.length } : {}), metrics }
}
