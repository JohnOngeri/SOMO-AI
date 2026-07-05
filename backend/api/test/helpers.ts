import type { FastifyInstance } from 'fastify'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createDb, type PrismaClient } from '../src/db'
import { loadEnv } from '../src/env'
import type { AppRouter } from '../src/routers/index'
import { buildServer, buildServices } from '../src/server'
import { MemorySmsSender } from '../src/sms'
import { newUlid } from '../src/ids'
import type { Services } from '../src/trpc'

export interface TestApp {
  app: FastifyInstance
  db: PrismaClient
  sms: MemorySmsSender
  services: Services
  url: string
  client: (accessToken?: string) => ReturnType<typeof createTRPCClient<AppRouter>>
  close: () => Promise<void>
}

export async function startTestApp(): Promise<TestApp> {
  const env = loadEnv()
  const db = createDb(env.DATABASE_URL)
  const sms = new MemorySmsSender()
  const services = buildServices({ env, db, sms })
  const app = await buildServer({ services })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  const url = `http://127.0.0.1:${address.port}`

  return {
    app,
    db,
    sms,
    services,
    url,
    client: (accessToken) =>
      createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${url}/trpc`,
            headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
          }),
        ],
      }),
    close: async () => {
      await app.close()
    },
  }
}

export async function resetDb(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "User", "UserSettings", "OtpChallenge", "Device", "RefreshToken", "ClassDnaProfile", "DnaResponse", "ReflectionEntry", "SynthesisCard", "Pack", "UsageEvent", "Price", "Subscription", "Coupon", "PaymentCharge", "WebhookDelivery", "Refund", "PackGrant", "Sale", "LedgerEntry", "Payout", "CoachReply", "Institution", "License", "Seat", "AdminUser", "AnalyticsSignal", "Order", "Invoice" CASCADE',
  )
}

/** Full OTP signup: returns an authenticated session for a fresh phone. */
export async function signUp(t: TestApp, phone: string) {
  const anon = t.client()
  const { challengeId } = await anon.auth.requestOtp.mutate({ phone, locale: 'en' })
  const code = t.sms.lastCodeFor(phone)!
  const deviceId = newUlid()
  const session = await anon.auth.verifyOtp.mutate({ challengeId, code, deviceId })
  return { ...session, deviceId }
}

/**
 * Give a user an ACTIVE seat on a live license (bypassing the PIN flow).
 * The default license runs for 80 more days with generous quotas.
 */
export async function seatUser(
  t: TestApp,
  userId: string,
  opts: {
    aiCalls?: number
    sms?: number
    startDaysAgo?: number
    endInDays?: number
    institutionName?: string
  } = {},
) {
  const DAY = 86_400_000
  const inst = await t.services.seats.createInstitution({
    name: opts.institutionName ?? 'Test Institution',
    type: 'NGO',
    country: 'KE',
  })
  const license = await t.services.seats.createLicense({
    institutionId: inst.id,
    term: '2026-T2',
    startDate: new Date(Date.now() - (opts.startDaysAgo ?? 10) * DAY),
    endDate: new Date(Date.now() + (opts.endInDays ?? 80) * DAY),
    seatsPurchased: 10,
    pricePerSeatMinor: 1200,
    currency: 'USD',
    monthlyAiCallsPerSeat: opts.aiCalls ?? 200,
    monthlySmsPerSeat: opts.sms ?? 100,
  })
  const [issued] = await t.services.seats.generateSeats(license.id, 1)
  const seat = await t.services.seats.redeemPin(issued!.pin, userId)
  return { inst, license, seat, pin: issued!.pin }
}

/** signUp + seat in one step — the common "authorized teacher" fixture. */
export async function signUpSeated(
  t: TestApp,
  phone: string,
  opts: Parameters<typeof seatUser>[2] = {},
) {
  const s = await signUp(t, phone)
  const seated = await seatUser(t, s.user.id, opts)
  return { ...s, ...seated }
}
