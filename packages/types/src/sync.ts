import { z } from 'zod'
import { cursor, isoDateTime, ulid } from './common'

export const syncEntity = z.enum([
  'classDna',
  'reflection',
  'synthesisCard',
  'usageEvent',
  'settings',
  'streak',
])
export type SyncEntity = z.infer<typeof syncEntity>

/**
 * Every offline mutation is an outbox event. The ULID id is the idempotency
 * key: the server applies each event at most once, in client order.
 */
export const outboxEvent = z.object({
  id: ulid,
  deviceId: ulid,
  entity: syncEntity,
  entityId: ulid,
  op: z.enum(['create', 'update', 'delete']),
  payload: z.record(z.string(), z.unknown()),
  clientAt: isoDateTime,
})
export type OutboxEvent = z.infer<typeof outboxEvent>

export const pushRequest = z.object({
  events: z.array(outboxEvent).max(500),
})
export type PushRequest = z.infer<typeof pushRequest>

export const pushResult = z.object({
  appliedIds: z.array(ulid),
  rejected: z.array(
    z.object({
      id: ulid,
      reason: z.enum(['conflict', 'invalid', 'forbidden', 'duplicate']),
    }),
  ),
})
export type PushResult = z.infer<typeof pushResult>

export const pullRequest = z.object({
  cursor: cursor.optional(),
  entities: z.array(syncEntity).optional(), // default: all
})
export type PullRequest = z.infer<typeof pullRequest>

export const pullResult = z.object({
  changes: z.array(
    z.object({
      entity: syncEntity,
      entityId: ulid,
      op: z.enum(['upsert', 'delete']),
      payload: z.record(z.string(), z.unknown()),
      serverAt: isoDateTime,
    }),
  ),
  nextCursor: cursor,
  hasMore: z.boolean(),
})
export type PullResult = z.infer<typeof pullResult>
