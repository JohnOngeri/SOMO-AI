import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CSSProperties } from 'react'
import { color, font, fontSize, radius, space } from './tokens'

const meta: Meta = { title: 'Foundation/Tokens' }
export default meta

const swatchLabel: CSSProperties = {
  fontFamily: font.mono,
  fontSize: 11,
  color: color.inkSoft,
}

export const Colors: StoryObj = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 12,
      }}
    >
      {Object.entries(color).map(([name, value]) => (
        <div key={name}>
          <div
            style={{
              background: value,
              height: 64,
              borderRadius: radius.md,
              border: `1px solid ${color.line}`,
            }}
          />
          <div style={{ ...swatchLabel, marginTop: 4 }}>
            {name}
            <br />
            {value}
          </div>
        </div>
      ))}
    </div>
  ),
}

export const Typography: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {Object.entries(fontSize).map(([name, size]) => (
        <div key={name}>
          <span style={swatchLabel}>
            {name} · {size}px
          </span>
          <div style={{ fontFamily: font.display, fontSize: size, color: color.ink }}>
            Teach with what you have.
          </div>
        </div>
      ))}
      <div>
        <span style={swatchLabel}>body · Public Sans</span>
        <p style={{ fontFamily: font.body, fontSize: fontSize.base, maxWidth: 480 }}>
          SOMO keeps working when the network does not — every reflection, every lesson, every ask
          is saved on the phone and synced later.
        </p>
      </div>
    </div>
  ),
}

export const RadiiAndSpacing: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {Object.entries(radius).map(([name, r]) => (
        <div key={name} style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 96,
              height: 56,
              background: color.clay,
              borderRadius: r,
            }}
          />
          <span style={swatchLabel}>r-{name}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
        {Object.entries(space).map(([name, s]) => (
          <div
            key={name}
            style={{ width: 12, height: Math.max(s, 2), background: color.teal }}
            title={`space-${name}`}
          />
        ))}
      </div>
    </div>
  ),
}
