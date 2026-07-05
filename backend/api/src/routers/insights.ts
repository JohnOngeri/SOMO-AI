import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { authedProcedure, router } from '../trpc'

/**
 * The licensed analytics product (ministries, funders, curriculum
 * developers). Access is a paid subscription — for now the 'insights' and
 * 'somo_admin' roles gate it; licensing/billing of this product lands with
 * B2B invoicing (P6/P7).
 */
const insightsProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const user = await ctx.db.user.findUnique({ where: { id: ctx.auth.sub } })
  if (!user || (user.role !== 'somo_admin' && user.role !== 'insights')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'insights_license_required' })
  }
  return next()
})

export const insightsRouter = router({
  topConcepts: insightsProcedure
    .input(
      z
        .object({
          country: z.string().length(2).optional(),
          institutionType: z.string().optional(),
          sinceWeeks: z.number().int().positive().max(52).optional(),
        })
        .default({}),
    )
    .query(({ ctx, input }) => ctx.analytics.topConcepts(input)),

  trend: insightsProcedure
    .input(
      z.object({
        topic: z.string().min(1).max(80),
        country: z.string().length(2).optional(),
        sinceWeeks: z.number().int().positive().max(52).optional(),
      }),
    )
    .query(({ ctx, input }) => ctx.analytics.trend(input)),
})
