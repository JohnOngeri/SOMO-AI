/**
 * THE pricing config. Sales models NGO vs school-network vs ministry deals
 * by editing this file — no service logic changes. All base prices are
 * per-seat-per-term in USD cents; volume breaks apply the highest matching
 * discount; currency conversion uses the coarse FX table below (invoices
 * state their FX date; reprice by editing, not deploying logic).
 */

export interface VolumeBreak {
  minSeats: number
  discountPct: number
}

export interface TierPricing {
  basePerSeatUsdCents: number
  volumeBreaks: VolumeBreak[]
}

export const PRICING_TIERS: Record<string, TierPricing> = {
  NGO: {
    basePerSeatUsdCents: 1500, // $15/seat/term
    volumeBreaks: [
      { minSeats: 200, discountPct: 10 },
      { minSeats: 1000, discountPct: 20 },
    ],
  },
  FELLOWSHIP: {
    basePerSeatUsdCents: 1500,
    volumeBreaks: [
      { minSeats: 200, discountPct: 10 },
      { minSeats: 1000, discountPct: 20 },
    ],
  },
  SCHOOL_NETWORK: {
    basePerSeatUsdCents: 1200,
    volumeBreaks: [
      { minSeats: 500, discountPct: 10 },
      { minSeats: 2500, discountPct: 20 },
    ],
  },
  MINISTRY: {
    basePerSeatUsdCents: 700,
    volumeBreaks: [
      { minSeats: 5000, discountPct: 15 },
      { minSeats: 20000, discountPct: 30 },
    ],
  },
  FOUNDATION: {
    basePerSeatUsdCents: 1500,
    volumeBreaks: [{ minSeats: 500, discountPct: 15 }],
  },
}

/** Minor units per 1 USD, coarse and deliberately editable. */
export const FX_MINOR_PER_USD: Record<string, number> = {
  USD: 100,
  KES: 12900,
  NGN: 155000,
  TZS: 265000,
  UGX: 370000,
  GHS: 1550,
  ZAR: 1800,
  XOF: 60000,
}

export interface SeatQuote {
  perSeatMinor: number
  discountPct: number
  totalMinor: number
  currency: string
  tier: string
}

export function quoteSeats(institutionType: string, seats: number, currency: string): SeatQuote {
  const tier = PRICING_TIERS[institutionType]
  if (!tier) throw new Error(`no pricing tier for institution type ${institutionType}`)
  const fx = FX_MINOR_PER_USD[currency]
  if (!fx) throw new Error(`unsupported currency ${currency}`)
  if (seats < 1) throw new Error('seats must be positive')

  let discountPct = 0
  for (const brk of tier.volumeBreaks) {
    if (seats >= brk.minSeats) discountPct = Math.max(discountPct, brk.discountPct)
  }

  const baseUsdCents = tier.basePerSeatUsdCents * (1 - discountPct / 100)
  const perSeatMinor = Math.round((baseUsdCents / 100) * fx)
  return {
    perSeatMinor,
    discountPct,
    totalMinor: perSeatMinor * seats,
    currency,
    tier: institutionType,
  }
}
