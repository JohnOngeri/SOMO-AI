import { getRandomBytes } from 'expo-crypto'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Client-generated ULID — every mutation to the API is idempotent on this id. */
export function ulid(): string {
  let ts = Date.now()
  const time: string[] = []
  for (let i = 0; i < 10; i++) {
    time.unshift(ALPHABET[ts % 32]!)
    ts = Math.floor(ts / 32)
  }
  const rand = getRandomBytes(16)
  return time.join('') + [...rand].map((b) => ALPHABET[b % 32]).join('')
}
