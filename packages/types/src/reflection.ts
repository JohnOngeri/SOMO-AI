import { z } from 'zod'
import { isoDateTime, ulid } from './common'

export const reflectionMode = z.enum(['voice', 'text', 'sms'])
export type ReflectionMode = z.infer<typeof reflectionMode>

/** One of the three timed slots of the 3-Minute Mirror. */
export const reflectionEntry = z.object({
  id: ulid,
  userId: ulid,
  /** which of the 3 mirror slots */
  slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  mode: reflectionMode,
  transcript: z.string().min(1).max(4000),
  durationSec: z.number().int().positive().max(180).optional(),
  capturedAt: isoDateTime,
})
export type ReflectionEntry = z.infer<typeof reflectionEntry>

/** AI synthesis of a day's three reflections. */
export const synthesisCard = z.object({
  id: ulid,
  userId: ulid,
  /** local calendar date the reflections belong to, YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  insights: z.array(z.string().max(500)).min(1).max(5),
  encouragement: z.string().max(500),
  focusForTomorrow: z.string().max(500),
  createdAt: isoDateTime,
})
export type SynthesisCard = z.infer<typeof synthesisCard>
