import type { QuotaState, UsageEventType } from '@somo/types'
import type { PrismaClient } from '../db'

/** Monday 00:00 UTC of the week containing `at` — the ask-quota window. */
export function weekStart(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const day = d.getUTCDay() // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7))
  return d
}

export function weekEnd(at: Date): Date {
  const start = weekStart(at)
  return new Date(start.getTime() + 7 * 86_400_000)
}

export class QuotaExceededError extends Error {
  constructor(public quota: QuotaState) {
    super('quota_exceeded')
  }
}

/**
 * Append-only usage facts. Events are idempotent by client ULID so offline
 * queues replay safely; counters are derived, never stored.
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

  async asksThisWeek(userId: string, at: Date = new Date()): Promise<number> {
    return this.db.usageEvent.count({
      where: { userId, type: 'ask_coach', at: { gte: weekStart(at), lt: weekEnd(at) } },
    })
  }

  async askQuota(userId: string, limit: number | null, at: Date = new Date()): Promise<QuotaState> {
    const used = await this.asksThisWeek(userId, at)
    return { used, limit, resetsAt: weekEnd(at).toISOString() }
  }

  /**
   * The freemium gate: atomically record an ask if quota allows.
   * Replays of an already-recorded id never double-count or re-block.
   */
  async recordAskOrThrow(input: {
    id: string
    userId: string
    limit: number | null
    meta?: Record<string, string | number | boolean>
  }): Promise<QuotaState> {
    const existing = await this.db.usageEvent.findUnique({ where: { id: input.id } })
    if (!existing) {
      const quota = await this.askQuota(input.userId, input.limit)
      if (quota.limit !== null && quota.used >= quota.limit) {
        await this.record({
          id: input.id,
          userId: input.userId,
          type: 'paywall_hit',
          meta: { ...(input.meta ?? {}), reason: 'ask_limit' },
        })
        throw new QuotaExceededError(quota)
      }
      await this.record({
        id: input.id,
        userId: input.userId,
        type: 'ask_coach',
        ...(input.meta ? { meta: input.meta } : {}),
      })
    }
    return this.askQuota(input.userId, input.limit)
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
