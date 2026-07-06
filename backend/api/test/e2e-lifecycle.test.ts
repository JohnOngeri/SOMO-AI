import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { MockAiProvider } from '../src/coach/provider'
import { newUlid } from '../src/ids'
import { resetDb, signUp, startTestApp, type TestApp } from './helpers'

/**
 * THE PIVOT JOURNEY, end to end over real HTTP + real Postgres:
 * SOMO sells a license → coordinator generates seats + PIN sheet → one
 * teacher redeems in the app, another over USSD → both coach until the
 * quota gracefully stops them → a seat is revoked → the license expires →
 * every access path degrades correctly, with zero unauthorized LLM calls.
 */

let t: TestApp
const DAY = 86_400_000

beforeEach(async () => {
  if (!t) t = await startTestApp()
  await resetDb(t.db)
  t.sms.sent = []
  mock().calls = []
})

afterAll(async () => {
  await t?.close()
})

const mock = () => t.services.ai as MockAiProvider

async function ussd(phoneNumber: string, text: string): Promise<string> {
  const res = await fetch(`${t.url}/gateway/ussd`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sessionId: 'AT1', serviceCode: '*384#', phoneNumber, text }),
  })
  return res.text()
}

describe('full institutional lifecycle', () => {
  it('sale → PIN sheet → app + USSD redemption → quota → revoke → expiry', async () => {
    // ── 1. SOMO sells: quote → invoice → paid → license provisioned ──
    const staffSignup = await signUp(t, '+254799900001')
    await t.db.user.update({ where: { id: staffSignup.user.id }, data: { role: 'somo_admin' } })
    await t.db.otpChallenge.deleteMany({})
    const staff = t.client((await signUp(t, '+254799900001')).accessToken)

    const inst = await staff.sales.createInstitution.mutate({
      name: 'Lifecycle Fellowship',
      type: 'FELLOWSHIP',
      country: 'KE',
    })
    const quote = await staff.sales.createQuote.mutate({
      institutionId: inst.id,
      term: '2026-T2',
      startDate: new Date(Date.now() - DAY).toISOString(),
      endDate: new Date(Date.now() + 89 * DAY).toISOString(),
      seats: 5,
      currency: 'USD',
    })
    await staff.sales.acceptQuote.mutate({ orderId: quote.id })
    const invoice = await staff.sales.issueInvoice.mutate({ orderId: quote.id })
    const { license } = await staff.sales.markPaid.mutate({
      invoiceId: invoice.id,
      paymentRef: 'BANKTRF-E2E',
    })
    await staff.sales.addAdmin.mutate({
      institutionId: inst.id,
      phone: '+254799900002',
      role: 'HQ_ADMIN',
    })
    // tighten the quota so the test can exhaust it quickly
    await t.db.license.update({
      where: { id: license!.id },
      data: { monthlyAiCallsPerSeat: 2 },
    })

    // ── 2. Coordinator generates the PIN sheet ───────────────────────
    const coordinator = t.client((await signUp(t, '+254799900002')).accessToken)
    const pins = await coordinator.admin.seats.generate.mutate({
      licenseId: license!.id,
      count: 2,
      labels: ['App Teacher', 'USSD Teacher'],
    })
    expect(pins).toHaveLength(2)

    // ── 3. Teacher A redeems in the app and coaches ──────────────────
    const appTeacher = await signUp(t, '+254799900010')
    const appApi = t.client(appTeacher.accessToken)
    const redemption = await appApi.auth.redeemPin.mutate({ pin: pins[0]!.pin })
    expect(redemption.claims.plan).toBe('org_seat')
    // the offline seat token verifies on-device
    expect(t.services.entitlements.verifyOffline(redemption.token).ok).toBe(true)

    const ask1 = await appApi.coach.ask.mutate({
      id: newUlid(),
      question: 'How do I teach fractions with bottle tops?',
      mode: 'text',
    })
    expect(ask1.answer).toContain('Coach advice')

    // ── 4. Teacher B redeems and coaches over USSD (button phone) ────
    expect(await ussd('+254799900011', '')).toContain('PIN')
    expect(await ussd('+254799900011', pins[1]!.pin)).toContain('Welcome')
    const ussdAnswer = await ussd('+254799900011', '1*how do i manage a noisy class')
    expect(ussdAnswer).toMatch(/^END /)
    expect(mock().calls).toHaveLength(2)

    // ── 5. Quota exhausts gracefully: cached still serves, new blocks ─
    await appApi.coach.ask.mutate({ id: newUlid(), question: 'Second question?', mode: 'text' })
    await expect(
      appApi.coach.ask.mutate({
        id: newUlid(),
        question: 'Third distinct question?',
        mode: 'text',
      }),
    ).rejects.toThrow(/quota_exceeded/)
    const cachedOverQuota = await appApi.coach.ask.mutate({
      id: newUlid(),
      question: 'how do I teach fractions with bottle tops??',
      mode: 'text',
    })
    expect(cachedOverQuota.costTier).toBe('cached')
    expect(cachedOverQuota.degraded).toBe(true)
    expect(mock().calls).toHaveLength(3) // 2 + teacher A's second — never the blocked one

    // the console sees all of it
    const seatRows = await coordinator.admin.seats.list.query({ licenseId: license!.id })
    expect(seatRows.filter((s) => s.status === 'ACTIVE')).toHaveLength(2)
    const costs = await coordinator.admin.costs.query({ licenseId: license!.id })
    expect(costs.actual.aiCalls).toBe(3)

    // ── 6. Revoke teacher A: instant fail-closed cutoff ──────────────
    const seatA = seatRows.find((s) => s.teacherPhone === '+254799900010')!
    await coordinator.admin.seats.revoke.mutate({ seatId: seatA.id })
    await expect(
      appApi.coach.ask.mutate({ id: newUlid(), question: 'Am I still in?', mode: 'text' }),
    ).rejects.toThrow(/seat_required/)

    // ── 7. License expires: teacher B degrades to the PIN screen ─────
    await t.db.license.update({
      where: { id: license!.id },
      data: { endDate: new Date(Date.now() - 1000) },
    })
    expect(await ussd('+254799900011', '')).toContain('PIN')
    const invoices = await coordinator.admin.invoices.query()
    expect(invoices[0]!.paidAt).not.toBeNull()

    // the whole journey produced exactly 3 paid LLM calls — no leaks
    expect(mock().calls).toHaveLength(3)
    expect(await t.db.usageEvent.count({ where: { type: 'ai_call' } })).toBe(3)
  })
})
