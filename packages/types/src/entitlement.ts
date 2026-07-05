import { z } from 'zod'
import { ulid } from './common'

export const planId = z.enum(['free', 'plus', 'org_seat'])
export type PlanId = z.infer<typeof planId>

/** Per-plan limits. null = unlimited. */
export const planLimits = z.object({
  asksPerWeek: z.number().int().nonnegative().nullable(),
  maxActivePacks: z.number().int().nonnegative().nullable(),
})
export type PlanLimits = z.infer<typeof planLimits>

export const freeLimits: z.infer<typeof planLimits> = {
  asksPerWeek: 5,
  maxActivePacks: 1,
}

/**
 * Claims inside the ed25519-signed offline entitlement token.
 * The device verifies the signature locally and enforces limits with NO connectivity.
 * Times are unix seconds (compact for SMS-transportable tokens).
 */
export const entitlementClaims = z.object({
  sub: ulid, // userId
  plan: planId,
  limits: planLimits,
  /** pack grants: explicit ids, or every standard pack (Plus) */
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
