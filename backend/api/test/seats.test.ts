import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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

const seats = () => t.services.seats

async function makeLicense(overrides: Record<string, unknown> = {}) {
  const inst = await seats().createInstitution({
    name: 'Teach For All — Kenya Pilot',
    type: 'FELLOWSHIP',
    country: 'KE',
    billingContactEmail: 'ops@teachforall.example',
  })
  const license = await seats().createLicense({
    institutionId: inst.id,
    term: '2026-T2',
    startDate: new Date(Date.now() - 10 * DAY),
    endDate: new Date(Date.now() + 80 * DAY),
    seatsPurchased: 5,
    pricePerSeatMinor: 1200, // $12/seat/term
    currency: 'USD',
    ...overrides,
  })
  return { inst, license }
}

describe('seat issuance', () => {
  it('bulk-generates seats with unique one-time PINs, hashed at rest', async () => {
    const { license } = await makeLicense()
    const issued = await seats().generateSeats(license.id, 5)

    expect(issued).toHaveLength(5)
    const pins = issued.map((i) => i.pin)
    expect(new Set(pins).size).toBe(5)
    for (const pin of pins) expect(pin).toMatch(/^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/)

    // plaintext never lands in the database
    const rows = await t.db.seat.findMany()
    for (const row of rows) {
      expect(row.status).toBe('UNCLAIMED')
      for (const pin of pins) {
        expect(row.authPinHash).not.toContain(pin.replace('-', ''))
      }
      expect(row.authPinHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('refuses to issue beyond seatsPurchased', async () => {
    const { license } = await makeLicense()
    await seats().generateSeats(license.id, 4)
    await expect(seats().generateSeats(license.id, 2)).rejects.toThrow(/seat_capacity|unissued/)
    // the remaining one still issues fine
    await expect(seats().generateSeats(license.id, 1)).resolves.toHaveLength(1)
  })
})

describe('PIN redemption', () => {
  it('binds an UNCLAIMED seat to the teacher; re-entry by the same teacher is idempotent', async () => {
    const { license } = await makeLicense()
    const [issued] = await seats().generateSeats(license.id, 1)
    const teacher = await signUp(t, '+254750000001')

    const seat = await seats().redeemPin(issued!.pin, teacher.user.id)
    expect(seat.status).toBe('ACTIVE')
    expect(seat.teacherId).toBe(teacher.user.id)
    expect(seat.claimedAt).not.toBeNull()

    // PIN formatting is forgiving: lowercase, spaces, missing dash
    const again = await seats().redeemPin(
      issued!.pin.toLowerCase().replace('-', ' '),
      teacher.user.id,
    )
    expect(again.id).toBe(seat.id)
  })

  it('rejects wrong PINs, reused PINs, and double-seating', async () => {
    const { license } = await makeLicense()
    const [a, b] = await seats().generateSeats(license.id, 2)
    const t1 = await signUp(t, '+254750000002')
    const t2 = await signUp(t, '+254750000003')

    await expect(seats().redeemPin('AAAA-AAAA', t1.user.id)).rejects.toThrow(/invalid_pin/)

    await seats().redeemPin(a!.pin, t1.user.id)
    // someone else tries the same PIN
    await expect(seats().redeemPin(a!.pin, t2.user.id)).rejects.toThrow(/pin_already_used/)
    // a seated teacher cannot claim a second seat
    await expect(seats().redeemPin(b!.pin, t1.user.id)).rejects.toThrow(/already holds a seat/)
  })

  it('rejects redemption on expired, suspended, not-yet-started, and revoked states', async () => {
    const teacher = await signUp(t, '+254750000004')

    const expired = await makeLicense({
      startDate: new Date(Date.now() - 100 * DAY),
      endDate: new Date(Date.now() - 5 * DAY),
    })
    const [ePin] = await seats().generateSeats(expired.license.id, 1)
    await expect(seats().redeemPin(ePin!.pin, teacher.user.id)).rejects.toThrow(/license_inactive/)

    const future = await makeLicense({ startDate: new Date(Date.now() + 30 * DAY) })
    const [fPin] = await seats().generateSeats(future.license.id, 1)
    await expect(seats().redeemPin(fPin!.pin, teacher.user.id)).rejects.toThrow(/license_inactive/)

    const ok = await makeLicense()
    const [rPin] = await seats().generateSeats(ok.license.id, 1)
    const seatRow = await t.db.seat.findFirstOrThrow({ where: { licenseId: ok.license.id } })
    await seats().revokeSeat(seatRow.id)
    await expect(seats().redeemPin(rPin!.pin, teacher.user.id)).rejects.toThrow(/seat_revoked/)

    const suspended = await makeLicense()
    await t.db.license.update({
      where: { id: suspended.license.id },
      data: { status: 'SUSPENDED' },
    })
    const [sPin] = await seats().generateSeats(suspended.license.id, 1)
    await expect(seats().redeemPin(sPin!.pin, teacher.user.id)).rejects.toThrow(/license_inactive/)
  })
})

describe('activeSeatFor — the fail-closed authorization question', () => {
  it('answers with the seat + license inside the term, null outside it', async () => {
    const { license } = await makeLicense()
    const [issued] = await seats().generateSeats(license.id, 1)
    const teacher = await signUp(t, '+254750000005')
    await seats().redeemPin(issued!.pin, teacher.user.id)

    const live = await seats().activeSeatFor(teacher.user.id)
    expect(live).not.toBeNull()
    expect(live!.license.term).toBe('2026-T2')

    // ...but the day after the license ends, the same seat answers null —
    // no cron required, the gate itself fails closed
    const afterTerm = new Date(license.endDate.getTime() + DAY)
    expect(await seats().activeSeatFor(teacher.user.id, afterTerm)).toBeNull()

    // and by phone (the USSD/SMS identity)
    expect(await seats().activeSeatForPhone('+254750000005')).not.toBeNull()
    expect(await seats().activeSeatForPhone('+254799999999')).toBeNull()
  })

  it('answers null for seatless users, revoked seats, and suspended institutions', async () => {
    const seatless = await signUp(t, '+254750000006')
    expect(await seats().activeSeatFor(seatless.user.id)).toBeNull()

    const { inst, license } = await makeLicense()
    const [issued] = await seats().generateSeats(license.id, 1)
    const teacher = await signUp(t, '+254750000007')
    const seat = await seats().redeemPin(issued!.pin, teacher.user.id)

    await t.db.institution.update({ where: { id: inst.id }, data: { status: 'SUSPENDED' } })
    expect(await seats().activeSeatFor(teacher.user.id)).toBeNull()
    await t.db.institution.update({ where: { id: inst.id }, data: { status: 'ACTIVE' } })

    await seats().revokeSeat(seat.id)
    expect(await seats().activeSeatFor(teacher.user.id)).toBeNull()
  })

  it('resolves quota from license defaults with per-seat overrides winning', async () => {
    const { license } = await makeLicense({ monthlyAiCallsPerSeat: 100, monthlySmsPerSeat: 40 })
    const [issued] = await seats().generateSeats(license.id, 1)
    const teacher = await signUp(t, '+254750000008')
    const seat = await seats().redeemPin(issued!.pin, teacher.user.id)

    const live = await seats().activeSeatFor(teacher.user.id)
    expect(seats().quotaFor(live!)).toEqual({ monthlyAiCalls: 100, monthlySms: 40 })

    await t.db.seat.update({ where: { id: seat.id }, data: { monthlyAiCallsOverride: 250 } })
    const updated = await seats().activeSeatFor(teacher.user.id)
    expect(seats().quotaFor(updated!)).toEqual({ monthlyAiCalls: 250, monthlySms: 40 })
  })
})

describe('seat lifecycle', () => {
  it('revoke -> reassign mints a fresh PIN and kills the old one', async () => {
    const { license } = await makeLicense()
    const [issued] = await seats().generateSeats(license.id, 1)
    const leaver = await signUp(t, '+254750000009')
    const seat = await seats().redeemPin(issued!.pin, leaver.user.id)

    await seats().revokeSeat(seat.id)
    const { pin: freshPin } = await seats().reassignSeat(seat.id)
    expect(freshPin).not.toBe(issued!.pin)

    // the departed teacher's PIN is dead
    const other = await signUp(t, '+254750000010')
    await expect(seats().redeemPin(issued!.pin, other.user.id)).rejects.toThrow(/invalid_pin/)
    // the fresh PIN seats the replacement
    const rebound = await seats().redeemPin(freshPin, other.user.id)
    expect(rebound.id).toBe(seat.id)
    expect(rebound.teacherId).toBe(other.user.id)
  })

  it('cannot reassign a live seat without revoking first', async () => {
    const { license } = await makeLicense()
    const [issued] = await seats().generateSeats(license.id, 1)
    const teacher = await signUp(t, '+254750000011')
    const seat = await seats().redeemPin(issued!.pin, teacher.user.id)
    await expect(seats().reassignSeat(seat.id)).rejects.toThrow(/invalid_state|revoke/)
  })

  it('expireLapsedLicenses flips only lapsed ACTIVE licenses', async () => {
    await makeLicense({ endDate: new Date(Date.now() - DAY) }) // lapsed
    await makeLicense() // live
    const flipped = await seats().expireLapsedLicenses()
    expect(flipped).toBe(1)
    expect(await t.db.license.count({ where: { status: 'EXPIRED' } })).toBe(1)
    expect(await t.db.license.count({ where: { status: 'ACTIVE' } })).toBe(1)
  })
})
