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

const NOW = new Date().toISOString()

describe('class dna', () => {
  it('creates a profile with the 5 sprint responses and reads it back', async () => {
    const s = await signUp(t, '+254712345678')
    const api = t.client(s.accessToken)

    const { id } = await api.dna.upsert.mutate({
      className: 'P4 — Mwangaza',
      learnerCount: 62,
      responses: [
        {
          promptId: 'class_size_context',
          transcript: '62 learners, two per desk',
          capturedAt: NOW,
        },
        { promptId: 'learner_strengths', transcript: 'call-and-response, songs', capturedAt: NOW },
        { promptId: 'biggest_challenge', transcript: 'place value in numeracy', capturedAt: NOW },
        {
          promptId: 'resources_available',
          transcript: 'chalkboard and bottle tops',
          capturedAt: NOW,
        },
        { promptId: 'teacher_goal', transcript: 'maths without fear', capturedAt: NOW },
      ],
    })

    const profile = await api.dna.get.query()
    expect(profile?.id).toBe(id)
    expect(profile?.responses).toHaveLength(5)
    expect(profile?.learnerCount).toBe(62)
  })

  it('re-answering a prompt updates instead of duplicating', async () => {
    const s = await signUp(t, '+254712345678')
    const api = t.client(s.accessToken)
    const { id } = await api.dna.upsert.mutate({
      className: 'P4',
      responses: [{ promptId: 'teacher_goal', transcript: 'first take', capturedAt: NOW }],
    })
    await api.dna.upsert.mutate({
      id,
      className: 'P4',
      responses: [{ promptId: 'teacher_goal', transcript: 'better take', capturedAt: NOW }],
    })
    const profile = await api.dna.get.query()
    expect(profile?.responses).toHaveLength(1)
    expect(profile?.responses[0]?.transcript).toBe('better take')
  })
})

describe('reflections (3-minute mirror)', () => {
  it('stores three slots for a day and lists them in order', async () => {
    const s = await signUp(t, '+254712345678')
    const api = t.client(s.accessToken)
    const date = '2026-07-04'

    for (const slot of [2, 1, 3] as const) {
      await api.reflection.add.mutate({
        id: newUlid(),
        date,
        slot,
        mode: 'voice',
        transcript: `slot ${slot}`,
        durationSec: 60,
        capturedAt: NOW,
      })
    }
    const list = await api.reflection.byDate.query({ date })
    expect(list.map((r) => r.slot)).toEqual([1, 2, 3])
  })

  it('is idempotent on the client ULID (offline replay-safe)', async () => {
    const s = await signUp(t, '+254712345678')
    const api = t.client(s.accessToken)
    const id = newUlid()
    const input = {
      id,
      date: '2026-07-04',
      slot: 1 as const,
      mode: 'text' as const,
      transcript: 'went well',
      capturedAt: NOW,
    }
    const first = await api.reflection.add.mutate(input)
    const replay = await api.reflection.add.mutate(input)
    expect(first).toEqual({ id, duplicate: false })
    expect(replay).toEqual({ id, duplicate: true })
    expect(await t.db.reflectionEntry.count()).toBe(1)
  })

  it('re-recording a slot replaces the earlier take', async () => {
    const s = await signUp(t, '+254712345678')
    const api = t.client(s.accessToken)
    const date = '2026-07-04'
    await api.reflection.add.mutate({
      id: newUlid(),
      date,
      slot: 1,
      mode: 'voice',
      transcript: 'first take',
      capturedAt: NOW,
    })
    await api.reflection.add.mutate({
      id: newUlid(),
      date,
      slot: 1,
      mode: 'voice',
      transcript: 'second take',
      capturedAt: NOW,
    })
    const list = await api.reflection.byDate.query({ date })
    expect(list).toHaveLength(1)
    expect(list[0]?.transcript).toBe('second take')
  })
})

describe('settings', () => {
  it('updates settings incl. accessibility and syncs locale to the user', async () => {
    const s = await signUp(t, '+254712345678')
    const api = t.client(s.accessToken)
    await api.me.updateSettings.mutate({ locale: 'sw', textScale: 1.5, highContrast: true })
    const me = await api.me.get.query()
    expect(me.settings?.textScale).toBe(1.5)
    expect(me.settings?.highContrast).toBe(true)
    expect(me.locale).toBe('sw')
  })
})
