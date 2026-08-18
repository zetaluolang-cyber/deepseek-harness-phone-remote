// Encoding-guard unit tests (data integrity): the write path must reject
// non-UTF-8 files (UTF-16 BOM / GBK-ANSI bytes) and preserve UTF-8 BOM +
// dominant newline style on write-back.
// Run: node --test test/encoding.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UTF8_BOM, hasUtf16Bom, hasUtf8Bom, stripUtf8Bom, isValidUtf8,
  dominantNewline, applyNewlineStyle, withBom,
} from '../lib/encoding.js'

const utf16le = Buffer.from([0xff, 0xfe, 0x41, 0x00])
const utf16be = Buffer.from([0xfe, 0xff, 0x00, 0x41])
const utf8Bom = Buffer.concat([UTF8_BOM, Buffer.from('hi')])
// GBK/ANSI Chinese bytes ("hi" as 0xC4 0xE3 = 你好 first char 0xC4E3) - these
// are invalid UTF-8 sequences.
const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3])
const ascii = Buffer.from('plain ascii')
const crlfText = Buffer.from('a\r\nb\r\nc\n', 'utf8')
const lfText = Buffer.from('a\nb\nc\r\n', 'utf8')
const noNl = Buffer.from('abc', 'utf8')

test('encoding: UTF-16 BOMs (LE and BE) are detected', () => {
  assert.equal(hasUtf16Bom(utf16le), true)
  assert.equal(hasUtf16Bom(utf16be), true)
  assert.equal(hasUtf16Bom(ascii), false)
  assert.equal(hasUtf16Bom(utf8Bom), false, 'UTF-8 BOM must not count as UTF-16')
  assert.equal(hasUtf16Bom(null), false)
  assert.equal(hasUtf16Bom(Buffer.alloc(1)), false)
})

test('encoding: UTF-8 BOM detection and stripping', () => {
  assert.equal(hasUtf8Bom(utf8Bom), true)
  assert.equal(hasUtf8Bom(ascii), false)
  assert.deepEqual(Buffer.from(stripUtf8Bom(utf8Bom)), Buffer.from('hi'))
  assert.deepEqual(Buffer.from(stripUtf8Bom(ascii)), ascii)
})

test('encoding: strict UTF-8 validation rejects GBK/ANSI and UTF-16, accepts BOM', () => {
  assert.equal(isValidUtf8(ascii), true)
  assert.equal(isValidUtf8(utf8Bom), true, 'UTF-8 BOM is legal')
  assert.equal(isValidUtf8(Buffer.from('你好', 'utf8')), true)
  assert.equal(isValidUtf8(gbk), false, 'GBK/ANSI bytes must fail')
  assert.equal(isValidUtf8(utf16le), false, 'UTF-16LE BOM must fail')
  assert.equal(isValidUtf8(utf16be), false, 'UTF-16BE BOM must fail')
  assert.equal(isValidUtf8(null), true)
  assert.equal(isValidUtf8(Buffer.alloc(0)), true)
})

test('encoding: dominant newline detection', () => {
  assert.equal(dominantNewline(crlfText), 'crlf')
  assert.equal(dominantNewline(lfText), 'lf')
  assert.equal(dominantNewline(noNl), null)
  assert.equal(dominantNewline(null), null)
  // BOM prefix must not confuse the newline scan
  assert.equal(dominantNewline(Buffer.concat([UTF8_BOM, crlfText])), 'crlf')
})

test('encoding: newline style application never doubles CRLF', () => {
  assert.equal(applyNewlineStyle('a\nb', 'crlf'), 'a\r\nb')
  assert.equal(applyNewlineStyle('a\r\nb', 'crlf'), 'a\r\nb', 'existing CRLF must not double')
  assert.equal(applyNewlineStyle('a\nb', 'lf'), 'a\nb')
  assert.equal(applyNewlineStyle('a\r\nb', null), 'a\r\nb')
})

test('encoding: BOM normalization never loses and never doubles the BOM', () => {
  assert.equal(withBom('hi', true), '\uFEFFhi')
  assert.equal(withBom('hi', false), 'hi')
  // content that already carries U+FEFF (readText kept it) is not doubled
  assert.equal(withBom('\uFEFFhi', true), '\uFEFFhi')
  assert.equal(withBom('\uFEFFhi', false), 'hi', 'a stale U+FEFF is stripped when the file had no BOM')
})
