import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto'

/**
 * Canonical JSON: object keys sorted recursively, no whitespace. The SAME
 * bytes must be produced on the signing server and the verifying device —
 * any drift bricks pack installs, so this stays dependency-free and dumb.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface Keypair {
  /** base64 pkcs8 DER */
  privateKey: string
  /** base64 spki DER */
  publicKey: string
}

export function generateEd25519Keypair(): Keypair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  }
}

function toPrivateKey(base64Pkcs8: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(base64Pkcs8, 'base64'), format: 'der', type: 'pkcs8' })
}

function toPublicKey(base64Spki: string): KeyObject {
  return createPublicKey({ key: Buffer.from(base64Spki, 'base64'), format: 'der', type: 'spki' })
}

/** Sign any JSON-serializable payload; returns base64 signature over its canonical JSON. */
export function signPayload(payload: unknown, privateKeyB64: string): string {
  return edSign(null, Buffer.from(canonicalJson(payload)), toPrivateKey(privateKeyB64)).toString(
    'base64',
  )
}

export function verifyPayload(payload: unknown, sigB64: string, publicKeyB64: string): boolean {
  try {
    return edVerify(
      null,
      Buffer.from(canonicalJson(payload)),
      toPublicKey(publicKeyB64),
      Buffer.from(sigB64, 'base64'),
    )
  } catch {
    return false
  }
}

/**
 * Compact token format for offline entitlements and referral invites:
 * base64url(canonicalJson(claims)) + '.' + base64url(signature)
 * Small enough to move over SMS when it has to.
 */
export function encodeSignedToken(claims: unknown, privateKeyB64: string): string {
  const body = Buffer.from(canonicalJson(claims)).toString('base64url')
  const sig = edSign(null, Buffer.from(canonicalJson(claims)), toPrivateKey(privateKeyB64))
  return `${body}.${sig.toString('base64url')}`
}

export function decodeSignedToken<T = unknown>(token: string, publicKeyB64: string): T | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  try {
    const body = Buffer.from(token.slice(0, dot), 'base64url')
    const sig = Buffer.from(token.slice(dot + 1), 'base64url')
    if (!edVerify(null, body, toPublicKey(publicKeyB64), sig)) return null
    const claims = JSON.parse(body.toString()) as T
    // reject tokens whose body isn't canonical (prevents mutation games)
    if (canonicalJson(claims) !== body.toString()) return null
    return claims
  } catch {
    return null
  }
}
