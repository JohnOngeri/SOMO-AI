import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@somo/api/src/routers/index'

const STORAGE_KEY = 'somo-console-session'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  phone: string
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

export function saveSession(s: StoredSession | null) {
  if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  else localStorage.removeItem(STORAGE_KEY)
}

export function makeClient(accessToken?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: '/trpc',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      }),
    ],
  })
}

export type Api = ReturnType<typeof makeClient>
