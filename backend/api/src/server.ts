import Fastify, { type FastifyInstance } from 'fastify'
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { createDb, type PrismaClient } from './db'
import { OtpService } from './auth/otp'
import { TokenService } from './auth/tokens'
import { type Env, loadEnv } from './env'
import { appRouter } from './routers/index'
import { ConsoleSmsSender, type SmsSender } from './sms'
import type { Context, Services } from './trpc'

export interface BuildOptions {
  env?: Env
  db?: PrismaClient
  sms?: SmsSender
}

export function buildServices(opts: BuildOptions = {}): Services {
  const env = opts.env ?? loadEnv()
  const db = opts.db ?? createDb(env.DATABASE_URL)
  const sms = opts.sms ?? new ConsoleSmsSender()
  return {
    db,
    env,
    sms,
    otp: new OtpService(db, sms, env),
    tokens: new TokenService(db, env),
  }
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const services = buildServices(opts)
  const app = Fastify({ logger: services.env.NODE_ENV === 'development' })

  app.get('/health', async () => {
    await services.db.$queryRaw`SELECT 1`
    return { status: 'ok', service: 'api' }
  })

  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: async ({ req }: CreateFastifyContextOptions): Promise<Context> => {
        const header = req.headers.authorization
        const token = header?.startsWith('Bearer ') ? header.slice(7) : null
        const auth = token ? await services.tokens.verifyAccessToken(token) : null
        return { ...services, auth }
      },
    },
  })

  app.addHook('onClose', async () => {
    await services.db.$disconnect()
  })

  return app
}
