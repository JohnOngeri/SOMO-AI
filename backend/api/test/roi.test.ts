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

async function institutionFixture() {
  const inst = await t.services.seats.createInstitution({
    name: 'Nova Pioneer Network',
    type: 'SCHOOL_NETWORK',
    country: 'KE',
  })
  const license = await t.services.seats.createLicense({
    institutionId: inst.id,
    term: '2026-T2',
    startDate: new Date(Date.now() - 30 * DAY),
    endDate: new Date(Date.now() + 60 * DAY),
    seatsPurchased: 10,
    pricePerSeatMinor: 1500, // $15/seat/term
    currency: 'USD',
  })
  await t.services.admin.addAdmin({
    institutionId: inst.id,
    phone: '+254790000001',
    role: 'HQ_ADMIN',
  })
  const admin = await signUp(t, '+254790000001')
  return { inst, license, api: t.client(admin.accessToken) }
}

/** A claimed teacher with a controllable activity history. */
async function seededTeacher(
  licenseId: string,
  phone: string,
  opts: { claimedDaysAgo: number; asks: number; reflections: number; activityDaysAgo: number },
) {
  const s = await signUp(t, phone)
  const [issued] = await t.services.seats.generateSeats(licenseId, 1)
  const seat = await t.services.seats.redeemPin(issued!.pin, s.user.id)
  await t.db.seat.update({
    where: { id: seat.id },
    data: { claimedAt: new Date(Date.now() - opts.claimedDaysAgo * DAY) },
  })
  const when = new Date(Date.now() - opts.activityDaysAgo * DAY)
  for (let i = 0; i < opts.asks; i++) {
    await t.db.usageEvent.create({
      data: { id: newUlid(), userId: s.user.id, type: 'ai_call', at: when, meta: {} },
    })
  }
  for (let i = 0; i < opts.reflections; i++) {
    await t.db.reflectionEntry.create({
      data: {
        id: newUlid(),
        userId: s.user.id,
        date: new Date(when.getTime() + i * DAY).toISOString().slice(0, 10),
        slot: 1,
        mode: 'text',
        transcript: `reflection ${i}`,
        capturedAt: new Date(when.getTime() + i * DAY),
      },
    })
  }
  return s
}

describe('Impact & ROI report', () => {
  it('computes coverage, displaced mentor visits, competency, and the savings headline', async () => {
    const { license, api } = await institutionFixture()

    // teacher A: fully ramped (8 asks -> 1 displaced visit, 5 reflections), active this week
    await seededTeacher(license.id, '+254791000001', {
      claimedDaysAgo: 20,
      asks: 8,
      reflections: 5,
      activityDaysAgo: 2,
    })
    // teacher B: ramping (below competency baseline), inactive this week
    await seededTeacher(license.id, '+254791000002', {
      claimedDaysAgo: 10,
      asks: 2,
      reflections: 1,
      activityDaysAgo: 9,
    })

    const roi = await api.admin.roi.query({ licenseId: license.id })

    expect(roi.coverage).toMatchObject({
      seatsPurchased: 10,
      seatsClaimed: 2,
      weeklyActive: 1,
      weeklyActivePct: 50,
      reflectionsTotal: 6,
      coachInteractionsTotal: 10,
    })

    // 10 interactions / 8 per visit = 1 visit displaced = 3h, $15 saved
    expect(roi.mentorTime).toMatchObject({
      visitsDisplaced: 1,
      hoursSaved: 3,
      costSavedUsdMicro: 15_000_000,
    })
    expect(roi.mentorTime.assumptions.asksPerVisit).toBe(8)

    // only teacher A reached the 5-reflections + 3-asks baseline
    expect(roi.timeToCompetency.reached).toBe(1)
    expect(roi.timeToCompetency.ofClaimed).toBe(2)
    expect(roi.timeToCompetency.medianDays).not.toBeNull()

    // the sales metric: $15 license seat vs $7.50 saved per claimed seat so far
    expect(roi.roi.costPerSeatMinor).toBe(1500)
    expect(roi.roi.savedPerClaimedSeatUsdMicro).toBe(7_500_000)
    expect(roi.roi.totalSavedUsdMicro).toBe(15_000_000)
  })

  it('is tenant-scoped and safe on an empty license', async () => {
    const a = await institutionFixture()
    const other = await t.services.seats.createInstitution({
      name: 'Other Org',
      type: 'NGO',
      country: 'NG',
    })
    const otherLicense = await t.services.seats.createLicense({
      institutionId: other.id,
      term: '2026-T2',
      startDate: new Date(Date.now() - DAY),
      endDate: new Date(Date.now() + DAY),
      seatsPurchased: 5,
      pricePerSeatMinor: 1000,
      currency: 'USD',
    })
    await expect(a.api.admin.roi.query({ licenseId: otherLicense.id })).rejects.toThrow(
      /NOT_FOUND|not_found/,
    )

    const empty = await a.api.admin.roi.query({ licenseId: a.license.id })
    expect(empty.coverage.seatsClaimed).toBe(0)
    expect(empty.mentorTime.visitsDisplaced).toBe(0)
    expect(empty.timeToCompetency.medianDays).toBeNull()
  })
})
