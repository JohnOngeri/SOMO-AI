import { decodeSignedToken, encodeSignedToken } from '@somo/packsign'
import { seatlessLimits, type EntitlementClaims } from '@somo/types'
import type { PrismaClient } from '../db'
import type { SigningKeys } from '../packs/service'
import type { SeatService } from '../seats/service'

export const ENTITLEMENT_TTL_DAYS = 30
export const ENTITLEMENT_GRACE_DAYS = 7

export type OfflineVerdict =
  | { ok: true; claims: EntitlementClaims; degraded: boolean }
  | { ok: false; reason: 'invalid' | 'expired' }

/**
 * Entitlements are DERIVED from the teacher's seat — nothing else grants
 * access. No seat (or lapsed license / revoked seat / suspended institution)
 * yields plan 'none' with zero limits: every gate downstream fails closed.
 */
export class EntitlementService {
  constructor(
    private db: PrismaClient,
    private keys: SigningKeys,
    private seats: SeatService,
  ) {}

  /** Public half only — what devices pin to verify tokens offline. */
  get publicKeyInfo(): { publicKeyId: string; publicKey: string } {
    return { publicKeyId: this.keys.publicKeyId, publicKey: this.keys.publicKey }
  }

  async claimsFor(userId: string, at: Date = new Date()): Promise<EntitlementClaims> {
    const now = Math.floor(at.getTime() / 1000)
    const live = await this.seats.activeSeatFor(userId, at)

    if (!live) {
      return {
        sub: userId,
        plan: 'none',
        limits: seatlessLimits,
        packs: [],
        iat: now,
        exp: now + 86_400, // short-lived: a seatless token grants nothing anyway
        graceDays: 0,
      }
    }

    const quota = this.seats.quotaFor(live)
    const licenseEndSec = Math.floor(live.license.endDate.getTime() / 1000)
    return {
      sub: userId,
      plan: 'org_seat',
      seatId: live.seat.id,
      licenseId: live.license.id,
      limits: {
        aiCallsPerMonth: quota.monthlyAiCalls,
        smsPerMonth: quota.monthlySms,
        maxActivePacks: null,
      },
      packs: 'all_standard',
      iat: now,
      // the offline token can never outlive the license term
      exp: Math.min(now + ENTITLEMENT_TTL_DAYS * 86_400, licenseEndSec),
      graceDays: ENTITLEMENT_GRACE_DAYS,
    }
  }

  /** Compact signed seat token the device stores and verifies with NO connectivity. */
  async issueToken(userId: string): Promise<{ token: string; claims: EntitlementClaims }> {
    const claims = await this.claimsFor(userId)
    return { token: encodeSignedToken(claims, this.keys.privateKey), claims }
  }

  /**
   * Device-side verification logic (exercised in tests here so server and
   * client can never drift): valid signature required; within exp -> full
   * access; within exp+grace -> degraded (cached content only, no new AI);
   * past grace -> expired.
   */
  verifyOffline(token: string, at: Date = new Date()): OfflineVerdict {
    const claims = decodeSignedToken<EntitlementClaims>(token, this.keys.publicKey)
    if (!claims) return { ok: false, reason: 'invalid' }
    const now = Math.floor(at.getTime() / 1000)
    if (now <= claims.exp) return { ok: true, claims, degraded: false }
    if (now <= claims.exp + claims.graceDays * 86_400) return { ok: true, claims, degraded: true }
    return { ok: false, reason: 'expired' }
  }
}
