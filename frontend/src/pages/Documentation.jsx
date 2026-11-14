import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ChevronDown, BookOpen, ExternalLink } from 'lucide-react'
import ProtocolGuide from '../components/docs/ProtocolGuide.jsx'
import Header from '../components/layout/Header.jsx'
import { MethodBadge } from '../components/common/Badge.jsx'
import { LoadingState, ErrorState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import api from '../services/api.js'

async function fetchEndpoints() {
  const res = await api.get('/docs/endpoints')
  return res.data.data
}

export default function Documentation() {
  const { onMenuClick } = useOutletContext()
  const fetcher = useCallback(fetchEndpoints, [])
  const { data: sections, loading, error, refetch } = useApiData(fetcher)

  const [open, setOpen] = useState([])
  const [expandedRow, setExpandedRow] = useState(null)

  useEffect(() => {
    if (sections) setOpen(Object.keys(sections).slice(0, 2))
  }, [sections])

  const toggleSection = (section) =>
    setOpen((prev) => (prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]))

  const apiBase = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1').replace(/\/api\/v1$/, '')

  return (
    <div>
      <Header
        title="API Documentation"
        description="Generated from the endpoints currently registered on the BridgeX API. Dashboard endpoints use a JWT from POST /auth/sessions; the /gateway/* proxy uses an API key."
        onMenuClick={onMenuClick}
        right={
          <a
            href={`${apiBase}/api-docs`}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-full bg-success-50 px-3 py-1.5 text-xs font-medium text-success-600 hover:bg-success-100 sm:flex"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open Swagger UI
          </a>
        }
      />

      <main className="p-5 sm:p-8">
        {loading && <LoadingState label="Loading documentation..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}

        {!loading && !error && sections && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
            <div className="mb-6 flex items-start gap-3 border-b border-gray-100 pb-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500">
                <BookOpen className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900">BridgeX API</h2>
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">OAS 3.0</span>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">
                  Multi-protocol API Integration and Management Platform. Version v1.1.0 (REST, GraphQL and SOAP).
                </p>
              </div>
            </div>

            <ProtocolGuide />

            <div className="space-y-3">
              {Object.entries(sections).map(([section, endpoints]) => {
                const isOpen = open.includes(section)
                return (
                  <div key={section} className="overflow-hidden rounded-xl border border-gray-100">
                    <button
                      onClick={() => toggleSection(section)}
                      className="flex w-full items-center justify-between bg-gray-50/60 px-4 py-3 text-left"
                    >
                      <span className="text-sm font-semibold text-gray-800">{section}</span>
                      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="divide-y divide-gray-50">
                        {endpoints.map((e) => {
                          const key = `${section}-${e.method}-${e.path}`
                          const rowOpen = expandedRow === key
                          return (
                            <div key={key}>
                              <button
                                onClick={() => setExpandedRow(rowOpen ? null : key)}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/60"
                              >
                                <MethodBadge method={e.method} />
                                <span className="font-mono-num text-sm text-gray-700">{e.path}</span>
                                {e.auth === 'Public' && (
                                  <span className="rounded-full bg-success-50 px-2 py-0.5 text-[10px] font-semibold text-success-600">Public</span>
                                )}
                                <span className="ml-auto text-sm text-gray-400">{e.desc}</span>
                                <ChevronDown className={`h-3.5 w-3.5 text-gray-300 transition-transform ${rowOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {rowOpen && (
                                <div className="bg-gray-50/60 px-4 py-3 text-xs text-gray-500">
                                  <p className="mb-3">
                                    <span className="font-semibold text-gray-600">Authentication: </span>
                                    {e.auth === 'Public' ? 'None (public endpoint)' : 'Bearer JWT from POST /auth/sessions'}
                                    <span className="ml-4 font-semibold text-gray-600">Allowed roles: </span>
                                    {Array.isArray(e.roles) ? e.roles.join(', ') : e.roles}
                                  </p>
                                  <p className="mb-1 font-semibold text-gray-600">Response 200</p>
                                  <pre className="overflow-x-auto rounded-lg bg-white p-3 font-mono-num text-[11px] text-gray-600 shadow-inner">
{`{
  "success": true,
  "data": {}
}`}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
