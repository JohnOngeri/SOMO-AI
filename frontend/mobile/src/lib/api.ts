import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@somo/api/src/routers/index'

const SESSION_KEY = 'somo-session'
const SEAT_KEY = 'somo-seat-token'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  userId: string
  phone: string
}

export interface StoredSeatToken {
  token: string
  publicKeyId: string
  publicKey: string
}

/**
 * Android emulators can't resolve the host's `localhost`; a physical device
 * can't reach it at all — set EXPO_PUBLIC_API_URL to the machine's LAN IP.
 */
function defaultApiUrl(): string {
  if (process.env['EXPO_PUBLIC_API_URL']) return process.env['EXPO_PUBLIC_API_URL']
  const configured = Constants.expoConfig?.extra?.['apiUrl']
  if (typeof configured === 'string' && !configured.includes('localhost')) return configured
  const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost'
  return `http://${host}:4000/trpc`
}

export const API_URL = defaultApiUrl()

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY)
  return raw ? (JSON.parse(raw) as StoredSession) : null
}

export async function saveSession(s: StoredSession | null): Promise<void> {
  if (s) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s))
  else await SecureStore.deleteItemAsync(SESSION_KEY)
}

export async function loadSeatToken(): Promise<StoredSeatToken | null> {
  const raw = await SecureStore.getItemAsync(SEAT_KEY)
  return raw ? (JSON.parse(raw) as StoredSeatToken) : null
}

export async function saveSeatToken(t: StoredSeatToken | null): Promise<void> {
  if (t) await SecureStore.setItemAsync(SEAT_KEY, JSON.stringify(t))
  else await SecureStore.deleteItemAsync(SEAT_KEY)
}

export function makeClient(accessToken?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: API_URL,
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      }),
    ],
  })
}

export type Api = ReturnType<typeof makeClient>

/** Narrow the tRPC error shape enough to branch on the server's message code. */
export function errorCode(e: unknown): string | null {
  return e instanceof Error ? e.message : null
}
