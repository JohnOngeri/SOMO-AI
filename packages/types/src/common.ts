import { z } from 'zod'

/** ULIDs are the client-generated id + idempotency key everywhere. */
export const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'invalid ULID')

/** E.164 — the primary identity in SOMO (no passwords, no emails). */
export const phoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'invalid E.164 phone number')

export const currency = z.enum(['KES', 'NGN', 'TZS', 'UGX', 'GHS', 'ZAR', 'XOF', 'USD'])
export type Currency = z.infer<typeof currency>

export const locale = z.enum(['en', 'fr', 'ha', 'sw'])
export type Locale = z.infer<typeof locale>

/** The connectivity ladder. Order matters: index = capability. */
export const connectivityTier = z.enum(['offline', 'sms', 'cellular2g', 'wifi'])
export type ConnectivityTier = z.infer<typeof connectivityTier>

/** All money is integer minor units + explicit currency. Floats are banned. */
export const money = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency,
})
export type Money = z.infer<typeof money>

export const isoDateTime = z.string().datetime({ offset: true })

export const cursor = z.string().min(1).max(512)

export const apiError = z.object({
  code: z.enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'rate_limited',
    'quota_exceeded',
    'payment_required',
    'validation_failed',
    'conflict',
    'internal',
  ]),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type ApiError = z.infer<typeof apiError>
