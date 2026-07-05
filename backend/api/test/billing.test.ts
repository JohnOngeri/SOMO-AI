import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { newUlid } from '../src/ids'
import { resetDb, signUp, startTestApp, type TestApp } from './helpers'

/**
 * Post-pivot, consumer subscriptions are gone from the product surface —
 * institutions pay per seat via invoices (P6). What must stay correct is the
 * shared money plumbing BillingService still owns: charge auditing, webhook
 * storage/dispatch (covered end-to-end in marketplace.test.ts), and
 * idempotent refunds.
 */

let t: TestApp

beforeEach(async () => {
  if (!t) t = await startTestApp()
  await resetDb(t.db)
  t.sms.sent = []
})

afterAll(async () => {
  await t?.close()
})

async function chargedSale() {
  const first = await signUp(t, '+254720000001')
  await t.db.user.update({ where: { id: first.user.id }, data: { role: 'creator' } })
  await t.db.otpChallenge.deleteMany({})
  const creator = await signUp(t, '+254720000001')
  const pub = await t.client(creator.accessToken).packs.publish.mutate({
    slug: 'billing-fixture-pack',
    title: 'Fixture',
    subject: 'Maths',
    gradeLevels: ['P4'],
    locale: 'en',
    version: '1.0.0',
    lessons: [{ index: 0, title: 'L', minutes: 30 }],
    priceAmountMinor: 26000,
    priceCurrency: 'KES',
    archiveBase64: Buffer.from('x').toString('base64'),
  })
  const buyer = await signUp(t, '+254720000002')
  await t.services.marketplace.buyPack({
    buyerId: buyer.user.id,
    packId: pub.manifest.id,
    channel: 'mobile_money',
    msisdn: '+254712345678',
    idempotencyKey: newUlid(),
  })
  return t.db.paymentCharge.findFirstOrThrow({ where: { userId: buyer.user.id } })
}

describe('charge auditing', () => {
  it('every charge attempt is an audited row with unique providerRef + idempotencyKey', async () => {
    const charge = await chargedSale()
    expect(charge.status).toBe('succeeded')
    expect(charge.providerRef).toMatch(/^sb_/)
    expect(charge.purpose).toBe('marketplace')
  })
})

describe('refunds are idempotent and capped', () => {
  it('replay never re-increments; over-refunds fail', async () => {
    const charge = await chargedSale()

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
    expect(rest).toMatchObject({ status: 'succeeded', amountMinor: 16000 })

    const over = await t.services.billing.refund({
      providerRef: charge.providerRef,
      amountMinor: 1,
      idempotencyKey: 'refund-3',
    })
    expect(over.status).toBe('failed')

    const updated = await t.db.paymentCharge.findUniqueOrThrow({ where: { id: charge.id } })
    expect(updated.refundedMinor).toBe(26000)
  })

  it('refunding an unknown charge fails closed', async () => {
    await expect(
      t.services.billing.refund({ providerRef: 'sb_nope', idempotencyKey: newUlid() }),
    ).rejects.toThrow(/not_found/)
  })
})

describe('unverified webhooks', () => {
  it('are stored for forensics but never processed', async () => {
    const res = await fetch(`${t.url}/webhooks/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-somo-signature': 'deadbeef' },
      body: JSON.stringify({ id: 'evt_fake', type: 'charge.succeeded', providerRef: 'sb_x' }),
    })
    expect(res.status).toBe(401)
    const row = await t.db.webhookDelivery.findFirstOrThrow()
    expect(row.verified).toBe(false)
    expect(row.processedAt).toBeNull()
  })
})
