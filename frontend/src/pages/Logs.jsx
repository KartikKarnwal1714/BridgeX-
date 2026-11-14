import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Download, RefreshCw, Loader2 } from 'lucide-react'
import Header from '../components/layout/Header.jsx'
import Button from '../components/common/Button.jsx'
import SearchBar from '../components/common/SearchBar.jsx'
import DataTable from '../components/common/DataTable.jsx'
import Modal from '../components/common/Modal.jsx'
import { MethodBadge, HttpStatusBadge } from '../components/common/Badge.jsx'
import { LoadingState, ErrorState, EmptyDataState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import api from '../services/api.js'

const PAGE_SIZE = 25
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: '2xx', label: '2xx Success' },
  { value: '3xx', label: '3xx Redirect' },
  { value: '4xx', label: '4xx Client error' },
  { value: '5xx', label: '5xx Server error' },
]

const OUTCOME_LABELS = {
  success: 'Forwarded',
  upstream_error: 'Upstream error',
  rejected: 'Rejected',
  rate_limited: 'Rate limited',
  gateway_error: 'Gateway error',
  client_aborted: 'Client aborted',
  circuit_open: 'Circuit open',
}

const PROTOCOL_LABEL = { REST: 'REST', GRAPHQL: 'GraphQL', SOAP: 'SOAP' }

// Compact reliability summary for one call: retries, timeout, circuit breaker.
function ReliabilityChips({ log }) {
  const chips = []
  if (log.retries > 0) chips.push({ text: `${log.retries} retr${log.retries === 1 ? 'y' : 'ies'}`, cls: 'bg-warning-50 text-warning-700' })
  if (log.timedOut) chips.push({ text: 'Timeout', cls: 'bg-danger-50 text-danger-600' })
  if (log.circuitOpen) chips.push({ text: 'Circuit open', cls: 'bg-danger-50 text-danger-600' })
  else if (log.breakerState && log.breakerState !== 'closed') chips.push({ text: `Breaker ${log.breakerState.replace('_', '-')}`, cls: 'bg-warning-50 text-warning-700' })
  if (chips.length === 0) return <span className="text-gray-300">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => <span key={c.text} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.cls}`}>{c.text}</span>)}
    </div>
  )
}

const selectClass =
  'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100'

function formatTimestamp(value) {
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// <input type="datetime-local"> gives local time without a zone; convert to a UTC ISO string for the API.
function toIso(localValue) {
  return localValue ? new Date(localValue).toISOString() : undefined
}

function exportAsCsv(logs) {
  const header = ['Timestamp', 'Method', 'Endpoint', 'Status', 'Response Time (ms)', 'Service', 'Correlation ID']
  const rows = logs.map((l) => [l.timestamp, l.method, l.endpoint, l.status, l.responseTime, l.service, l.correlationId])
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bridgex-logs-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function DetailRow({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 text-sm">
      <dt className="text-gray-400">{label}</dt>
      <dd className="col-span-2 break-all font-mono-num text-xs text-gray-700">{children ?? '—'}</dd>
    </div>
  )
}

export default function Logs() {
  const { onMenuClick } = useOutletContext()

  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cursor, setCursor] = useState('')
  const [cursorHistory, setCursorHistory] = useState([])

  const [selected, setSelected] = useState(null) // log shown in the detail modal
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState('')

  // Wait for the user to stop typing before querying the server.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(queryInput.trim())
      setCursor('')
      setCursorHistory([])
    }, 400)
    return () => clearTimeout(t)
  }, [queryInput])

  const fetcher = async () => {
    const res = await api.get('/logs', {
      params: { cursor, limit: PAGE_SIZE, q: query || undefined, method: method || undefined, status: status || undefined, source: source || undefined, from: toIso(from), to: toIso(to) },
    })
    return { items: res.data.data, meta: res.data.meta }
  }
  const { data, loading, error, refetch } = useApiData(fetcher, [cursor, query, method, status, source, from, to])

  const logs = data?.items || []
  const meta = data?.meta
  const hasFilters = Boolean(query || method || status || source || from || to)

  function changeFilter(setter) {
    return (e) => {
      setter(e.target.value)
      setCursor('')
      setCursorHistory([])
    }
  }

  function clearFilters() {
    setQueryInput('')
    setQuery('')
    setMethod('')
    setStatus('')
    setSource('')
    setFrom('')
    setTo('')
    setCursor('')
    setCursorHistory([])
  }

  function nextPage() {
    if (!meta?.nextCursor) return
    setCursorHistory((history) => [...history, cursor])
    setCursor(meta.nextCursor)
  }

  function previousPage() {
    if (!cursorHistory.length) return
    setCursor(cursorHistory[cursorHistory.length - 1])
    setCursorHistory((history) => history.slice(0, -1))
  }

  async function openDetail(log) {
    setSelected(log)
    setDetail(null)
    setDetailError('')
    try {
      const res = await api.get(`/logs/${log._id}`)
      setDetail(res.data.data)
    } catch (err) {
      setDetailError(err.response?.data?.error?.message || 'Unable to load log details.')
    }
  }

  return (
    <div>
      <Header
        title="API Logs"
        description="View and analyze API requests and responses."
        onMenuClick={onMenuClick}
        right={
          <Button variant="secondary" icon={Download} onClick={() => exportAsCsv(logs)} disabled={logs.length === 0}>
            Export page
          </Button>
        }
      />

      <main className="space-y-5 p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar placeholder="Search endpoint, service or correlation ID..." value={queryInput} onChange={(e) => setQueryInput(e.target.value)} className="min-w-[220px] max-w-sm flex-1" />
          <select aria-label="Filter by method" className={selectClass} value={method} onChange={changeFilter(setMethod)}>
            <option value="">All methods</option>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select aria-label="Filter by status" className={selectClass} value={status} onChange={changeFilter(setStatus)}>
            {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select aria-label="Filter by source" className={selectClass} value={source} onChange={changeFilter(setSource)}>
            <option value="">All traffic</option>
            <option value="gateway">Gateway traffic</option>
            <option value="dashboard">Dashboard API</option>
          </select>
          <input aria-label="From date and time" type="datetime-local" className={selectClass} value={from} max={to || undefined} onChange={changeFilter(setFrom)} />
          <input aria-label="To date and time" type="datetime-local" className={selectClass} value={to} min={from || undefined} onChange={changeFilter(setTo)} />
          {hasFilters && <Button variant="secondary" onClick={clearFilters}>Clear</Button>}
          <Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>
        </div>

        {loading && <LoadingState label="Loading logs..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && meta?.available === false && (
          <EmptyDataState label="The log store (MongoDB) isn't connected, so no logs can be shown. Start MongoDB and restart the API." />
        )}
        {!loading && !error && meta?.available !== false && logs.length === 0 && (
          <EmptyDataState
            label={hasFilters ? 'No logs match these filters.' : 'No logs recorded yet. Logs are captured from live API traffic — make a request to the API to see one here.'}
          />
        )}

        {!loading && !error && logs.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
            <DataTable columns={['Timestamp', 'Method', 'Endpoint', 'Status', 'Response Time', 'Service', 'Protocol', 'Outcome', 'Reliability', 'Correlation ID']}>
              {logs.map((l) => (
                <tr
                  key={l._id || l.correlationId}
                  tabIndex={0}
                  onClick={() => openDetail(l)}
                  onKeyDown={(e) => e.key === 'Enter' && openDetail(l)}
                  className="cursor-pointer hover:bg-gray-50/60 focus:bg-gray-50/60 focus:outline-none"
                >
                  <td className="whitespace-nowrap px-5 py-3.5 font-mono-num text-xs text-gray-500">{formatTimestamp(l.timestamp)}</td>
                  <td className="px-5 py-3.5"><MethodBadge method={l.method} /></td>
                  <td className="px-5 py-3.5 font-mono-num text-xs text-gray-700">{l.endpoint}</td>
                  <td className="px-5 py-3.5"><HttpStatusBadge status={l.status} /></td>
                  <td className="px-5 py-3.5 text-gray-500">{l.responseTime}ms</td>
                  <td className="px-5 py-3.5 text-gray-500">{l.service}</td>
                  <td className="px-5 py-3.5 text-xs text-gray-500">{l.protocol ? PROTOCOL_LABEL[l.protocol] || l.protocol : '—'}</td>
                  <td className="px-5 py-3.5 text-xs text-gray-500">{l.outcome ? OUTCOME_LABELS[l.outcome] || l.outcome : l.source === 'gateway' ? 'gateway' : '—'}</td>
                  <td className="px-5 py-3.5"><ReliabilityChips log={l} /></td>
                  <td className="px-5 py-3.5 font-mono-num text-xs text-gray-400">{l.correlationId}</td>
                </tr>
              ))}
            </DataTable>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <Button variant="secondary" onClick={previousPage} disabled={cursorHistory.length === 0}>Previous</Button>
              <Button variant="secondary" onClick={nextPage} disabled={!meta?.nextCursor}>Next</Button>
            </div>
            <p className="border-t border-gray-100 px-5 py-2 text-xs text-gray-400">
              {meta?.total?.toLocaleString()} matching entr{meta?.total === 1 ? 'y' : 'ies'} · click a row for details
            </p>
          </div>
        )}
      </main>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Log details" description={selected ? `${selected.method} ${selected.endpoint}` : ''}>
        {!detail && !detailError && (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary-500" /></div>
        )}
        {detailError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">{detailError}</p>}
        {detail && (
          <dl className="divide-y divide-gray-50">
            <DetailRow label="Timestamp">{formatTimestamp(detail.timestamp)}</DetailRow>
            <DetailRow label="Method">{detail.method}</DetailRow>
            <DetailRow label="Endpoint">{detail.endpoint}</DetailRow>
            <DetailRow label="Status">{detail.status}</DetailRow>
            <DetailRow label="Response time">{detail.responseTime != null ? `${detail.responseTime} ms` : null}</DetailRow>
            <DetailRow label="Service">{detail.service}</DetailRow>
            <DetailRow label="Correlation ID">{detail.correlationId}</DetailRow>
            <DetailRow label="User ID">{detail.metadata?.userId}</DetailRow>
            <DetailRow label="User role">{detail.metadata?.role}</DetailRow>
            <DetailRow label="Error">{detail.error}</DetailRow>
            {detail.attempts != null && (
              <>
                <DetailRow label="Protocol">{PROTOCOL_LABEL[detail.protocol] || detail.protocol}</DetailRow>
                <DetailRow label="Attempts">{detail.attempts}</DetailRow>
                <DetailRow label="Retries">{detail.retries != null ? `${detail.retries}${detail.retryDelayMs ? ` (waited ${detail.retryDelayMs} ms in total)` : ''}` : null}</DetailRow>
                <DetailRow label="Timed out">{detail.timedOut ? 'Yes' : 'No'}</DetailRow>
                <DetailRow label="Circuit breaker">{detail.breakerState ? `${detail.breakerState}${detail.circuitOpen ? ' — request blocked, upstream not called' : ''}` : null}</DetailRow>
                {detail.graphqlOperation && <DetailRow label="GraphQL operation">{`${detail.graphqlOperation}${detail.graphqlName ? ` ${detail.graphqlName}` : ''}`}</DetailRow>}
              </>
            )}
            {(detail.source === 'gateway' || detail.outcome) && (
              <>
                <DetailRow label="Outcome">{OUTCOME_LABELS[detail.outcome] || detail.outcome}</DetailRow>
                <DetailRow label="Route">{detail.apiSlug}</DetailRow>
                <DetailRow label="API key ID">{detail.apiKeyId}</DetailRow>
                <DetailRow label="Upstream status">{detail.upstreamStatus}</DetailRow>
                <DetailRow label="Upstream time">{detail.upstreamTimeMs != null ? `${detail.upstreamTimeMs} ms` : null}</DetailRow>
                <DetailRow label="Request / response size">
                  {detail.requestBytes != null ? `${detail.requestBytes} B in · ${detail.responseBytes ?? 0} B out` : null}
                </DetailRow>
              </>
            )}
          </dl>
        )}
      </Modal>
    </div>
  )
}
