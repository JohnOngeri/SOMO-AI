import { z } from 'zod'
import { isoDateTime, ulid } from './common'

export const askMode = z.enum(['voice', 'text', 'sms', 'ussd'])
export type AskMode = z.infer<typeof askMode>

export const askCoachInput = z.object({
  id: ulid, // client-generated, doubles as idempotency key
  question: z.string().min(1).max(2000),
  mode: askMode,
  /** ground the answer in this Class DNA profile */
  dnaId: ulid.optional(),
})
export type AskCoachInput = z.infer<typeof askCoachInput>

/** Which rung of the cost ladder answered — margin telemetry, reported per reply. */
export const costTier = z.enum(['cached', 'small', 'quality'])
export type CostTier = z.infer<typeof costTier>

export const coachReply = z.object({
  id: ulid,
  askId: ulid,
  answer: z.string().min(1).max(8000),
  groundedOn: z.object({
    dna: z.boolean(),
    packIds: z.array(ulid).default([]),
  }),
  costTier,
  createdAt: isoDateTime,
})
export type CoachReply = z.infer<typeof coachReply>

/** Freemium quota state, shown at the paywall and enforced offline via entitlements. */
export const quotaState = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive().nullable(), // null = unlimited (Plus)
  resetsAt: isoDateTime,
})
export type QuotaState = z.infer<typeof quotaState>
