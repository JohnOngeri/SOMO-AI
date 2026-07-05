import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  decodeSignedToken,
  encodeSignedToken,
  generateEd25519Keypair,
  sha256Hex,
  signPayload,
  verifyPayload,
} from '../src/index'

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined', () => {
    const a = canonicalJson({ b: 1, a: { z: [3, { y: 2, x: 1 }], k: 'v' }, skip: undefined })
    const b = canonicalJson({ a: { k: 'v', z: [3, { x: 1, y: 2 }] }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"k":"v","z":[3,{"x":1,"y":2}]},"b":1}')
  })

  it('array order is preserved (it is meaningful)', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
  })
})

describe('ed25519 sign/verify', () => {
  const keys = generateEd25519Keypair()
  const manifest = { id: 'X', title: 'Numeracy', price: { amountMinor: 0, currency: 'KES' } }

  it('roundtrips a valid signature', () => {
    const sig = signPayload(manifest, keys.privateKey)
    expect(verifyPayload(manifest, sig, keys.publicKey)).toBe(true)
    // key order must not matter
    const reordered = { title: 'Numeracy', price: { currency: 'KES', amountMinor: 0 }, id: 'X' }
    expect(verifyPayload(reordered, sig, keys.publicKey)).toBe(true)
  })

  it('rejects tampered payloads, wrong keys, and garbage signatures', () => {
    const sig = signPayload(manifest, keys.privateKey)
    expect(verifyPayload({ ...manifest, title: 'Hacked' }, sig, keys.publicKey)).toBe(false)
    const other = generateEd25519Keypair()
    expect(verifyPayload(manifest, sig, other.publicKey)).toBe(false)
    expect(verifyPayload(manifest, 'bm90IGEgc2ln', keys.publicKey)).toBe(false)
    expect(verifyPayload(manifest, '!!!', keys.publicKey)).toBe(false)
  })
})

describe('compact signed tokens', () => {
  const keys = generateEd25519Keypair()

  it('encodes and decodes claims', () => {
    const claims = { sub: 'U1', plan: 'plus', exp: 1_800_000_000 }
    const token = encodeSignedToken(claims, keys.privateKey)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(decodeSignedToken(token, keys.publicKey)).toEqual(claims)
  })

  it('rejects tampered bodies and truncated tokens', () => {
    const token = encodeSignedToken({ sub: 'U1', plan: 'free' }, keys.privateKey)
    const [body, sig] = token.split('.') as [string, string]
    const evil = Buffer.from(JSON.stringify({ sub: 'U1', plan: 'plus' })).toString('base64url')
    expect(decodeSignedToken(`${evil}.${sig}`, keys.publicKey)).toBeNull()
    expect(decodeSignedToken(body, keys.publicKey)).toBeNull()
    expect(decodeSignedToken('', keys.publicKey)).toBeNull()
  })

  it('fits comfortably in a concatenated SMS', () => {
    const claims = {
      sub: '01HZY3V7Q4J8K2M5N9P1R3T6W8',
      plan: 'plus',
      limits: { asksPerWeek: null, maxActivePacks: null },
      packs: 'all_standard',
      iat: 1_800_000_000,
      exp: 1_800_600_000,
      graceDays: 7,
    }
    const token = encodeSignedToken(claims, keys.privateKey)
    expect(token.length).toBeLessThan(420) // ~3 SMS segments max
  })
})

describe('sha256Hex', () => {
  it('hashes deterministically', () => {
    expect(sha256Hex('somo')).toBe(sha256Hex('somo'))
    expect(sha256Hex('somo')).toMatch(/^[0-9a-f]{64}$/)
  })
})
