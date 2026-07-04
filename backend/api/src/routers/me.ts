import { userSettings } from '@somo/types'
import { authedProcedure, router } from '../trpc'

export const meRouter = router({
  get: authedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.auth.sub },
      include: { settings: true },
    })
    return {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      locale: user.locale,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      settings: user.settings,
    }
  }),

  updateSettings: authedProcedure.input(userSettings.partial()).mutation(async ({ ctx, input }) => {
    // drop undefineds so partial updates don't null-out columns
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
    const updated = await ctx.db.userSettings.upsert({
      where: { userId: ctx.auth.sub },
      update: patch,
      create: { userId: ctx.auth.sub, ...patch },
    })
    if (input.locale) {
      await ctx.db.user.update({ where: { id: ctx.auth.sub }, data: { locale: input.locale } })
    }
    return updated
  }),
})
