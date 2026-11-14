import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Info } from 'lucide-react'
import Header from '../components/layout/Header.jsx'
import LineChartWidget from '../components/charts/LineChart.jsx'
import BarChartWidget from '../components/charts/BarChart.jsx'
import { LoadingState, ErrorState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import api from '../services/api.js'

const compact = (v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))

const CARD_FORMATTERS = {
  'Total Requests': compact,
  'Successful Requests': compact,
  'Failed Requests': compact,
  'Active APIs': String,
  'Error Rate': (v) => `${v}%`,
  'Avg Response Time': (v) => `${v}ms`,
}

// Each preset maps to a window ending "now" and a bucket size the API accepts.
const RANGES = [
  { id: '24h', label: 'Last 24 hours', hours: 24, interval: 'hour' },
  { id: '7d', label: 'Last 7 days', hours: 24 * 7, interval: 'day' },
  { id: '30d', label: 'Last 30 days', hours: 24 * 30, interval: 'day' },
  { id: '90d', label: 'Last 90 days', hours: 24 * 90, interval: 'day' },
]

const selectClass =
  'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100'

const OUTCOME_LABELS = {
  success: 'Forwarded OK', upstream_error: 'Upstream error', rejected: 'Rejected (auth / route / method)',
  rate_limited: 'Rate limited', gateway_error: 'Gateway error (timeout / unreachable)', client_aborted: 'Client aborted', circuit_open: 'Circuit open (fast-failed)',
}

const PROTOCOL_LABEL = { REST: 'REST', GRAPHQL: 'GraphQL', SOAP: 'SOAP' }

// Retry / timeout / circuit-breaker statistics for every outbound call (gateway, GraphQL and SOAP integrations).
function Reliability({ data }) {
  const t = data.totals
  const stats = [
    ['Outbound calls', compact(t.calls)],
    ['Retried calls', compact(t.retriedCalls)],
    ['Total retries', compact(t.totalRetries)],
    ['Timeouts', compact(t.timeouts)],
    ['Blocked by open circuit', compact(t.circuitOpen)],
    ['Avg attempts / call', String(t.averageAttempts)],
  ]
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">Reliability (retries, timeouts, circuit breaker)</h3>
      {!data.available && <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-600">Reliability figures need the log store (MongoDB), which isn't connected.</p>}
      {data.available && t.calls === 0 && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">No outbound calls were recorded in this period.</p>}
      {t.calls > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-card">
                <p className="text-xs font-medium text-gray-400">{label}</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs text-gray-400">
                <tr>{['Protocol', 'Calls', 'Retried', 'Timeouts', 'Circuit open', 'Avg attempts'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-gray-600">
                {data.byProtocol.map((r) => (
                  <tr key={r.protocol}>
                    <td className="px-5 py-3 font-medium text-gray-800">{PROTOCOL_LABEL[r.protocol] || r.protocol}</td>
                    <td className="px-5 py-3">{r.calls}</td><td className="px-5 py-3">{r.retriedCalls}</td>
                    <td className="px-5 py-3">{r.timeouts}</td><td className="px-5 py-3">{r.circuitOpen}</td><td className="px-5 py-3">{r.averageAttempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function GatewayUsage({ usage }) {
  const t = usage.totals
  const stats = [
    ['Gateway requests', compact(t.requests)],
    ['Successful', compact(t.successful)],
    ['Failed', compact(t.failed)],
    ['Rate limited', compact(t.rateLimited)],
    ['Upstream errors', compact(t.upstreamErrors)],
    ['Avg latency', `${t.averageResponseTime}ms`],
  ]
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">Gateway usage</h3>
      {!usage.available && (
        <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-600">Gateway usage needs the log store (MongoDB), which isn't connected.</p>
      )}
      {usage.available && t.requests === 0 && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          No gateway requests in this period. Send a request to <code className="font-mono-num">/gateway/&lt;route&gt;/…</code> with an API key to see it here.
        </p>
      )}
      {t.requests > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-white p-3 shadow-card">
                <p className="text-xs text-gray-400">{label}</p>
                <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <UsageTable title="By API" rows={usage.byApi} nameOf={(r) => r.apiName || r.apiSlug} />
            <UsageTable title="By API key" rows={usage.byKey} nameOf={(r) => r.keyName} />
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
            <h4 className="mb-2 text-xs font-semibold text-gray-500">Outcomes</h4>
            <ul className="space-y-1 text-sm text-gray-600">
              {usage.byOutcome.map((o) => (
                <li key={o.outcome} className="flex justify-between">
                  <span>{OUTCOME_LABELS[o.outcome] || o.outcome}</span>
                  <span className="font-mono-num text-gray-800">{o.requests}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

function UsageTable({ title, rows, nameOf }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
      <h4 className="mb-3 text-xs font-semibold text-gray-500">{title}</h4>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No data.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="text-gray-400">
            <tr><th className="pb-2 font-medium">Name</th><th className="pb-2 font-medium">Requests</th><th className="pb-2 font-medium">Errors</th><th className="pb-2 font-medium">429s</th><th className="pb-2 font-medium">Avg ms</th></tr>
          </thead>
          <tbody className="text-gray-700">
            {rows.map((r) => (
              <tr key={r.apiSlug || r.apiKeyId} className="border-t border-gray-50">
                <td className="py-1.5 pr-2">{nameOf(r)}</td>
                <td className="py-1.5">{r.requests}</td>
                <td className="py-1.5">{r.failed} ({r.errorRate}%)</td>
                <td className="py-1.5">{r.rateLimited}</td>
                <td className="py-1.5">{r.averageResponseTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function Analytics() {
  const { onMenuClick } = useOutletContext()
  const [rangeId, setRangeId] = useState('7d')

  const fetcher = async () => {
    const range = RANGES.find((r) => r.id === rangeId)
    const to = new Date()
    const params = {
      from: new Date(to.getTime() - range.hours * 3600 * 1000).toISOString(),
      to: to.toISOString(),
      interval: range.interval,
    }
    // Gateway usage is restricted to SUPER_ADMIN / DEVELOPER / SUPPORT; other roles simply don't see the panel.
    const gatewayRequest = api.get('/analytics/gateway', { params }).then((r) => r.data).catch(() => null)
    const reliabilityRequest = api.get('/analytics/reliability', { params }).then((r) => r.data).catch(() => null)
    const [cards, traffic, topEndpoints, gateway, reliability] = await Promise.all([
      api.get('/analytics/cards', { params }),
      api.get('/analytics/traffic', { params }),
      api.get('/analytics/top-endpoints', { params }),
      gatewayRequest,
      reliabilityRequest,
    ])
    return {
      cards: cards.data.data,
      available: cards.data.meta?.available !== false,
      traffic: traffic.data.data,
      topEndpoints: topEndpoints.data.data.map((e) => ({ ...e, requests: Number(e.requests) })),
      gateway: gateway ? { ...gateway.data, available: gateway.meta?.available !== false } : null,
      reliability: reliability ? { ...reliability.data, available: reliability.meta?.available !== false } : null,
    }
  }
  const { data, loading, error, refetch } = useApiData(fetcher, [rangeId])

  const totalRequests = data?.cards.find((c) => c.label === 'Total Requests')?.value ?? 0

  return (
    <div>
      <Header
        title="Analytics"
        description="API analytics calculated from recorded request logs."
        onMenuClick={onMenuClick}
        right={
          <select aria-label="Date range" className={selectClass} value={rangeId} onChange={(e) => setRangeId(e.target.value)}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        }
      />

      <main className="space-y-6 p-5 sm:p-8">
        {loading && <LoadingState label="Loading analytics..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}

        {!loading && !error && data && (
          <>
            {!data.available && (
              <p className="flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-600">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Request analytics need the log store (MongoDB), which isn't connected. Request figures show 0 instead of estimates.
              </p>
            )}
            {data.available && totalRequests === 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                No requests were recorded in this period. Requests are only counted from when logging was switched on — earlier history isn't available.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {data.cards.map((c) => (
                <div key={c.label} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-card">
                  <p className="text-xs font-medium text-gray-400">{c.label}</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">{(CARD_FORMATTERS[c.label] || String)(c.value)}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
                <h3 className="mb-4 text-sm font-semibold text-gray-800">Requests Over Time</h3>
                {data.traffic.length === 0 ? (
                  <p className="py-16 text-center text-sm text-gray-400">No data for this period.</p>
                ) : (
                  <LineChartWidget data={data.traffic} xKey="date" yKey="requests" color="#7C5CFC" />
                )}
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
                <h3 className="mb-4 text-sm font-semibold text-gray-800">Top Endpoints</h3>
                {data.topEndpoints.length === 0 ? (
                  <p className="py-16 text-center text-sm text-gray-400">No data for this period.</p>
                ) : (
                  <BarChartWidget data={data.topEndpoints} xKey="endpoint" yKey="requests" color="#7C5CFC" />
                )}
              </div>
            </div>

            {data.gateway && <GatewayUsage usage={data.gateway} />}
            {data.reliability && <Reliability data={data.reliability} />}

            <p className="text-xs text-gray-400">
              Error = response status 400 or higher. Error rate = errors ÷ total requests. Times are grouped in UTC.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
