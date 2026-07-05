import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { SandboxPaymentProvider } from '@somo/payments'
import { newUlid } from '../src/ids'
import { splitFee } from '../src/marketplace/service'
import { resetDb, signUp, startTestApp, type TestApp } from './helpers'

let t: TestApp

beforeEach(async () => {
  if (!t) t = await startTestApp()
  await resetDb(t.db)
  t.sms.sent = []
})

afterAll(async () => {
  await t?.close()
})

const sandbox = () => t.services.payments as SandboxPaymentProvider
const GOOD_MSISDN = '+254712345678'
const PENDING_MSISDN = '+254700001111'
const PRICE = 26000 // KES 260

async function makeCreatorWithPaidPack() {
  const first = await signUp(t, '+254730000001')
  await t.db.user.update({ where: { id: first.user.id }, data: { role: 'creator' } })
  await t.db.otpChallenge.deleteMany({})
  const creator = await signUp(t, '+254730000001')
  const pub = await t.client(creator.accessToken).packs.publish.mutate({
    slug: `paid-pack-${newUlid().slice(-6).toLowerCase()}`,
    title: 'Premium Literacy Pack',
    subject: 'Literacy',
    gradeLevels: ['P5'],
    locale: 'en',
    version: '1.0.0',
    lessons: [{ index: 0, title: 'Phonics drills', minutes: 30 }],
    priceAmountMinor: PRICE,
    priceCurrency: 'KES',
    archiveBase64: Buffer.from('premium-content').toString('base64'),
  })
  return { creator, pack: pub.manifest }
}

async function ledgerSumsByRef() {
  const entries = await t.db.ledgerEntry.findMany()
  const byRef = new Map<string, number>()
  for (const e of entries) byRef.set(e.refId, (byRef.get(e.refId) ?? 0) + e.amountMinor)
  return byRef
}

describe('buying a pack', () => {
  it('splits 25% platform fee, grants the pack, and balances the ledger', async () => {
    const { creator, pack } = await makeCreatorWithPaidPack()
    const buyer = await signUp(t, '+254730000002')
    const api = t.client(buyer.accessToken)

    const result = await api.marketplace.buy.mutate({
      idempotencyKey: newUlid(),
      packId: pack.id,
      channel: 'mobile_money',
      msisdn: GOOD_MSISDN,
    })
    expect(result.alreadyOwned).toBe(false)

    const { feeMinor, netMinor } = splitFee(PRICE)
    expect(feeMinor).toBe(6500)
    expect(netMinor).toBe(19500)

    const sale = await t.db.sale.findFirstOrThrow({ where: { buyerId: buyer.user.id } })
    expect(sale).toMatchObject({
      grossMinor: PRICE,
      platformFeeMinor: feeMinor,
      creatorNetMinor: netMinor,
      creatorId: creator.user.id,
    })

    // journal balances to zero per refId
    for (const [ref, sum] of await ledgerSumsByRef()) {
      expect(sum, `refId ${ref}`).toBe(0)
    }

    // a FREE-plan buyer can now download the paid pack all the way to bytes
    const dl = await api.packs.download.mutate({ id: pack.id })
    const res = await fetch(`${t.url}${dl.archivePath}`, {
      headers: { authorization: `Bearer ${buyer.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('is idempotent: retried key and repeat purchase never double-charge', async () => {
    const { pack } = await makeCreatorWithPaidPack()
    const buyer = await signUp(t, '+254730000003')
    const api = t.client(buyer.accessToken)
    const key = newUlid()
    const input = {
      idempotencyKey: key,
      packId: pack.id,
      channel: 'mobile_money' as const,
      msisdn: GOOD_MSISDN,
    }
    const a = await api.marketplace.buy.mutate(input)
    expect(a.alreadyOwned).toBe(false)
    const b = await api.marketplace.buy.mutate(input)
    expect(b.alreadyOwned).toBe(true)
    const c = await api.marketplace.buy.mutate({ ...input, idempotencyKey: newUlid() })
    expect(c.alreadyOwned).toBe(true)

    expect(await t.db.sale.count()).toBe(1)
    expect(await t.db.paymentCharge.count({ where: { userId: buyer.user.id } })).toBe(1)
  })

  it('failed charges produce no grant, no sale, no ledger entries', async () => {
    const { pack } = await makeCreatorWithPaidPack()
    const buyer = await signUp(t, '+254730000004')
    await expect(
      t.client(buyer.accessToken).marketplace.buy.mutate({
        idempotencyKey: newUlid(),
        packId: pack.id,
        channel: 'mobile_money',
        msisdn: '+254700000000',
      }),
    ).rejects.toThrow(/charge_failed|insufficient/)
    expect(await t.db.sale.count()).toBe(0)
    expect(await t.db.packGrant.count()).toBe(0)
    expect(await t.db.ledgerEntry.count()).toBe(0)
  })

  it('free packs are not for sale', async () => {
    const { creator } = await makeCreatorWithPaidPack()
    const freePub = await t.client(creator.accessToken).packs.publish.mutate({
      slug: 'free-pack-x',
      title: 'Free Pack',
      subject: 'Maths',
      gradeLevels: ['P4'],
      locale: 'en',
      version: '1.0.0',
      lessons: [{ index: 0, title: 'L', minutes: 30 }],
      priceAmountMinor: 0,
      priceCurrency: 'KES',
      archiveBase64: Buffer.from('x').toString('base64'),
    })
    const buyer = await signUp(t, '+254730000005')
    await expect(
      t.client(buyer.accessToken).marketplace.buy.mutate({
        idempotencyKey: newUlid(),
        packId: freePub.manifest.id,
        channel: 'mobile_money',
        msisdn: GOOD_MSISDN,
      }),
    ).rejects.toThrow(/not_for_sale|free/)
  })

  it('pending mobile-money purchase completes through the webhook', async () => {
    const { pack } = await makeCreatorWithPaidPack()
    const buyer = await signUp(t, '+254730000006')
    const api = t.client(buyer.accessToken)

    await expect(
      api.marketplace.buy.mutate({
        idempotencyKey: newUlid(),
        packId: pack.id,
        channel: 'mobile_money',
        msisdn: PENDING_MSISDN,
      }),
    ).rejects.toThrow(/payment_pending|CONFLICT/)
    expect(await t.db.sale.count()).toBe(0)

    const charge = await t.db.paymentCharge.findFirstOrThrow({
      where: { userId: buyer.user.id },
    })
    const { rawBody, signature } = sandbox().settlePending(charge.providerRef, 'succeeded')
    const res = await fetch(`${t.url}/webhooks/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-somo-signature': signature },
      body: rawBody,
    })
    expect(res.status).toBe(200)

    expect(await t.db.sale.count()).toBe(1)
    expect(await t.db.packGrant.count({ where: { userId: buyer.user.id } })).toBe(1)
    for (const [, sum] of await ledgerSumsByRef()) expect(sum).toBe(0)
  })
})

describe('creator earnings + payouts', () => {
  it('earnings reflect net revenue; payout drains the balance with a balanced journal', async () => {
    const { creator, pack } = await makeCreatorWithPaidPack()
    for (const phone of ['+254730000010', '+254730000011']) {
      const buyer = await signUp(t, phone)
      await t.client(buyer.accessToken).marketplace.buy.mutate({
        idempotencyKey: newUlid(),
        packId: pack.id,
        channel: 'mobile_money',
        msisdn: GOOD_MSISDN,
      })
    }

    const api = t.client(creator.accessToken)
    const before = await api.marketplace.earnings.query()
    expect(before.balanceMinor).toBe(19500 * 2)
    expect(before.lifetimeNetMinor).toBe(19500 * 2)
    expect(before.sales).toHaveLength(2)

    const payout = await api.marketplace.requestPayout.mutate({
      idempotencyKey: newUlid(),
      currency: 'KES',
    })
    expect(payout.status).toBe('paid')
    expect(payout.amountMinor).toBe(39000)

    const after = await api.marketplace.earnings.query()
    expect(after.balanceMinor).toBe(0)
    expect(after.paidOutMinor).toBe(39000)
    for (const [, sum] of await ledgerSumsByRef()) expect(sum).toBe(0)

    // platform kept its 25%
    const revenue = await t.db.ledgerEntry.aggregate({
      where: { account: 'platform:revenue' },
      _sum: { amountMinor: true },
    })
    expect(revenue._sum.amountMinor).toBe(6500 * 2)
  })

  it('payout requests are idempotent and refuse dust balances', async () => {
    const { creator, pack } = await makeCreatorWithPaidPack()
    const buyer = await signUp(t, '+254730000012')
    await t.client(buyer.accessToken).marketplace.buy.mutate({
      idempotencyKey: newUlid(),
      packId: pack.id,
      channel: 'mobile_money',
      msisdn: GOOD_MSISDN,
    })

    const api = t.client(creator.accessToken)
    const key = newUlid()
    const p1 = await api.marketplace.requestPayout.mutate({ idempotencyKey: key, currency: 'KES' })
    const p2 = await api.marketplace.requestPayout.mutate({ idempotencyKey: key, currency: 'KES' })
    expect(p2.id).toBe(p1.id)
    // balance now zero -> a fresh request refuses
    await expect(
      api.marketplace.requestPayout.mutate({ idempotencyKey: newUlid(), currency: 'KES' }),
    ).rejects.toThrow(/insufficient_balance/)
  })

  it('non-creators cannot read earnings or cash out', async () => {
    const teacher = await signUp(t, '+254730000013')
    await expect(t.client(teacher.accessToken).marketplace.earnings.query()).rejects.toThrow(
      /FORBIDDEN|creator/,
    )
  })
})

describe('refunding a sale', () => {
  it('reverses the journal, revokes the grant, and blocks re-download', async () => {
    const { pack } = await makeCreatorWithPaidPack()
    const buyer = await signUp(t, '+254730000020')
    const api = t.client(buyer.accessToken)
    await api.marketplace.buy.mutate({
      idempotencyKey: newUlid(),
      packId: pack.id,
      channel: 'mobile_money',
      msisdn: GOOD_MSISDN,
    })

    const sale = await t.db.sale.findFirstOrThrow()
    const refunded = await t.services.marketplace.refundSale(sale.id, newUlid())
    expect(refunded.refunded).toBe(true)
    // idempotent
    const again = await t.services.marketplace.refundSale(sale.id, newUlid())
    expect(again.refunded).toBe(true)
    expect(await t.db.ledgerEntry.count({ where: { type: 'refund' } })).toBe(3)

    for (const [, sum] of await ledgerSumsByRef()) expect(sum).toBe(0)
    // creator + revenue net to zero after the reversal
    for (const account of ['platform:revenue']) {
      const agg = await t.db.ledgerEntry.aggregate({
        where: { account },
        _sum: { amountMinor: true },
      })
      expect(agg._sum.amountMinor).toBe(0)
    }

    await expect(api.packs.download.mutate({ id: pack.id })).rejects.toThrow(
      /purchase or SOMO Plus/,
    )
  })
})
