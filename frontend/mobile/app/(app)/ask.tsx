import { useEffect, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, TextInput } from 'react-native'
import {
  Body,
  Card,
  ErrorText,
  Heading,
  Pill,
  PrimaryButton,
  Screen,
} from '../../src/components/ui'
import { cacheCoachReply, listCachedReplies, type CachedCoachReply } from '../../src/lib/db'
import { color, radius, space } from '../../src/lib/theme'
import { useSession } from '../../src/lib/session'
import { ulid } from '../../src/lib/ulid'

export default function AskCoach() {
  const { api } = useSession()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replies, setReplies] = useState<CachedCoachReply[]>([])

  const loadHistory = () => setReplies(listCachedReplies())

  useEffect(() => {
    loadHistory()
    void api.coach.history.query().then((rows) => {
      rows.forEach((r) =>
        cacheCoachReply({ id: r.id, question: r.question, answer: r.answer, costTier: r.costTier }),
      )
      loadHistory()
    })
  }, [api])

  const ask = async () => {
    const q = question.trim()
    if (!q) return
    setBusy(true)
    setError(null)
    try {
      const reply = await api.coach.ask.mutate({ id: ulid(), question: q, mode: 'text' })
      cacheCoachReply({ id: reply.id, question: q, answer: reply.answer, costTier: reply.costTier })
      setQuestion('')
      loadHistory()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        /seat_required/.test(msg)
          ? 'Your seat is no longer active — see Settings.'
          : /quota_exceeded/.test(msg)
            ? "You have used this month's coach asks. Cached answers to similar questions still work."
            : /network|fetch/i.test(msg)
              ? 'No connection right now — try again once you are back online.'
              : 'Something went wrong. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Heading>Ask Coach</Heading>
      <Body muted>Grounded in your Class DNA — ask anything about today's lesson.</Body>

      <FlatList
        style={{ marginTop: 16, flex: 1 }}
        data={replies}
        keyExtractor={(r) => r.id}
        inverted
        renderItem={({ item }) => (
          <Card style={{ marginBottom: 12 }}>
            <Body>{item.question}</Body>
            <Body muted style={{ marginTop: 8 }}>
              {item.answer}
            </Body>
            <Pill label={item.costTier} tone={item.costTier === 'cached' ? 'ok' : 'neutral'} />
          </Card>
        )}
        ListEmptyComponent={<Body muted>Ask your first question below.</Body>}
      />

      <ErrorText>{error}</ErrorText>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="How do I teach fractions with bottle tops?"
          placeholderTextColor={color.inkFaint}
          multiline
          style={{
            borderWidth: 1,
            borderColor: color.line,
            borderRadius: radius.md,
            padding: space[4],
            minHeight: 60,
            backgroundColor: color.white,
            marginTop: space[3],
          }}
        />
        <PrimaryButton
          label={busy ? 'Asking…' : 'Ask'}
          onPress={ask}
          disabled={!question.trim()}
          busy={busy}
          style={{ marginTop: 12, marginBottom: 12 }}
        />
      </KeyboardAvoidingView>
    </Screen>
  )
}
