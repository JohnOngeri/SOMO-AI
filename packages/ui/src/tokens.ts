/**
 * SOMO design tokens — the single source of truth for every surface
 * (web, admin, mobile via NativeWind, and Storybook).
 *
 * Warm earthy palette tuned for high legibility on cheap LCDs in sunlight.
 * Contrast pairs are enforced by test/contrast.test.ts (WCAG 2.2 AA).
 */

export const color = {
  // surfaces
  bg: '#f3ede1',
  paper: '#ebe1cf',
  night: '#2a2620', // dark chrome / offline strip
  white: '#ffffff',
  // text
  ink: '#15110d',
  inkSoft: '#5b5345',
  inkFaint: '#948869',
  // brand
  clay: '#c44d2e',
  clayDeep: '#8a3520',
  teal: '#2a5d4f',
  tealSoft: '#d6e3dd',
  amber: '#d4a847',
  amberSoft: '#f1e4be',
  // lines
  line: '#d8ccb0',
  lineStrong: '#a89773',
  // semantic
  ok: '#2a6f3e',
  warn: '#b8520a',
} as const

export type ColorToken = keyof typeof color

export const radius = {
  sm: 6,
  md: 12,
  lg: 18,
  pill: 999,
} as const

/** 4px-base spacing scale. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const

export const font = {
  display: "'Familjen Grotesk', 'Outfit', system-ui, sans-serif",
  body: "'Public Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const

/** px at textScale=1; multiply by the user's textScale (1–2). */
export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 18,
  xl: 22,
  '2xl': 28,
  '3xl': 36,
} as const

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
  spring: { damping: 18, stiffness: 220 },
} as const

/** WCAG 2.2 AA: minimum touch target in px — nothing interactive goes below this. */
export const tapTarget = 44

/** Emit the tokens as CSS custom properties (used by web, admin, Storybook). */
export function cssVariables(): string {
  const colors = Object.entries(color)
    .map(
      ([name, value]) =>
        `  --somo-${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value};`,
    )
    .join('\n')
  const radii = Object.entries(radius)
    .map(([name, value]) => `  --somo-r-${name}: ${value}px;`)
    .join('\n')
  return `:root {\n${colors}\n${radii}\n  --somo-tap-target: ${tapTarget}px;\n  --tscale: 1;\n}`
}
