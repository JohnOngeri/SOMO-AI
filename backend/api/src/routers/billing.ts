import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { currency, ulid } from '@somo/types'
import { BillingError } from '../billing/service'
import { authedProcedure, publicProcedure, router } from '../trpc'

function rethrow(e: unknown): never {
  if (e instanceof BillingError) {
    const code =
      e.code === 'price_not_found' || e.code === 'not_found'
        ? 'NOT_FOUND'
        : e.code === 'charge_failed'
          ? 'PAYMENT_REQUIRED'
          : 'BAD_REQUEST'
    throw new TRPCError({ code, message: e.message })
  }
  throw e
}

const subscribeInput = z.object({
  idempotencyKey: ulid,
  priceId: ulid,
  channel: z.enum(['mobile_money', 'card', 'airtime']),
  msisdn: z.string().optional(),
  couponCode: z.string().max(40).optional(),
  trial: z.boolean().default(false),
})

export const billingRouter = router({
  prices: publicProcedure
    .input(z.object({ currency: currency.optional() }).default({}))
    .query(({ ctx, input }) => ctx.billing.listPrices(input.currency)),

  preview: authedProcedure
    .input(z.object({ priceId: ulid, couponCode: z.string().max(40).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        const { price, amountMinor, coupon } = await ctx.billing.previewAmount(
          input.priceId,
          input.couponCode,
        )
        return { price, amountMinor, couponApplied: coupon?.code ?? null }
      } catch (e) {
        rethrow(e)
      }
    }),

  subscribe: authedProcedure.input(subscribeInput).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.billing.subscribe({
        userId: ctx.auth.sub,
        priceId: input.priceId,
        channel: input.channel,
        idempotencyKey: input.idempotencyKey,
        trial: input.trial,
        ...(input.msisdn ? { msisdn: input.msisdn } : {}),
        ...(input.couponCode ? { couponCode: input.couponCode } : {}),
      })
    } catch (e) {
      rethrow(e)
    }
  }),

  mySubscription: authedProcedure.query(async ({ ctx }) => {
    return ctx.db.subscription.findFirst({
      where: { userId: ctx.auth.sub, status: { not: 'expired' } },
      include: { price: true },
      orderBy: { createdAt: 'desc' },
    })
  }),

  cancel: authedProcedure
    .input(z.object({ subscriptionId: ulid }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.billing.cancel(input.subscriptionId, ctx.auth.sub)
      } catch (e) {
        rethrow(e)
      }
    }),
})
