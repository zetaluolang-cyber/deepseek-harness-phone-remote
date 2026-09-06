// presence/sessionlog.js — read a persisted DSH session log.
//
// The zstd frame scan and the JSONL reader used to live only in
// scripts/dogfood-board.js, which is NOT shipped in the npm package
// ("files": ["lib"]). lib/ needed the same capability, and a second
// hand-rolled scanner is exactly how two implementations drift apart - the
// first attempt here searched for the frame magic byte-by-byte and found zero
// frames in a real 5 MB log. This module is now the single implementation and
// the CLI imports it.
//
// The log is a sequence of complete zstd frames, each holding JSONL records.
// Frame boundaries are found by walking zstd block headers, never by scanning
// for the magic number (compressed data contains it).
import fs from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 4247762216 // 0xFD2FB528

/**
 * Locate complete zstd frame ranges (same algorithm as DSH's
 * dsh-session-persistence-jsonl scanZstdFrames: concatenated frames, each
 * with its own header, blocks, and optional 4-byte checksum).
 * @param {Buffer} buffer - complete file bytes.
 * @returns {{ frames: Array<{start:number,end:number}> }}
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error('invalid zstd frame magic at byte ' + offset)
    }
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('reserved zstd block type at byte ' + (offset - 3))
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** Decompress one session log file into event records. */
export function loadSessionFile(file) {
  const buf = fs.readFileSync(file)
  const { frames } = scanZstdFrames(buf)
  const plain = Buffer.concat(frames.map((f) => zstdDecompressSync(buf.subarray(f.start, f.end)))).toString('utf8')
  const events = []
  let header = null
  for (const line of plain.split('\n')) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev && ev.type === 'session') { header = ev; continue }
    events.push(ev)
  }
  return { events, header }
}
