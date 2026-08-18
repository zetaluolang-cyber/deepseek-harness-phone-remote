// encoding.js — write-path encoding guard for the /remfs channel (data
// integrity). Pure Node so it is unit-testable; the browser client inlines a
// compact copy because browser bundles cannot import this module.
//
// Rules enforced by the dispatcher's write endpoint:
//   - A file that is NOT UTF-8 (UTF-16 BOM, or invalid UTF-8 sequences that
//     indicate GBK/ANSI content) must never be overwritten by the phone: the
//     write is rejected so the original is not corrupted.
//   - An existing UTF-8 BOM is preserved on write-back.
//   - The dominant newline style (CRLF/LF) of the original file is preserved.

/** UTF-8 BOM bytes (EF BB BF). */
export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

/** True when the buffer starts with a UTF-16 BOM (LE FF FE or BE FE FF). */
export function hasUtf16Bom(buf) {
  if (!buf || buf.length < 2) return false
  return (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)
}

/** True when the buffer starts with a UTF-8 BOM (EF BB BF). */
export function hasUtf8Bom(buf) {
  if (!buf || buf.length < 3) return false
  return buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
}

/** Return the buffer without a leading UTF-8 BOM (identity when absent). */
export function stripUtf8Bom(buf) {
  return hasUtf8Bom(buf) ? buf.subarray(3) : buf
}

/** True when the buffer is valid UTF-8 (strict, fatal). A leading UTF-8 BOM
 *  is legal; UTF-16 BOMs and GBK/ANSI byte sequences fail. */
export function isValidUtf8(buf) {
  if (!buf || buf.length === 0) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch {
    return false
  }
}

/**
 * Detect the dominant newline style of a text buffer.
 * @param {Uint8Array|Buffer} buf - file bytes (probe prefix is enough).
 * @returns {'crlf'|'lf'|null} - dominant style, or null when no newlines.
 */
export function dominantNewline(buf) {
  if (!buf || buf.length === 0) return null
  const text = stripUtf8Bom(Buffer.from(buf)).toString('utf8')
  const crlf = (text.match(/\r\n/g) || []).length
  const lf = (text.match(/(?<!\r)\n/g) || []).length
  if (crlf === 0 && lf === 0) return null
  return crlf >= lf ? 'crlf' : 'lf'
}

/**
 * Apply a newline style to text ('crlf' converts every line break to CRLF;
 * 'lf' and null leave the text as-is; already-CRLF breaks are not doubled).
 * @param {string} text
 * @param {'crlf'|'lf'|null} style
 * @returns {string}
 */
export function applyNewlineStyle(text, style) {
  const s = String(text || '')
  if (style !== 'crlf') return s
  return s.replace(/\r?\n/g, '\r\n')
}

/**
 * Normalize a leading U+FEFF against the original file's BOM state: strip a
 * U+FEFF already present, then re-add it only when the original had a UTF-8
 * BOM. This keeps write-back byte-faithful (never a double BOM, never a lost
 * BOM).
 * @param {string} text - new content (may already carry U+FEFF from read).
 * @param {boolean} originalHadBom
 * @returns {string}
 */
export function withBom(text, originalHadBom) {
  let s = String(text || '')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  return originalHadBom ? '\uFEFF' + s : s
}
