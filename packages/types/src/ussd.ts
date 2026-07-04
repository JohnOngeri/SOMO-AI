import { z } from 'zod'
import { phoneE164 } from './common'

/** Africa's Talking-compatible USSD webhook input. */
export const ussdSessionInput = z.object({
  sessionId: z.string().min(1).max(120),
  serviceCode: z.string().min(1).max(30),
  phoneNumber: phoneE164,
  /** full '*'-joined input history for the session, '' on first hit */
  text: z.string().max(500),
})
export type UssdSessionInput = z.infer<typeof ussdSessionInput>

/** CON = keep session open (menu), END = final screen. */
export const ussdResponse = z.object({
  type: z.enum(['CON', 'END']),
  /** USSD screens are tiny — enforce the practical limit */
  message: z.string().min(1).max(160),
})
export type UssdResponse = z.infer<typeof ussdResponse>

export const inboundSms = z.object({
  from: phoneE164,
  to: z.string().max(30),
  text: z.string().max(1600),
  receivedAt: z.string(),
})
export type InboundSms = z.infer<typeof inboundSms>
