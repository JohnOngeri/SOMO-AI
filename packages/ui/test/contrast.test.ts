import { describe, expect, it } from 'vitest'
import { color, cssVariables, tapTarget } from '../src/tokens'
import { somoPreset } from '../src/tailwind-preset'

/** WCAG 2.2 relative luminance + contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number]
  return (l1 + 0.05) / (l2 + 0.05)
}

describe('WCAG 2.2 AA contrast — enforced at the token level', () => {
  // [foreground, background, minimum ratio] — 4.5 body text, 3.0 large text / UI components
  const pairs: [keyof typeof color, keyof typeof color, number][] = [
    ['ink', 'bg', 7], // primary body text: AAA
    ['ink', 'paper', 7],
    ['inkSoft', 'bg', 4.5], // secondary text: AA
    ['inkSoft', 'paper', 4.5],
    ['white', 'clay', 3], // pill button label: large/bold text
    ['white', 'clayDeep', 4.5], // pressed / deep variant
    ['white', 'teal', 4.5], // teal buttons and chips
    ['ink', 'amberSoft', 7], // amber highlight cards
    ['ink', 'tealSoft', 7],
    ['bg', 'night', 4.5], // connectivity strip text
    ['warn', 'bg', 3], // semantic accents as large text/icons
    ['ok', 'bg', 3],
    ['clayDeep', 'bg', 4.5], // clay used AS text must use the deep variant
  ]

  it.each(pairs)('%s on %s ≥ %s', (fg, bg, min) => {
    expect(ratio(color[fg], color[bg])).toBeGreaterThanOrEqual(min)
  })
})

describe('tokens surface', () => {
  it('tap target meets WCAG 2.2 target size minimum', () => {
    expect(tapTarget).toBeGreaterThanOrEqual(44)
  })

  it('cssVariables emits kebab-cased custom properties', () => {
    const css = cssVariables()
    expect(css).toContain('--somo-bg: #f3ede1;')
    expect(css).toContain('--somo-ink-soft: #5b5345;')
    expect(css).toContain('--somo-r-pill: 999px;')
    expect(css).toContain('--somo-tap-target: 44px;')
  })

  it('tailwind preset exposes the brand colors and pill radius', () => {
    const theme = somoPreset.theme.extend
    expect(theme.colors.clay.DEFAULT).toBe(color.clay)
    expect(theme.colors.teal.soft).toBe(color.tealSoft)
    expect(theme.borderRadius.pill).toBe('999px')
    expect(theme.minHeight.tap).toBe('44px')
  })
})
