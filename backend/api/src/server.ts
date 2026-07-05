import Fastify, { type FastifyInstance } from 'fastify'
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { generateEd25519Keypair } from '@somo/packsign'
import { createDb, type PrismaClient } from './db'
import { OtpService } from './auth/otp'
import { TokenService } from './auth/tokens'
import { EntitlementService } from './entitlements/service'
import { type Env, loadEnv } from './env'
import { MeteringService } from './metering/service'
import { PackService, type SigningKeys } from './packs/service'
import { appRouter } from './routers/index'
import { ConsoleSmsSender, type SmsSender } from './sms'
import { FsObjectStore, type ObjectStore } from './storage'
import type { Context, Services } from './trpc'

export interface BuildOptions {
  env?: Env
  db?: PrismaClient
  sms?: SmsSender
  store?: ObjectStore
  /** pass prebuilt services (tests inspect them directly) */
  services?: Services
}

function loadSigningKeys(
  env: Env,
  name: string,
  privateKey: string | undefined,
  publicKey: string | undefined,
): SigningKeys {
  if (privateKey && publicKey) {
    return { publicKeyId: `somo-${name}`, privateKey, publicKey }
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(`${name} signing keys are required in production`)
  }
  const pair = generateEd25519Keypair()
  return { publicKeyId: `somo-${name}-dev-ephemeral`, ...pair }
}

export function buildServices(opts: BuildOptions = {}): Services {
  const env = opts.env ?? loadEnv()
  const db = opts.db ?? createDb(env.DATABASE_URL)
  const sms = opts.sms ?? new ConsoleSmsSender()
  const store = opts.store ?? new FsObjectStore(env.PACKS_STORAGE_DIR)
  const packKeys = loadSigningKeys(
    env,
    'packs',
    env.PACK_SIGNING_PRIVATE_KEY,
    env.PACK_SIGNING_PUBLIC_KEY,
  )
  const entitlementKeys = loadSigningKeys(
    env,
    'entitlements',
    env.ENTITLEMENT_SIGNING_PRIVATE_KEY,
    env.ENTITLEMENT_SIGNING_PUBLIC_KEY,
  )
  return {
    db,
    env,
    sms,
    store,
    packKeys,
    otp: new OtpService(db, sms, env),
    tokens: new TokenService(db, env),
    packs: new PackService(db, store, packKeys),
    entitlements: new EntitlementService(db, entitlementKeys),
    metering: new MeteringService(db),
  }
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const services = opts.services ?? buildServices(opts)
  const app = Fastify({ logger: services.env.NODE_ENV === 'development' })

  app.get('/health', async () => {
    await services.db.$queryRaw`SELECT 1`
    return { status: 'ok', service: 'api' }
  })

  // Pack archive bytes. Device flow: verify manifest signature -> download ->
  // check sha256(content) === manifest.contentHash -> install.
  app.get<{ Params: { id: string } }>('/packs/:id/archive', async (req, reply) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    const auth = token ? await services.tokens.verifyAccessToken(token) : null
    if (!auth) return reply.code(401).send({ error: 'unauthorized' })

    const row = await services.db.pack.findUnique({ where: { id: req.params.id } })
    if (!row || row.status !== 'live') return reply.code(404).send({ error: 'not_found' })
    if (row.priceAmountMinor > 0) {
      const claims = await services.entitlements.claimsFor(auth.sub)
      if (claims.packs !== 'all_standard') {
        return reply.code(402).send({ error: 'payment_required' })
      }
    }

    const bytes = await services.packs.getArchive(row.storageKey)
    return reply
      .header('content-type', 'application/octet-stream')
      .header('x-somo-content-hash', row.contentHash)
      .send(bytes)
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
