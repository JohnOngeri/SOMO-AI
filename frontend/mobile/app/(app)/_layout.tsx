import { Redirect, Tabs } from 'expo-router'
import { Text } from 'react-native'
import { color, fontFamily, fontSize } from '../../src/lib/theme'
import { isSeated, useSession } from '../../src/lib/session'

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{glyph}</Text>
}

export default function AppLayout() {
  const { claims } = useSession()
  // revoke/expiry mid-session must cut off access here too, not just server-side
  if (!isSeated(claims)) return <Redirect href="/onboarding/pin" />

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.clay,
        tabBarInactiveTintColor: color.inkFaint,
        tabBarStyle: { backgroundColor: color.white, borderTopColor: color.line },
        tabBarLabelStyle: { fontFamily: fontFamily.body, fontSize: fontSize.xs },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ focused }) => <TabIcon glyph="☀" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{
          title: 'Ask Coach',
          tabBarIcon: ({ focused }) => <TabIcon glyph="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="mirror"
        options={{
          title: 'Mirror',
          tabBarIcon: ({ focused }) => <TabIcon glyph="🪞" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="dna"
        options={{
          title: 'Class DNA',
          tabBarIcon: ({ focused }) => <TabIcon glyph="🧬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon glyph="⚙" focused={focused} />,
        }}
      />
    </Tabs>
  )
}
