import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { newUlid } from '../src/ids'
import { resetDb, signUp, startTestApp, type TestApp } from './helpers'

const PHONE = '+254712345678'

let t: TestApp

beforeEach(async () => {
  if (!t) t = await startTestApp()
  await resetDb(t.db)
  t.sms.sent = []
})

afterAll(async () => {
  await t?.close()
})

describe('health', () => {
  it('responds ok and can reach the database', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', service: 'api' })
  })
})

describe('phone OTP auth', () => {
  it('signs up a new teacher end to end', async () => {
    const session = await signUp(t, PHONE)
    expect(session.user.phone).toBe(PHONE)
    expect(session.accessToken.length).toBeGreaterThan(20)
    expect(session.refreshToken.length).toBeGreaterThan(20)

    // token actually works
    const me = await t.client(session.accessToken).me.get.query()
    expect(me.phone).toBe(PHONE)
    expect(me.settings?.locale).toBe('en')
  })

  it('sends the code by sms and never returns it in the response', async () => {
    const res = await t.client().auth.requestOtp.mutate({ phone: PHONE, locale: 'sw' })
    expect(res.channel).toBe('sms')
    const code = t.sms.lastCodeFor(PHONE)
    expect(code).toMatch(/^\d{6}$/)
    expect(JSON.stringify(res)).not.toContain(code)
    // localized sender copy
    expect(t.sms.sent[0]!.message).toContain('SOMO')
  })

  it('rejects a wrong code and counts attempts', async () => {
    const { challengeId } = await t.client().auth.requestOtp.mutate({ phone: PHONE, locale: 'en' })
    const right = t.sms.lastCodeFor(PHONE)!
    const wrong = right === '000000' ? '000001' : '000000'

    await expect(
      t.client().auth.verifyOtp.mutate({ challengeId, code: wrong, deviceId: newUlid() }),
    ).rejects.toThrow(/invalid_code/)

    // correct code still works after one failure
    const session = await t
      .client()
      .auth.verifyOtp.mutate({ challengeId, code: right, deviceId: newUlid() })
    expect(session.user.phone).toBe(PHONE)
  })

  it('locks the challenge after max wrong attempts', async () => {
    const { challengeId } = await t.client().auth.requestOtp.mutate({ phone: PHONE, locale: 'en' })
    const right = t.sms.lastCodeFor(PHONE)!
    const wrong = right === '111111' ? '111112' : '111111'
    for (let i = 0; i < 5; i++) {
      await expect(
        t.client().auth.verifyOtp.mutate({ challengeId, code: wrong, deviceId: newUlid() }),
      ).rejects.toThrow()
    }
    await expect(
      t.client().auth.verifyOtp.mutate({ challengeId, code: right, deviceId: newUlid() }),
    ).rejects.toThrow(/too_many_attempts/)
  })

  it('a consumed challenge cannot be replayed', async () => {
    const { challengeId } = await t.client().auth.requestOtp.mutate({ phone: PHONE, locale: 'en' })
    const code = t.sms.lastCodeFor(PHONE)!
    await t.client().auth.verifyOtp.mutate({ challengeId, code, deviceId: newUlid() })
    await expect(
      t.client().auth.verifyOtp.mutate({ challengeId, code, deviceId: newUlid() }),
    ).rejects.toThrow(/invalid_code/)
  })

  it('rate-limits resend within the window', async () => {
    await t.client().auth.requestOtp.mutate({ phone: PHONE, locale: 'en' })
    await expect(t.client().auth.requestOtp.mutate({ phone: PHONE, locale: 'en' })).rejects.toThrow(
      /rate_limited/,
    )
  })

  it('signing in twice with the same phone reuses the user', async () => {
    const s1 = await signUp(t, PHONE)
    await resetRateLimit()
    const s2 = await signUp(t, PHONE)
    expect(s2.user.id).toBe(s1.user.id)
    expect(await t.db.user.count()).toBe(1)
  })
})

describe('refresh rotation', () => {
  it('rotates: new pair issued, old refresh token dies', async () => {
    const s = await signUp(t, PHONE)
    const rotated = await t
      .client()
      .auth.refresh.mutate({ refreshToken: s.refreshToken, deviceId: s.deviceId })
    expect(rotated.refreshToken).not.toBe(s.refreshToken)

    // old one is now unusable
    await expect(
      t.client().auth.refresh.mutate({ refreshToken: s.refreshToken, deviceId: s.deviceId }),
    ).rejects.toThrow(/invalid_refresh_token/)
  })

  it('reuse of a rotated token revokes the whole device family', async () => {
    const s = await signUp(t, PHONE)
    const r1 = await t
      .client()
      .auth.refresh.mutate({ refreshToken: s.refreshToken, deviceId: s.deviceId })
    // replay the original (stolen) token -> family nuked
    await expect(
      t.client().auth.refresh.mutate({ refreshToken: s.refreshToken, deviceId: s.deviceId }),
    ).rejects.toThrow()
    // even the newest token is dead now
    await expect(
      t.client().auth.refresh.mutate({ refreshToken: r1.refreshToken, deviceId: s.deviceId }),
    ).rejects.toThrow()
  })

  it('a refresh token is bound to its device', async () => {
    const s = await signUp(t, PHONE)
    await expect(
      t.client().auth.refresh.mutate({ refreshToken: s.refreshToken, deviceId: newUlid() }),
    ).rejects.toThrow(/invalid_refresh_token/)
  })
})

describe('authorization', () => {
  it('rejects unauthenticated and garbage tokens', async () => {
    await expect(t.client().me.get.query()).rejects.toThrow(/UNAUTHORIZED/)
    await expect(t.client('not-a-jwt').me.get.query()).rejects.toThrow(/UNAUTHORIZED/)
  })
})

/** clear OTP rate-limit window between signups of the same phone */
async function resetRateLimit() {
  await t.db.otpChallenge.deleteMany({})
}
