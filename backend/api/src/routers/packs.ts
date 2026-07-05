import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { currency, locale, packLesson, semver, ulid } from '@somo/types'
import { authedProcedure, publicProcedure, router } from '../trpc'

const publishInput = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(80),
  gradeLevels: z.array(z.string().max(40)).min(1).max(12),
  locale,
  version: semver,
  lessons: z.array(packLesson).min(1).max(200),
  priceAmountMinor: z.number().int().nonnegative(),
  priceCurrency: currency,
  /** base64 pack archive (small packs; large uploads move to presigned S3 later) */
  archiveBase64: z.string().min(1),
})

export const packsRouter = router({
  /** Device pin: the key packs must verify against. */
  signingKey: publicProcedure.query(({ ctx }) => ({
    publicKeyId: ctx.packKeys.publicKeyId,
    publicKey: ctx.packKeys.publicKey,
  })),

  list: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.pack.findMany({
      where: { status: 'live' },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => ctx.packs.toSignedManifest(r))
  }),

  get: authedProcedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.pack.findUnique({ where: { slug: input.slug } })
    if (!row || row.status !== 'live') throw new TRPCError({ code: 'NOT_FOUND' })
    return ctx.packs.toSignedManifest(row)
  }),

  publish: authedProcedure.input(publishInput).mutation(async ({ ctx, input }) => {
    if (ctx.auth.role !== 'creator' && ctx.auth.role !== 'somo_admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'publisher role required' })
    }
    const { archiveBase64, ...meta } = input
    const archive = Buffer.from(archiveBase64, 'base64')
    if (archive.byteLength === 0) throw new TRPCError({ code: 'BAD_REQUEST' })
    return ctx.packs.publish({ ...meta, publisherId: ctx.auth.sub, archive })
  }),

  /**
   * Free packs download immediately; paid packs require an entitlement
   * (enforced properly in Phase 4 — until then they 402).
   */
  download: authedProcedure.input(z.object({ id: ulid })).mutation(async ({ ctx, input }) => {
    const row = await ctx.db.pack.findUnique({ where: { id: input.id } })
    if (!row || row.status !== 'live') throw new TRPCError({ code: 'NOT_FOUND' })
    if (row.priceAmountMinor > 0) {
      throw new TRPCError({
        code: 'PAYMENT_REQUIRED',
        message: 'pack requires purchase or SOMO Plus',
      })
    }
    return {
      ...ctx.packs.toSignedManifest(row),
      archivePath: `/packs/${row.id}/archive`,
    }
  }),
})
