import { ed25519 } from '@noble/curves/ed25519.js'
import { type EntitlementClaims, entitlementClaims } from '@somo/types'

/**
 * On-device mirror of @somo/packsign's canonicalJson + decodeSignedToken.
 * That package signs with node:crypto, which doesn't exist in Hermes — this
 * re-implements the same canonical-JSON + ed25519 verify with a pure-JS
 * curve library so the seat token is CRYPTOGRAPHICALLY checked with zero
 * connectivity, not just trusted because it's cached.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url + '='.repeat((4 - (b64url.length % 4)) % 4)
  return base64ToBytes(padded.replace(/-/g, '+').replace(/_/g, '/'))
}

export type OfflineVerifyResult =
  | { ok: true; degraded: boolean; claims: EntitlementClaims }
  | { ok: false; reason: 'bad_signature' | 'expired' | 'malformed' }

/** publicKeyB64 is the server's ENTITLEMENT_SIGNING_PUBLIC_KEY, pinned into app config. */
export function verifySeatTokenOffline(token: string, publicKeyB64: string): OfflineVerifyResult {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  try {
    const bodyBytes = base64UrlToBytes(token.slice(0, dot))
    const sigBytes = base64UrlToBytes(token.slice(dot + 1))
    // spki-DER (44 bytes, standard base64 from the server) wraps the 32 raw
    // ed25519 public-key bytes at the tail
    const pubKeyBytes = base64ToBytes(publicKeyB64)
    const rawPubKey = pubKeyBytes.length === 32 ? pubKeyBytes : pubKeyBytes.slice(-32)
    if (!ed25519.verify(sigBytes, bodyBytes, rawPubKey))
      return { ok: false, reason: 'bad_signature' }

    const bodyText = new TextDecoder().decode(bodyBytes)
    const parsed: unknown = JSON.parse(bodyText)
    if (canonicalJson(parsed) !== bodyText) return { ok: false, reason: 'malformed' }
    const claims = entitlementClaims.parse(parsed)

    const nowSec = Math.floor(Date.now() / 1000)
    const graceEnd = claims.exp + claims.graceDays * 86_400
    if (nowSec > graceEnd) return { ok: false, reason: 'expired' }
    return { ok: true, degraded: nowSec > claims.exp, claims }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}
