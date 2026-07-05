import type { PaymentProvider, PaymentChannel, WebhookEvent, Charge } from '@somo/payments'
import type { PrismaClient } from '../db'
import { newUlid } from '../ids'
import type { MeteringService } from '../metering/service'

export const TRIAL_DAYS = 14
/** Dunning: retry 2 days after failure, then 3 more days, then expire (day 0/2/5). */
export const DUNNING_RETRY_DAYS = [2, 3]
export const MAX_DUNNING_ATTEMPTS = DUNNING_RETRY_DAYS.length + 1

const DAY = 86_400_000

export class BillingError extends Error {
  constructor(
    public code:
      | 'price_not_found'
      | 'already_subscribed'
      | 'coupon_invalid'
      | 'charge_failed'
      | 'not_found'
      | 'invalid_state',
    message?: string,
  ) {
    super(message ?? code)
  }
}

function periodEnd(from: Date, interval: string): Date {
  const d = new Date(from)
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

export interface BillingHooks {
  /** invoked after a marketplace charge settles successfully via webhook */
  marketplaceChargeSucceeded?: (providerRef: string) => Promise<void>
}

export class BillingService {
  constructor(
    private db: PrismaClient,
    private payments: PaymentProvider,
    private metering: MeteringService,
    private hooks: BillingHooks = {},
  ) {}

  listPrices(currency?: string) {
    return this.db.price.findMany({
      where: { active: true, ...(currency ? { currency } : {}) },
      orderBy: [{ currency: 'asc' }, { interval: 'asc' }],
    })
  }

  /** Discounted amount for a price+coupon, validating the coupon. */
  async previewAmount(priceId: string, couponCode?: string, at: Date = new Date()) {
    const price = await this.db.price.findUnique({ where: { id: priceId } })
    if (!price || !price.active) throw new BillingError('price_not_found')
    if (!couponCode) return { price, amountMinor: price.amountMinor, coupon: null }

    const coupon = await this.db.coupon.findUnique({ where: { code: couponCode } })
    if (!coupon) throw new BillingError('coupon_invalid', 'unknown coupon')
    if (coupon.redeemBy && coupon.redeemBy < at)
      throw new BillingError('coupon_invalid', 'coupon expired')
    if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) {
      throw new BillingError('coupon_invalid', 'coupon fully redeemed')
    }
    if (coupon.amountOffCurrency && coupon.amountOffCurrency !== price.currency) {
      throw new BillingError('coupon_invalid', 'coupon currency mismatch')
    }

    let amount = price.amountMinor
    if (coupon.percentOff) amount = Math.round(amount * (1 - coupon.percentOff / 100))
    if (coupon.amountOffMinor) amount = Math.max(0, amount - coupon.amountOffMinor)
    return { price, amountMinor: amount, coupon }
  }

  /**
   * Start a subscription. trial=true starts a no-charge 14-day trial.
   * Synchronous charge outcomes activate/fail immediately; pending
   * (mobile-money STK push) parks the subscription until the webhook lands.
   */
  async subscribe(input: {
    userId: string
    priceId: string
    channel: PaymentChannel
    msisdn?: string
    couponCode?: string
    idempotencyKey: string
    trial?: boolean
    at?: Date
  }) {
    const at = input.at ?? new Date()

    // idempotent retry: same key returns the same subscription
    const priorCharge = await this.db.paymentCharge.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { subscription: true },
    })
    if (priorCharge?.subscription) return priorCharge.subscription

    const existing = await this.db.subscription.findFirst({
      where: {
        userId: input.userId,
        status: { in: ['pending', 'trialing', 'active', 'past_due'] },
      },
    })
    if (existing) throw new BillingError('already_subscribed')

    const { price, amountMinor, coupon } = await this.previewAmount(
      input.priceId,
      input.couponCode,
      at,
    )

    if (input.trial) {
      const trialEnd = new Date(at.getTime() + TRIAL_DAYS * DAY)
      const sub = await this.db.subscription.create({
        data: {
          id: newUlid(),
          userId: input.userId,
          priceId: price.id,
          status: 'trialing',
          channel: input.channel,
          msisdn: input.msisdn ?? null,
          couponCode: input.couponCode ?? null,
          currentPeriodStart: at,
          currentPeriodEnd: trialEnd,
          trialEndsAt: trialEnd,
        },
      })
      await this.grantPlus(input.userId, trialEnd)
      await this.metering.record({ id: newUlid(), userId: input.userId, type: 'trial_start' })
      return sub
    }

    const charge = await this.payments.createCharge({
      idempotencyKey: input.idempotencyKey,
      amountMinor,
      currency: price.currency as never,
      channel: input.channel,
      ...(input.msisdn ? { msisdn: input.msisdn } : {}),
      customerId: input.userId,
      description: `SOMO Plus (${price.interval})`,
    })

    const sub = await this.db.subscription.create({
      data: {
        id: newUlid(),
        userId: input.userId,
        priceId: price.id,
        status:
          charge.status === 'succeeded'
            ? 'active'
            : charge.status === 'pending'
              ? 'pending'
              : 'expired',
        channel: input.channel,
        msisdn: input.msisdn ?? null,
        couponCode: input.couponCode ?? null,
        currentPeriodStart: at,
        currentPeriodEnd: periodEnd(at, price.interval),
      },
    })
    await this.recordCharge(charge, {
      userId: input.userId,
      subscriptionId: sub.id,
      purpose: 'subscription',
    })

    if (charge.status === 'failed') {
      throw new BillingError('charge_failed', charge.failureCode)
    }
    if (charge.status === 'succeeded') {
      await this.activate(sub.id, coupon?.code)
    }
    return this.db.subscription.findUniqueOrThrow({ where: { id: sub.id } })
  }

  /** Renewal at period end (worker-driven in prod; time-injectable for tests). */
  async renew(subscriptionId: string, at: Date = new Date()) {
    const sub = await this.db.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { price: true },
    })
    if (sub.status === 'canceled' || sub.status === 'expired') {
      return this.settleLapsed(sub.id, at)
    }
    if (!['active', 'past_due', 'trialing'].includes(sub.status)) {
      throw new BillingError('invalid_state', `cannot renew from ${sub.status}`)
    }

    const purpose = sub.status === 'trialing' ? 'trial_conversion' : 'renewal'
    const charge = await this.payments.createCharge({
      idempotencyKey: newUlid(),
      amountMinor: sub.price.amountMinor,
      currency: sub.price.currency as never,
      channel: sub.channel as PaymentChannel,
      ...(sub.msisdn ? { msisdn: sub.msisdn } : {}),
      customerId: sub.userId,
      description: `SOMO Plus ${purpose}`,
    })
    await this.recordCharge(charge, { userId: sub.userId, subscriptionId: sub.id, purpose })

    if (charge.status === 'succeeded') {
      const newEnd = periodEnd(at, sub.price.interval)
      await this.db.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'active',
          currentPeriodStart: at,
          currentPeriodEnd: newEnd,
          dunningAttempts: 0,
          nextRetryAt: null,
        },
      })
      await this.grantPlus(sub.userId, newEnd)
      return this.db.subscription.findUniqueOrThrow({ where: { id: sub.id } })
    }

    // failed or pending-that-we-treat-as-not-yet-paid -> dunning
    return this.enterDunning(sub.id, at)
  }

  /** One dunning retry (worker calls this when nextRetryAt passes). */
  async retryDunning(subscriptionId: string, at: Date = new Date()) {
    const sub = await this.db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })
    if (sub.status !== 'past_due') throw new BillingError('invalid_state', 'not in dunning')
    return this.renew(subscriptionId, at)
  }

  /** User cancel: access runs to the end of the paid period. */
  async cancel(subscriptionId: string, userId: string, at: Date = new Date()) {
    const sub = await this.db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })
    if (sub.userId !== userId) throw new BillingError('not_found')
    if (sub.status === 'expired') return sub
    return this.db.subscription.update({
      where: { id: sub.id },
      data: { status: 'canceled', canceledAt: at, nextRetryAt: null },
    })
  }

  /** Lazily settle a canceled/overdue subscription once its period has passed. */
  async settleLapsed(subscriptionId: string, at: Date = new Date()) {
    const sub = await this.db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })
    if (sub.status === 'canceled' && sub.currentPeriodEnd <= at) {
      await this.db.user.update({
        where: { id: sub.userId },
        data: { plan: 'free', plusUntil: null },
      })
      return this.db.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } })
    }
    return sub
  }

  async refund(input: { providerRef: string; amountMinor?: number; idempotencyKey: string }) {
    // our own idempotency, independent of the provider's: a replay must not
    // re-increment the refunded total
    const prior = await this.db.refund.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (prior) {
      return {
        refundRef: prior.refundRef,
        providerRef: prior.providerRef,
        status: 'succeeded' as const,
        amountMinor: prior.amountMinor,
      }
    }

    const chargeRow = await this.db.paymentCharge.findUnique({
      where: { providerRef: input.providerRef },
    })
    if (!chargeRow) throw new BillingError('not_found')

    const refund = await this.payments.refund(input)
    if (refund.status === 'succeeded') {
      await this.db.refund.create({
        data: {
          id: newUlid(),
          providerRef: refund.providerRef,
          refundRef: refund.refundRef,
          idempotencyKey: input.idempotencyKey,
          amountMinor: refund.amountMinor,
        },
      })
      await this.db.paymentCharge.update({
        where: { providerRef: input.providerRef },
        data: { refundedMinor: { increment: refund.amountMinor } },
      })
    }
    return refund
  }

  /**
   * Verify + store + process a provider webhook. Raw body is stored even when
   * verification fails (forensics); processing is idempotent by event id.
   */
  async applyWebhook(rawBody: string, signature: string) {
    const event = this.payments.verifyWebhook(rawBody, signature)
    const eventId = event?.id ?? `unverified_${newUlid()}`

    const existing = await this.db.webhookDelivery.findUnique({ where: { eventId } })
    if (existing?.processedAt) return { ok: true, duplicate: true }

    await this.db.webhookDelivery.upsert({
      where: { eventId },
      update: {},
      create: {
        id: newUlid(),
        provider: this.payments.id,
        eventId,
        type: event?.type ?? 'unverified',
        providerRef: event?.providerRef ?? '',
        rawBody,
        verified: event !== null,
      },
    })
    if (!event) return { ok: false, duplicate: false }

    await this.processEvent(event)
    await this.db.webhookDelivery.update({
      where: { eventId },
      data: { processedAt: new Date() },
    })
    return { ok: true, duplicate: false }
  }

  private async processEvent(event: WebhookEvent) {
    const chargeRow = await this.db.paymentCharge.findUnique({
      where: { providerRef: event.providerRef },
      include: { subscription: true },
    })
    if (!chargeRow) return // marketplace or unknown — other modules subscribe later

    if (event.type === 'charge.succeeded') {
      await this.db.paymentCharge.update({
        where: { id: chargeRow.id },
        data: { status: 'succeeded' },
      })
      if (chargeRow.subscription && chargeRow.subscription.status === 'pending') {
        await this.activate(chargeRow.subscription.id, chargeRow.subscription.couponCode)
      }
      if (chargeRow.purpose === 'marketplace') {
        await this.hooks.marketplaceChargeSucceeded?.(chargeRow.providerRef)
      }
    } else if (event.type === 'charge.failed') {
      await this.db.paymentCharge.update({
        where: { id: chargeRow.id },
        data: { status: 'failed' },
      })
      if (chargeRow.subscription && chargeRow.subscription.status === 'pending') {
        await this.db.subscription.update({
          where: { id: chargeRow.subscription.id },
          data: { status: 'expired' },
        })
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────

  private async activate(subscriptionId: string, couponCode?: string | null) {
    const sub = await this.db.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    })
    await this.db.subscription.update({
      where: { id: sub.id },
      data: { status: 'active', dunningAttempts: 0, nextRetryAt: null },
    })
    await this.grantPlus(sub.userId, sub.currentPeriodEnd)
    if (couponCode) {
      await this.db.coupon.update({
        where: { code: couponCode },
        data: { timesRedeemed: { increment: 1 } },
      })
    }
    await this.metering.record({ id: newUlid(), userId: sub.userId, type: 'upgrade' })
  }

  private async enterDunning(subscriptionId: string, at: Date) {
    const sub = await this.db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })
    const attempts = sub.dunningAttempts + 1

    if (attempts >= MAX_DUNNING_ATTEMPTS) {
      await this.db.user.update({
        where: { id: sub.userId },
        data: { plan: 'free', plusUntil: null },
      })
      return this.db.subscription.update({
        where: { id: sub.id },
        data: { status: 'expired', dunningAttempts: attempts, nextRetryAt: null },
      })
    }

    const retryInDays = DUNNING_RETRY_DAYS[attempts - 1]!
    const nextRetryAt = new Date(at.getTime() + retryInDays * DAY)
    // access grace through the dunning window so a flaky wallet ≠ instant lockout
    await this.grantPlus(sub.userId, nextRetryAt)
    return this.db.subscription.update({
      where: { id: sub.id },
      data: { status: 'past_due', dunningAttempts: attempts, nextRetryAt },
    })
  }

  private async grantPlus(userId: string, until: Date) {
    await this.db.user.update({
      where: { id: userId },
      data: { plan: 'plus', plusUntil: until },
    })
  }

  private async recordCharge(
    charge: Charge,
    ctx: { userId: string; subscriptionId?: string; purpose: string },
  ) {
    await this.db.paymentCharge.create({
      data: {
        id: newUlid(),
        userId: ctx.userId,
        subscriptionId: ctx.subscriptionId ?? null,
        purpose: ctx.purpose,
        amountMinor: charge.amountMinor,
        currency: charge.currency,
        channel: charge.channel,
        provider: this.payments.id,
        providerRef: charge.providerRef,
        idempotencyKey: charge.idempotencyKey,
        status: charge.status,
        failureCode: charge.failureCode ?? null,
      },
    })
  }
}
