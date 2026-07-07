import { useState } from 'react'
import { router } from 'expo-router'
import { Body, ErrorText, Field, Heading, PrimaryButton, Screen } from '../../src/components/ui'
import { makeClient } from '../../src/lib/api'

export default function PhoneEntry() {
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const requestCode = async () => {
    setBusy(true)
    setError(null)
    try {
      const anon = makeClient()
      const res = await anon.auth.requestOtp.mutate({ phone: phone.trim(), locale: 'en' })
      router.push({
        pathname: '/onboarding/otp',
        params: { phone: phone.trim(), challengeId: res.challengeId },
      })
    } catch (e) {
      setError(
        e instanceof Error && /rate_limited/.test(e.message)
          ? 'Please wait a minute before requesting another code.'
          : 'Could not send the code. Check the number, e.g. +254712345678.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Heading>SOMO</Heading>
      <Body muted>Your teaching coach — free for you, licensed by your school or network.</Body>
      <Field
        label="Your phone number"
        value={phone}
        onChangeText={setPhone}
        placeholder="+254712345678"
        keyboardType="phone-pad"
        autoFocus
        containerStyle={{ marginTop: 32 }}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={busy ? 'Sending…' : 'Send me a code'}
        onPress={requestCode}
        disabled={phone.trim().length < 8}
        busy={busy}
      />
    </Screen>
  )
}
