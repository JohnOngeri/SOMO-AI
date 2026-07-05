import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { institutionType, ulid } from '@somo/types'
import { SalesError } from '../billing/sales'
import { authedProcedure, router } from '../trpc'

/** SOMO staff operate sales; institutions see their invoices via admin.invoices. */
const somoAdminProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const user = await ctx.db.user.findUnique({ where: { id: ctx.auth.sub } })
  if (!user || user.role !== 'somo_admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'somo_admin_required' })
  }
  return next()
})

function rethrow(e: unknown): never {
  if (e instanceof SalesError) {
    throw new TRPCError({
      code: e.code === 'not_found' ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: e.message,
    })
  }
  throw e
}

export const salesRouter = router({
  createInstitution: somoAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        type: institutionType,
        country: z.string().length(2),
        billingContactEmail: z.string().email().optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.seats.createInstitution(input)),

  addAdmin: somoAdminProcedure
    .input(
      z.object({
        institutionId: ulid,
        phone: z.string().min(8),
        displayName: z.string().max(120).optional(),
        role: z.enum(['HQ_ADMIN', 'COORDINATOR']),
        regionScope: z.string().max(120).optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.admin.addAdmin(input)),

  priceQuote: somoAdminProcedure
    .input(
      z.object({
        institutionId: ulid,
        seats: z.number().int().positive().max(1_000_000),
        currency: z.string().length(3),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.sales.priceQuote(input.institutionId, input.seats, input.currency)
      } catch (e) {
        rethrow(e)
      }
    }),

  createQuote: somoAdminProcedure
    .input(
      z.object({
        institutionId: ulid,
        term: z.string().regex(/^\d{4}-T[1-3]$/),
        startDate: z.string().datetime({ offset: true }),
        endDate: z.string().datetime({ offset: true }),
        seats: z.number().int().positive().max(1_000_000),
        currency: z.string().length(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.sales.createQuote({
          ...input,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
        })
      } catch (e) {
        rethrow(e)
      }
    }),

  acceptQuote: somoAdminProcedure
    .input(z.object({ orderId: ulid }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.sales.acceptQuote(input.orderId)
      } catch (e) {
        rethrow(e)
      }
    }),

  issueInvoice: somoAdminProcedure
    .input(z.object({ orderId: ulid, dueInDays: z.number().int().positive().max(120).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.sales.issueInvoice(input.orderId, { dueInDays: input.dueInDays })
      } catch (e) {
        rethrow(e)
      }
    }),

  markPaid: somoAdminProcedure
    .input(z.object({ invoiceId: ulid, paymentRef: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.sales.markPaid(input.invoiceId, input.paymentRef)
      } catch (e) {
        rethrow(e)
      }
    }),
})
