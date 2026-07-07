import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EntitlementClaims } from '@somo/types'
import {
  loadSeatToken,
  loadSession,
  makeClient,
  saveSeatToken,
  saveSession,
  type Api,
  type StoredSeatToken,
  type StoredSession,
} from './api'
import { verifySeatTokenOffline } from './entitlement'

interface SessionState {
  ready: boolean
  session: StoredSession | null
  seat: StoredSeatToken | null
  claims: EntitlementClaims | null
  api: Api
  signIn: (s: StoredSession) => Promise<void>
  signOut: () => Promise<void>
  onSeatRedeemed: (t: StoredSeatToken, claims: EntitlementClaims) => Promise<void>
  refreshEntitlement: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<StoredSession | null>(null)
  const [seat, setSeat] = useState<StoredSeatToken | null>(null)
  const [claims, setClaims] = useState<EntitlementClaims | null>(null)

  const api = useMemo(() => makeClient(session?.accessToken), [session])

  const applySeat = (t: StoredSeatToken | null) => {
    setSeat(t)
    if (!t) {
      setClaims(null)
      return
    }
    const verified = verifySeatTokenOffline(t.token, t.publicKey)
    setClaims(verified.ok ? verified.claims : null)
  }

  useEffect(() => {
    void (async () => {
      const [storedSession, storedSeat] = await Promise.all([loadSession(), loadSeatToken()])
      setSession(storedSession)
      applySeat(storedSeat)
      // a seat claimed elsewhere (roster import, another device) has no local
      // token yet — try once for a live answer before falling back to cache
      if (storedSession) {
        try {
          const client = makeClient(storedSession.accessToken)
          const fresh = await client.entitlements.get.query()
          await saveSeatToken({
            token: fresh.token,
            publicKeyId: fresh.publicKeyId,
            publicKey: fresh.publicKey,
          })
          applySeat({
            token: fresh.token,
            publicKeyId: fresh.publicKeyId,
            publicKey: fresh.publicKey,
          })
        } catch {
          // offline on cold start — the cached token from applySeat() above stands
        }
      }
      setReady(true)
    })()
  }, [])

  const signIn = async (s: StoredSession) => {
    await saveSession(s)
    setSession(s)
  }

  const signOut = async () => {
    await saveSession(null)
    await saveSeatToken(null)
    setSession(null)
    applySeat(null)
  }

  const onSeatRedeemed = async (t: StoredSeatToken, c: EntitlementClaims) => {
    await saveSeatToken(t)
    setSeat(t)
    setClaims(c)
  }

  /** Opportunistic refresh of the offline seat token — call on every reconnect. */
  const refreshEntitlement = async () => {
    if (!session) return
    try {
      const fresh = await api.entitlements.get.query()
      const t: StoredSeatToken = {
        token: fresh.token,
        publicKeyId: fresh.publicKeyId,
        publicKey: fresh.publicKey,
      }
      await onSeatRedeemed(t, fresh.claims)
    } catch {
      // offline or expired session — keep serving the last-verified token
    }
  }

  const value: SessionState = {
    ready,
    session,
    seat,
    claims,
    api,
    signIn,
    signOut,
    onSeatRedeemed,
    refreshEntitlement,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

export function isSeated(claims: EntitlementClaims | null): boolean {
  return claims?.plan === 'org_seat'
}
