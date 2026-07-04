import type { FastifyInstance } from 'fastify'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createDb, type PrismaClient } from '../src/db'
import { loadEnv } from '../src/env'
import type { AppRouter } from '../src/routers/index'
import { buildServer } from '../src/server'
import { MemorySmsSender } from '../src/sms'
import { newUlid } from '../src/ids'

export interface TestApp {
  app: FastifyInstance
  db: PrismaClient
  sms: MemorySmsSender
  url: string
  client: (accessToken?: string) => ReturnType<typeof createTRPCClient<AppRouter>>
  close: () => Promise<void>
}

export async function startTestApp(): Promise<TestApp> {
  const env = loadEnv()
  const db = createDb(env.DATABASE_URL)
  const sms = new MemorySmsSender()
  const app = await buildServer({ env, db, sms })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  const url = `http://127.0.0.1:${address.port}`

  return {
    app,
    db,
    sms,
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
    'TRUNCATE "User", "UserSettings", "OtpChallenge", "Device", "RefreshToken", "ClassDnaProfile", "DnaResponse", "ReflectionEntry", "SynthesisCard" CASCADE',
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
