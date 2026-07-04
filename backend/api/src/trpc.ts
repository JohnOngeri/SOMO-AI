import { TRPCError, initTRPC } from '@trpc/server'
import type { PrismaClient } from './db'
import type { Env } from './env'
import type { OtpService } from './auth/otp'
import type { TokenService, AccessClaims } from './auth/tokens'
import type { SmsSender } from './sms'

export interface Services {
  db: PrismaClient
  env: Env
  otp: OtpService
  tokens: TokenService
  sms: SmsSender
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
