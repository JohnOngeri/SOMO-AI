/**
 * Demo seed for the B2B pivot: two buyer-type institutions with licenses,
 * PIN'd seats, staggered teacher activity (so the console, cost, ROI and
 * insights dashboards all render), plus a fixed demo PIN for walkthroughs.
 *
 *   pnpm --filter @somo/api db:push && pnpm --filter @somo/api seed
 *
 * Demo logins (phone OTP codes print to the API console in dev):
 *   SOMO staff   : +254700000100  (sales + insights)
 *   TFA HQ admin : +254700000001  (console: Teach For All pilot)
 *   Umoja HQ     : +254700000011  (console: Bridge-style school network)
 *   Teacher PIN  : TEST-SEAT      (unclaimed seat on the TFA license)
 */
import { generateEd25519Keypair } from '@somo/packsign'
import { createDb } from '../src/db'
import { loadEnv } from '../src/env'
import { newUlid } from '../src/ids'
import { AnalyticsService } from '../src/analytics/service'
import { AdminService } from '../src/admin/service'
import { SalesService } from '../src/billing/sales'
import { PackService } from '../src/packs/service'
import { SeatService } from '../src/seats/service'
import { FsObjectStore } from '../src/storage'

const DAY = 86_400_000
const env = loadEnv({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://somo:somo@localhost:5432/somo',
})
const db = createDb(env.DATABASE_URL)
const seats = new SeatService(db, env)
const admin = new AdminService(db, seats, env)
const sales = new SalesService(db, seats)
const analytics = new AnalyticsService(db, env)

const QUESTIONS = [
  'How do I explain fractions with no textbooks?',
  'My learners confuse place value past one hundred',
  'A warm-up game for a large class of 70 learners?',
  'The class gets noisy after break, how do I refocus attention?',
  'How do I check understanding without a written test?',
  'Phonics blends for slow readers?',
  'How do I keep quiet learners participating?',
  'Times table drills that work with call-and-response?',
]

async function user(phone: string, displayName: string, role = 'teacher') {
  return db.user.upsert({
    where: { phone },
    update: { role },
    create: { id: newUlid(), phone, displayName, role, settings: { create: {} } },
  })
}

async function seedTeacherActivity(
  teacherId: string,
  opts: { claimedDaysAgo: number; asks: number; reflections: number },
) {
  for (let i = 0; i < opts.asks; i++) {
    const at = new Date(Date.now() - (opts.claimedDaysAgo - 1 - (i % opts.claimedDaysAgo)) * DAY)
    await db.usageEvent.create({
      data: { id: newUlid(), userId: teacherId, type: 'ai_call', at, meta: { mode: 'text' } },
    })
    await analytics.ingest({
      userId: teacherId,
      source: 'coach_question',
      text: QUESTIONS[i % QUESTIONS.length]!,
      at,
    })
  }
  for (let i = 0; i < opts.reflections; i++) {
    const at = new Date(Date.now() - (i % opts.claimedDaysAgo) * DAY)
    await db.reflectionEntry
      .create({
        data: {
          id: newUlid(),
          userId: teacherId,
          date: at.toISOString().slice(0, 10),
          slot: ((i % 3) + 1) as number,
          mode: 'voice',
          transcript: 'The exit-question-first structure worked; quieter learners joined the game.',
          capturedAt: at,
        },
      })
      .catch(() => null) // same date+slot collisions are fine to skip
    await analytics.ingest({
      userId: teacherId,
      source: 'reflection',
      text: 'exit question assessment engaged the quiet learners',
      at,
    })
  }
}

async function seedInstitution(config: {
  name: string
  type: string
  country: string
  hqPhone: string
  coordinatorPhone: string
  seatsPurchased: number
  seatsToIssue: number
  teachersToClaim: number
  phonePrefix: string
  viaSalesPipeline: boolean
}) {
  let institutionId: string
  let licenseId: string

  if (config.viaSalesPipeline) {
    // exercise the real money pipeline: quote -> order -> invoice -> paid
    const inst = await seats.createInstitution({
      name: config.name,
      type: config.type,
      country: config.country,
      billingContactEmail: 'finance@example.org',
    })
    const quote = await sales.createQuote({
      institutionId: inst.id,
      term: '2026-T2',
      startDate: new Date(Date.now() - 30 * DAY),
      endDate: new Date(Date.now() + 60 * DAY),
      seats: config.seatsPurchased,
      currency: 'USD',
    })
    await sales.acceptQuote(quote.id)
    const invoice = await sales.issueInvoice(quote.id)
    const { license } = await sales.markPaid(invoice.id, 'BANKTRF-DEMO-001')
    institutionId = inst.id
    licenseId = license!.id
    console.log(`  invoice ${invoice.number} paid -> license ${license!.id}`)
  } else {
    const inst = await seats.createInstitution({
      name: config.name,
      type: config.type,
      country: config.country,
      billingContactEmail: 'programmes@example.org',
    })
    const license = await seats.createLicense({
      institutionId: inst.id,
      term: '2026-T2',
      startDate: new Date(Date.now() - 30 * DAY),
      endDate: new Date(Date.now() + 60 * DAY),
      seatsPurchased: config.seatsPurchased,
      pricePerSeatMinor: 1500,
      currency: 'USD',
    })
    institutionId = inst.id
    licenseId = license.id
  }

  await admin.addAdmin({
    institutionId,
    phone: config.hqPhone,
    displayName: 'HQ Coordinator',
    role: 'HQ_ADMIN',
  })
  await admin.addAdmin({
    institutionId,
    phone: config.coordinatorPhone,
    displayName: 'Regional Coordinator',
    role: 'COORDINATOR',
    regionScope: 'Nairobi',
  })

  const issued = await seats.generateSeats(licenseId, config.seatsToIssue)
  console.log(`  ${config.name}: ${issued.length} seats issued — sample PINs:`)
  for (const s of issued.slice(0, 3)) console.log(`    ${s.pin}`)

  for (let i = 0; i < config.teachersToClaim; i++) {
    const teacher = await user(
      `${config.phonePrefix}${String(i).padStart(2, '0')}`,
      `Demo Teacher ${i + 1}`,
    )
    const claimedDaysAgo = 5 + ((i * 3) % 25)
    const seat = await seats.redeemPin(issued[i]!.pin, teacher.id)
    await db.seat.update({
      where: { id: seat.id },
      data: {
        claimedAt: new Date(Date.now() - claimedDaysAgo * DAY),
        label: `Demo Teacher ${i + 1}`,
      },
    })
    await seedTeacherActivity(teacher.id, {
      claimedDaysAgo,
      asks: 3 + ((i * 5) % 12),
      reflections: 2 + ((i * 7) % 9),
    })
  }
  console.log(`  ${config.teachersToClaim} teachers claimed seats and have activity`)
  return { institutionId, licenseId }
}

async function main() {
  console.log('Seeding SOMO demo data (B2B pivot)…')

  await user('+254700000100', 'SOMO Staff', 'somo_admin')

  console.log('• Teach For All — Kenya Pilot (fellowship buyer)')
  const tfa = await seedInstitution({
    name: 'Teach For All — Kenya Pilot',
    type: 'FELLOWSHIP',
    country: 'KE',
    hqPhone: '+254700000001',
    coordinatorPhone: '+254700000002',
    seatsPurchased: 20,
    seatsToIssue: 15,
    teachersToClaim: 10,
    phonePrefix: '+2547101000',
    viaSalesPipeline: false,
  })

  // a fixed, documented demo PIN on the TFA license: TEST-SEAT
  await db.seat.create({
    data: {
      id: newUlid(),
      licenseId: tfa.licenseId,
      authPinHash: seats.hashPin('TEST-SEAT'),
      label: 'Walkthrough seat (PIN: TEST-SEAT)',
    },
  })
  console.log('  fixed demo PIN ready: TEST-SEAT')

  console.log('• Umoja Schools Network (Bridge-style network, via the sales pipeline)')
  await seedInstitution({
    name: 'Umoja Schools Network',
    type: 'SCHOOL_NETWORK',
    country: 'KE',
    hqPhone: '+254700000011',
    coordinatorPhone: '+254700000012',
    seatsPurchased: 40,
    seatsToIssue: 25,
    teachersToClaim: 15,
    phonePrefix: '+2547102000',
    viaSalesPipeline: true,
  })

  // one signed demo pack so Today/Packs render
  if (!(await db.pack.findUnique({ where: { slug: 'numeracy-foundations-term-1' } }))) {
    const keys =
      env.PACK_SIGNING_PRIVATE_KEY && env.PACK_SIGNING_PUBLIC_KEY
        ? {
            publicKeyId: 'somo-root',
            privateKey: env.PACK_SIGNING_PRIVATE_KEY,
            publicKey: env.PACK_SIGNING_PUBLIC_KEY,
          }
        : { publicKeyId: 'somo-dev-ephemeral', ...generateEd25519Keypair() }
    const packs = new PackService(db, new FsObjectStore(env.PACKS_STORAGE_DIR), keys)
    const publisher = await user('+254700000199', 'SOMO Content', 'creator')
    await packs.publish({
      slug: 'numeracy-foundations-term-1',
      title: 'Numeracy Foundations — Term 1',
      subject: 'Mathematics',
      gradeLevels: ['P3', 'P4'],
      locale: 'en',
      version: '1.0.0',
      publisherId: publisher.id,
      lessons: [
        { index: 0, title: 'Counting with what you have', minutes: 30 },
        { index: 1, title: 'Place value with bottle tops', minutes: 35 },
        { index: 2, title: 'Number stories out loud', minutes: 30 },
      ],
      priceAmountMinor: 0,
      priceCurrency: 'KES',
      archive: Buffer.from(JSON.stringify({ format: 'somopack/1', note: 'demo archive' })),
    })
    console.log('• demo pack published')
  }

  console.log('\nDone. Console logins (OTP prints to the API log in dev):')
  console.log('  TFA HQ admin  +254700000001   Umoja HQ  +254700000011')
  console.log('  SOMO staff    +254700000100   Demo PIN  TEST-SEAT')
}

await main().finally(() => db.$disconnect())
