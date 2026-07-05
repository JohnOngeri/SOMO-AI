import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex, verifyPayload } from '@somo/packsign'
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

const ARCHIVE = Buffer.from('somo-pack-archive-bytes: lesson content here')

async function creatorSession() {
  const s = await signUp(t, '+254799000001')
  await t.db.user.update({ where: { id: s.user.id }, data: { role: 'creator' } })
  // re-login so the JWT carries the creator role
  await t.db.otpChallenge.deleteMany({})
  const s2 = await signUp(t, '+254799000001')
  return s2
}

function publishInput(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'numeracy-term-1',
    title: 'Numeracy Term 1',
    subject: 'Mathematics',
    gradeLevels: ['P3', 'P4'],
    locale: 'en' as const,
    version: '1.0.0',
    lessons: [{ index: 0, title: 'Counting to 100', minutes: 30 }],
    priceAmountMinor: 0,
    priceCurrency: 'KES' as const,
    archiveBase64: ARCHIVE.toString('base64'),
    ...overrides,
  }
}

describe('pack publishing', () => {
  it('creators can publish; the manifest is signed and verifiable', async () => {
    const creator = await creatorSession()
    const api = t.client(creator.accessToken)

    const published = await api.packs.publish.mutate(publishInput())
    expect(published.manifest.contentHash).toBe(sha256Hex(ARCHIVE))
    expect(published.manifest.sizeBytes).toBe(ARCHIVE.byteLength)

    const { publicKey } = await api.packs.signingKey.query()
    expect(verifyPayload(published.manifest, published.signature, publicKey)).toBe(true)
  })

  it('plain teachers cannot publish', async () => {
    const s = await signUp(t, '+254799000002')
    await expect(t.client(s.accessToken).packs.publish.mutate(publishInput())).rejects.toThrow(
      /FORBIDDEN|publisher/,
    )
  })

  it('a tampered manifest fails device-side verification', async () => {
    const creator = await creatorSession()
    const api = t.client(creator.accessToken)
    const published = await api.packs.publish.mutate(publishInput())
    const { publicKey } = await api.packs.signingKey.query()

    const tampered = {
      ...published.manifest,
      price: { amountMinor: 0, currency: 'KES' },
      title: 'Free Hacked Pack',
    }
    expect(verifyPayload(tampered, published.signature, publicKey)).toBe(false)
  })
})

describe('pack browsing + download', () => {
  it('teachers list live packs and download free ones with hash-checked bytes', async () => {
    const creator = await creatorSession()
    await t.client(creator.accessToken).packs.publish.mutate(publishInput())

    const teacher = await signUp(t, '+254799000003')
    const api = t.client(teacher.accessToken)

    const list = await api.packs.list.query()
    expect(list).toHaveLength(1)

    const dl = await api.packs.download.mutate({ id: list[0]!.manifest.id })
    const res = await fetch(`${t.url}${dl.archivePath}`, {
      headers: { authorization: `Bearer ${teacher.accessToken}` },
    })
    expect(res.status).toBe(200)
    const bytes = Buffer.from(await res.arrayBuffer())
    // the device's install check: content hash must match the signed manifest
    expect(sha256Hex(bytes)).toBe(dl.manifest.contentHash)
  })

  it('archive endpoint requires auth', async () => {
    const creator = await creatorSession()
    const pub = await t.client(creator.accessToken).packs.publish.mutate(publishInput())
    const res = await fetch(`${t.url}/packs/${pub.manifest.id}/archive`)
    expect(res.status).toBe(401)
  })

  it('paid packs 402 until purchased (entitlements arrive in phase 4)', async () => {
    const creator = await creatorSession()
    const pub = await t
      .client(creator.accessToken)
      .packs.publish.mutate(publishInput({ slug: 'premium-pack', priceAmountMinor: 26000 }))

    const teacher = await signUp(t, '+254799000004')
    await expect(
      t.client(teacher.accessToken).packs.download.mutate({ id: pub.manifest.id }),
    ).rejects.toThrow(/PAYMENT_REQUIRED|purchase/)

    const res = await fetch(`${t.url}/packs/${pub.manifest.id}/archive`, {
      headers: { authorization: `Bearer ${teacher.accessToken}` },
    })
    expect(res.status).toBe(402)
  })

  it('unknown pack ids 404', async () => {
    const teacher = await signUp(t, '+254799000005')
    await expect(
      t.client(teacher.accessToken).packs.download.mutate({ id: '01HZY3V7Q4J8K2M5N9P1R3T6W8' }),
    ).rejects.toThrow(/NOT_FOUND/)
  })
})
