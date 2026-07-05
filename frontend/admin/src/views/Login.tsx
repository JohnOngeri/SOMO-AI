import { useState } from 'react'
import { makeClient, type StoredSession } from '../api'

/** ULIDs are generated client-side for idempotency; a light impl is enough here. */
function ulid(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let ts = Date.now()
  const time: string[] = []
  for (let i = 0; i < 10; i++) {
    time.unshift(alphabet[ts % 32]!)
    ts = Math.floor(ts / 32)
  }
  const rand = crypto.getRandomValues(new Uint8Array(16))
  return time.join('') + [...rand].map((b) => alphabet[b % 32]).join('')
}

export function Login({ onLogin }: { onLogin: (s: StoredSession) => void }) {
  const [phone, setPhone] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const anon = makeClient()

  const requestCode = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await anon.auth.requestOtp.mutate({ phone: phone.trim(), locale: 'en' })
      setChallengeId(res.challengeId)
    } catch (e) {
      setError(
        e instanceof Error && /rate_limited/.test(e.message)
          ? 'Please wait a minute before requesting another code.'
          : 'Could not send the code. Check the phone number (+2547…).',
      )
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!challengeId) return
    setBusy(true)
    setError(null)
    try {
      const session = await anon.auth.verifyOtp.mutate({
        challengeId,
        code: code.trim(),
        deviceId: ulid(),
        deviceName: 'console',
      })
      // confirm this phone actually belongs to an institution admin
      const authed = makeClient(session.accessToken)
      await authed.admin.me.query()
      onLogin({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        phone: session.user.phone,
      })
    } catch (e) {
      setError(
        e instanceof Error && /not_an_institution_admin/.test(e.message)
          ? 'This number is not registered as an institution coordinator. Contact SOMO.'
          : 'That code did not work. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          SOMO<span>.</span>
        </div>
        <p className="sub" style={{ marginTop: 4 }}>
          Institution console — licenses, seats &amp; spend.
        </p>

        {!challengeId ? (
          <>
            <label htmlFor="phone">Coordinator phone number</label>
            <input
              id="phone"
              inputMode="tel"
              placeholder="+254712345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && phone && requestCode()}
            />
            <div style={{ marginTop: 18 }}>
              <button disabled={busy || phone.trim().length < 8} onClick={requestCode}>
                {busy ? 'Sending…' : 'Send code by SMS'}
              </button>
            </div>
          </>
        ) : (
          <>
            <label htmlFor="code">Enter the 6-digit code sent to {phone}</label>
            <input
              id="code"
              inputMode="numeric"
              maxLength={6}
              className="mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()}
            />
            <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
              <button disabled={busy || code.trim().length !== 6} onClick={verify}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button className="ghost" onClick={() => setChallengeId(null)}>
                Change number
              </button>
            </div>
          </>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
