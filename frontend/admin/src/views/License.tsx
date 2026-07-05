import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Api } from '../api'

type IssuedPin = { seatId: string; pin: string; label?: string | null }

export function License({ api, licenseId }: { api: Api; licenseId: string }) {
  const qc = useQueryClient()
  const seats = useQuery({
    queryKey: ['seats', licenseId],
    queryFn: () => api.admin.seats.list.query({ licenseId }),
  })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.admin.me.query() })

  const [count, setCount] = useState(10)
  const [roster, setRoster] = useState('')
  const [issued, setIssued] = useState<IssuedPin[]>([])
  const [freshPin, setFreshPin] = useState<{ seatId: string; pin: string } | null>(null)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['seats', licenseId] })
    void qc.invalidateQueries({ queryKey: ['overview'] })
  }

  const generate = useMutation({
    mutationFn: () => api.admin.seats.generate.mutate({ licenseId, count }),
    onSuccess: (pins) => {
      setIssued(pins)
      invalidate()
    },
  })

  const importRoster = useMutation({
    mutationFn: () => {
      const rows = roster
        .split('\n')
        .map((line) => line.split(',')[0]?.trim() ?? '')
        .filter(Boolean)
        .map((name) => ({ name }))
      return api.admin.seats.importRoster.mutate({ licenseId, rows })
    },
    onSuccess: (pins) => {
      setIssued(pins)
      setRoster('')
      invalidate()
    },
  })

  const revoke = useMutation({
    mutationFn: (seatId: string) => api.admin.seats.revoke.mutate({ seatId }),
    onSuccess: invalidate,
  })

  const reassign = useMutation({
    mutationFn: (seatId: string) => api.admin.seats.reassign.mutate({ seatId }),
    onSuccess: (res) => {
      setFreshPin(res)
      invalidate()
    },
  })

  const isHq = me.data?.role === 'HQ_ADMIN'
  const orgName = me.data?.institution.name ?? 'your institution'

  return (
    <>
      <a href="#/" className="muted no-print">
        ← Overview
      </a>
      <h1>Seats</h1>
      <p className="sub">
        Generate seats, print PIN sheets, and manage teachers on this license. PINs are shown{' '}
        <strong>once</strong> — print or export before leaving this page.
      </p>

      {isHq && (
        <div className="sheet no-print">
          <div className="row">
            <div>
              <label htmlFor="count">Seats to generate</label>
              <input
                id="count"
                type="number"
                min={1}
                max={1000}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 2 }}>
              <label htmlFor="roster">…or paste a roster (one teacher name per line, CSV ok)</label>
              <textarea
                id="roster"
                rows={2}
                value={roster}
                onChange={(e) => setRoster(e.target.value)}
                placeholder={'Amina Wanjiru\nBaraka Otieno'}
              />
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button disabled={generate.isPending || count < 1} onClick={() => generate.mutate()}>
              {generate.isPending ? 'Generating…' : `Generate ${count} seats`}
            </button>
            <button
              className="ghost"
              disabled={importRoster.isPending || !roster.trim()}
              onClick={() => importRoster.mutate()}
            >
              Import roster
            </button>
          </div>
          {(generate.error ?? importRoster.error) && (
            <div className="error">{String((generate.error ?? importRoster.error)!.message)}</div>
          )}
        </div>
      )}

      {issued.length > 0 && (
        <section>
          <h2>
            PIN sheet <span className="muted">({issued.length} seats)</span>
          </h2>
          <div className="no-print" style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => window.print()}>Print PIN sheet</button>
            <button
              className="ghost"
              onClick={() => {
                const csv = issued.map((s) => `${s.label ?? ''},${s.pin}`).join('\n')
                void navigator.clipboard.writeText(`teacher,pin\n${csv}`)
              }}
            >
              Copy as CSV
            </button>
          </div>
          <p className="print-note no-print">
            These PINs cannot be shown again. Cut along the dashed lines — one slip per teacher.
          </p>
          <div className="pin-grid">
            {issued.map((s) => (
              <div className="pin-card" key={s.seatId}>
                <div className="org">{orgName} · SOMO seat</div>
                <div className="teacher">{s.label ?? '____________________'}</div>
                <div className="pin">{s.pin}</div>
                <div className="how">
                  In the SOMO app: enter your phone number, then this PIN.
                  <br />
                  No smartphone? Dial the SOMO USSD code and enter the PIN, or SMS: PIN {s.pin}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {freshPin && (
        <div className="sheet no-print">
          <strong>New PIN for the reassigned seat:</strong>{' '}
          <span className="pin mono" style={{ fontSize: 20 }}>
            {freshPin.pin}
          </span>
          <p className="print-note">
            Hand this to the replacement teacher — it will not be shown again.
          </p>
          <button className="small ghost" onClick={() => setFreshPin(null)}>
            Done
          </button>
        </div>
      )}

      <h2 className="no-print">All seats</h2>
      {seats.data && (
        <table className="no-print">
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Status</th>
              <th>Phone</th>
              <th>Claimed</th>
              <th>Last active</th>
              <th>AI / month</th>
              <th>SMS / month</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {seats.data.map((s) => (
              <tr key={s.id}>
                <td>{s.teacherName ?? s.label ?? <span className="muted">unassigned</span>}</td>
                <td>
                  <span className={`chip ${s.status.toLowerCase()}`}>{s.status}</span>
                </td>
                <td className="mono">{s.teacherPhone ?? '—'}</td>
                <td>{s.claimedAt ? new Date(s.claimedAt).toLocaleDateString() : '—'}</td>
                <td>{s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleDateString() : '—'}</td>
                <td>{s.aiCallsThisMonth}</td>
                <td>{s.smsThisMonth}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {s.status !== 'REVOKED' ? (
                    <button className="small ghost" onClick={() => revoke.mutate(s.id)}>
                      Revoke
                    </button>
                  ) : (
                    <button className="small ghost" onClick={() => reassign.mutate(s.id)}>
                      Reassign
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
