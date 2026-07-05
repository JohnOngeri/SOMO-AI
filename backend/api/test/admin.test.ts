import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { newUlid } from '../src/ids'
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

/** An institution with a live license and a logged-in HQ admin session. */
async function institutionWithAdmin(
  role: 'HQ_ADMIN' | 'COORDINATOR' = 'HQ_ADMIN',
  phone = '+254780000001',
) {
  const inst = await t.services.seats.createInstitution({
    name: 'Teach For All — Kenya',
    type: 'FELLOWSHIP',
    country: 'KE',
  })
  const license = await t.services.seats.createLicense({
    institutionId: inst.id,
    term: '2026-T2',
    startDate: new Date(Date.now() - 10 * DAY),
    endDate: new Date(Date.now() + 80 * DAY),
    seatsPurchased: 20,
    pricePerSeatMinor: 1200,
    currency: 'USD',
    monthlyAiCallsPerSeat: 100,
    monthlySmsPerSeat: 50,
  })
  await t.services.admin.addAdmin({ institutionId: inst.id, phone, role, displayName: 'Achieng' })
  const session = await signUp(t, phone)
  return { inst, license, session, api: t.client(session.accessToken) }
}

describe('console access control', () => {
  it('non-admin users are refused', async () => {
    const s = await signUp(t, '+254780000010')
    await expect(t.client(s.accessToken).admin.overview.query()).rejects.toThrow(
      /not_an_institution_admin/,
    )
  })

  it('admins are tenant-scoped: institution A cannot touch institution B', async () => {
    const a = await institutionWithAdmin('HQ_ADMIN', '+254780000011')
    const b = await institutionWithAdmin('HQ_ADMIN', '+254780000012')

    await expect(a.api.admin.seats.list.query({ licenseId: b.license.id })).rejects.toThrow(
      /NOT_FOUND|not_found/,
    )
    await expect(
      a.api.admin.seats.generate.mutate({ licenseId: b.license.id, count: 1 }),
    ).rejects.toThrow(/NOT_FOUND|not_found/)
  })

  it('coordinators can view and manage seats but not bulk-generate', async () => {
    const c = await institutionWithAdmin('COORDINATOR', '+254780000013')
    await expect(
      c.api.admin.seats.generate.mutate({ licenseId: c.license.id, count: 2 }),
    ).rejects.toThrow(/HQ_ADMIN/)
    // viewing is fine
    expect(await c.api.admin.seats.list.query({ licenseId: c.license.id })).toEqual([])
  })
})

describe('seat operations from the console', () => {
  it('generates labelled seats and returns plaintext PINs exactly once', async () => {
    const { api, license } = await institutionWithAdmin()
    const issued = await api.admin.seats.generate.mutate({
      licenseId: license.id,
      count: 3,
      labels: ['Amina W.', 'Baraka O.', 'Chebet K.'],
    })
    expect(issued).toHaveLength(3)
    expect(issued[0]).toMatchObject({ label: 'Amina W.' })
    for (const s of issued) expect(s.pin).toMatch(/^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/)

    // the listing never exposes PINs
    const list = await api.admin.seats.list.query({ licenseId: license.id })
    expect(list).toHaveLength(3)
    expect(JSON.stringify(list)).not.toContain(issued[0]!.pin.replace('-', ''))
  })

  it('roster import creates one labelled seat per row', async () => {
    const { api, license } = await institutionWithAdmin()
    const issued = await api.admin.seats.importRoster.mutate({
      licenseId: license.id,
      rows: [{ name: 'Dama T.' }, { name: 'Ekai L.' }],
    })
    expect(issued.map((s) => s.label)).toEqual(['Dama T.', 'Ekai L.'])
  })

  it('shows per-seat usage + last-active once teachers redeem and work', async () => {
    const { api, license } = await institutionWithAdmin()
    const [issued] = await api.admin.seats.generate.mutate({ licenseId: license.id, count: 1 })

    const teacher = await signUp(t, '+254780000020')
    await t.client(teacher.accessToken).auth.redeemPin.mutate({ pin: issued!.pin })
    await t
      .client(teacher.accessToken)
      .coach.ask.mutate({ id: newUlid(), question: 'How do I teach fractions?', mode: 'text' })

    const [row] = await api.admin.seats.list.query({ licenseId: license.id })
    expect(row!.status).toBe('ACTIVE')
    expect(row!.teacherPhone).toBe('+254780000020')
    expect(row!.aiCallsThisMonth).toBe(1)
    expect(row!.lastActiveAt).not.toBeNull()
  })

  it('revoke + reassign from the console rotates the PIN and cuts the old teacher off', async () => {
    const { api, license } = await institutionWithAdmin()
    const [issued] = await api.admin.seats.generate.mutate({ licenseId: license.id, count: 1 })

    const leaver = await signUp(t, '+254780000021')
    await t.client(leaver.accessToken).auth.redeemPin.mutate({ pin: issued!.pin })

    const seatRow = await t.db.seat.findFirstOrThrow({ where: { licenseId: license.id } })
    await api.admin.seats.revoke.mutate({ seatId: seatRow.id })

    // the leaver is fail-closed immediately
    await expect(
      t
        .client(leaver.accessToken)
        .coach.ask.mutate({ id: newUlid(), question: 'Hi?', mode: 'text' }),
    ).rejects.toThrow(/seat_required/)

    const { pin: freshPin } = await api.admin.seats.reassign.mutate({ seatId: seatRow.id })
    const joiner = await signUp(t, '+254780000022')
    const res = await t.client(joiner.accessToken).auth.redeemPin.mutate({ pin: freshPin })
    expect(res.claims.plan).toBe('org_seat')
  })
})

describe('overview + cost dashboard', () => {
  it('overview reports purchased vs issued vs claimed vs weekly-active', async () => {
    const { api, license } = await institutionWithAdmin()
    const issued = await api.admin.seats.generate.mutate({ licenseId: license.id, count: 5 })

    for (const [i, seat] of issued.slice(0, 2).entries()) {
      const teacher = await signUp(t, `+25478000003${i}`)
      await t.client(teacher.accessToken).auth.redeemPin.mutate({ pin: seat.pin })
      await t
        .client(teacher.accessToken)
        .coach.ask.mutate({ id: newUlid(), question: `Question ${i}?`, mode: 'text' })
    }

    const { institution, licenses } = await api.admin.overview.query()
    expect(institution.name).toContain('Teach For All')
    expect(licenses).toHaveLength(1)
    expect(licenses[0]).toMatchObject({
      seatsPurchased: 20,
      seatsIssued: 5,
      seatsClaimed: 2,
      activeThisWeek: 2,
      totalValueMinor: 24000,
    })
  })

  it('costs: actual from the metered ledger, ceiling from quotas, projection from run-rate', async () => {
    const { api, license } = await institutionWithAdmin()
    const issued = await api.admin.seats.generate.mutate({ licenseId: license.id, count: 2 })

    for (const [i, seat] of issued.entries()) {
      const teacher = await signUp(t, `+25478000004${i}`)
      await t.client(teacher.accessToken).auth.redeemPin.mutate({ pin: seat.pin })
      await t
        .client(teacher.accessToken)
        .coach.ask.mutate({ id: newUlid(), question: `Unique question ${i}?`, mode: 'text' })
    }
    // one SMS out
    const anyTeacher = await t.db.seat.findFirstOrThrow({
      where: { licenseId: license.id, teacherId: { not: null } },
    })
    await t.services.smsGate.sendGated(anyTeacher.teacherId!, '+254780000040', 'hello')

    const costs = await api.admin.costs.query({ licenseId: license.id })
    expect(costs.activeSeats).toBe(2)
    expect(costs.actual.aiCalls).toBe(2)
    expect(costs.actual.smsOut).toBe(1)
    // 2 × $0.005 + 1 × $0.01 = $0.02 = 20,000 micro-USD
    expect(costs.actual.usdMicro).toBe(20000)
    // ceiling: 2 seats × (100 ai × 5000 + 50 sms × 10000) = 2 × 1,000,000 = 2,000,000
    expect(costs.ceiling.usdMicro).toBe(2000000)
    expect(costs.projected.usdMicro).toBeGreaterThanOrEqual(costs.actual.usdMicro)
  })
})
