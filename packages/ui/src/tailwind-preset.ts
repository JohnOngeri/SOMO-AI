import { color, font, fontSize, radius, space } from './tokens'

const px = (n: number) => `${n}px`

/**
 * Tailwind preset shared by web, admin, and (via NativeWind) mobile.
 * Usage: `presets: [somoPreset]` in each app's tailwind config.
 */
export const somoPreset = {
  theme: {
    extend: {
      colors: {
        bg: color.bg,
        paper: color.paper,
        night: color.night,
        ink: {
          DEFAULT: color.ink,
          soft: color.inkSoft,
          faint: color.inkFaint,
        },
        clay: {
          DEFAULT: color.clay,
          deep: color.clayDeep,
        },
        teal: {
          DEFAULT: color.teal,
          soft: color.tealSoft,
        },
        amber: {
          DEFAULT: color.amber,
          soft: color.amberSoft,
        },
        line: {
          DEFAULT: color.line,
          strong: color.lineStrong,
        },
        ok: color.ok,
        warn: color.warn,
      },
      borderRadius: {
        sm: px(radius.sm),
        DEFAULT: px(radius.md),
        lg: px(radius.lg),
        pill: px(radius.pill),
      },
      fontFamily: {
        display: font.display.split(',').map((s) => s.trim()),
        body: font.body.split(',').map((s) => s.trim()),
        mono: font.mono.split(',').map((s) => s.trim()),
      },
      fontSize: Object.fromEntries(Object.entries(fontSize).map(([k, v]) => [k, px(v)])),
      spacing: Object.fromEntries(Object.entries(space).map(([k, v]) => [k, px(v)])),
      minHeight: {
        tap: '44px',
      },
      minWidth: {
        tap: '44px',
      },
    },
  },
}
