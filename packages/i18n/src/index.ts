import en from './locales/en.json'
import fr from './locales/fr.json'
import ha from './locales/ha.json'
import sw from './locales/sw.json'

export const catalogs = { en, fr, ha, sw } as const

export type Locale = keyof typeof catalogs
export type MessageKey = keyof typeof en

export const supportedLocales = Object.keys(catalogs) as Locale[]

export type Params = Record<string, string | number>

/**
 * Tiny interpolating translator. Falls back to English for a missing locale
 * string; the missing-key case is prevented at compile time by MessageKey and
 * at test time by the parity test.
 */
export function t(locale: Locale, key: MessageKey, params?: Params): string {
  const catalog: Record<string, string> = catalogs[locale] ?? catalogs.en
  const template = catalog[key] ?? (catalogs.en as Record<string, string>)[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** Locale display names, in their own language (for the language picker). */
export const localeNames: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  ha: 'Hausa',
  sw: 'Kiswahili',
}
