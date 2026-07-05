import Fastify, { type FastifyInstance } from 'fastify'
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { generateEd25519Keypair } from '@somo/packsign'
import { SandboxPaymentProvider, type PaymentProvider } from '@somo/payments'
import { createDb, type PrismaClient } from './db'
import { OtpService } from './auth/otp'
import { TokenService } from './auth/tokens'
import { SalesService } from './billing/sales'
import { BillingService } from './billing/service'
import { AnthropicAiProvider, MockAiProvider, type AiProvider } from './coach/provider'
import { CoachService } from './coach/service'
import { RoiService } from './admin/roi'
import { AnalyticsService } from './analytics/service'
import { AdminService } from './admin/service'
import { EntitlementService } from './entitlements/service'
import { GatewayService } from './gateway/service'
import { SmsGate } from './gateway/smsgate'
import { MarketplaceService } from './marketplace/service'
import { type Env, loadEnv } from './env'
import { MeteringService } from './metering/service'
import { PackService, type SigningKeys } from './packs/service'
import { SeatService } from './seats/service'
import { appRouter } from './routers/index'
import { ConsoleSmsSender, type SmsSender } from './sms'
import { FsObjectStore, type ObjectStore } from './storage'
import type { Context, Services } from './trpc'

export interface BuildOptions {
  env?: Env
  db?: PrismaClient
  sms?: SmsSender
  store?: ObjectStore
  payments?: PaymentProvider
  ai?: AiProvider
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
  const payments = opts.payments ?? new SandboxPaymentProvider()
  const metering = new MeteringService(db)
  const marketplace = new MarketplaceService(db, payments)
  const seats = new SeatService(db, env)
  const entitlements = new EntitlementService(db, entitlementKeys, seats)
  const smsGate = new SmsGate(db, seats, metering, sms)
  const ai =
    opts.ai ??
    (env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY
      ? new AnthropicAiProvider(env.ANTHROPIC_API_KEY)
      : new MockAiProvider())
  const analytics = new AnalyticsService(db, env)
  const coach = new CoachService(db, ai, seats, metering, env, analytics)
  return {
    db,
    env,
    sms,
    store,
    packKeys,
    payments,
    otp: new OtpService(db, sms, env),
    tokens: new TokenService(db, env),
    packs: new PackService(db, store, packKeys),
    entitlements,
    metering,
    marketplace,
    ai,
    coach,
    seats,
    smsGate,
    gateway: new GatewayService(db, coach, seats, metering, smsGate, analytics),
    admin: new AdminService(db, seats, env),
    roi: new RoiService(db, env),
    analytics,
    sales: new SalesService(db, seats),
    billing: new BillingService(db, payments, metering, {
      marketplaceChargeSucceeded: (ref) => marketplace.completeSaleForCharge(ref),
    }),
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
    // fail closed: pack bytes are metered distribution — seat required
    const claims = await services.entitlements.claimsFor(auth.sub)
    const owned = await services.marketplace.hasGrant(auth.sub, row.id)
    if (claims.plan === 'none' && !owned) {
      return reply.code(403).send({ error: 'seat_required' })
    }
    if (row.priceAmountMinor > 0 && claims.packs !== 'all_standard' && !owned) {
      return reply.code(402).send({ error: 'payment_required' })
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

  // Payment provider webhooks. Raw body preserved for signature verification;
  // stored before processing; idempotent by event id.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    )
    scope.post('/webhooks/payments', async (req, reply) => {
      const signature = String(req.headers['x-somo-signature'] ?? '')
      const result = await services.billing.applyWebhook(String(req.body), signature)
      if (!result.ok) return reply.code(401).send({ error: 'invalid_signature' })
      return { received: true, duplicate: result.duplicate }
    })
  })

  // USSD/SMS gateway (Africa's Talking-compatible, form-encoded webhooks).
  // Authorization lives inside GatewayService: unbound MSISDNs never reach
  // the LLM and never trigger a paid outbound SMS.
  await app.register(async (scope) => {
    const { default: formbody } = await import('@fastify/formbody')
    await scope.register(formbody)

    scope.post('/gateway/ussd', async (req, reply) => {
      const body = req.body as Record<string, string>
      const res = await services.gateway.handleUssd({
        phoneNumber: body.phoneNumber ?? '',
        text: body.text ?? '',
      })
      return reply.type('text/plain').send(`${res.type} ${res.message}`)
    })

    scope.post('/gateway/sms', async (req) => {
      const body = req.body as Record<string, string>
      await services.gateway.handleSms({ from: body.from ?? '', text: body.text ?? '' })
      return { ok: true }
    })
  })

  app.addHook('onClose', async () => {
    await services.db.$disconnect()
  })

  return app
}
