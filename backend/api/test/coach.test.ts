import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { MockAiProvider } from '../src/coach/provider'
import { newUlid } from '../src/ids'
import { resetDb, signUp, startTestApp, type TestApp } from './helpers'

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

const NOW = new Date().toISOString()

async function teacherWithDna(phone: string) {
  const s = await signUp(t, phone)
  const api = t.client(s.accessToken)
  await api.dna.upsert.mutate({
    className: 'P4 — Mwangaza',
    learnerCount: 62,
    responses: [
      { promptId: 'biggest_challenge', transcript: 'place value in numeracy', capturedAt: NOW },
      {
        promptId: 'resources_available',
        transcript: 'chalkboard and bottle tops',
        capturedAt: NOW,
      },
    ],
  })
  return { s, api }
}

describe('ask coach', () => {
  it('answers grounded in Class DNA and consumes a quota credit', async () => {
    const { api } = await teacherWithDna('+254740000001')

    const res = await api.coach.ask.mutate({
      id: newUlid(),
      question: 'How do I teach place value with no textbooks?',
      mode: 'text',
    })

    expect(res.answer).toContain('grounded in your class')
    expect(res.groundedOn.dna).toBe(true)
    expect(res.costTier).toBe('small')
    expect(res.quota.used).toBe(1)

    // the model actually received the DNA context
    expect(mock().calls[0]!.system).toContain('CLASS CONTEXT')
    expect(mock().calls[0]!.system).toContain('bottle tops')
  })

  it('routes long or multi-part questions to the quality model', async () => {
    const { api } = await teacherWithDna('+254740000002')

    const long = await api.coach.ask.mutate({
      id: newUlid(),
      question:
        'My class of 62 learners struggles with place value and I only have four textbooks. ' +
        'I have tried call-and-response but the quieter learners fall behind. ' +
        'How should I restructure my numeracy lessons over the next two weeks? ' +
        'And how do I assess who is actually improving without written tests?',
      mode: 'text',
    })
    expect(long.costTier).toBe('quality')
    expect(mock().calls[0]!.model).toBe('claude-sonnet-5')

    const short = await api.coach.ask.mutate({
      id: newUlid(),
      question: 'Quick idea for a warm-up game?',
      mode: 'text',
    })
    expect(short.costTier).toBe('small')
    expect(mock().calls[1]!.model).toBe('claude-haiku-4-5')
  })

  it('sms mode always uses the small model and stays sms-sized', async () => {
    const { api } = await teacherWithDna('+254740000003')
    const res = await api.coach.ask.mutate({
      id: newUlid(),
      question:
        'I have a very long question about how to handle multi-grade teaching with sixty learners and almost no materials, what should I do first and second and third?',
      mode: 'sms',
    })
    expect(res.costTier).toBe('small')
    expect(res.answer.length).toBeLessThanOrEqual(380)
    expect(mock().calls[0]!.system).toContain('SMS')
  })

  it('is idempotent by askId: replay returns the same answer without double-charging quota', async () => {
    const { api } = await teacherWithDna('+254740000004')
    const id = newUlid()
    const a = await api.coach.ask.mutate({ id, question: 'Warm-up game?', mode: 'text' })
    const b = await api.coach.ask.mutate({ id, question: 'Warm-up game?', mode: 'text' })
    expect(b.answer).toBe(a.answer)
    expect(b.quota.used).toBe(1)
    expect(mock().calls).toHaveLength(1)
  })

  it('answers repeat questions from cache: no model call, quota still consumed', async () => {
    const { api } = await teacherWithDna('+254740000005')
    const first = await api.coach.ask.mutate({
      id: newUlid(),
      question: 'How do I teach fractions?',
      mode: 'text',
    })
    expect(first.costTier).toBe('small')

    // different id, same question modulo case/whitespace/punctuation
    const second = await api.coach.ask.mutate({
      id: newUlid(),
      question: '  how do I   teach fractions??',
      mode: 'text',
    })
    expect(second.costTier).toBe('cached')
    expect(second.answer).toBe(first.answer)
    expect(second.quota.used).toBe(2)
    expect(mock().calls).toHaveLength(1)
  })

  it('enforces the free-tier weekly limit and lifts it on upgrade', async () => {
    const { s, api } = await teacherWithDna('+254740000006')
    for (let i = 0; i < 4; i++) {
      // 1 ask already used in setup? no — dna doesn't ask. use 5 total
      await api.coach.ask.mutate({ id: newUlid(), question: `Question number ${i}?`, mode: 'text' })
    }
    await api.coach.ask.mutate({ id: newUlid(), question: 'Fifth question?', mode: 'text' })
    await expect(
      api.coach.ask.mutate({ id: newUlid(), question: 'Sixth question?', mode: 'text' }),
    ).rejects.toThrow(/quota_exceeded/)

    await t.db.user.update({
      where: { id: s.user.id },
      data: { plan: 'plus', plusUntil: new Date(Date.now() + 30 * 86_400_000) },
    })
    const res = await api.coach.ask.mutate({
      id: newUlid(),
      question: 'Seventh question?',
      mode: 'text',
    })
    expect(res.quota.limit).toBeNull()
  })

  it('works without a DNA profile (ungrounded) and lists history', async () => {
    const s = await signUp(t, '+254740000007')
    const api = t.client(s.accessToken)
    const res = await api.coach.ask.mutate({
      id: newUlid(),
      question: 'Warm-up game?',
      mode: 'text',
    })
    expect(res.groundedOn.dna).toBe(false)
    expect(mock().calls[0]!.system).not.toContain('CLASS CONTEXT')

    const history = await api.coach.history.query()
    expect(history).toHaveLength(1)
    expect(history[0]!.question).toBe('Warm-up game?')
  })
})
