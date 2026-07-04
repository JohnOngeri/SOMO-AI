import { z } from 'zod'
import { isoDateTime, locale, money, ulid } from './common'

export const semver = z.string().regex(/^\d+\.\d+\.\d+$/)

export const packLesson = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().min(1).max(200),
  minutes: z.number().int().positive().max(240),
})

/** The unsigned manifest — what gets hashed and signed. */
export const packManifest = z.object({
  id: ulid,
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(80),
  gradeLevels: z.array(z.string().max(40)).min(1).max(12),
  locale,
  version: semver,
  publisherId: ulid,
  sizeBytes: z.number().int().positive(),
  /** sha256 hex of the pack archive content */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  lessons: z.array(packLesson).min(1).max(200),
  /** zero-amount money = free pack */
  price: money,
  createdAt: isoDateTime,
})
export type PackManifest = z.infer<typeof packManifest>

export const packSignature = z.object({
  alg: z.literal('ed25519'),
  /** which key signed: 'somo-root' or a countersigned creator key id */
  publicKeyId: z.string().min(1).max(120),
  /** base64 signature over the canonical JSON of the manifest */
  sig: z.string().min(1),
})
export type PackSignature = z.infer<typeof packSignature>

/** What actually travels — over HTTPS, Bluetooth, or USB. Verified before install AND before render. */
export const signedPackManifest = z.object({
  manifest: packManifest,
  signature: packSignature,
})
export type SignedPackManifest = z.infer<typeof signedPackManifest>

export const packInstallState = z.enum([
  'available',
  'downloading',
  'verifying',
  'installed',
  'failed',
  'disabled',
])
export type PackInstallState = z.infer<typeof packInstallState>
