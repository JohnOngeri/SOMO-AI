import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32

/** Monotonic-enough ULID: 48-bit timestamp + 80 random bits. */
export function newUlid(now = Date.now()): string {
  let ts = now
  const time = new Array<string>(10)
  for (let i = 9; i >= 0; i--) {
    time[i] = ALPHABET[ts % 32]!
    ts = Math.floor(ts / 32)
  }
  const rand = randomBytes(10)
  let out = time.join('')
  for (let i = 0; i < 16; i++) {
    // 16 chars from 80 bits: take 5 bits at a time
    const bitIndex = i * 5
    const byteIndex = Math.floor(bitIndex / 8)
    const shift = bitIndex % 8
    const value = ((rand[byteIndex]! << 8) | (rand[byteIndex + 1] ?? 0)) >> (11 - shift)
    out += ALPHABET[value & 31]
  }
  return out
}
