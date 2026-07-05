import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { quoteSeats } from '../src/billing/pricing'
import { resetDb, signUp, startTestApp, type TestApp } from './helpers'

let t: TestApp
const DAY = 86_400_000

beforeEach(async () => {
  if (!t) t = await startTestApp()
  await resetDb(t.db)
  t.sms.sent = []
})

afterAll(async () => {
  await t?.close()
})

describe('pricing config (pure)', () => {
  it('applies tier bases and volume breaks', () => {
    // NGO $15 base, no discount under 200 seats
    expect(quoteSeats('NGO', 50, 'USD')).toMatchObject({
      perSeatMinor: 1500,
      discountPct: 0,
      totalMinor: 75000,
    })
    // 10% at 200+, 20% at 1000+
    expect(quoteSeats('NGO', 200, 'USD').perSeatMinor).toBe(1350)
    expect(quoteSeats('NGO', 1000, 'USD').perSeatMinor).toBe(1200)
    // ministry tier: $7 base, 30% at 20k seats
    expect(quoteSeats('MINISTRY', 20000, 'USD')).toMatchObject({
      perSeatMinor: 490,
      discountPct: 30,
    })
  })

  it('converts to local currency via the FX table', () => {
    // $15 at 129 KES/USD = KES 1,935 -> 193,500 minor
    expect(quoteSeats('NGO', 10, 'KES').perSeatMinor).toBe(193500)
    expect(() => quoteSeats('NGO', 10, 'EUR')).toThrow(/unsupported currency/)
    expect(() => quoteSeats('CIRCUS', 10, 'USD')).toThrow(/no pricing tier/)
  })
})

describe('quote -> order -> invoice -> paid -> provisioned license', () => {
  async function somoStaff() {
    const s = await signUp(t, '+254796000001')
    await t.db.user.update({ where: { id: s.user.id }, data: { role: 'somo_admin' } })
    await t.db.otpChallenge.deleteMany({})
    const again = await signUp(t, '+254796000001')
    return t.client(again.accessToken)
  }

  it('runs the whole pipeline and only provisions seats on payment', async () => {
    const api = await somoStaff()
    const inst = await api.sales.createInstitution.mutate({
      name: 'Bridge International — Kenya',
      type: 'SCHOOL_NETWORK',
      country: 'KE',
      billingContactEmail: 'finance@bridge.example',
    })

    const quote = await api.sales.createQuote.mutate({
      institutionId: inst.id,
      term: '2026-T3',
      startDate: new Date(Date.now() + DAY).toISOString(),
      endDate: new Date(Date.now() + 100 * DAY).toISOString(),
      seats: 500,
      currency: 'USD',
    })
    // school network $12 base with 10% at 500 seats
    expect(quote).toMatchObject({
      status: 'QUOTE',
      perSeatMinor: 1080,
      discountPct: 10,
      totalMinor: 540000,
    })

    // no license exists until money moves
    expect(await t.db.license.count()).toBe(0)

    await api.sales.acceptQuote.mutate({ orderId: quote.id })
    const invoice = await api.sales.issueInvoice.mutate({ orderId: quote.id })
    expect(invoice.number).toMatch(/^INV-\d{4}-0001$/)
    expect(invoice.totalMinor).toBe(540000)
    expect(await t.db.license.count()).toBe(0) // still nothing — invoice unpaid

    const { license } = await api.sales.markPaid.mutate({
      invoiceId: invoice.id,
      paymentRef: 'BANKTRF-88213',
    })
    expect(license).not.toBeNull()
    expect(license!.seatsPurchased).toBe(500)
    expect(license!.pricePerSeatMinor).toBe(1080)
    expect(license!.status).toBe('ACTIVE')

    // idempotent: paying twice provisions nothing new
    const again = await api.sales.markPaid.mutate({
      invoiceId: invoice.id,
      paymentRef: 'BANKTRF-88213',
    })
    expect(again.license!.id).toBe(license!.id)
    expect(await t.db.license.count()).toBe(1)

    const order = await t.db.order.findUniqueOrThrow({ where: { id: quote.id } })
    expect(order.status).toBe('PAID')
  })

  it('issueInvoice is idempotent and numbers are sequential', async () => {
    const api = await somoStaff()
    const inst = await api.sales.createInstitution.mutate({
      name: 'TFA Pilot',
      type: 'FELLOWSHIP',
      country: 'NG',
    })
    const mkOrder = async () => {
      const q = await api.sales.createQuote.mutate({
        institutionId: inst.id,
        term: '2026-T3',
        startDate: new Date(Date.now() + DAY).toISOString(),
        endDate: new Date(Date.now() + 90 * DAY).toISOString(),
        seats: 15,
        currency: 'USD',
      })
      await api.sales.acceptQuote.mutate({ orderId: q.id })
      return q
    }
    const a = await mkOrder()
    const b = await mkOrder()
    const invA1 = await api.sales.issueInvoice.mutate({ orderId: a.id })
    const invA2 = await api.sales.issueInvoice.mutate({ orderId: a.id })
    const invB = await api.sales.issueInvoice.mutate({ orderId: b.id })
    expect(invA2.id).toBe(invA1.id)
    expect(invA1.number.endsWith('-0001')).toBe(true)
    expect(invB.number.endsWith('-0002')).toBe(true)
  })

  it('sales endpoints are somo_admin-only; institutions see their invoices in the console', async () => {
    const staff = await somoStaff()
    const inst = await staff.sales.createInstitution.mutate({
      name: 'Invoice Viewer Org',
      type: 'NGO',
      country: 'KE',
    })
    await staff.sales.addAdmin.mutate({
      institutionId: inst.id,
      phone: '+254796000002',
      role: 'HQ_ADMIN',
    })
    const q = await staff.sales.createQuote.mutate({
      institutionId: inst.id,
      term: '2026-T3',
      startDate: new Date(Date.now() + DAY).toISOString(),
      endDate: new Date(Date.now() + 90 * DAY).toISOString(),
      seats: 20,
      currency: 'KES',
    })
    await staff.sales.acceptQuote.mutate({ orderId: q.id })
    await staff.sales.issueInvoice.mutate({ orderId: q.id })

    const coordinator = await signUp(t, '+254796000002')
    const invoices = await t.client(coordinator.accessToken).admin.invoices.query()
    expect(invoices).toHaveLength(1)
    expect(invoices[0]!.currency).toBe('KES')
    expect(invoices[0]!.order.seats).toBe(20)

    // and a coordinator cannot reach the sales surface
    await expect(
      t.client(coordinator.accessToken).sales.createInstitution.mutate({
        name: 'X',
        type: 'NGO',
        country: 'KE',
      }),
    ).rejects.toThrow(/somo_admin_required/)
  })
})
