import { z } from 'zod'
import { dnaResponse, ulid } from '@somo/types'
import { newUlid } from '../ids'
import { authedProcedure, router } from '../trpc'

const upsertInput = z.object({
  id: ulid.optional(),
  className: z.string().min(1).max(120),
  learnerCount: z.number().int().positive().max(500).optional(),
  responses: z.array(dnaResponse).max(5),
})

export const dnaRouter = router({
  upsert: authedProcedure.input(upsertInput).mutation(async ({ ctx, input }) => {
    const id = input.id ?? newUlid()
    const profile = await ctx.db.classDnaProfile.upsert({
      where: { id },
      update: {
        className: input.className,
        learnerCount: input.learnerCount ?? null,
      },
      create: {
        id,
        userId: ctx.auth.sub,
        className: input.className,
        learnerCount: input.learnerCount ?? null,
      },
    })
    if (profile.userId !== ctx.auth.sub) throw new Error('forbidden')

    for (const r of input.responses) {
      await ctx.db.dnaResponse.upsert({
        where: { profileId_promptId: { profileId: id, promptId: r.promptId } },
        update: {
          transcript: r.transcript,
          audioRef: r.audioRef ?? null,
          capturedAt: new Date(r.capturedAt),
        },
        create: {
          id: newUlid(),
          profileId: id,
          promptId: r.promptId,
          transcript: r.transcript,
          audioRef: r.audioRef ?? null,
          capturedAt: new Date(r.capturedAt),
        },
      })
    }
    return { id }
  }),

  get: authedProcedure.query(async ({ ctx }) => {
    const profile = await ctx.db.classDnaProfile.findFirst({
      where: { userId: ctx.auth.sub },
      include: { responses: true },
      orderBy: { updatedAt: 'desc' },
    })
    return profile
  }),
})
