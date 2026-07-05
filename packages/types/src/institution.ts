import { z } from 'zod'
import { currency, isoDateTime, phoneE164, ulid } from './common'

export const institutionType = z.enum([
  'NGO',
  'FELLOWSHIP',
  'SCHOOL_NETWORK',
  'MINISTRY',
  'FOUNDATION',
])
export type InstitutionType = z.infer<typeof institutionType>

export const institutionStatus = z.enum(['ACTIVE', 'SUSPENDED'])
export const licenseStatus = z.enum(['ACTIVE', 'EXPIRED', 'SUSPENDED'])
export const seatStatus = z.enum(['UNCLAIMED', 'ACTIVE', 'REVOKED'])

export const institution = z.object({
  id: ulid,
  name: z.string().min(1).max(200),
  type: institutionType,
  country: z.string().length(2), // ISO 3166-1 alpha-2
  billingContactEmail: z.string().email().optional(),
  status: institutionStatus,
  createdAt: isoDateTime,
})
export type Institution = z.infer<typeof institution>

export const license = z.object({
  id: ulid,
  institutionId: ulid,
  term: z.string().regex(/^\d{4}-T[1-3]$/), // e.g. 2026-T1
  startDate: isoDateTime,
  endDate: isoDateTime,
  seatsPurchased: z.number().int().positive().max(1_000_000),
  pricePerSeatMinor: z.number().int().nonnegative(),
  currency,
  status: licenseStatus,
  monthlyAiCallsPerSeat: z.number().int().nonnegative(),
  monthlySmsPerSeat: z.number().int().nonnegative(),
})
export type License = z.infer<typeof license>

/**
 * Authorization PIN: XXXX-XXXX from an alphabet without confusable glyphs
 * (no I/L/O/U/0/1) — printable on paper, readable over a bad phone line,
 * typeable on a feature-phone keypad in T9-alpha mode.
 */
export const AUTH_PIN_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
export const authPin = z
  .string()
  .transform((s) => s.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(new RegExp(`^[${AUTH_PIN_ALPHABET}]{8}$`), 'invalid PIN'))

export const redeemPinInput = z.object({
  pin: authPin,
})
export type RedeemPinInput = z.infer<typeof redeemPinInput>

export const seatSummary = z.object({
  id: ulid,
  licenseId: ulid,
  status: seatStatus,
  teacherPhone: phoneE164.optional(),
  claimedAt: isoDateTime.optional(),
})
export type SeatSummary = z.infer<typeof seatSummary>

export const adminRole = z.enum(['HQ_ADMIN', 'COORDINATOR'])
export type AdminRole = z.infer<typeof adminRole>
