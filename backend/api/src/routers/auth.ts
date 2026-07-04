import { TRPCError } from '@trpc/server'
import { refreshInput, requestOtpInput, verifyOtpInput } from '@somo/types'
import { OtpError } from '../auth/otp'
import { newUlid } from '../ids'
import { publicProcedure, router } from '../trpc'

function toTrpcError(e: unknown): never {
  if (e instanceof OtpError) {
    throw new TRPCError({
      code: e.code === 'rate_limited' ? 'TOO_MANY_REQUESTS' : 'UNAUTHORIZED',
      message: e.code,
    })
  }
  throw e
}

export const authRouter = router({
  requestOtp: publicProcedure.input(requestOtpInput).mutation(async ({ ctx, input }) => {
    try {
      const { challengeId, expiresAt, retryAfterSec } = await ctx.otp.request(
        input.phone,
        input.locale,
      )
      return {
        challengeId,
        channel: 'sms' as const,
        expiresAt: expiresAt.toISOString(),
        retryAfterSec,
      }
    } catch (e) {
      toTrpcError(e)
    }
  }),

  verifyOtp: publicProcedure.input(verifyOtpInput).mutation(async ({ ctx, input }) => {
    let phone: string, locale: string
    try {
      ;({ phone, locale } = await ctx.otp.verify(input.challengeId, input.code))
    } catch (e) {
      toTrpcError(e)
    }

    const user = await ctx.db.user.upsert({
      where: { phone },
      update: {},
      create: {
        id: newUlid(),
        phone,
        locale,
        settings: { create: { locale } },
      },
    })

    await ctx.db.device.upsert({
      where: { id: input.deviceId },
      update: { lastSeenAt: new Date() },
      create: { id: input.deviceId, userId: user.id, name: input.deviceName ?? null },
    })

    const { token, expiresAt } = await ctx.tokens.signAccessToken({
      sub: user.id,
      deviceId: input.deviceId,
      role: user.role,
    })
    const refreshToken = await ctx.tokens.issueRefreshToken(user.id, input.deviceId)

    return {
      accessToken: token,
      accessTokenExpiresAt: expiresAt.toISOString(),
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        ...(user.displayName ? { displayName: user.displayName } : {}),
        locale: user.locale,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      },
    }
  }),

  refresh: publicProcedure.input(refreshInput).mutation(async ({ ctx, input }) => {
    const rotated = await ctx.tokens.rotateRefreshToken(input.refreshToken, input.deviceId)
    if (!rotated) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'invalid_refresh_token' })

    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: rotated.userId } })
    const { token, expiresAt } = await ctx.tokens.signAccessToken({
      sub: user.id,
      deviceId: input.deviceId,
      role: user.role,
    })
    return {
      accessToken: token,
      accessTokenExpiresAt: expiresAt.toISOString(),
      refreshToken: rotated.newToken,
    }
  }),
})
