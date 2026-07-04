import { describe, expect, it } from 'vitest'
import {
  askCoachInput,
  coupon,
  entitlementClaims,
  freeLimits,
  ledgerEntry,
  money,
  outboxEvent,
  packManifest,
  phoneE164,
  pushRequest,
  referralInvite,
  requestOtpInput,
  signedPackManifest,
  ulid,
  usageEvent,
  ussdResponse,
  ussdSessionInput,
  verifyOtpInput,
} from '../src/index'

const ULID = '01HZY3V7Q4J8K2M5N9P1R3T6W8'
const ISO = '2026-07-04T10:00:00+03:00'

describe('common', () => {
  it('accepts valid E.164 phones and rejects junk', () => {
    expect(phoneE164.safeParse('+254712345678').success).toBe(true)
    expect(phoneE164.safeParse('+2347012345678').success).toBe(true)
    expect(phoneE164.safeParse('0712345678').success).toBe(false)
    expect(phoneE164.safeParse('+0712').success).toBe(false)
    expect(phoneE164.safeParse('+1 555 000').success).toBe(false)
  })

  it('accepts valid ULIDs and rejects lowercase/short ones', () => {
    expect(ulid.safeParse(ULID).success).toBe(true)
    expect(ulid.safeParse(ULID.toLowerCase()).success).toBe(false)
    expect(ulid.safeParse('ABC').success).toBe(false)
  })

  it('money is integer minor units — floats are rejected', () => {
    expect(money.safeParse({ amountMinor: 260, currency: 'KES' }).success).toBe(true)
    expect(money.safeParse({ amountMinor: 2.6, currency: 'KES' }).success).toBe(false)
    expect(money.safeParse({ amountMinor: -1, currency: 'KES' }).success).toBe(false)
    expect(money.safeParse({ amountMinor: 100, currency: 'EUR' }).success).toBe(false)
  })
})

describe('auth', () => {
  it('defaults locale to en on OTP request', () => {
    const parsed = requestOtpInput.parse({ phone: '+254712345678' })
    expect(parsed.locale).toBe('en')
  })

  it('requires a 6-digit code', () => {
    const base = { challengeId: ULID, deviceId: ULID }
    expect(verifyOtpInput.safeParse({ ...base, code: '123456' }).success).toBe(true)
    expect(verifyOtpInput.safeParse({ ...base, code: '12345' }).success).toBe(false)
    expect(verifyOtpInput.safeParse({ ...base, code: 'abcdef' }).success).toBe(false)
  })
})

describe('coach + quota', () => {
  it('accepts all four ask modes', () => {
    for (const mode of ['voice', 'text', 'sms', 'ussd'] as const) {
      expect(
        askCoachInput.safeParse({ id: ULID, question: 'How do I teach fractions?', mode }).success,
      ).toBe(true)
    }
  })

  it('free plan ships with 5 asks/week and 1 active pack', () => {
    expect(freeLimits.asksPerWeek).toBe(5)
    expect(freeLimits.maxActivePacks).toBe(1)
  })
})

describe('packs', () => {
  const manifest = {
    id: ULID,
    slug: 'numeracy-term-1',
    title: 'Numeracy Term 1',
    subject: 'Mathematics',
    gradeLevels: ['P3', 'P4'],
    locale: 'en',
    version: '1.0.0',
    publisherId: ULID,
    sizeBytes: 1024,
    contentHash: 'a'.repeat(64),
    lessons: [{ index: 0, title: 'Counting to 100', minutes: 30 }],
    price: { amountMinor: 0, currency: 'KES' },
    createdAt: ISO,
  }

  it('parses a valid manifest', () => {
    expect(packManifest.safeParse(manifest).success).toBe(true)
  })

  it('rejects a bad content hash and bad slug', () => {
    expect(packManifest.safeParse({ ...manifest, contentHash: 'xyz' }).success).toBe(false)
    expect(packManifest.safeParse({ ...manifest, slug: 'Bad Slug!' }).success).toBe(false)
  })

  it('signed manifests carry an ed25519 signature', () => {
    const signed = {
      manifest,
      signature: { alg: 'ed25519', publicKeyId: 'somo-root', sig: 'c2ln' },
    }
    expect(signedPackManifest.safeParse(signed).success).toBe(true)
    expect(
      signedPackManifest.safeParse({ ...signed, signature: { ...signed.signature, alg: 'rsa' } })
        .success,
    ).toBe(false)
  })
})

describe('entitlements', () => {
  it('parses plus claims with unlimited limits', () => {
    const claims = {
      sub: ULID,
      plan: 'plus',
      limits: { asksPerWeek: null, maxActivePacks: null },
      packs: 'all_standard',
      iat: 1_800_000_000,
      exp: 1_800_600_000,
      graceDays: 7,
    }
    expect(entitlementClaims.safeParse(claims).success).toBe(true)
  })

  it('caps grace at 30 days', () => {
    const claims = {
      sub: ULID,
      plan: 'free',
      limits: freeLimits,
      packs: [ULID],
      iat: 1,
      exp: 2,
      graceDays: 31,
    }
    expect(entitlementClaims.safeParse(claims).success).toBe(false)
  })
})

describe('billing', () => {
  it('coupon codes are uppercase alphanumeric', () => {
    expect(coupon.safeParse({ code: 'LAUNCH-25' }).success).toBe(true)
    expect(coupon.safeParse({ code: 'bad code' }).success).toBe(false)
  })
})

describe('marketplace ledger', () => {
  it('accepts platform and creator accounts, rejects others', () => {
    const base = {
      id: ULID,
      amountMinor: -500,
      currency: 'NGN',
      type: 'platform_fee',
      refId: ULID,
      createdAt: ISO,
    }
    expect(ledgerEntry.safeParse({ ...base, account: 'platform:revenue' }).success).toBe(true)
    expect(ledgerEntry.safeParse({ ...base, account: `creator:${ULID}` }).success).toBe(true)
    expect(ledgerEntry.safeParse({ ...base, account: 'creator:bob' }).success).toBe(false)
  })
})

describe('sync', () => {
  it('outbox events are idempotent-by-ULID and push is capped at 500', () => {
    const ev = {
      id: ULID,
      deviceId: ULID,
      entity: 'reflection',
      entityId: ULID,
      op: 'create',
      payload: { transcript: 'went well' },
      clientAt: ISO,
    }
    expect(outboxEvent.safeParse(ev).success).toBe(true)
    expect(pushRequest.safeParse({ events: Array(501).fill(ev) }).success).toBe(false)
  })
})

describe('metering', () => {
  it('meta defaults to empty object', () => {
    const parsed = usageEvent.parse({ id: ULID, userId: ULID, type: 'ask_coach', at: ISO })
    expect(parsed.meta).toEqual({})
  })
})

describe('referral', () => {
  it('codes are 8-char base32 without confusing characters', () => {
    const invite = {
      code: 'AB2C3D4E',
      inviterId: ULID,
      issuedAt: ISO,
      expiresAt: ISO,
      sig: 'c2ln',
    }
    expect(referralInvite.safeParse(invite).success).toBe(true)
    expect(referralInvite.safeParse({ ...invite, code: 'ab2c3d4e' }).success).toBe(false)
    expect(referralInvite.safeParse({ ...invite, code: 'AB1C0D4E' }).success).toBe(false) // 0/1 excluded
  })
})

describe('ussd', () => {
  it("parses an Africa's Talking style session and caps screens at 160 chars", () => {
    expect(
      ussdSessionInput.safeParse({
        sessionId: 'ATUid_123',
        serviceCode: '*384*1234#',
        phoneNumber: '+254712345678',
        text: '1*2',
      }).success,
    ).toBe(true)
    expect(ussdResponse.safeParse({ type: 'CON', message: 'x'.repeat(161) }).success).toBe(false)
  })
})
