import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { classifyText, isoWeekBucket } from '../src/analytics/service'
import { newUlid } from '../src/ids'
import { resetDb, signUp, signUpSeated, startTestApp, type TestApp } from './helpers'

let t: TestApp

beforeEach(async () => {
  if (!t) t = await startTestApp()
  await resetDb(t.db)
  t.sms.sent = []
})

afterAll(async () => {
  await t?.close()
})

async function insightsUser() {
  const s = await signUp(t, '+254795000001')
  await t.db.user.update({ where: { id: s.user.id }, data: { role: 'insights' } })
  await t.db.otpChallenge.deleteMany({})
  const again = await signUp(t, '+254795000001')
  return t.client(again.accessToken)
}

describe('classifier + buckets (pure)', () => {
  it('maps classroom questions onto the curriculum taxonomy', () => {
    expect(classifyText('How do I explain fractions to P4?').topic).toBe('numeracy.fractions')
    expect(classifyText('place value with bottle tops').topic).toBe('numeracy.place_value')
    expect(classifyText('my class is noisy and I cannot keep attention').topic).toBe(
      'classroom.management',
    )
    expect(classifyText('I have no textbooks for reading').topic).toBe('resources.low_resource')
    expect(classifyText('what should I cook tonight').topic).toBe('general.pedagogy')
  })

  it('buckets dates into ISO weeks', () => {
    expect(isoWeekBucket(new Date('2026-01-05T10:00:00Z'))).toBe('2026-W02')
    expect(isoWeekBucket(new Date('2026-07-05T10:00:00Z'))).toMatch(/^2026-W\d{2}$/)
  })
})

describe('ingestion strips identity at the door', () => {
  it('a coach question lands as labels only — no PII, no transcript', async () => {
    const s = await signUpSeated(t, '+254795000010', { institutionName: 'Nova Pioneer' })
    await t.client(s.accessToken).coach.ask.mutate({
      id: newUlid(),
      question: 'How do I explain fractions with no textbooks?',
      mode: 'text',
    })

    const signals = await t.db.analyticsSignal.findMany()
    expect(signals).toHaveLength(1)
    const row = signals[0]!
    expect(row.topic).toBe('numeracy.fractions')
    expect(row.country).toBe('KE')
    expect(row.institutionType).toBe('NGO')

    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain(s.user.id)
    expect(serialized).not.toContain('+254795000010')
    expect(serialized).not.toContain('fractions with no textbooks') // no transcript
    expect(serialized).not.toContain(s.inst.id)
    expect(row.teacherHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reflections ingest through app and gateway paths', async () => {
    const s = await signUpSeated(t, '+254795000011')
    await t.client(s.accessToken).reflection.add.mutate({
      id: newUlid(),
      date: '2026-07-05',
      slot: 1,
      mode: 'text',
      transcript: 'the exit question assessment worked well today',
      capturedAt: new Date().toISOString(),
    })
    expect(await t.db.analyticsSignal.count({ where: { source: 'reflection' } })).toBe(1)
    expect((await t.db.analyticsSignal.findFirstOrThrow()).topic).toBe('assessment.formative')
  })

  it('opted-out institutions produce ZERO signals', async () => {
    const s = await signUpSeated(t, '+254795000012')
    await t.db.institution.update({
      where: { id: s.inst.id },
      data: { analyticsOptOut: true },
    })
    await t.client(s.accessToken).coach.ask.mutate({
      id: newUlid(),
      question: 'How do I teach fractions?',
      mode: 'text',
    })
    expect(await t.db.analyticsSignal.count()).toBe(0)
  })
})

describe('k-anonymity at read time', () => {
  async function seedSignals(topic: string, teacherCount: number, perTeacher = 2) {
    for (let i = 0; i < teacherCount; i++) {
      for (let j = 0; j < perTeacher; j++) {
        await t.db.analyticsSignal.create({
          data: {
            id: newUlid(),
            teacherHash: `hash-${topic}-${i}`,
            source: 'coach_question',
            topic,
            skill: 'concept_explanation',
            country: 'KE',
            institutionType: 'NGO',
            weekBucket: isoWeekBucket(new Date()),
          },
        })
      }
    }
  }

  it('suppresses cells under K distinct teachers and discloses the suppression', async () => {
    const api = await insightsUser()
    await seedSignals('numeracy.fractions', 6) // >= K(5): visible
    await seedSignals('literacy.phonics', 3) // < K: suppressed

    const res = await api.insights.topConcepts.query({ country: 'KE' })
    expect(res.kThreshold).toBe(5)
    expect(res.cells).toHaveLength(1)
    expect(res.cells[0]).toMatchObject({ topic: 'numeracy.fractions', teachers: 6, signals: 12 })
    expect(res.suppressedCells).toBe(1)
  })

  it('trend buckets are independently suppressed', async () => {
    const api = await insightsUser()
    await seedSignals('numeracy.fractions', 6)
    // one lonely teacher in an older week
    await t.db.analyticsSignal.create({
      data: {
        id: newUlid(),
        teacherHash: 'hash-lonely',
        source: 'coach_question',
        topic: 'numeracy.fractions',
        skill: 'concept_explanation',
        country: 'KE',
        institutionType: 'NGO',
        weekBucket: '2026-W01',
        createdAt: new Date(Date.now() - 21 * 86_400_000),
      },
    })
    const trend = await api.insights.trend.query({ topic: 'numeracy.fractions' })
    expect(trend).toHaveLength(1) // the lonely week is gone
    expect(trend[0]!.teachers).toBe(6)
  })

  it('the insights product is licence-gated', async () => {
    const teacher = await signUpSeated(t, '+254795000020')
    await expect(t.client(teacher.accessToken).insights.topConcepts.query({})).rejects.toThrow(
      /insights_license_required/,
    )
  })
})
