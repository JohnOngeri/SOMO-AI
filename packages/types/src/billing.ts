import { z } from 'zod'
import { currency, isoDateTime, money, ulid } from './common'
import { planId } from './entitlement'

export const billingInterval = z.enum(['month', 'year'])
export type BillingInterval = z.infer<typeof billingInterval>

export const price = z.object({
  id: ulid,
  planId,
  currency,
  interval: billingInterval,
  amountMinor: z.number().int().nonnegative(),
  active: z.boolean(),
})
export type Price = z.infer<typeof price>

export const subscriptionStatus = z.enum([
  'pending', // charge in flight (mobile-money STK push)
  'trialing',
  'active',
  'past_due', // in dunning
  'canceled', // user-initiated, runs to period end
  'expired', // terminal
])
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>

export const subscription = z.object({
  id: ulid,
  userId: ulid,
  orgId: ulid.optional(), // set for org_seat subscriptions
  priceId: ulid,
  status: subscriptionStatus,
  currentPeriodStart: isoDateTime,
  currentPeriodEnd: isoDateTime,
  trialEndsAt: isoDateTime.optional(),
  canceledAt: isoDateTime.optional(),
  couponCode: z.string().max(40).optional(),
})
export type Subscription = z.infer<typeof subscription>

export const coupon = z.object({
  code: z
    .string()
    .regex(/^[A-Z0-9-]{3,20}$/)
    .max(20),
  /** exactly one of the two discount forms */
  percentOff: z.number().int().min(1).max(100).optional(),
  amountOff: money.optional(),
  redeemBy: isoDateTime.optional(),
  maxRedemptions: z.number().int().positive().optional(),
  timesRedeemed: z.number().int().nonnegative().default(0),
})
export type Coupon = z.infer<typeof coupon>

export const checkoutInput = z.object({
  idempotencyKey: ulid,
  priceId: ulid,
  channel: z.enum(['mobile_money', 'card', 'airtime']),
  msisdn: z.string().optional(), // required for mobile_money/airtime, validated server-side
  couponCode: z.string().max(40).optional(),
})
export type CheckoutInput = z.infer<typeof checkoutInput>

export const receipt = z.object({
  id: ulid,
  userId: ulid,
  description: z.string().max(300),
  amount: money,
  providerRef: z.string().max(200),
  paidAt: isoDateTime,
})
export type Receipt = z.infer<typeof receipt>

/** Normalized event after provider webhook verification — stored raw first, then processed. */
export const paymentWebhookEvent = z.object({
  id: ulid,
  provider: z.enum(['sandbox', 'flutterwave', 'paystack']),
  type: z.enum(['charge.succeeded', 'charge.failed', 'refund.succeeded']),
  providerRef: z.string().max(200),
  receivedAt: isoDateTime,
})
export type PaymentWebhookEvent = z.infer<typeof paymentWebhookEvent>
