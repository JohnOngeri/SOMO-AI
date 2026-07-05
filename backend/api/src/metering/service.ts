import type { QuotaState, UsageEventType } from '@somo/types'
import type { PrismaClient } from '../db'
import { newUlid } from '../ids'

/** Quota windows are calendar months (UTC) — matching per-seat monthly quotas. */
export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
}

export function monthEnd(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
}

export class QuotaExceededError extends Error {
  constructor(
    public quota: QuotaState,
    public kind: 'ai_call' | 'sms_out' = 'ai_call',
  ) {
    super('quota_exceeded')
  }
}

/**
 * Append-only usage facts. Events are idempotent by client ULID so offline
 * queues replay safely; counters are derived, never stored. ai_call and
 * sms_out events ARE the cost ledger — every paid action leaves a row.
 */
export class MeteringService {
  constructor(private db: PrismaClient) {}

  /** Record an event. Returns false when the id was already applied (replay). */
  async record(input: {
    id: string
    userId: string
    type: UsageEventType
    at?: Date
    meta?: Record<string, string | number | boolean>
  }): Promise<boolean> {
    const existing = await this.db.usageEvent.findUnique({ where: { id: input.id } })
    if (existing) return false
    await this.db.usageEvent.create({
      data: {
        id: input.id,
        userId: input.userId,
        type: input.type,
        at: input.at ?? new Date(),
        meta: input.meta ?? {},
      },
    })
    return true
  }

  async countThisMonth(
    userId: string,
    type: 'ai_call' | 'sms_out' | 'ussd_session',
    at: Date = new Date(),
  ): Promise<number> {
    return this.db.usageEvent.count({
      where: { userId, type, at: { gte: monthStart(at), lt: monthEnd(at) } },
    })
  }

  async quotaState(
    userId: string,
    type: 'ai_call' | 'sms_out',
    limit: number | null,
    at: Date = new Date(),
  ): Promise<QuotaState> {
    const used = await this.countThisMonth(userId, type, at)
    return { used, limit, resetsAt: monthEnd(at).toISOString() }
  }

  /**
   * THE cost gate for LLM calls. Atomically consumes one monthly AI credit or
   * throws — callers must not touch a model provider unless this returns.
   * Replays of an already-recorded id never double-count or re-block.
   */
  async recordAiCallOrThrow(input: {
    id: string
    userId: string
    limit: number | null
    meta?: Record<string, string | number | boolean>
  }): Promise<QuotaState> {
    const existing = await this.db.usageEvent.findUnique({ where: { id: input.id } })

    // Only a prior ai_call means "already paid". A prior quota_block under this
    // id must NOT open the gate on retry — re-evaluate with a fresh event id
    // (the retry may legitimately pass after the monthly window reset).
    const alreadyPaid = existing?.type === 'ai_call'
    if (!alreadyPaid) {
      const eventId = existing ? newUlid() : input.id
      const quota = await this.quotaState(input.userId, 'ai_call', input.limit)
      if (quota.limit !== null && quota.used >= quota.limit) {
        await this.record({
          id: eventId,
          userId: input.userId,
          type: 'quota_block',
          meta: { ...(input.meta ?? {}), blocked: 'ai_call' },
        })
        throw new QuotaExceededError(quota, 'ai_call')
      }
      await this.record({
        id: eventId,
        userId: input.userId,
        type: 'ai_call',
        ...(input.meta ? { meta: input.meta } : {}),
      })
    }
    return this.quotaState(input.userId, 'ai_call', input.limit)
  }

  /**
   * THE cost gate for outbound SMS (excluding auth OTPs, which are gated by
   * the resend window instead). Consumes one monthly SMS credit or throws.
   */
  async recordSmsOrThrow(input: {
    userId: string
    limit: number | null
    meta?: Record<string, string | number | boolean>
  }): Promise<QuotaState> {
    const quota = await this.quotaState(input.userId, 'sms_out', input.limit)
    if (quota.limit !== null && quota.used >= quota.limit) {
      await this.record({
        id: newUlid(),
        userId: input.userId,
        type: 'quota_block',
        meta: { ...(input.meta ?? {}), blocked: 'sms_out' },
      })
      throw new QuotaExceededError(quota, 'sms_out')
    }
    await this.record({
      id: newUlid(),
      userId: input.userId,
      type: 'sms_out',
      ...(input.meta ? { meta: input.meta } : {}),
    })
    return this.quotaState(input.userId, 'sms_out', input.limit)
  }

  /** Distinct packs this user has installed (uninstalls arrive with sync, phase 9). */
  async distinctInstalledPacks(userId: string): Promise<string[]> {
    const events = await this.db.usageEvent.findMany({
      where: { userId, type: 'pack_install' },
      select: { meta: true },
    })
    const ids = new Set<string>()
    for (const e of events) {
      const packId = (e.meta as Record<string, unknown>).packId
      if (typeof packId === 'string') ids.add(packId)
    }
    return [...ids]
  }
}
