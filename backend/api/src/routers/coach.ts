import { TRPCError } from '@trpc/server'
import { askCoachInput } from '@somo/types'
import { SeatRequiredError } from '../coach/service'
import { QuotaExceededError } from '../metering/service'
import { authedProcedure, router } from '../trpc'

export const coachRouter = router({
  ask: authedProcedure.input(askCoachInput).mutation(async ({ ctx, input }) => {
    try {
      const { reply, quota, degraded } = await ctx.coach.ask({
        userId: ctx.auth.sub,
        askId: input.id,
        question: input.question,
        mode: input.mode,
        ...(input.dnaId ? { dnaId: input.dnaId } : {}),
      })
      return {
        id: reply.id,
        askId: reply.askId,
        answer: reply.answer,
        costTier: reply.costTier,
        degraded,
        groundedOn: { dna: reply.dnaProfileId !== null, packIds: [] },
        createdAt: reply.createdAt.toISOString(),
        quota,
      }
    } catch (e) {
      if (e instanceof SeatRequiredError) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'seat_required' })
      }
      if (e instanceof QuotaExceededError) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'quota_exceeded', cause: e.quota })
      }
      throw e
    }
  }),

  history: authedProcedure.query(async ({ ctx }) => {
    return ctx.db.coachReply.findMany({
      where: { userId: ctx.auth.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        askId: true,
        question: true,
        answer: true,
        costTier: true,
        mode: true,
        createdAt: true,
      },
    })
  }),
})
