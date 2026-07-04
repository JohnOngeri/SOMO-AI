import { z } from 'zod'
import { isoDateTime, ulid } from './common'

/** Days of SOMO Plus credited to BOTH sides on redemption. */
export const REFERRAL_REWARD_DAYS = 14

/**
 * Embedded in Bluetooth/USB pack transfers. Signed so a forged invite can't
 * mint Plus days. Compact — must fit in an SMS if needed.
 */
export const referralInvite = z.object({
  code: z.string().regex(/^[A-Z2-7]{8}$/), // base32, no confusing chars
  inviterId: ulid,
  packId: ulid.optional(),
  issuedAt: isoDateTime,
  expiresAt: isoDateTime,
  sig: z.string().min(1), // ed25519 over the fields above
})
export type ReferralInvite = z.infer<typeof referralInvite>

export const referralRedemption = z.object({
  id: ulid,
  code: z.string(),
  inviterId: ulid,
  inviteeId: ulid,
  rewardDays: z.number().int().positive(),
  redeemedAt: isoDateTime,
})
export type ReferralRedemption = z.infer<typeof referralRedemption>
