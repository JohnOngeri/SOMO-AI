import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { MockAiProvider } from '../src/coach/provider'
import { resetDb, seatUser, signUpSeated, startTestApp, type TestApp } from './helpers'

let t: TestApp

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

async function sms(from: string, text: string): Promise<void> {
  await fetch(`${t.url}/gateway/sms`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ from, to: '40404', text }),
  })
}

/** An issued-but-unclaimed seat + its PIN. */
async function freshPin() {
  const inst = await t.services.seats.createInstitution({
    name: 'Bridge Network',
    type: 'SCHOOL_NETWORK',
    country: 'KE',
  })
  const license = await t.services.seats.createLicense({
    institutionId: inst.id,
    term: '2026-T2',
    startDate: new Date(Date.now() - 86_400_000),
    endDate: new Date(Date.now() + 80 * 86_400_000),
    seatsPurchased: 3,
    pricePerSeatMinor: 1500,
    currency: 'USD',
  })
  const [issued] = await t.services.seats.generateSeats(license.id, 1)
  return issued!
}

describe('USSD — PIN gate', () => {
  it('an unbound MSISDN is only ever offered PIN entry', async () => {
    const screen = await ussd('+254760000001', '')
    expect(screen).toMatch(/^CON /)
    expect(screen).toContain('PIN')
    expect(screen).not.toContain('Ask Coach')
  })

  it('a valid PIN binds the number and unlocks the menu', async () => {
    const { pin } = await freshPin()
    const done = await ussd('+254760000002', pin)
    expect(done).toMatch(/^END Welcome/)

    const menu = await ussd('+254760000002', '')
    expect(menu).toMatch(/^CON /)
    expect(menu).toContain('Ask Coach')
  })

  it('an invalid PIN gets the coordinator message and no account state', async () => {
    const res = await ussd('+254760000003', 'WRONGPIN')
    expect(res).toContain('not registered')
    expect(res).toContain('coordinator')
  })

  it('a bound teacher asks the coach over USSD', async () => {
    const { pin } = await freshPin()
    await ussd('+254760000004', pin)
    const answer = await ussd('+254760000004', '1*how do i teach fractions')
    expect(answer).toMatch(/^END /)
    expect(answer).toContain('Coach advice')
    expect(mock().calls).toHaveLength(1)
  })

  it('reflections and seat summary work over USSD', async () => {
    const { pin } = await freshPin()
    await ussd('+254760000005', pin)

    const saved = await ussd('+254760000005', '2*1*the bottle top game worked')
    expect(saved).toContain('Saved')
    expect(await t.db.reflectionEntry.count()).toBe(1)

    const seat = await ussd('+254760000005', '4')
    expect(seat).toContain('Bridge Network')
    expect(seat).toContain('2026-T2')
  })
})

describe('SMS — PIN gate', () => {
  it('unbound numbers texting anything but a PIN are silently dropped (zero cost)', async () => {
    await sms('+254761000001', 'ASK how do i teach fractions')
    await sms('+254761000001', 'hello?')
    expect(t.sms.sent).toHaveLength(0)
    expect(mock().calls).toHaveLength(0)
  })

  it('PIN <pin> by SMS binds the seat and sends a welcome under the new quota', async () => {
    const { pin } = await freshPin()
    await sms('+254761000002', `PIN ${pin}`)
    expect(t.sms.sent).toHaveLength(1)
    expect(t.sms.sent[0]!.message).toContain('Welcome')

    // the welcome SMS consumed one metered sms_out
    const user = await t.db.user.findUniqueOrThrow({ where: { phone: '+254761000002' } })
    expect(await t.db.usageEvent.count({ where: { userId: user.id, type: 'sms_out' } })).toBe(1)
    expect(await t.db.usageEvent.count({ where: { userId: user.id, type: 'seat_redeemed' } })).toBe(
      1,
    )
  })

  it('a wrong PIN by SMS produces NO reply and NO state', async () => {
    await sms('+254761000003', 'PIN ZZZZZZZZ')
    expect(t.sms.sent).toHaveLength(0)
  })

  it('bound teachers use ASK / R1 / WEEK over SMS', async () => {
    const s = await signUpSeated(t, '+254761000004')
    void s
    await sms('+254761000004', 'ASK what warm-up game works for 60 learners?')
    expect(mock().calls).toHaveLength(1)
    expect(t.sms.sent.at(-1)!.message).toContain('Coach advice')

    await sms('+254761000004', 'R1 exit question first today')
    expect(t.sms.sent.at(-1)!.message).toContain('saved')

    await sms('+254761000004', 'WEEK')
    expect(t.sms.sent.at(-1)!.message).toContain('reflections')
  })

  it('lapsed licenses turn a bound number back into an unbound one', async () => {
    const s = await signUpSeated(t, '+254761000005')
    t.sms.sent = [] // discard the signup OTP
    await t.db.license.update({
      where: { id: s.license.id },
      data: { endDate: new Date(Date.now() - 1000) },
    })
    await sms('+254761000005', 'ASK anything?')
    expect(mock().calls).toHaveLength(0)
    expect(t.sms.sent).toHaveLength(0)

    const screen = await ussd('+254761000005', '')
    expect(screen).toContain('PIN')
  })
})

describe('quota degradation over the gateway', () => {
  it('an exhausted AI quota yields the polite renewal message, never a model call', async () => {
    const s = await signUpSeated(t, '+254762000001', { aiCalls: 1 })
    void seatUser
    await sms('+254762000001', 'ASK first question?')
    expect(mock().calls).toHaveLength(1)

    await sms('+254762000001', 'ASK second question?')
    expect(mock().calls).toHaveLength(1) // no second model call
    expect(t.sms.sent.at(-1)!.message).toContain('quota')

    // reflections still work over quota
    await sms('+254762000001', 'R2 still reflecting')
    expect(t.sms.sent.at(-1)!.message).toContain('saved')
    expect(
      await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'quota_block' } }),
    ).toBeGreaterThanOrEqual(1)
  })

  it('an exhausted SMS quota stops paid replies without burning AI credits', async () => {
    const s = await signUpSeated(t, '+254762000002', { sms: 0 })
    t.sms.sent = [] // discard the signup OTP
    await sms('+254762000002', 'ASK a question?')
    expect(mock().calls).toHaveLength(0) // AI credit NOT burned
    expect(t.sms.sent).toHaveLength(0) // no unauthorized SMS
    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'quota_block' } })).toBe(
      1,
    )
  })
})
