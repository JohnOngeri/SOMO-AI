import { z } from 'zod'
import { isoDateTime, locale, phoneE164, ulid } from './common'
import { userPublic } from './user'

export const requestOtpInput = z.object({
  phone: phoneE164,
  locale: locale.default('en'),
})
export type RequestOtpInput = z.infer<typeof requestOtpInput>

export const requestOtpResult = z.object({
  challengeId: ulid,
  channel: z.literal('sms'),
  expiresAt: isoDateTime,
  /** seconds the client must wait before requesting another code */
  retryAfterSec: z.number().int().positive(),
})
export type RequestOtpResult = z.infer<typeof requestOtpResult>

export const verifyOtpInput = z.object({
  challengeId: ulid,
  code: z.string().regex(/^\d{6}$/),
  deviceId: ulid,
  deviceName: z.string().max(120).optional(),
})
export type VerifyOtpInput = z.infer<typeof verifyOtpInput>

export const session = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: isoDateTime,
  refreshToken: z.string().min(1),
  user: userPublic,
})
export type Session = z.infer<typeof session>

export const refreshInput = z.object({
  refreshToken: z.string().min(1),
  deviceId: ulid,
})
export type RefreshInput = z.infer<typeof refreshInput>
