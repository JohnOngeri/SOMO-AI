import { useState } from 'react'
import { router } from 'expo-router'
import {
  Body,
  ErrorText,
  Field,
  GhostButton,
  Heading,
  PrimaryButton,
  Screen,
} from '../../src/components/ui'
import { useSession } from '../../src/lib/session'

export default function PinRedeem() {
  const { api, onSeatRedeemed, signOut } = useSession()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const redeem = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.auth.redeemPin.mutate({ pin: pin.trim() })
      await onSeatRedeemed(
        { token: res.token, publicKeyId: res.publicKeyId, publicKey: res.publicKey },
        res.claims,
      )
      router.replace('/(app)/today')
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        /invalid_pin/.test(msg)
          ? 'That PIN isn’t recognized. Check the printout from your coordinator.'
          : /seat_revoked|license_inactive/.test(msg)
            ? 'That seat is no longer active. Ask your coordinator for a new PIN.'
            : /already holds a seat/.test(msg)
              ? "You're already set up — continuing."
              : 'Could not redeem that PIN. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Heading>One last step</Heading>
      <Body muted>
        Enter the authorization PIN your school, network, or ministry gave you. It unlocks the coach
        for your account — free to you, paid for by them.
      </Body>
      <Field
        label="Authorization PIN"
        value={pin}
        onChangeText={(v) => setPin(v.toUpperCase())}
        placeholder="ABCD-2345"
        autoCapitalize="characters"
        autoFocus
        containerStyle={{ marginTop: 32 }}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={busy ? 'Checking…' : 'Unlock my coach'}
        onPress={redeem}
        disabled={pin.trim().length < 6}
        busy={busy}
      />
      <GhostButton label="Sign out" onPress={signOut} />
    </Screen>
  )
}
