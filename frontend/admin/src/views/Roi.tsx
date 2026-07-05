import { useQuery } from '@tanstack/react-query'
import type { Api } from '../api'

const usd = (micro: number) =>
  `$${(micro / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Time-to-competency cumulative curve — one series (teal), so no legend box;
 * the title names it. Direct labels at the ends only; recessive grid.
 */
function CompetencyCurve({ curve }: { curve: { day: number; cumulativePct: number }[] }) {
  const W = 720
  const H = 200
  const pad = { l: 40, r: 20, t: 14, b: 30 }
  if (curve.length < 2) {
    return <p className="muted">Not enough ramped teachers yet to draw the cohort curve.</p>
  }
  const maxDay = curve[curve.length - 1]!.day || 1
  const x = (d: number) => pad.l + (d / maxDay) * (W - pad.l - pad.r)
  const y = (p: number) => pad.t + (1 - p / 100) * (H - pad.t - pad.b)
  const path = curve
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${x(c.day)},${y(c.cumulativePct)}`)
    .join(' ')
  const last = curve[curve.length - 1]!

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Cumulative share of teachers reaching the competency baseline by day: ${last.cumulativePct}% by day ${last.day}`}
    >
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line x1={pad.l} x2={W - pad.r} y1={y(p)} y2={y(p)} stroke="#d8ccb0" strokeWidth={1} />
          <text x={pad.l - 6} y={y(p) + 4} fontSize={11} fill="#948869" textAnchor="end">
            {p}%
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#0f7a5c" strokeWidth={2} strokeLinejoin="round" />
      {curve.map((c) => (
        <circle key={c.day} cx={x(c.day)} cy={y(c.cumulativePct)} r={3} fill="#0f7a5c">
          <title>
            day {c.day}: {c.cumulativePct}% of cohort ramped
          </title>
        </circle>
      ))}
      <text
        x={x(last.day)}
        y={y(last.cumulativePct) - 8}
        fontSize={12}
        fill="#15110d"
        textAnchor="end"
      >
        {last.cumulativePct}% by day {last.day}
      </text>
      <text
        x={(pad.l + W - pad.r) / 2}
        y={H - 6}
        fontSize={11.5}
        fill="#948869"
        textAnchor="middle"
      >
        days since seat claimed
      </text>
    </svg>
  )
}

export function Roi({ api, licenseId }: { api: Api; licenseId: string }) {
  const q = useQuery({
    queryKey: ['roi', licenseId],
    queryFn: () => api.admin.roi.query({ licenseId }),
  })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.admin.me.query() })

  if (q.error) return <div className="error">{String(q.error.message)}</div>
  if (!q.data) return <p className="muted">Loading…</p>
  const r = q.data
  const seatCost = `${r.roi.currency} ${(r.roi.costPerSeatMinor / 100).toFixed(2)}`

  return (
    <>
      <a href="#/" className="muted no-print">
        ← Overview
      </a>
      <div className="no-print" style={{ float: 'right' }}>
        <button onClick={() => window.print()}>Export report (PDF)</button>
      </div>
      <h1>Impact &amp; ROI — {r.term}</h1>
      <p className="sub">
        {me.data?.institution.name ?? ''} · generated {new Date(r.generatedAt).toLocaleDateString()}{' '}
        · every figure traces to metered usage; assumptions are printed below.
      </p>

      <div className="card" style={{ borderLeft: '5px solid #0f7a5c' }}>
        <div className="stat">
          <div className="label">The headline</div>
          <div className="value" style={{ fontSize: 26, lineHeight: 1.35 }}>
            SOMO costs {seatCost} per teacher this term and has already displaced{' '}
            {usd(r.roi.savedPerClaimedSeatUsdMicro)} per teacher in field-mentor cost.
          </div>
          <div className="hint">
            {r.mentorTime.visitsDisplaced} mentor visits displaced · {r.mentorTime.hoursSaved} field
            hours saved · {usd(r.roi.totalSavedUsdMicro)} total
          </div>
        </div>
      </div>

      <h2>Coverage</h2>
      <div className="grid cols-4">
        <div className="card stat">
          <div className="label">Seats claimed</div>
          <div className="value">
            {r.coverage.seatsClaimed}
            <span style={{ fontSize: 20, color: '#948869' }}>/{r.coverage.seatsPurchased}</span>
          </div>
        </div>
        <div className="card stat">
          <div className="label">Weekly active</div>
          <div className="value">
            {r.coverage.weeklyActivePct}
            <span style={{ fontSize: 22 }}>%</span>
          </div>
          <div className="hint">{r.coverage.weeklyActive} teachers</div>
        </div>
        <div className="card stat">
          <div className="label">Reflections</div>
          <div className="value">{r.coverage.reflectionsTotal.toLocaleString()}</div>
          <div className="hint">{r.coverage.avgReflectionsPerClaimedSeat} avg / teacher</div>
        </div>
        <div className="card stat">
          <div className="label">Coach interactions</div>
          <div className="value">{r.coverage.coachInteractionsTotal.toLocaleString()}</div>
        </div>
      </div>

      <h2>Time to competency</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          A teacher is "ramped" after {r.timeToCompetency.baseline.reflections} reflections and{' '}
          {r.timeToCompetency.baseline.asks} coach interactions. {r.timeToCompetency.reached} of{' '}
          {r.timeToCompetency.ofClaimed} claimed teachers have ramped
          {r.timeToCompetency.medianDays !== null
            ? ` — median ${r.timeToCompetency.medianDays} days`
            : ''}
          .
        </p>
        <CompetencyCurve curve={r.timeToCompetency.curve} />
      </div>

      <h2>Assumptions</h2>
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Mentor-visit displacement: {r.mentorTime.assumptions.asksPerVisit} substantive coach
          interactions ≈ 1 in-person visit; each visit costs{' '}
          {usd(r.mentorTime.assumptions.costPerVisitUsdMicro)} and{' '}
          {r.mentorTime.assumptions.hoursPerVisit}h incl. travel. Adjust these with your SOMO
          account manager to match your field-staff cost base.
        </p>
      </div>
    </>
  )
}
