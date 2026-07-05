import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { currency, ulid } from '@somo/types'
import { MarketplaceError } from '../marketplace/service'
import { authedProcedure, router } from '../trpc'

function rethrow(e: unknown): never {
  if (e instanceof MarketplaceError) {
    const code =
      e.code === 'pack_not_found' || e.code === 'not_found'
        ? 'NOT_FOUND'
        : e.code === 'charge_failed'
          ? 'PAYMENT_REQUIRED'
          : e.code === 'payment_pending'
            ? 'CONFLICT'
            : 'BAD_REQUEST'
    throw new TRPCError({ code, message: e.message })
  }
  throw e
}

export const marketplaceRouter = router({
  /** Creator earnings dashboard data. */
  earnings: authedProcedure.query(async ({ ctx }) => {
    if (ctx.auth.role !== 'creator' && ctx.auth.role !== 'somo_admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'creator role required' })
    }
    return ctx.marketplace.earnings(ctx.auth.sub)
  }),

  requestPayout: authedProcedure
    .input(z.object({ idempotencyKey: ulid, currency }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.role !== 'creator' && ctx.auth.role !== 'somo_admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'creator role required' })
      }
      try {
        return await ctx.marketplace.requestPayout(
          ctx.auth.sub,
          input.currency,
          input.idempotencyKey,
        )
      } catch (e) {
        rethrow(e)
      }
    }),
})
