import { Platform } from 'react-native'
import { color, fontSize, motion, radius, space, tapTarget } from '@somo/ui/tokens'

export { color, fontSize, motion, radius, space, tapTarget }

// System font stacks stand in for Familjen Grotesk / Public Sans until the
// web-font packages are worth the extra install weight — same weights/scale,
// no network fetch on first launch in the field.
export const fontFamily = Platform.select({
  ios: { display: 'Avenir Next', body: 'System', mono: 'Menlo' },
  android: { display: 'sans-serif-medium', body: 'sans-serif', mono: 'monospace' },
  default: { display: 'system-ui', body: 'system-ui', mono: 'monospace' },
})!

export const shadow = {
  card: {
    shadowColor: color.ink,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const
