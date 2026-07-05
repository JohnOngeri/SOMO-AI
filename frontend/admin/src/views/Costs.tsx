import { useQuery } from '@tanstack/react-query'
import type { Api } from '../api'

const usd = (micro: number) =>
  `$${(micro / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Spend meter — single-hue sequential (magnitude), per the dataviz method:
 * teal fill = actual, ink tick = projected, neutral track = quota ceiling.
 * Every value is direct-labeled; color never carries meaning alone.
 */
function SpendMeter({
  actual,
  projected,
  ceiling,
}: {
  actual: number
  projected: number
  ceiling: number
}) {
  const W = 720
  const H = 92
  const trackY = 34
  const trackH = 22
  const max = Math.max(ceiling, projected, actual, 1)
  const x = (v: number) => 8 + (v / max) * (W - 16)

  return (
    <div className="meter-block">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Spend this month: actual ${usd(actual)}, projected ${usd(projected)}, quota ceiling ${usd(ceiling)}`}
      >
        {/* ceiling track */}
        <rect x={8} y={trackY} width={W - 16} height={trackH} rx={4} fill="#e7dfcc" />
        <rect
          x={8}
          y={trackY}
          width={W - 16}
          height={trackH}
          rx={4}
          fill="none"
          stroke="#a89773"
          strokeWidth={1}
        />
        {/* actual fill (rounded data-end) */}
        <rect
          x={8}
          y={trackY}
          width={Math.max(x(actual) - 8, 4)}
          height={trackH}
          rx={4}
          fill="#0f7a5c"
        >
          <title>Actual metered spend: {usd(actual)}</title>
        </rect>
        {/* projected tick */}
        <line
          x1={x(projected)}
          x2={x(projected)}
          y1={trackY - 8}
          y2={trackY + trackH + 8}
          stroke="#15110d"
          strokeWidth={2}
          strokeDasharray="3 3"
        >
          <title>Projected month-end: {usd(projected)}</title>
        </line>
        {/* direct labels in text tokens */}
        <text x={8} y={trackY - 12} fontSize={12.5} fill="#5b5345">
          actual {usd(actual)}
        </text>
        <text
          x={Math.min(x(projected) + 6, W - 150)}
          y={trackY + trackH + 22}
          fontSize={12.5}
          fill="#15110d"
        >
          projected {usd(projected)}
        </text>
        <text x={W - 8} y={trackY - 12} fontSize={12.5} fill="#5b5345" textAnchor="end">
          quota ceiling {usd(ceiling)}
        </text>
      </svg>
      <div className="meter-legend">
        <span className="key">
          <span className="swatch" style={{ background: '#0f7a5c' }} /> actual (metered ledger)
        </span>
        <span className="key">
          <span
            className="swatch"
            style={{ background: 'transparent', borderLeft: '2px dashed #15110d', width: 2 }}
          />{' '}
          projected (run-rate)
        </span>
        <span className="key">
          <span className="swatch" style={{ background: '#e7dfcc', border: '1px solid #a89773' }} />{' '}
          ceiling (seats × quota — spend can never exceed this)
        </span>
      </div>
    </div>
  )
}

export function Costs({ api, licenseId }: { api: Api; licenseId: string }) {
  const q = useQuery({
    queryKey: ['costs', licenseId],
    queryFn: () => api.admin.costs.query({ licenseId }),
  })

  if (q.error) return <div className="error">{String(q.error.message)}</div>
  if (!q.data) return <p className="muted">Loading…</p>
  const c = q.data

  return (
    <>
      <a href="#/" className="muted no-print">
        ← Overview
      </a>
      <h1>Cost dashboard</h1>
      <p className="sub">
        {c.month} · {c.activeSeats} active seats · unit costs: {usd(c.unitCosts.aiCallUsdMicro)}
        /AI call, {usd(c.unitCosts.smsUsdMicro)}/SMS. The ceiling is a hard server-side limit — SOMO
        never serves an unauthorized or over-quota call.
      </p>

      <div className="card">
        <SpendMeter
          actual={c.actual.usdMicro}
          projected={c.projected.usdMicro}
          ceiling={c.ceiling.usdMicro}
        />
      </div>

      <h2>This month in numbers</h2>
      <div className="grid cols-4">
        <div className="card stat">
          <div className="label">AI coach calls</div>
          <div className="value">{c.actual.aiCalls.toLocaleString()}</div>
          <div className="hint">
            of {c.ceiling.aiCalls.toLocaleString()} ceiling · proj.{' '}
            {c.projected.aiCalls.toLocaleString()}
          </div>
        </div>
        <div className="card stat">
          <div className="label">SMS sent</div>
          <div className="value">{c.actual.smsOut.toLocaleString()}</div>
          <div className="hint">
            of {c.ceiling.smsOut.toLocaleString()} ceiling · proj.{' '}
            {c.projected.smsOut.toLocaleString()}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Actual spend</div>
          <div className="value" style={{ fontSize: 32 }}>
            {usd(c.actual.usdMicro)}
          </div>
          <div className="hint">metered, to the call</div>
        </div>
        <div className="card stat">
          <div className="label">Worst case</div>
          <div className="value" style={{ fontSize: 32 }}>
            {usd(c.ceiling.usdMicro)}
          </div>
          <div className="hint">if every seat used every credit</div>
        </div>
      </div>
    </>
  )
}
