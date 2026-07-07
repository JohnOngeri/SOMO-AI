import { useEffect, useState } from 'react'
import { Pressable, TextInput } from 'react-native'
import {
  Body,
  Card,
  ErrorText,
  Heading,
  Pill,
  PrimaryButton,
  Screen,
} from '../../src/components/ui'
import { enqueue } from '../../src/lib/db'
import { color, fontFamily, radius, space } from '../../src/lib/theme'
import { useSession } from '../../src/lib/session'
import { ulid } from '../../src/lib/ulid'

const SLOTS: { slot: 1 | 2 | 3; label: string; prompt: string }[] = [
  { slot: 1, label: 'Before class', prompt: 'What is your one goal for this lesson?' },
  { slot: 2, label: 'Right after', prompt: 'What actually happened? What surprised you?' },
  { slot: 3, label: 'Later, calm', prompt: 'What will you try differently next time?' },
]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function Mirror() {
  const { api } = useSession()
  const [done, setDone] = useState<Record<number, boolean>>({})
  const [activeSlot, setActiveSlot] = useState<1 | 2 | 3 | null>(null)
  const [transcript, setTranscript] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    void api.reflection.byDate
      .query({ date: today() })
      .then((rows) => setDone(Object.fromEntries(rows.map((r) => [r.slot, true]))))
      .catch(() => {})
  }, [api])

  const submit = async () => {
    if (!activeSlot || !transcript.trim()) return
    setBusy(true)
    setStatus(null)
    const payload = {
      id: ulid(),
      date: today(),
      slot: activeSlot,
      mode: 'text' as const,
      transcript: transcript.trim(),
      capturedAt: new Date().toISOString(),
    }
    try {
      await api.reflection.add.mutate(payload)
      setStatus('Saved.')
    } catch {
      enqueue('reflection.add', payload)
      setStatus('No connection — saved on your device, will sync automatically.')
    }
    setDone((d) => ({ ...d, [activeSlot]: true }))
    setTranscript('')
    setActiveSlot(null)
    setBusy(false)
  }

  return (
    <Screen>
      <Heading>3-Minute Mirror</Heading>
      <Body muted>Three short check-ins around today's lesson. No wrong answers.</Body>

      {SLOTS.map((s) => (
        <Pressable key={s.slot} onPress={() => setActiveSlot(s.slot)} style={{ marginTop: 16 }}>
          <Card
            style={activeSlot === s.slot ? { borderWidth: 2, borderColor: color.clay } : undefined}
          >
            <Body style={{ fontFamily: fontFamily.body, fontWeight: '600' }}>{s.label}</Body>
            <Body muted>{s.prompt}</Body>
            {done[s.slot] && <Pill label="Recorded today" tone="ok" />}
          </Card>
        </Pressable>
      ))}

      {activeSlot && (
        <>
          <TextInput
            value={transcript}
            onChangeText={setTranscript}
            placeholder="Type your reflection…"
            placeholderTextColor={color.inkFaint}
            multiline
            autoFocus
            style={{
              borderWidth: 1,
              borderColor: color.line,
              borderRadius: radius.md,
              padding: space[4],
              minHeight: 90,
              backgroundColor: color.white,
              marginTop: space[4],
            }}
          />
          <PrimaryButton
            label={busy ? 'Saving…' : 'Save reflection'}
            onPress={submit}
            disabled={!transcript.trim()}
            busy={busy}
            style={{ marginTop: 12, marginBottom: 24 }}
          />
        </>
      )}
      <ErrorText>{status}</ErrorText>
    </Screen>
  )
}
