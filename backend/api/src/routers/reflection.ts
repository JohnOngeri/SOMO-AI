import { z } from 'zod'
import { reflectionMode, ulid } from '@somo/types'
import { authedProcedure, router } from '../trpc'

const addInput = z.object({
  id: ulid, // client ULID = offline idempotency key
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  mode: reflectionMode,
  transcript: z.string().min(1).max(4000),
  durationSec: z.number().int().positive().max(180).optional(),
  capturedAt: z.string().datetime({ offset: true }),
})

export const reflectionRouter = router({
  add: authedProcedure.input(addInput).mutation(async ({ ctx, input }) => {
    // idempotent replay: same id -> same row, no error
    const existing = await ctx.db.reflectionEntry.findUnique({ where: { id: input.id } })
    if (existing) {
      if (existing.userId !== ctx.auth.sub) throw new Error('forbidden')
      return { id: existing.id, duplicate: true }
    }

    const entry = await ctx.db.reflectionEntry.upsert({
      // same slot re-recorded on the same day replaces the earlier take
      where: { userId_date_slot: { userId: ctx.auth.sub, date: input.date, slot: input.slot } },
      update: {
        id: input.id,
        mode: input.mode,
        transcript: input.transcript,
        durationSec: input.durationSec ?? null,
        capturedAt: new Date(input.capturedAt),
      },
      create: {
        id: input.id,
        userId: ctx.auth.sub,
        date: input.date,
        slot: input.slot,
        mode: input.mode,
        transcript: input.transcript,
        durationSec: input.durationSec ?? null,
        capturedAt: new Date(input.capturedAt),
      },
    })
    await ctx.analytics.ingest({
      userId: ctx.auth.sub,
      source: 'reflection',
      text: input.transcript,
    })
    return { id: entry.id, duplicate: false }
  }),

  byDate: authedProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.reflectionEntry.findMany({
        where: { userId: ctx.auth.sub, date: input.date },
        orderBy: { slot: 'asc' },
      })
    }),
})
