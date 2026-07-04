/**
 * Dev seed: one teacher with a Class DNA profile and a day of reflections,
 * so `pnpm dev` starts with a living app. Run: pnpm --filter @somo/api seed
 */
import { createDb } from '../src/db'
import { newUlid } from '../src/ids'

const db = createDb(process.env.DATABASE_URL ?? 'postgresql://somo:somo@localhost:5432/somo')

async function main() {
  const teacher = await db.user.upsert({
    where: { phone: '+254700123456' },
    update: {},
    create: {
      id: newUlid(),
      phone: '+254700123456',
      displayName: 'Amina W.',
      locale: 'sw',
      settings: { create: { locale: 'sw' } },
    },
  })

  const dnaId = newUlid()
  const existing = await db.classDnaProfile.findFirst({ where: { userId: teacher.id } })
  const profileId = existing?.id ?? dnaId
  if (!existing) {
    await db.classDnaProfile.create({
      data: {
        id: dnaId,
        userId: teacher.id,
        className: 'P4 — Mwangaza Primary',
        learnerCount: 62,
        summary:
          'Large multi-ability P4 class, few textbooks, strong oral culture; teacher wants better numeracy engagement.',
        traits: ['large-class', 'low-resource', 'multilingual', 'oral-first'],
      },
    })
    const prompts: [string, string][] = [
      ['class_size_context', 'I teach 62 learners in P4, two share one desk, morning shift.'],
      ['learner_strengths', 'They love call-and-response and singing; strong memory for stories.'],
      ['biggest_challenge', 'Numeracy — place value confuses most of them and I have 4 textbooks.'],
      ['resources_available', 'Chalkboard, bottle tops for counting, my phone. No projector.'],
      ['teacher_goal', 'I want every child to attempt maths without fear by end of term.'],
    ]
    for (const [promptId, transcript] of prompts) {
      await db.dnaResponse.create({
        data: { id: newUlid(), profileId, promptId, transcript, capturedAt: new Date() },
      })
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const reflections: [1 | 2 | 3, string][] = [
    [1, 'The bottle-top place value game worked — even the quiet ones joined.'],
    [2, 'Ran out of time for the exit question, again.'],
    [3, 'Tomorrow I will start with the exit question instead of ending with it.'],
  ]
  for (const [slot, transcript] of reflections) {
    await db.reflectionEntry.upsert({
      where: { userId_date_slot: { userId: teacher.id, date: today, slot } },
      update: {},
      create: {
        id: newUlid(),
        userId: teacher.id,
        date: today,
        slot,
        mode: 'voice',
        transcript,
        durationSec: 55,
        capturedAt: new Date(),
      },
    })
  }

  console.log(`seeded teacher ${teacher.phone} (${teacher.id})`)
}

await main().finally(() => db.$disconnect())
