import { z } from 'zod'
import { isoDateTime, ulid } from './common'

/**
 * ai_call / sms_out / quota_block / seat_redeemed are SERVER-written only —
 * they are the cost ledger and the audit trail of the fail-closed gates.
 */
export const usageEventType = z.enum([
  'ai_call',
  'sms_out',
  'ussd_session',
  'pack_install',
  'reflection',
  'active_day',
  'quota_block',
  'seat_redeemed',
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
