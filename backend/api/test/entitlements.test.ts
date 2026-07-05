import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { newUlid } from '../src/ids'
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

async function makePlus(userId: string, days = 30) {
  await t.db.user.update({
    where: { id: userId },
    data: { plan: 'plus', plusUntil: new Date(Date.now() + days * 86_400_000) },
  })
}

describe('entitlement claims', () => {
  it('free teachers get the freemium limits and no paid packs', async () => {
    const s = await signUp(t, '+254711000001')
    const ent = await t.client(s.accessToken).entitlements.get.query()
    expect(ent.claims.plan).toBe('free')
    expect(ent.claims.limits).toEqual({ asksPerWeek: 5, maxActivePacks: 1 })
    expect(ent.claims.packs).toEqual([])
  })

  it('plus teachers get unlimited limits and all standard packs', async () => {
    const s = await signUp(t, '+254711000002')
    await makePlus(s.user.id)
    const ent = await t.client(s.accessToken).entitlements.get.query()
    expect(ent.claims.plan).toBe('plus')
    expect(ent.claims.limits).toEqual({ asksPerWeek: null, maxActivePacks: null })
    expect(ent.claims.packs).toBe('all_standard')
  })

  it('a lapsed plus subscription degrades to free automatically', async () => {
    const s = await signUp(t, '+254711000003')
    await t.db.user.update({
      where: { id: s.user.id },
      data: { plan: 'plus', plusUntil: new Date(Date.now() - 1000) },
    })
    const ent = await t.client(s.accessToken).entitlements.get.query()
    expect(ent.claims.plan).toBe('free')
  })
})

describe('offline token verification (the device-side contract)', () => {
  it('verifies a fresh token with the published public key', async () => {
    const s = await signUp(t, '+254711000004')
    const ent = await t.client(s.accessToken).entitlements.get.query()
    const verdict = t.services.entitlements.verifyOffline(ent.token)
    expect(verdict).toEqual({ ok: true, claims: ent.claims, degraded: false })
  })

  it('grants degraded access inside the grace window, then expires', async () => {
    const s = await signUp(t, '+254711000005')
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
    const s = await signUp(t, '+254711000006')
    const { token } = await t.services.entitlements.issueToken(s.user.id)
    const [body] = token.split('.') as [string, string]
    const forgedBody = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), plan: 'plus' }),
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

describe('ask quota (freemium gate)', () => {
  it('allows 5 free asks a week, blocks the 6th, and meters the paywall hit', async () => {
    const s = await signUp(t, '+254711000007')
    const api = t.client(s.accessToken)

    for (let i = 1; i <= 5; i++) {
      const quota = await api.metering.ask.mutate({ id: newUlid() })
      expect(quota.used).toBe(i)
      expect(quota.limit).toBe(5)
    }

    await expect(api.metering.ask.mutate({ id: newUlid() })).rejects.toThrow(/quota_exceeded/)

    const paywallHits = await t.db.usageEvent.count({
      where: { userId: s.user.id, type: 'paywall_hit' },
    })
    expect(paywallHits).toBe(1)
    // the blocked ask did NOT consume a credit
    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'ask_coach' } })).toBe(5)
  })

  it('replaying the same ask id is idempotent (offline retry-safe)', async () => {
    const s = await signUp(t, '+254711000008')
    const api = t.client(s.accessToken)
    const id = newUlid()
    const a = await api.metering.ask.mutate({ id })
    const b = await api.metering.ask.mutate({ id })
    expect(a.used).toBe(1)
    expect(b.used).toBe(1)
  })

  it('upgrading lifts the limit immediately', async () => {
    const s = await signUp(t, '+254711000009')
    const api = t.client(s.accessToken)
    for (let i = 0; i < 5; i++) await api.metering.ask.mutate({ id: newUlid() })
    await expect(api.metering.ask.mutate({ id: newUlid() })).rejects.toThrow(/quota_exceeded/)

    await makePlus(s.user.id)
    const quota = await api.metering.ask.mutate({ id: newUlid() })
    expect(quota.limit).toBeNull()
    expect(quota.used).toBe(6)
  })

  it('clients cannot self-report money-adjacent events', async () => {
    const s = await signUp(t, '+254711000010')
    await expect(
      // 'upgrade' is excluded from the client-reportable union — force it onto the wire
      t.client(s.accessToken).metering.record.mutate({ id: newUlid(), type: 'upgrade' as never }),
    ).rejects.toThrow()
  })
})

describe('pack limits through entitlements', () => {
  const ARCHIVE = Buffer.from('pack-bytes').toString('base64')

  async function publishTwoFreeAndOnePaid() {
    const c = await signUp(t, '+254711000020')
    await t.db.user.update({ where: { id: c.user.id }, data: { role: 'creator' } })
    await t.db.otpChallenge.deleteMany({})
    const creator = await signUp(t, '+254711000020')
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
    const p1 = await api.packs.publish.mutate({
      ...base,
      slug: 'free-1',
      title: 'Free 1',
      priceAmountMinor: 0,
    })
    const p2 = await api.packs.publish.mutate({
      ...base,
      slug: 'free-2',
      title: 'Free 2',
      priceAmountMinor: 0,
    })
    const paid = await api.packs.publish.mutate({
      ...base,
      slug: 'paid-1',
      title: 'Paid 1',
      priceAmountMinor: 26000,
    })
    return { p1, p2, paid }
  }

  it('free tier: 1 active pack — second distinct download blocks, re-download passes', async () => {
    const { p1, p2 } = await publishTwoFreeAndOnePaid()
    const s = await signUp(t, '+254711000021')
    const api = t.client(s.accessToken)

    await api.packs.download.mutate({ id: p1.manifest.id })
    await expect(api.packs.download.mutate({ id: p2.manifest.id })).rejects.toThrow(
      /pack_limit_reached/,
    )
    // same pack again is fine (device re-download / repair)
    await api.packs.download.mutate({ id: p1.manifest.id })

    const hits = await t.db.usageEvent.findMany({
      where: { userId: s.user.id, type: 'paywall_hit' },
    })
    expect(hits).toHaveLength(1)
  })

  it('plus unlocks paid packs and unlimited actives, end to end to the bytes', async () => {
    const { p2, paid } = await publishTwoFreeAndOnePaid()
    const s = await signUp(t, '+254711000022')
    const api = t.client(s.accessToken)

    await expect(api.packs.download.mutate({ id: paid.manifest.id })).rejects.toThrow(
      /PAYMENT_REQUIRED|purchase/,
    )

    await makePlus(s.user.id)
    await api.packs.download.mutate({ id: p2.manifest.id })
    const dl = await api.packs.download.mutate({ id: paid.manifest.id })

    const res = await fetch(`${t.url}${dl.archivePath}`, {
      headers: { authorization: `Bearer ${s.accessToken}` },
    })
    expect(res.status).toBe(200)
  })
})
