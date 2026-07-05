import { z } from 'zod'
import { ulid, usageEventType } from '@somo/types'
import { authedProcedure, router } from '../trpc'

/**
 * Event types clients may self-report. Cost-ledger types (ai_call, sms_out,
 * ussd_session, quota_block, seat_redeemed) are SERVER-written only.
 */
const clientReportable = usageEventType.extract(['pack_install', 'reflection', 'active_day'])

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

  /** Monthly AI-call quota state for the caller's seat (0 when seatless). */
  quota: authedProcedure.query(async ({ ctx }) => ctx.coach.quota(ctx.auth.sub)),
})
