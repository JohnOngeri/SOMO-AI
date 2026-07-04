import { z } from 'zod'
import { connectivityTier, isoDateTime, locale, phoneE164, ulid } from './common'

export const userRole = z.enum(['teacher', 'creator', 'org_admin', 'somo_admin'])
export type UserRole = z.infer<typeof userRole>

export const userPublic = z.object({
  id: ulid,
  phone: phoneE164,
  displayName: z.string().min(1).max(80).optional(),
  locale,
  role: userRole,
  createdAt: isoDateTime,
})
export type UserPublic = z.infer<typeof userPublic>

/** Device-level settings, synced but locally authoritative. */
export const userSettings = z.object({
  locale,
  /** teacher may pin a tier lower than detected (e.g. force SMS to save data) */
  connectivityCeiling: connectivityTier,
  textScale: z.number().min(1).max(2),
  highContrast: z.boolean(),
  readAloud: z.boolean(),
  sound: z.boolean(),
  haptics: z.boolean(),
})
export type UserSettings = z.infer<typeof userSettings>

export const defaultSettings: z.infer<typeof userSettings> = {
  locale: 'en',
  connectivityCeiling: 'wifi',
  textScale: 1,
  highContrast: false,
  readAloud: false,
  sound: true,
  haptics: true,
}
