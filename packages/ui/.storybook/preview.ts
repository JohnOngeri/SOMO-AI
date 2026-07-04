import type { Preview } from '@storybook/react-vite'
import { color, font } from '../src/tokens'

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        cream: { name: 'cream', value: color.bg },
        paper: { name: 'paper', value: color.paper },
        night: { name: 'night', value: color.night },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'cream' },
  },
  decorators: [
    (Story) => {
      document.body.style.fontFamily = font.body
      document.body.style.color = color.ink
      return Story()
    },
  ],
}

export default preview
