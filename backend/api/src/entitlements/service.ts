import { decodeSignedToken, encodeSignedToken } from '@somo/packsign'
import { freeLimits, type EntitlementClaims, type PlanId } from '@somo/types'
import type { PrismaClient } from '../db'
import type { SigningKeys } from '../packs/service'

export const ENTITLEMENT_TTL_DAYS = 30
export const ENTITLEMENT_GRACE_DAYS = 7

export type OfflineVerdict =
  | { ok: true; claims: EntitlementClaims; degraded: boolean }
  | { ok: false; reason: 'invalid' | 'expired' }

/**
 * Extraction-ready module: everything goes through this class so it can move
 * to its own deployable (backend/entitlements) without touching callers.
 */
export class EntitlementService {
  constructor(
    private db: PrismaClient,
    private keys: SigningKeys,
  ) {}

  /** Public half only — what devices pin to verify tokens offline. */
  get publicKeyInfo(): { publicKeyId: string; publicKey: string } {
    return { publicKeyId: this.keys.publicKeyId, publicKey: this.keys.publicKey }
  }

  /** The user's effective plan right now (billing writes plan/plusUntil). */
  async effectivePlan(userId: string): Promise<PlanId> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.plan === 'org_seat') return 'org_seat'
    if (user.plan === 'plus' && user.plusUntil && user.plusUntil > new Date()) return 'plus'
    // lapsed plus degrades to free automatically
    return 'free'
  }

  async claimsFor(userId: string): Promise<EntitlementClaims> {
    const plan = await this.effectivePlan(userId)
    const now = Math.floor(Date.now() / 1000)
    return {
      sub: userId,
      plan,
      limits: plan === 'free' ? freeLimits : { asksPerWeek: null, maxActivePacks: null },
      packs: plan === 'free' ? [] : 'all_standard',
      iat: now,
      exp: now + ENTITLEMENT_TTL_DAYS * 86_400,
      graceDays: ENTITLEMENT_GRACE_DAYS,
    }
  }

  /** Compact signed token the device stores and verifies with NO connectivity. */
  async issueToken(userId: string): Promise<{ token: string; claims: EntitlementClaims }> {
    const claims = await this.claimsFor(userId)
    return { token: encodeSignedToken(claims, this.keys.privateKey), claims }
  }

  /**
   * Device-side verification logic (exercised in tests here so server and
   * client can never drift): valid signature required; within exp -> full
   * access; within exp+grace -> degraded (access continues, upsell banner);
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
