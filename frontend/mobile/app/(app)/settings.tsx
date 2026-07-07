import { ScrollView } from 'react-native'
import { Body, Card, GhostButton, Heading, Pill } from '../../src/components/ui'
import { Screen } from '../../src/components/ui'
import { useSession } from '../../src/lib/session'

const LOCALE_LABEL: Record<string, string> = {
  en: 'English',
  fr: 'Français',
  ha: 'Hausa',
  sw: 'Kiswahili',
}

export default function Settings() {
  const { session, claims, signOut } = useSession()

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Heading>Settings</Heading>

        <Card style={{ marginTop: 24 }}>
          <Body muted>Phone</Body>
          <Body style={{ fontWeight: '600' }}>{session?.phone}</Body>
        </Card>

        <Card style={{ marginTop: 16 }}>
          <Body muted>Seat status</Body>
          {claims?.plan === 'org_seat' ? (
            <>
              <Pill label="Active seat" tone="ok" />
              <Body muted style={{ marginTop: 8 }}>
                Monthly asks: {claims.limits.aiCallsPerMonth ?? 'unlimited'}
              </Body>
              <Body muted>Monthly SMS: {claims.limits.smsPerMonth ?? 'unlimited'}</Body>
              <Body muted>
                Offline access valid until {new Date(claims.exp * 1000).toLocaleDateString()}
              </Body>
            </>
          ) : (
            <Pill label="No active seat" tone="warn" />
          )}
        </Card>

        <Card style={{ marginTop: 16 }}>
          <Body muted>Language</Body>
          <Body style={{ fontWeight: '600' }}>{LOCALE_LABEL['en']}</Body>
          <Body muted style={{ marginTop: 4 }}>
            Français, Hausa, Kiswahili coming soon on this screen.
          </Body>
        </Card>

        <GhostButton label="Sign out" onPress={signOut} />
      </ScrollView>
    </Screen>
  )
}
