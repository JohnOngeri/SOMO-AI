import { useQuery } from '@tanstack/react-query'
import type { Api } from '../api'

const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export function Overview({ api, onAuthFailure }: { api: Api; onAuthFailure: () => void }) {
  const q = useQuery({
    queryKey: ['overview'],
    queryFn: () => api.admin.overview.query(),
  })

  if (q.error) {
    if (/UNAUTHORIZED|not_an_institution_admin/.test(String(q.error))) onAuthFailure()
    return <div className="error">Could not load the console. {String(q.error.message ?? '')}</div>
  }
  if (!q.data) return <p className="muted">Loading…</p>

  const { institution, licenses } = q.data
  const totals = licenses.reduce(
    (acc, l) => ({
      purchased: acc.purchased + l.seatsPurchased,
      claimed: acc.claimed + l.seatsClaimed,
      active: acc.active + l.activeThisWeek,
    }),
    { purchased: 0, claimed: 0, active: 0 },
  )

  return (
    <>
      <h1>{institution.name}</h1>
      <p className="sub">
        {institution.type.replaceAll('_', ' ').toLowerCase()} · {institution.country} · SOMO
        licenses &amp; seat activity
      </p>

      <div className="grid cols-4">
        <div className="card stat">
          <div className="label">Seats purchased</div>
          <div className="value">{totals.purchased}</div>
          <div className="hint">
            across {licenses.length} license{licenses.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Seats claimed</div>
          <div className="value">{totals.claimed}</div>
          <div className="hint">teachers who redeemed a PIN</div>
        </div>
        <div className="card stat">
          <div className="label">Active this week</div>
          <div className="value">{totals.active}</div>
          <div className="hint">any coaching, reflection or sync</div>
        </div>
        <div className="card stat">
          <div className="label">Weekly coverage</div>
          <div className="value">
            {totals.claimed > 0 ? Math.round((totals.active / totals.claimed) * 100) : 0}
            <span style={{ fontSize: 22 }}>%</span>
          </div>
          <div className="hint">active ÷ claimed seats</div>
        </div>
      </div>

      <h2>Licenses</h2>
      <table>
        <thead>
          <tr>
            <th>Term</th>
            <th>Status</th>
            <th>Purchased</th>
            <th>Issued</th>
            <th>Claimed</th>
            <th>Active/wk</th>
            <th>Value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {licenses.map((l) => (
            <tr key={l.id}>
              <td className="mono">{l.term}</td>
              <td>
                <span
                  className={`chip ${l.status === 'ACTIVE' ? 'active' : l.status === 'EXPIRED' ? 'unclaimed' : 'revoked'}`}
                >
                  {l.status}
                </span>
              </td>
              <td>{l.seatsPurchased}</td>
              <td>{l.seatsIssued}</td>
              <td>{l.seatsClaimed}</td>
              <td>{l.activeThisWeek}</td>
              <td>{money(l.totalValueMinor, l.currency)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <a href={`#/license/${l.id}`} style={{ marginRight: 12 }}>
                  Seats
                </a>
                <a href={`#/costs/${l.id}`}>Costs</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
