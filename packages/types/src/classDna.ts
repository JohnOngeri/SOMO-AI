import { z } from 'zod'
import { isoDateTime, ulid } from './common'

/** The 5 voice prompts of the Class DNA Sprint. */
export const dnaPromptId = z.enum([
  'class_size_context',
  'learner_strengths',
  'biggest_challenge',
  'resources_available',
  'teacher_goal',
])
export type DnaPromptId = z.infer<typeof dnaPromptId>

export const dnaResponse = z.object({
  promptId: dnaPromptId,
  /** speech-to-text result (or typed fallback) */
  transcript: z.string().min(1).max(4000),
  /** object-store ref of the raw audio, kept for re-transcription */
  audioRef: z.string().max(500).optional(),
  capturedAt: isoDateTime,
})
export type DnaResponse = z.infer<typeof dnaResponse>

export const classDnaProfile = z.object({
  id: ulid,
  userId: ulid,
  className: z.string().min(1).max(120),
  learnerCount: z.number().int().positive().max(500).optional(),
  responses: z.array(dnaResponse).max(5),
  /** AI-derived summary + traits used to ground Ask Coach */
  summary: z.string().max(4000).optional(),
  traits: z.array(z.string().max(120)).max(20).default([]),
  updatedAt: isoDateTime,
})
export type ClassDnaProfile = z.infer<typeof classDnaProfile>
