import { useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import Header from '../components/layout/Header.jsx'
import StatCard from '../components/dashboard/StatCard.jsx'
import TrafficChart from '../components/dashboard/TrafficChart.jsx'
import ProtocolChart from '../components/dashboard/ProtocolChart.jsx'
import TopAPIs from '../components/dashboard/TopAPIs.jsx'
import SystemStatus from '../components/dashboard/SystemStatus.jsx'
import { LoadingState, ErrorState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import { useAuth } from '../context/AuthContext.jsx'
import { formatCompactNumber, formatPercent, formatMs } from '../utils/format.js'
import api from '../services/api.js'

async function fetchDashboardData() {
  const [stats, traffic, protocol, topApis, systemStatus] = await Promise.all([
    api.get('/dashboard/stats'),
    api.get('/dashboard/traffic'),
    api.get('/dashboard/protocol-distribution'),
    api.get('/dashboard/top-apis'),
    api.get('/dashboard/system-status'),
  ])

  return {
    stats: stats.data.data,
    traffic: traffic.data.data,
    protocol: protocol.data.data,
    topApis: topApis.data.data,
    systemStatus: systemStatus.data.data,
  }
}

export default function Dashboard() {
  const { onMenuClick } = useOutletContext()
  const { user } = useAuth()
  const fetcher = useCallback(fetchDashboardData, [])
  const { data, loading, error, refetch } = useApiData(fetcher)

  const kpis = data
    ? [
        { label: 'Total APIs', value: data.stats.totalApis },
        { label: 'Total Requests', value: formatCompactNumber(data.stats.totalRequests) },
        { label: 'Success Rate', value: formatPercent(data.stats.successRate) },
        { label: 'Avg Response Time', value: formatMs(data.stats.averageResponseTime) },
        { label: 'Failed Requests', value: formatCompactNumber(data.stats.failedRequests) },
      ]
    : []

  return (
    <div>
      <Header
        title="Dashboard"
        description={`Welcome back, ${user?.name?.split(' ')[0] || ''}! Here's what's happening with your APIs.`}
        onMenuClick={onMenuClick}
        showFilters
      />

      <main className="space-y-6 p-5 sm:p-8">
        {loading && <LoadingState label="Loading dashboard..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}

        {!loading && !error && data && (
          <>
            {data.stats.logDataAvailable === false && (
              <p role="status" className="rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700">
                Request log data is unavailable because MongoDB is not connected. Request totals, success rate, and latency are shown as zero until logging is available.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              {kpis.map((k) => (
                <StatCard key={k.label} {...k} />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <TrafficChart data={data.traffic} />
              </div>
              <ProtocolChart data={data.protocol} />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <TopAPIs apis={data.topApis} />
              </div>
              <SystemStatus data={data.systemStatus} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
