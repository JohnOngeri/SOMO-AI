import { useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import {
  Body,
  ErrorText,
  Field,
  GhostButton,
  Heading,
  PrimaryButton,
  Screen,
} from '../../src/components/ui'
import { makeClient } from '../../src/lib/api'
import { useSession } from '../../src/lib/session'
import { ulid } from '../../src/lib/ulid'

export default function OtpVerify() {
  const { phone, challengeId } = useLocalSearchParams<{ phone: string; challengeId: string }>()
  const { signIn } = useSession()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const verify = async () => {
    setBusy(true)
    setError(null)
    try {
      const anon = makeClient()
      const res = await anon.auth.verifyOtp.mutate({
        challengeId,
        code: code.trim(),
        deviceId: ulid(),
        deviceName: 'teacher-app',
      })
      await signIn({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        userId: res.user.id,
        phone: res.user.phone,
      })
      router.replace('/')
    } catch {
      setError('That code did not work. Check it and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Heading>Enter your code</Heading>
      <Body muted>We sent a 6-digit code by SMS to {phone}.</Body>
      <Field
        label="6-digit code"
        value={code}
        onChangeText={setCode}
        placeholder="123456"
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        containerStyle={{ marginTop: 32 }}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={busy ? 'Checking…' : 'Continue'}
        onPress={verify}
        disabled={code.trim().length !== 6}
        busy={busy}
      />
      <GhostButton label="Use a different number" onPress={() => router.back()} />
    </Screen>
  )
}
