import { useCallback, useEffect, useState } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { RefreshControl, ScrollView } from 'react-native'
import type { QuotaState } from '@somo/types'
import { Body, Card, Heading, Pill, PrimaryButton, Screen } from '../../src/components/ui'
import { flushOutbox, pendingCount } from '../../src/lib/db'
import { useSession } from '../../src/lib/session'

export default function Today() {
  const { api, session, refreshEntitlement } = useSession()
  const [quota, setQuota] = useState<QuotaState | null>(null)
  const [pending, setPending] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setPending(pendingCount())
    try {
      const { synced } = await flushOutbox(api)
      if (synced > 0) setPending(pendingCount())
      const q = await api.metering.quota.query()
      setQuota(q)
      await refreshEntitlement()
    } catch {
      // offline — Today still renders from cached claims/pending count
    }
  }, [api, refreshEntitlement])

  useEffect(() => {
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const usedUp = quota?.limit != null && quota.used >= quota.limit
  const firstName = session?.phone ?? 'teacher'

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Heading>Karibu, {firstName}</Heading>
        <Body muted>Your seat is active — asks and reflections are on your school's plan.</Body>

        <Card style={{ marginTop: 24 }}>
          <Body>This month's coach asks</Body>
          {quota ? (
            <>
              <Heading>
                {quota.used}
                {quota.limit != null ? ` / ${quota.limit}` : ''}
              </Heading>
              {usedUp && <Pill label="Quota used — answers may be cached only" tone="warn" />}
            </>
          ) : (
            <Body muted>—</Body>
          )}
        </Card>

        {pending > 0 && (
          <Card style={{ marginTop: 16, backgroundColor: '#f1e4be' }}>
            <Body>
              {pending} reflection{pending === 1 ? '' : 's'} waiting to sync. They'll go through
              automatically once you're back online.
            </Body>
          </Card>
        )}

        <PrimaryButton
          label="Ask the coach"
          onPress={() => router.push('/(app)/ask')}
          style={{ marginTop: 24 }}
        />
        <PrimaryButton
          label="Record a 3-minute mirror"
          onPress={() => router.push('/(app)/mirror')}
          style={{ marginTop: 12, marginBottom: 32 }}
        />
      </ScrollView>
    </Screen>
  )
}
