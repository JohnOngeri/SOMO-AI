import { useEffect, useState } from 'react'
import { ScrollView } from 'react-native'
import type { DnaPromptId } from '@somo/types'
import {
  Body,
  Card,
  ErrorText,
  Field,
  Heading,
  PrimaryButton,
  Screen,
} from '../../src/components/ui'
import { enqueue } from '../../src/lib/db'
import { useSession } from '../../src/lib/session'

const PROMPTS: { id: DnaPromptId; label: string }[] = [
  { id: 'class_size_context', label: 'Tell us about your class — size, age, setting.' },
  { id: 'learner_strengths', label: 'What are your learners good at?' },
  { id: 'biggest_challenge', label: "What's the biggest challenge in this class right now?" },
  { id: 'resources_available', label: 'What resources do you have — or not have?' },
  { id: 'teacher_goal', label: 'What do you want to get better at this term?' },
]

export default function ClassDna() {
  const { api } = useSession()
  const [profileId, setProfileId] = useState<string | undefined>(undefined)
  const [className, setClassName] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    void api.dna.get.query().then((profile) => {
      if (!profile) return
      setProfileId(profile.id)
      setClassName(profile.className)
      setAnswers(Object.fromEntries(profile.responses.map((r) => [r.promptId, r.transcript])))
    })
  }, [api])

  const save = async () => {
    setBusy(true)
    setStatus(null)
    const payload = {
      ...(profileId ? { id: profileId } : {}),
      className: className.trim() || 'My class',
      responses: PROMPTS.filter((p) => answers[p.id]?.trim()).map((p) => ({
        promptId: p.id,
        transcript: answers[p.id]!.trim(),
        capturedAt: new Date().toISOString(),
      })),
    }
    try {
      const res = await api.dna.upsert.mutate(payload)
      setProfileId(res.id)
      setStatus('Saved — the coach will use this to ground its answers.')
    } catch {
      enqueue('dna.upsert', payload)
      setStatus('No connection — saved on your device, will sync automatically.')
    }
    setBusy(false)
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Heading>Class DNA</Heading>
        <Body muted>
          A five-minute sprint so the coach understands your class. Answer what you can — you can
          always come back.
        </Body>

        <Field
          label="Class name"
          value={className}
          onChangeText={setClassName}
          placeholder="Grade 4B"
          containerStyle={{ marginTop: 24 }}
        />

        {PROMPTS.map((p) => (
          <Card key={p.id} style={{ marginBottom: 16 }}>
            <Body style={{ fontWeight: '600' }}>{p.label}</Body>
            <Field
              label=""
              value={answers[p.id] ?? ''}
              onChangeText={(v) => setAnswers((a) => ({ ...a, [p.id]: v }))}
              placeholder="Type or dictate your answer…"
              multiline
              containerStyle={{ marginTop: 8, marginBottom: 0 }}
              style={{ minHeight: 60, fontFamily: undefined }}
            />
          </Card>
        ))}

        <ErrorText>{status}</ErrorText>
        <PrimaryButton
          label={busy ? 'Saving…' : 'Save Class DNA'}
          onPress={save}
          busy={busy}
          style={{ marginBottom: 32 }}
        />
      </ScrollView>
    </Screen>
  )
}
