import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { color } from '../src/lib/theme'
import { isSeated, useSession } from '../src/lib/session'

export default function Index() {
  const { ready, session, claims } = useSession()

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color.bg,
        }}
      >
        <ActivityIndicator color={color.clay} size="large" />
      </View>
    )
  }
  if (!session) return <Redirect href="/onboarding/phone" />
  if (!isSeated(claims)) return <Redirect href="/onboarding/pin" />
  return <Redirect href="/(app)/today" />
}
