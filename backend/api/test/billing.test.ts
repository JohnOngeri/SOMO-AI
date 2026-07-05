import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { SandboxPaymentProvider } from '@somo/payments'
import { MAX_DUNNING_ATTEMPTS, TRIAL_DAYS } from '../src/billing/service'
import { newUlid } from '../src/ids'
import { resetDb, signUp, startTestApp, type TestApp } from './helpers'

let t: TestApp
const DAY = 86_400_000

beforeEach(async () => {
  if (!t) t = await startTestApp()
  await resetDb(t.db)
  t.sms.sent = []
  await seedPrices()
})

afterAll(async () => {
  await t?.close()
})

let PRICE_KES_MONTH: string
let PRICE_KES_YEAR: string

async function seedPrices() {
  PRICE_KES_MONTH = newUlid()
  PRICE_KES_YEAR = newUlid()
  await t.db.price.createMany({
    data: [
      {
        id: PRICE_KES_MONTH,
        planId: 'plus',
        currency: 'KES',
        interval: 'month',
        amountMinor: 26000,
      },
      {
        id: PRICE_KES_YEAR,
        planId: 'plus',
        currency: 'KES',
        interval: 'year',
        amountMinor: 260000,
      },
      { id: newUlid(), planId: 'plus', currency: 'NGN', interval: 'month', amountMinor: 300000 },
    ],
  })
  await t.db.coupon.create({
    data: { code: 'LAUNCH25', percentOff: 25, maxRedemptions: 2 },
  })
}

const sandbox = () => t.services.payments as SandboxPaymentProvider

const GOOD_MSISDN = '+254712345678'
const BROKE_MSISDN = '+254700000000'
const PENDING_MSISDN = '+254700001111'

async function subscribeOk(phone: string, opts: Record<string, unknown> = {}) {
  const s = await signUp(t, phone)
  const sub = await t.client(s.accessToken).billing.subscribe.mutate({
    idempotencyKey: newUlid(),
    priceId: PRICE_KES_MONTH,
    channel: 'mobile_money',
    msisdn: GOOD_MSISDN,
    ...opts,
  })
  return { s, sub }
}

describe('subscribe', () => {
  it('mobile-money success activates immediately and grants plus entitlements', async () => {
    const { s, sub } = await subscribeOk('+254720000001')
    expect(sub.status).toBe('active')

    const user = await t.db.user.findUniqueOrThrow({ where: { id: s.user.id } })
    expect(user.plan).toBe('plus')
    expect(user.plusUntil!.getTime()).toBe(new Date(sub.currentPeriodEnd).getTime())

    const ent = await t.client(s.accessToken).entitlements.get.query()
    expect(ent.claims.plan).toBe('plus')

    // audited charge + upgrade event
    expect(
      await t.db.paymentCharge.count({ where: { userId: s.user.id, status: 'succeeded' } }),
    ).toBe(1)
    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'upgrade' } })).toBe(1)
  })

  it('failed charge -> clear error, no entitlement, audited failure', async () => {
    const s = await signUp(t, '+254720000002')
    await expect(
      t.client(s.accessToken).billing.subscribe.mutate({
        idempotencyKey: newUlid(),
        priceId: PRICE_KES_MONTH,
        channel: 'mobile_money',
        msisdn: BROKE_MSISDN,
      }),
    ).rejects.toThrow(/insufficient_funds|PAYMENT_REQUIRED/)

    const user = await t.db.user.findUniqueOrThrow({ where: { id: s.user.id } })
    expect(user.plan).toBe('free')
    expect(await t.db.paymentCharge.count({ where: { userId: s.user.id, status: 'failed' } })).toBe(
      1,
    )
  })

  it('retrying with the same idempotency key never double-charges', async () => {
    const s = await signUp(t, '+254720000003')
    const key = newUlid()
    const input = {
      idempotencyKey: key,
      priceId: PRICE_KES_MONTH,
      channel: 'mobile_money' as const,
      msisdn: GOOD_MSISDN,
    }
    const a = await t.client(s.accessToken).billing.subscribe.mutate(input)
    const b = await t.client(s.accessToken).billing.subscribe.mutate(input)
    expect(b.id).toBe(a.id)
    expect(await t.db.paymentCharge.count({ where: { userId: s.user.id } })).toBe(1)
    expect(await t.db.subscription.count({ where: { userId: s.user.id } })).toBe(1)
  })

  it('a user cannot hold two live subscriptions', async () => {
    const { s } = await subscribeOk('+254720000004')
    await expect(
      t.client(s.accessToken).billing.subscribe.mutate({
        idempotencyKey: newUlid(),
        priceId: PRICE_KES_YEAR,
        channel: 'mobile_money',
        msisdn: GOOD_MSISDN,
      }),
    ).rejects.toThrow(/already_subscribed/)
  })
})

describe('pending mobile-money (STK push) via webhooks', () => {
  it('pending sub activates only after a verified charge.succeeded webhook', async () => {
    const { s, sub } = await subscribeOk('+254720000010', { msisdn: PENDING_MSISDN })
    expect(sub.status).toBe('pending')
    expect((await t.db.user.findUniqueOrThrow({ where: { id: s.user.id } })).plan).toBe('free')

    const charge = await t.db.paymentCharge.findFirstOrThrow({ where: { userId: s.user.id } })
    const { rawBody, signature } = sandbox().settlePending(charge.providerRef, 'succeeded')

    const res = await fetch(`${t.url}/webhooks/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-somo-signature': signature },
      body: rawBody,
    })
    expect(res.status).toBe(200)

    const settled = await t.db.subscription.findUniqueOrThrow({ where: { id: sub.id } })
    expect(settled.status).toBe('active')
    expect((await t.db.user.findUniqueOrThrow({ where: { id: s.user.id } })).plan).toBe('plus')

    // replaying the same webhook is a no-op
    const replay = await fetch(`${t.url}/webhooks/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-somo-signature': signature },
      body: rawBody,
    })
    const replayBody = (await replay.json()) as { duplicate: boolean }
    expect(replayBody.duplicate).toBe(true)
    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'upgrade' } })).toBe(1)
  })

  it('charge.failed webhook expires the pending sub; tampered webhooks are rejected and stored', async () => {
    const { sub, s } = await subscribeOk('+254720000011', { msisdn: PENDING_MSISDN })
    const charge = await t.db.paymentCharge.findFirstOrThrow({ where: { userId: s.user.id } })
    const { rawBody, signature } = sandbox().settlePending(charge.providerRef, 'failed')

    const tampered = await fetch(`${t.url}/webhooks/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-somo-signature': 'deadbeef' },
      body: rawBody,
    })
    expect(tampered.status).toBe(401)
    expect(await t.db.webhookDelivery.count({ where: { verified: false } })).toBe(1)

    await fetch(`${t.url}/webhooks/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-somo-signature': signature },
      body: rawBody,
    })
    expect((await t.db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe(
      'expired',
    )
  })
})

describe('coupons', () => {
  it('percent-off applies to the charge, redemptions count and cap out', async () => {
    const s = await signUp(t, '+254720000020')
    const api = t.client(s.accessToken)

    const preview = await api.billing.preview.query({
      priceId: PRICE_KES_MONTH,
      couponCode: 'LAUNCH25',
    })
    expect(preview.amountMinor).toBe(19500) // 26000 * 0.75

    await api.billing.subscribe.mutate({
      idempotencyKey: newUlid(),
      priceId: PRICE_KES_MONTH,
      channel: 'mobile_money',
      msisdn: GOOD_MSISDN,
      couponCode: 'LAUNCH25',
    })
    const charge = await t.db.paymentCharge.findFirstOrThrow({ where: { userId: s.user.id } })
    expect(charge.amountMinor).toBe(19500)
    expect(
      (await t.db.coupon.findUniqueOrThrow({ where: { code: 'LAUNCH25' } })).timesRedeemed,
    ).toBe(1)
  })

  it('rejects unknown, expired, and fully-redeemed coupons', async () => {
    const s = await signUp(t, '+254720000021')
    const api = t.client(s.accessToken)
    await expect(
      api.billing.preview.query({ priceId: PRICE_KES_MONTH, couponCode: 'NOPE' }),
    ).rejects.toThrow(/coupon/)

    await t.db.coupon.create({
      data: { code: 'OLD-CODE', percentOff: 50, redeemBy: new Date(Date.now() - DAY) },
    })
    await expect(
      api.billing.preview.query({ priceId: PRICE_KES_MONTH, couponCode: 'OLD-CODE' }),
    ).rejects.toThrow(/expired/)

    await t.db.coupon.update({ where: { code: 'LAUNCH25' }, data: { timesRedeemed: 2 } })
    await expect(
      api.billing.preview.query({ priceId: PRICE_KES_MONTH, couponCode: 'LAUNCH25' }),
    ).rejects.toThrow(/redeemed/)
  })
})

describe('trials', () => {
  it('starts a no-charge trial with full plus access, then converts to paid', async () => {
    const { s, sub } = await subscribeOk('+254720000030', { trial: true })
    expect(sub.status).toBe('trialing')
    expect(await t.db.paymentCharge.count({ where: { userId: s.user.id } })).toBe(0)
    expect((await t.client(s.accessToken).entitlements.get.query()).claims.plan).toBe('plus')
    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'trial_start' } })).toBe(
      1,
    )

    // trial ends -> conversion charge succeeds -> active for a full period
    const trialEnd = new Date(Date.now() + TRIAL_DAYS * DAY)
    const converted = await t.services.billing.renew(sub.id, trialEnd)
    expect(converted.status).toBe('active')
    const charge = await t.db.paymentCharge.findFirstOrThrow({ where: { userId: s.user.id } })
    expect(charge.purpose).toBe('trial_conversion')
    expect(charge.status).toBe('succeeded')
  })

  it('failed trial conversion enters dunning, not instant lockout', async () => {
    const { s, sub } = await subscribeOk('+254720000031', { trial: true, msisdn: BROKE_MSISDN })
    const after = await t.services.billing.renew(sub.id, new Date(Date.now() + TRIAL_DAYS * DAY))
    expect(after.status).toBe('past_due')
    expect(after.nextRetryAt).not.toBeNull()
    // access grace persists through the retry window
    expect((await t.db.user.findUniqueOrThrow({ where: { id: s.user.id } })).plan).toBe('plus')
  })
})

describe('renewal + dunning', () => {
  it('successful renewal extends the period and resets dunning', async () => {
    const { sub } = await subscribeOk('+254720000040')
    const at = new Date(sub.currentPeriodEnd)
    const renewed = await t.services.billing.renew(sub.id, at)
    expect(renewed.status).toBe('active')
    expect(renewed.currentPeriodEnd.getTime()).toBeGreaterThan(at.getTime())
  })

  it('fail -> retry(fail) -> final fail expires and downgrades (day 0/2/5)', async () => {
    const { s, sub } = await subscribeOk('+254720000041')
    // make the wallet broke for renewals
    await t.db.subscription.update({ where: { id: sub.id }, data: { msisdn: BROKE_MSISDN } })

    const d0 = await t.services.billing.renew(sub.id, new Date(sub.currentPeriodEnd))
    expect(d0.status).toBe('past_due')
    expect(d0.dunningAttempts).toBe(1)

    const d2 = await t.services.billing.retryDunning(sub.id, d0.nextRetryAt!)
    expect(d2.status).toBe('past_due')
    expect(d2.dunningAttempts).toBe(2)

    const d5 = await t.services.billing.retryDunning(sub.id, d2.nextRetryAt!)
    expect(d5.status).toBe('expired')
    expect(d5.dunningAttempts).toBe(MAX_DUNNING_ATTEMPTS)

    const user = await t.db.user.findUniqueOrThrow({ where: { id: s.user.id } })
    expect(user.plan).toBe('free')
    expect(user.plusUntil).toBeNull()
  })

  it('a dunning retry that succeeds restores active', async () => {
    const { sub } = await subscribeOk('+254720000042')
    await t.db.subscription.update({ where: { id: sub.id }, data: { msisdn: BROKE_MSISDN } })
    const failed = await t.services.billing.renew(sub.id, new Date(sub.currentPeriodEnd))
    expect(failed.status).toBe('past_due')

    await t.db.subscription.update({ where: { id: sub.id }, data: { msisdn: GOOD_MSISDN } })
    const recovered = await t.services.billing.retryDunning(sub.id, failed.nextRetryAt!)
    expect(recovered.status).toBe('active')
    expect(recovered.dunningAttempts).toBe(0)
  })
})

describe('cancel + refunds', () => {
  it('cancel keeps access to period end, then expires and downgrades', async () => {
    const { s, sub } = await subscribeOk('+254720000050')
    const canceled = await t.client(s.accessToken).billing.cancel.mutate({ subscriptionId: sub.id })
    expect(canceled.status).toBe('canceled')
    // still entitled inside the paid period
    expect((await t.client(s.accessToken).entitlements.get.query()).claims.plan).toBe('plus')

    const afterEnd = new Date(new Date(sub.currentPeriodEnd).getTime() + DAY)
    const settled = await t.services.billing.settleLapsed(sub.id, afterEnd)
    expect(settled.status).toBe('expired')
    expect((await t.db.user.findUniqueOrThrow({ where: { id: s.user.id } })).plan).toBe('free')
  })

  it('users cannot cancel someone else’s subscription', async () => {
    const { sub } = await subscribeOk('+254720000051')
    const other = await signUp(t, '+254720000052')
    await expect(
      t.client(other.accessToken).billing.cancel.mutate({ subscriptionId: sub.id }),
    ).rejects.toThrow(/not_found/i)
  })

  it('refunds are idempotent, capped at the charge, and audited', async () => {
    const { s } = await subscribeOk('+254720000053')
    const charge = await t.db.paymentCharge.findFirstOrThrow({ where: { userId: s.user.id } })

    const r1 = await t.services.billing.refund({
      providerRef: charge.providerRef,
      amountMinor: 10000,
      idempotencyKey: 'refund-1',
    })
    expect(r1.status).toBe('succeeded')
    const replay = await t.services.billing.refund({
      providerRef: charge.providerRef,
      amountMinor: 10000,
      idempotencyKey: 'refund-1',
    })
    expect(replay).toEqual(r1)

    const rest = await t.services.billing.refund({
      providerRef: charge.providerRef,
      idempotencyKey: 'refund-2',
    })
    expect(rest.status).toBe('succeeded')

    const over = await t.services.billing.refund({
      providerRef: charge.providerRef,
      amountMinor: 1,
      idempotencyKey: 'refund-3',
    })
    expect(over.status).toBe('failed')

    const updated = await t.db.paymentCharge.findUniqueOrThrow({ where: { id: charge.id } })
    expect(updated.refundedMinor).toBe(26000)
  })
})
