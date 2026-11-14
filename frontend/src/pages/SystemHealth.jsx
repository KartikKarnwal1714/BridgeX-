import { useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react'
import Header from '../components/layout/Header.jsx'
import Button from '../components/common/Button.jsx'
import { LoadingState, ErrorState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import api from '../services/api.js'

const TEXT = { Healthy: 'text-success-600', Degraded: 'text-warning-600', Error: 'text-danger-600' }
const DOT = { Healthy: 'bg-success-500', Degraded: 'bg-warning-500', Error: 'bg-danger-500' }
const BG = { Healthy: 'bg-success-50', Degraded: 'bg-warning-50', Error: 'bg-danger-50' }

function timeAgo(value) {
  const diffMs = Date.now() - new Date(value).getTime()
  const secs = Math.round(diffMs / 1000)
  if (secs < 60) return `${secs} sec ago`
  const mins = Math.round(secs / 60)
  return `${mins} min${mins > 1 ? 's' : ''} ago`
}

async function fetchSystemHealth() {
  const [health, alerts] = await Promise.all([
    api.get('/system-health'),
    api.get('/system-health/alerts'),
  ])
  // Circuit breakers are visible to SUPER_ADMIN only; other roles simply do not get the panel.
  const breakers = await api.get('/system-health/circuit-breakers').then((r) => r.data.data).catch(() => null)
  return { health: health.data.data, alerts: alerts.data.data, breakers }
}

const BREAKER_STYLE = { closed: 'bg-success-50 text-success-600', open: 'bg-danger-50 text-danger-600', half_open: 'bg-warning-50 text-warning-600' }

function CircuitBreakers({ info, onReset }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-800">Circuit Breakers</h3>
        <span className="text-xs text-gray-400">
          {info.sharedAcrossInstances ? 'State shared across instances via Redis' : 'State is local to this server instance (Redis not in use)'}
        </span>
      </div>
      {info.circuits.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-gray-400">No upstream has failed yet, so no breaker state exists.</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {info.circuits.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-sm">
              <span className="font-mono-num text-xs text-gray-700">{c.key}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${BREAKER_STYLE[c.state] || 'bg-gray-100 text-gray-500'}`}>{String(c.state).replace('_', '-').toUpperCase()}</span>
              <span className="text-xs text-gray-400">{c.consecutiveFailures} consecutive failure(s) · opened {c.timesOpened}×</span>
              {c.lastError && <span className="max-w-xs truncate text-xs text-danger-600" title={c.lastError}>{c.lastError}</span>}
              <button onClick={() => onReset(c.key)} className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">Reset</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SystemHealth() {
  const { onMenuClick } = useOutletContext()
  const fetcher = useCallback(fetchSystemHealth, [])
  const { data, loading, error, refetch } = useApiData(fetcher)

  async function resetBreaker(key) {
    try { await api.delete(`/system-health/circuit-breakers/${encodeURIComponent(key)}`) } finally { refetch() }
  }

  return (
    <div>
      <Header
        title="System Health"
        description="Monitor the health of all system components, checked live."
        onMenuClick={onMenuClick}
        right={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Recheck</Button>}
      />

      <main className="space-y-6 p-5 sm:p-8">
        {loading && <LoadingState label="Checking system health..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}

        {!loading && !error && data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.health.map((s) => (
                <div key={s.name} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800">
                      {s.name}
                      {s.required === false && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Optional</span>}
                    </h3>
                    <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${BG[s.status]} ${TEXT[s.status]}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.status]}`} />
                      {s.status}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-400" title="Share of health checks that succeeded since the server started (last 100 checks)">Availability</p>
                      <p className="mt-0.5 font-semibold text-gray-800">{s.uptime}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Response</p>
                      <p className="mt-0.5 font-semibold text-gray-800">{s.response}</p>
                    </div>
                  </div>
                  {s.detail && <p className="mt-3 text-xs text-warning-600">{s.detail}</p>}
                  <p className="mt-3 text-xs text-gray-400">Last checked {timeAgo(s.lastChecked)}</p>
                </div>
              ))}
            </div>

            {data.breakers && <CircuitBreakers info={data.breakers} onReset={resetBreaker} />}

            <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
              <div className="border-b border-gray-100 px-5 py-4">
                <h3 className="text-sm font-semibold text-gray-800">Recent Alerts</h3>
              </div>
              {data.alerts.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-gray-400">
                  No alerts — everything's running clean.
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {data.alerts.map((a, i) => {
                    const Icon = a.level === 'error' ? AlertCircle : AlertTriangle
                    const color = a.level === 'error' ? 'text-danger-500' : 'text-warning-500'
                    return (
                      <div key={i} className="flex items-center gap-3 px-5 py-3.5 text-sm">
                        <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                        <span className="text-gray-700">{a.message}</span>
                        <span className="ml-auto shrink-0 text-xs text-gray-400">{timeAgo(a.time)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
