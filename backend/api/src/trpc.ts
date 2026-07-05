import { TRPCError, initTRPC } from '@trpc/server'
import type { PrismaClient } from './db'
import type { Env } from './env'
import type { OtpService } from './auth/otp'
import type { TokenService, AccessClaims } from './auth/tokens'
import type { PaymentProvider } from '@somo/payments'
import type { BillingService } from './billing/service'
import type { AiProvider } from './coach/provider'
import type { CoachService } from './coach/service'
import type { EntitlementService } from './entitlements/service'
import type { MarketplaceService } from './marketplace/service'
import type { MeteringService } from './metering/service'
import type { PackService, SigningKeys } from './packs/service'
import type { SeatService } from './seats/service'
import type { SmsSender } from './sms'
import type { ObjectStore } from './storage'

export interface Services {
  db: PrismaClient
  env: Env
  otp: OtpService
  tokens: TokenService
  sms: SmsSender
  store: ObjectStore
  packs: PackService
  packKeys: SigningKeys
  entitlements: EntitlementService
  metering: MeteringService
  payments: PaymentProvider
  billing: BillingService
  marketplace: MarketplaceService
  ai: AiProvider
  coach: CoachService
  seats: SeatService
}

export interface Context extends Services {
  auth: AccessClaims | null
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { ...ctx, auth: ctx.auth } })
})
