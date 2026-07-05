import { authedProcedure, router } from '../trpc'

export const entitlementsRouter = router({
  /**
   * Current claims + the signed offline token. Clients refresh this
   * opportunistically on any sync and store it locally; the device enforces
   * limits from the token when there is no connectivity.
   */
  get: authedProcedure.query(async ({ ctx }) => {
    const { token, claims } = await ctx.entitlements.issueToken(ctx.auth.sub)
    return { token, claims, ...ctx.entitlements.publicKeyInfo }
  }),
})
