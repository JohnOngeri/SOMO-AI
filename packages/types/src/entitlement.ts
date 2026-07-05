import { z } from 'zod'
import { ulid } from './common'

export const planId = z.enum(['none', 'org_seat'])
export type PlanId = z.infer<typeof planId>

/** Per-plan monthly limits. null = unlimited, 0 = fail closed. */
export const planLimits = z.object({
  aiCallsPerMonth: z.number().int().nonnegative().nullable(),
  smsPerMonth: z.number().int().nonnegative().nullable(),
  maxActivePacks: z.number().int().nonnegative().nullable(),
})
export type PlanLimits = z.infer<typeof planLimits>

/**
 * FAIL CLOSED: a user without an authorized seat gets zero of everything
 * metered. This is the pivot's core invariant — no seat, no paid calls.
 */
export const seatlessLimits: z.infer<typeof planLimits> = {
  aiCallsPerMonth: 0,
  smsPerMonth: 0,
  maxActivePacks: 0,
}

/**
 * Claims inside the ed25519-signed offline entitlement token (the "seat
 * token"). The device verifies the signature locally and enforces limits with
 * NO connectivity. Times are unix seconds (compact for SMS-transportable
 * tokens). exp never outlives the license term end.
 */
export const entitlementClaims = z.object({
  sub: ulid, // userId
  plan: planId,
  seatId: ulid.optional(),
  licenseId: ulid.optional(),
  limits: planLimits,
  /** pack grants: explicit ids, or every standard pack (seated teachers) */
  packs: z.union([z.literal('all_standard'), z.array(ulid).max(500)]),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  /** days after exp during which access degrades gracefully instead of hard-stopping */
  graceDays: z.number().int().nonnegative().max(30),
})
export type EntitlementClaims = z.infer<typeof entitlementClaims>

/** Wire format: base64url(claimsJson) + '.' + base64url(ed25519 sig). */
export const signedEntitlementToken = z.object({
  claims: entitlementClaims,
  publicKeyId: z.string().min(1).max(120),
  sig: z.string().min(1),
})
export type SignedEntitlementToken = z.infer<typeof signedEntitlementToken>
