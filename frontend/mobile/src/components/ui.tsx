import { type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { color, fontFamily, fontSize, radius, shadow, space, tapTarget } from '../lib/theme'

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>
}

export function Card({ children, style }: { children: ReactNode; style?: object | undefined }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>
}

export function Body({
  children,
  muted = false,
  style,
}: {
  children: ReactNode
  muted?: boolean
  style?: object | undefined
}) {
  return <Text style={[styles.body, muted && styles.bodyMuted, style]}>{children}</Text>
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  style,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  style?: object | undefined
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.buttonPrimary,
        style,
        (disabled || busy) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color.white} />
      ) : (
        <Text style={styles.buttonPrimaryLabel}>{label}</Text>
      )}
    </Pressable>
  )
}

export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.buttonGhost} hitSlop={8}>
      <Text style={styles.buttonGhostLabel}>{label}</Text>
    </Pressable>
  )
}

export function Field({
  label,
  containerStyle,
  style,
  ...inputProps
}: { label: string; containerStyle?: object | undefined } & TextInputProps) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={color.inkFaint}
        {...inputProps}
      />
    </View>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <Text style={styles.error}>{children}</Text>
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: 'neutral' | 'warn' | 'ok'
}) {
  const bg = tone === 'warn' ? color.amberSoft : tone === 'ok' ? color.tealSoft : color.paper
  const fg = tone === 'warn' ? color.clayDeep : tone === 'ok' ? color.teal : color.inkSoft
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillLabel, { color: fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
    paddingHorizontal: space[5],
    paddingTop: space[12],
  },
  card: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: space[5],
    ...shadow.card,
  },
  heading: {
    fontFamily: fontFamily.display,
    fontSize: fontSize['2xl'],
    color: color.ink,
    fontWeight: '700',
    marginBottom: space[2],
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.base,
    color: color.ink,
    lineHeight: fontSize.base * 1.5,
  },
  bodyMuted: {
    color: color.inkSoft,
  },
  buttonPrimary: {
    backgroundColor: color.clay,
    borderRadius: radius.pill,
    minHeight: tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[6],
  },
  buttonPressed: {
    backgroundColor: color.clayDeep,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPrimaryLabel: {
    color: color.white,
    fontFamily: fontFamily.body,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  buttonGhost: {
    minHeight: tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
  buttonGhostLabel: {
    color: color.teal,
    fontFamily: fontFamily.body,
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  field: {
    marginBottom: space[5],
  },
  fieldLabel: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.sm,
    color: color.inkSoft,
    marginBottom: space[2],
  },
  input: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    minHeight: tapTarget,
    paddingHorizontal: space[4],
    fontSize: fontSize.lg,
    fontFamily: fontFamily.mono,
    color: color.ink,
    backgroundColor: color.white,
  },
  error: {
    color: color.warn,
    fontFamily: fontFamily.body,
    fontSize: fontSize.sm,
    marginTop: space[2],
  },
  pill: {
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pillLabel: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
})
