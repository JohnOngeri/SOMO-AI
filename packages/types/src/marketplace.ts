import { z } from 'zod'
import { currency, isoDateTime, money, ulid } from './common'

export const listingStatus = z.enum(['draft', 'in_review', 'live', 'suspended'])

export const listing = z.object({
  id: ulid,
  packId: ulid,
  creatorId: ulid,
  price: money,
  status: listingStatus,
  createdAt: isoDateTime,
})
export type Listing = z.infer<typeof listing>

export const sale = z.object({
  id: ulid,
  listingId: ulid,
  buyerId: ulid,
  grossMinor: z.number().int().positive(),
  platformFeeMinor: z.number().int().nonnegative(),
  creatorNetMinor: z.number().int().nonnegative(),
  currency,
  providerRef: z.string().max(200),
  at: isoDateTime,
})
export type Sale = z.infer<typeof sale>

/**
 * Double-entry ledger for revenue share. Rows are immutable; a sale writes a
 * balanced set of entries (gross in, fee to platform, net to creator balance).
 */
export const ledgerAccount = z.union([
  z.literal('platform:revenue'),
  z.literal('platform:clearing'),
  z.string().regex(/^creator:[0-9A-HJKMNP-TV-Z]{26}$/),
])

export const ledgerEntry = z.object({
  id: ulid,
  account: ledgerAccount,
  /** positive = credit, negative = debit; entries for one refId must sum to zero */
  amountMinor: z.number().int(),
  currency,
  type: z.enum(['sale_gross', 'platform_fee', 'creator_credit', 'payout', 'refund']),
  /** the sale / payout / refund this entry belongs to */
  refId: ulid,
  createdAt: isoDateTime,
})
export type LedgerEntry = z.infer<typeof ledgerEntry>

export const payout = z.object({
  id: ulid,
  creatorId: ulid,
  amount: money,
  status: z.enum(['pending', 'paid', 'failed']),
  providerRef: z.string().max(200).optional(),
  requestedAt: isoDateTime,
  settledAt: isoDateTime.optional(),
})
export type Payout = z.infer<typeof payout>
