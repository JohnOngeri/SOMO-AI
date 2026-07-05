import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { ulid } from '@somo/types'
import type { AdminIdentity } from '../admin/service'
import { SeatError } from '../seats/service'
import { authedProcedure, router } from '../trpc'

/**
 * Console procedures: the caller must be an AdminUser (matched by phone) of
 * an ACTIVE institution. Coordinators authenticate with the same phone-OTP
 * flow as teachers — no separate password system to operate.
 */
const adminProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const user = await ctx.db.user.findUnique({ where: { id: ctx.auth.sub } })
  if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  const admin = await ctx.admin.identityForPhone(user.phone)
  if (!admin) throw new TRPCError({ code: 'FORBIDDEN', message: 'not_an_institution_admin' })
  return next({ ctx: { ...ctx, adminIdentity: admin as AdminIdentity } })
})

function rethrow(e: unknown): never {
  if (e instanceof SeatError) {
    throw new TRPCError({
      code: e.code === 'not_found' ? 'NOT_FOUND' : 'FORBIDDEN',
      message: e.message,
    })
  }
  throw e
}

export const adminRouter = router({
  me: adminProcedure.query(async ({ ctx }) => {
    const inst = await ctx.db.institution.findUniqueOrThrow({
      where: { id: ctx.adminIdentity.institutionId },
    })
    return { ...ctx.adminIdentity, institution: inst }
  }),

  overview: adminProcedure.query(({ ctx }) => ctx.admin.overview(ctx.adminIdentity)),

  seats: router({
    list: adminProcedure.input(z.object({ licenseId: ulid })).query(async ({ ctx, input }) => {
      try {
        return await ctx.admin.listSeats(ctx.adminIdentity, input.licenseId)
      } catch (e) {
        rethrow(e)
      }
    }),

    /** HQ only — returns plaintext PINs exactly once for the printable sheet. */
    generate: adminProcedure
      .input(
        z.object({
          licenseId: ulid,
          count: z.number().int().positive().max(1000),
          labels: z.array(z.string().max(120)).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.admin.generateSeats(
            ctx.adminIdentity,
            input.licenseId,
            input.count,
            input.labels,
          )
        } catch (e) {
          rethrow(e)
        }
      }),

    importRoster: adminProcedure
      .input(
        z.object({
          licenseId: ulid,
          rows: z
            .array(z.object({ name: z.string().min(1).max(120) }))
            .min(1)
            .max(1000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.admin.importRoster(ctx.adminIdentity, input.licenseId, input.rows)
        } catch (e) {
          rethrow(e)
        }
      }),

    revoke: adminProcedure.input(z.object({ seatId: ulid })).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.admin.revokeSeat(ctx.adminIdentity, input.seatId)
      } catch (e) {
        rethrow(e)
      }
    }),

    reassign: adminProcedure.input(z.object({ seatId: ulid })).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.admin.reassignSeat(ctx.adminIdentity, input.seatId)
      } catch (e) {
        rethrow(e)
      }
    }),
  }),

  costs: adminProcedure.input(z.object({ licenseId: ulid })).query(async ({ ctx, input }) => {
    try {
      return await ctx.admin.costs(ctx.adminIdentity, input.licenseId)
    } catch (e) {
      rethrow(e)
    }
  }),

  /** The institution's invoices (printable from the console). */
  invoices: adminProcedure.query(({ ctx }) =>
    ctx.sales.invoicesFor(ctx.adminIdentity.institutionId),
  ),

  /** Impact & ROI — the per-term report institutional buyers renew on. */
  roi: adminProcedure.input(z.object({ licenseId: ulid })).query(async ({ ctx, input }) => {
    try {
      return await ctx.roi.report(ctx.adminIdentity, input.licenseId)
    } catch (e) {
      rethrow(e)
    }
  }),
})
