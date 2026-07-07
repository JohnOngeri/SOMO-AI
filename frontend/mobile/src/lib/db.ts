import * as SQLite from 'expo-sqlite'
import type { Api } from './api'
import { ulid } from './ulid'

const db = SQLite.openDatabaseSync('somo.db')

db.execSync(`
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS coach_cache (
    id TEXT PRIMARY KEY NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    costTier TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
`)

export type OutboxKind = 'reflection.add' | 'dna.upsert'

/** Queue a mutation captured with no connectivity — flushed in order once online. */
export function enqueue(kind: OutboxKind, payload: unknown): string {
  const id = ulid()
  db.runSync(`INSERT INTO outbox (id, kind, payload, createdAt, synced) VALUES (?, ?, ?, ?, 0)`, [
    id,
    kind,
    JSON.stringify(payload),
    Date.now(),
  ])
  return id
}

export function pendingCount(): number {
  const row = db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox WHERE synced = 0`)
  return row?.n ?? 0
}

interface OutboxRow {
  id: string
  kind: OutboxKind
  payload: string
}

/**
 * Replays queued mutations in capture order. Stops at the first failure that
 * looks like "still offline" so later items don't jump the queue; a payload
 * the server outright rejects is marked synced (dropped) rather than stuck
 * forever, since idempotency keys mean a retry can never double-charge.
 */
export async function flushOutbox(api: Api): Promise<{ synced: number; remaining: number }> {
  const rows = db.getAllSync<OutboxRow>(
    `SELECT id, kind, payload FROM outbox WHERE synced = 0 ORDER BY createdAt ASC`,
  )
  let synced = 0
  for (const row of rows) {
    const payload = JSON.parse(row.payload)
    try {
      if (row.kind === 'reflection.add') await api.reflection.add.mutate(payload)
      else if (row.kind === 'dna.upsert') await api.dna.upsert.mutate(payload)
      db.runSync(`UPDATE outbox SET synced = 1 WHERE id = ?`, [row.id])
      synced++
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      const offline = /network|fetch|timeout/i.test(message)
      if (offline) break
      db.runSync(`UPDATE outbox SET synced = 1 WHERE id = ?`, [row.id])
    }
  }
  return { synced, remaining: pendingCount() }
}

export function cacheCoachReply(reply: {
  id: string
  question: string
  answer: string
  costTier: string
}): void {
  db.runSync(
    `INSERT OR REPLACE INTO coach_cache (id, question, answer, costTier, createdAt) VALUES (?, ?, ?, ?, ?)`,
    [reply.id, reply.question, reply.answer, reply.costTier, Date.now()],
  )
}

export interface CachedCoachReply {
  id: string
  question: string
  answer: string
  costTier: string
  createdAt: number
}

export function listCachedReplies(limit = 20): CachedCoachReply[] {
  return db.getAllSync<CachedCoachReply>(
    `SELECT id, question, answer, costTier, createdAt FROM coach_cache ORDER BY createdAt DESC LIMIT ?`,
    [limit],
  )
}
