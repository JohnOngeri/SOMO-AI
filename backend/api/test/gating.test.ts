import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { MockAiProvider } from '../src/coach/provider'
import { newUlid } from '../src/ids'
import { resetDb, signUp, signUpSeated, startTestApp, type TestApp } from './helpers'

/**
 * THE PIVOT'S CRITICAL SUITE: prove that no LLM invocation and no outbound
 * SMS ever happens for unauthorized or over-quota users. The mock provider
 * and the memory SMS sender are the invocation counters — if these tests
 * pass, monthly spend is bounded by seats × quota, period.
 */

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

describe('zero LLM invocations without authorization', () => {
  it('seatless app users: coach refuses before the provider is touched', async () => {
    const s = await signUp(t, '+254770000001')
    const api = t.client(s.accessToken)
    t.sms.sent = [] // discard the signup OTP

    for (const question of ['Help me teach?', 'Another try?', 'Third try?']) {
      await expect(api.coach.ask.mutate({ id: newUlid(), question, mode: 'text' })).rejects.toThrow(
        /seat_required/,
      )
    }
    expect(mock().calls).toHaveLength(0)
    expect(t.sms.sent).toHaveLength(0)
  })

  it('a revoked seat cuts off AI mid-term, instantly', async () => {
    const s = await signUpSeated(t, '+254770000002')
    const api = t.client(s.accessToken)
    await api.coach.ask.mutate({ id: newUlid(), question: 'Works while seated?', mode: 'text' })
    expect(mock().calls).toHaveLength(1)

    await t.services.seats.revokeSeat(s.seat.id)
    await expect(
      api.coach.ask.mutate({ id: newUlid(), question: 'And now?', mode: 'text' }),
    ).rejects.toThrow(/seat_required/)
    expect(mock().calls).toHaveLength(1)
  })

  it('license expiry cuts off AI with no cron involved', async () => {
    const s = await signUpSeated(t, '+254770000003')
    await t.db.license.update({
      where: { id: s.license.id },
      data: { endDate: new Date(Date.now() - 1000) },
    })
    await expect(
      t.client(s.accessToken).coach.ask.mutate({ id: newUlid(), question: 'Hello?', mode: 'text' }),
    ).rejects.toThrow(/seat_required/)
    expect(mock().calls).toHaveLength(0)
  })
})

describe('hard quota ceiling on the LLM', () => {
  it('the (limit+1)th ask never reaches the provider and is audited', async () => {
    const s = await signUpSeated(t, '+254770000010', { aiCalls: 3 })
    const api = t.client(s.accessToken)

    for (let i = 1; i <= 3; i++) {
      const res = await api.coach.ask.mutate({
        id: newUlid(),
        question: `Distinct question number ${i}?`,
        mode: 'text',
      })
      expect(res.quota.used).toBe(i)
    }
    expect(mock().calls).toHaveLength(3)

    await expect(
      api.coach.ask.mutate({
        id: newUlid(),
        question: 'One more distinct question?',
        mode: 'text',
      }),
    ).rejects.toThrow(/quota_exceeded/)
    expect(mock().calls).toHaveLength(3)

    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'ai_call' } })).toBe(3)
    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'quota_block' } })).toBe(
      1,
    )
  })

  it('retrying a blocked askId cannot sneak past the gate', async () => {
    const s = await signUpSeated(t, '+254770000011', { aiCalls: 1 })
    const api = t.client(s.accessToken)
    await api.coach.ask.mutate({ id: newUlid(), question: 'First?', mode: 'text' })

    const blockedId = newUlid()
    await expect(
      api.coach.ask.mutate({ id: blockedId, question: 'Second distinct?', mode: 'text' }),
    ).rejects.toThrow(/quota_exceeded/)
    // retry the SAME id — the recorded quota_block must not read as "already paid"
    await expect(
      api.coach.ask.mutate({ id: blockedId, question: 'Second distinct?', mode: 'text' }),
    ).rejects.toThrow(/quota_exceeded/)
    expect(mock().calls).toHaveLength(1)
  })

  it('over quota, cached content still serves — graceful degradation, zero new cost', async () => {
    const s = await signUpSeated(t, '+254770000012', { aiCalls: 1 })
    const api = t.client(s.accessToken)
    const first = await api.coach.ask.mutate({
      id: newUlid(),
      question: 'How do I teach fractions?',
      mode: 'text',
    })

    // quota is now exhausted; the same question is served from cache, flagged degraded
    const degraded = await api.coach.ask.mutate({
      id: newUlid(),
      question: 'how do i teach fractions?',
      mode: 'text',
    })
    expect(degraded.answer).toBe(first.answer)
    expect(degraded.costTier).toBe('cached')
    expect(degraded.degraded).toBe(true)
    expect(mock().calls).toHaveLength(1)

    // ...but a NEW question stays blocked
    await expect(
      api.coach.ask.mutate({ id: newUlid(), question: 'A brand new question?', mode: 'text' }),
    ).rejects.toThrow(/quota_exceeded/)
    expect(mock().calls).toHaveLength(1)
  })
})

describe('hard quota ceiling on outbound SMS', () => {
  it('sms_out stops exactly at the seat limit', async () => {
    const s = await signUpSeated(t, '+254770000020', { sms: 2 })
    t.sms.sent = [] // discard the signup OTP
    await t.services.smsGate.sendGated(s.user.id, s.user.phone, 'one')
    await t.services.smsGate.sendGated(s.user.id, s.user.phone, 'two')
    await expect(t.services.smsGate.sendGated(s.user.id, s.user.phone, 'three')).rejects.toThrow(
      /over_quota/,
    )
    expect(t.sms.sent).toHaveLength(2)
    expect(await t.db.usageEvent.count({ where: { userId: s.user.id, type: 'sms_out' } })).toBe(2)
  })

  it('seatless users can never trigger a gated SMS', async () => {
    const s = await signUp(t, '+254770000021')
    t.sms.sent = [] // discard the signup OTP
    await expect(t.services.smsGate.sendGated(s.user.id, s.user.phone, 'hi')).rejects.toThrow(
      /no_seat/,
    )
    expect(t.sms.sent).toHaveLength(0)
  })
})

describe('spend predictability end to end', () => {
  it('total provider invocations === sum of ai_call events, bounded by quota', async () => {
    const a = await signUpSeated(t, '+254770000030', { aiCalls: 2 })
    const b = await signUpSeated(t, '+254770000031', { aiCalls: 1 })
    const seatless = await signUp(t, '+254770000032')

    const askAll = async (s: { accessToken: string }, q: string) =>
      t
        .client(s.accessToken)
        .coach.ask.mutate({ id: newUlid(), question: q, mode: 'text' })
        .catch(() => null)

    await askAll(a, 'q one?')
    await askAll(a, 'q two?')
    await askAll(a, 'q three — should block?')
    await askAll(b, 'q one?')
    await askAll(b, 'q two — should block?')
    await askAll(seatless, 'q — should refuse?')

    const aiEvents = await t.db.usageEvent.count({ where: { type: 'ai_call' } })
    expect(mock().calls.length).toBe(aiEvents)
    expect(aiEvents).toBe(3) // 2 (seat a) + 1 (seat b) + 0 (seatless)
  })
})
