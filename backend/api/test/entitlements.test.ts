import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDb, seatUser, signUp, signUpSeated, startTestApp, type TestApp } from './helpers'

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

describe('seat-derived entitlement claims', () => {
  it('seatless users get plan none with ZERO limits — fail closed', async () => {
    const s = await signUp(t, '+254711000001')
    const ent = await t.client(s.accessToken).entitlements.get.query()
    expect(ent.claims.plan).toBe('none')
    expect(ent.claims.limits).toEqual({ aiCallsPerMonth: 0, smsPerMonth: 0, maxActivePacks: 0 })
    expect(ent.claims.packs).toEqual([])
  })

  it('seated teachers get org_seat with the license quotas and all standard packs', async () => {
    const s = await signUpSeated(t, '+254711000002', { aiCalls: 120, sms: 60 })
    const ent = await t.client(s.accessToken).entitlements.get.query()
    expect(ent.claims.plan).toBe('org_seat')
    expect(ent.claims.seatId).toBe(s.seat.id)
    expect(ent.claims.licenseId).toBe(s.license.id)
    expect(ent.claims.limits).toEqual({
      aiCallsPerMonth: 120,
      smsPerMonth: 60,
      maxActivePacks: null,
    })
    expect(ent.claims.packs).toBe('all_standard')
  })

  it('the offline token never outlives the license term', async () => {
    const s = await signUpSeated(t, '+254711000003', { endInDays: 5 })
    const ent = await t.client(s.accessToken).entitlements.get.query()
    const licenseEndSec = Math.floor(s.license.endDate.getTime() / 1000)
    expect(ent.claims.exp).toBeLessThanOrEqual(licenseEndSec)
  })

  it('revoking the seat or lapsing the license degrades claims to none', async () => {
    const s = await signUpSeated(t, '+254711000004')

    await t.db.license.update({
      where: { id: s.license.id },
      data: { endDate: new Date(Date.now() - DAY) },
    })
    let ent = await t.client(s.accessToken).entitlements.get.query()
    expect(ent.claims.plan).toBe('none')

    await t.db.license.update({
      where: { id: s.license.id },
      data: { endDate: new Date(Date.now() + 30 * DAY) },
    })
    await t.services.seats.revokeSeat(s.seat.id)
    ent = await t.client(s.accessToken).entitlements.get.query()
    expect(ent.claims.plan).toBe('none')
  })
})

describe('offline seat-token verification (the device-side contract)', () => {
  it('verifies a fresh token with the published public key', async () => {
    const s = await signUpSeated(t, '+254711000005')
    const ent = await t.client(s.accessToken).entitlements.get.query()
    const verdict = t.services.entitlements.verifyOffline(ent.token)
    expect(verdict).toEqual({ ok: true, claims: ent.claims, degraded: false })
  })

  it('grants degraded access inside the grace window, then expires', async () => {
    const s = await signUpSeated(t, '+254711000006')
    const { token, claims } = await t.services.entitlements.issueToken(s.user.id)

    const insideGrace = new Date((claims.exp + 3 * 86_400) * 1000)
    expect(t.services.entitlements.verifyOffline(token, insideGrace)).toMatchObject({
      ok: true,
      degraded: true,
    })

    const pastGrace = new Date((claims.exp + 8 * 86_400) * 1000)
    expect(t.services.entitlements.verifyOffline(token, pastGrace)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('rejects forged and tampered tokens', async () => {
    const s = await signUpSeated(t, '+254711000007')
    const { token } = await t.services.entitlements.issueToken(s.user.id)
    const [body] = token.split('.') as [string, string]
    const forgedBody = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString()),
        limits: { aiCallsPerMonth: null, smsPerMonth: null, maxActivePacks: null },
      }),
    ).toString('base64url')
    expect(t.services.entitlements.verifyOffline(`${forgedBody}.${token.split('.')[1]}`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(t.services.entitlements.verifyOffline('garbage')).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})

describe('pack distribution is seat-gated', () => {
  const ARCHIVE = Buffer.from('pack-bytes').toString('base64')

  async function publishPacks() {
    const c = await signUp(t, '+254711000020')
    await t.db.user.update({ where: { id: c.user.id }, data: { role: 'creator' } })
    await t.db.otpChallenge.deleteMany({})
    const creator = await signUp(t, '+254711000020')
    await seatUser(t, creator.user.id) // creators need seats to be teachers; publishing is role-gated anyway
    const api = t.client(creator.accessToken)
    const base = {
      subject: 'Mathematics',
      gradeLevels: ['P4'],
      locale: 'en' as const,
      version: '1.0.0',
      lessons: [{ index: 0, title: 'L1', minutes: 30 }],
      priceCurrency: 'KES' as const,
      archiveBase64: ARCHIVE,
    }
    const free = await api.packs.publish.mutate({
      ...base,
      slug: 'free-1',
      title: 'Free 1',
      priceAmountMinor: 0,
    })
    const paid = await api.packs.publish.mutate({
      ...base,
      slug: 'paid-1',
      title: 'Paid 1',
      priceAmountMinor: 26000,
    })
    return { free, paid }
  }

  it('seatless teachers cannot download ANY pack — not even free ones', async () => {
    const { free } = await publishPacks()
    const s = await signUp(t, '+254711000021')
    await expect(
      t.client(s.accessToken).packs.download.mutate({ id: free.manifest.id }),
    ).rejects.toThrow(/seat_required/)
    // the block is audited
    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'quota_block' } })).toBe(
      1,
    )
    // and the archive route fails closed too
    const res = await fetch(`${t.url}/packs/${free.manifest.id}/archive`, {
      headers: { authorization: `Bearer ${s.accessToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('seated teachers download free AND paid packs under the institutional license', async () => {
    const { free, paid } = await publishPacks()
    const s = await signUpSeated(t, '+254711000022')
    const api = t.client(s.accessToken)

    await api.packs.download.mutate({ id: free.manifest.id })
    const dl = await api.packs.download.mutate({ id: paid.manifest.id })
    const res = await fetch(`${t.url}${dl.archivePath}`, {
      headers: { authorization: `Bearer ${s.accessToken}` },
    })
    expect(res.status).toBe(200)
  })
})
