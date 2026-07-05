import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { ulid, usageEventType } from '@somo/types'
import { QuotaExceededError } from '../metering/service'
import { authedProcedure, router } from '../trpc'

/** Event types clients may self-report; money-adjacent types are server-only. */
const clientReportable = usageEventType.exclude(['upgrade', 'trial_start', 'referral_redeem'])

export const meteringRouter = router({
  record: authedProcedure
    .input(
      z.object({
        id: ulid,
        type: clientReportable,
        at: z.string().datetime({ offset: true }).optional(),
        meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const applied = await ctx.metering.record({
        id: input.id,
        userId: ctx.auth.sub,
        type: input.type,
        ...(input.at ? { at: new Date(input.at) } : {}),
        ...(input.meta ? { meta: input.meta } : {}),
      })
      return { applied }
    }),

  /**
   * Consume one Ask Coach credit (or verify unlimited). The AI coach (phase 7)
   * calls the same gate internally; SMS/USSD asks flow through it too.
   */
  ask: authedProcedure
    .input(z.object({ id: ulid, meta: z.record(z.string(), z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const claims = await ctx.entitlements.claimsFor(ctx.auth.sub)
      try {
        return await ctx.metering.recordAskOrThrow({
          id: input.id,
          userId: ctx.auth.sub,
          limit: claims.limits.asksPerWeek,
          ...(input.meta ? { meta: input.meta } : {}),
        })
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'quota_exceeded',
            cause: e.quota,
          })
        }
        throw e
      }
    }),

  quota: authedProcedure.query(async ({ ctx }) => {
    const claims = await ctx.entitlements.claimsFor(ctx.auth.sub)
    return ctx.metering.askQuota(ctx.auth.sub, claims.limits.asksPerWeek)
  }),
})
