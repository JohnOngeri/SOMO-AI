/**
 * Dev seed: one teacher with a Class DNA profile and a day of reflections,
 * so `pnpm dev` starts with a living app. Run: pnpm --filter @somo/api seed
 */
import { generateEd25519Keypair } from '@somo/packsign'
import { createDb } from '../src/db'
import { newUlid } from '../src/ids'
import { PackService } from '../src/packs/service'
import { FsObjectStore } from '../src/storage'

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

  // one free signed demo pack so Today/Packs render on first boot
  if (!(await db.pack.findUnique({ where: { slug: 'numeracy-foundations-term-1' } }))) {
    const keys =
      process.env.PACK_SIGNING_PRIVATE_KEY && process.env.PACK_SIGNING_PUBLIC_KEY
        ? {
            publicKeyId: 'somo-root',
            privateKey: process.env.PACK_SIGNING_PRIVATE_KEY,
            publicKey: process.env.PACK_SIGNING_PUBLIC_KEY,
          }
        : { publicKeyId: 'somo-dev-ephemeral', ...generateEd25519Keypair() }
    const packs = new PackService(
      db,
      new FsObjectStore(process.env.PACKS_STORAGE_DIR ?? './storage'),
      keys,
    )
    await packs.publish({
      slug: 'numeracy-foundations-term-1',
      title: 'Numeracy Foundations — Term 1',
      subject: 'Mathematics',
      gradeLevels: ['P3', 'P4'],
      locale: 'en',
      version: '1.0.0',
      publisherId: teacher.id,
      lessons: [
        { index: 0, title: 'Counting with what you have', minutes: 30 },
        { index: 1, title: 'Place value with bottle tops', minutes: 35 },
        { index: 2, title: 'Number stories out loud', minutes: 30 },
      ],
      priceAmountMinor: 0,
      priceCurrency: 'KES',
      archive: Buffer.from(
        JSON.stringify({
          format: 'somopack/1',
          note: 'demo archive — real packs ship lesson JSON + audio',
        }),
      ),
    })
    console.log('seeded demo pack numeracy-foundations-term-1')
  }

  // SOMO Plus price book (annual = 10× monthly, i.e. 2 months free) + launch coupon
  const prices: [string, string, number][] = [
    // [currency, interval, amountMinor]
    ['KES', 'month', 26000], // KES 260
    ['KES', 'year', 260000],
    ['NGN', 'month', 300000], // NGN 3,000
    ['NGN', 'year', 3000000],
    ['TZS', 'month', 520000], // TZS 5,200
    ['TZS', 'year', 5200000],
    ['USD', 'month', 200], // $2
    ['USD', 'year', 2000],
  ]
  for (const [cur, interval, amountMinor] of prices) {
    await db.price.upsert({
      where: { planId_currency_interval: { planId: 'plus', currency: cur, interval } },
      update: { amountMinor },
      create: { id: newUlid(), planId: 'plus', currency: cur, interval, amountMinor },
    })
  }
  await db.coupon.upsert({
    where: { code: 'LAUNCH25' },
    update: {},
    create: {
      code: 'LAUNCH25',
      percentOff: 25,
      maxRedemptions: 500,
      redeemBy: new Date(Date.now() + 90 * 86_400_000),
    },
  })
  console.log('seeded plus price book (KES/NGN/TZS/USD) + LAUNCH25')

  console.log(`seeded teacher ${teacher.phone} (${teacher.id})`)
}

await main().finally(() => db.$disconnect())
