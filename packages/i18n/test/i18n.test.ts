import { describe, expect, it } from 'vitest'
import { catalogs, localeNames, supportedLocales, t } from '../src/index'

describe('catalog parity', () => {
  const enKeys = Object.keys(catalogs.en).sort()

  it.each(supportedLocales.filter((l) => l !== 'en'))(
    '%s has exactly the same keys as en',
    (loc) => {
      const keys = Object.keys(catalogs[loc]).sort()
      expect(keys).toEqual(enKeys)
    },
  )

  it('no locale has an empty string', () => {
    for (const loc of supportedLocales) {
      for (const [key, value] of Object.entries(catalogs[loc])) {
        expect(value.length, `${loc}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('placeholders match across locales', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort()
    for (const loc of supportedLocales) {
      for (const key of Object.keys(catalogs.en) as (keyof typeof catalogs.en)[]) {
        expect(placeholders(catalogs[loc][key]), `${loc}:${key}`).toEqual(
          placeholders(catalogs.en[key]),
        )
      }
    }
  })
})

describe('t()', () => {
  it('translates and interpolates', () => {
    expect(t('en', 'dna.promptCount', { current: 2, total: 5 })).toBe('Prompt 2 of 5')
    expect(t('fr', 'dna.promptCount', { current: 2, total: 5 })).toBe('Question 2 sur 5')
    expect(t('sw', 'common.save')).toBe('Hifadhi')
    expect(t('ha', 'common.next')).toBe('Gaba')
  })

  it('leaves unknown placeholders intact rather than crashing', () => {
    expect(t('en', 'auth.codeSentTo', {})).toBe('Code sent to {phone}')
  })

  it('has display names for every locale', () => {
    for (const loc of supportedLocales) {
      expect(localeNames[loc].length).toBeGreaterThan(0)
    }
  })
})
