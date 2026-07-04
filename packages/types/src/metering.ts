import { z } from 'zod'
import { isoDateTime, ulid } from './common'

export const usageEventType = z.enum([
  'ask_coach',
  'pack_install',
  'reflection',
  'active_day',
  'ussd_session',
  'paywall_hit',
  'trial_start',
  'upgrade',
  'referral_share',
  'referral_redeem',
])
export type UsageEventType = z.infer<typeof usageEventType>

/**
 * Usage events are append-only facts. The id is a client ULID so offline events
 * replay idempotently when they finally sync.
 */
export const usageEvent = z.object({
  id: ulid,
  userId: ulid,
  type: usageEventType,
  at: isoDateTime,
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
})
export type UsageEvent = z.infer<typeof usageEvent>
