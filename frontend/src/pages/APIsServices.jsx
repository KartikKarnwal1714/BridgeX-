import { useCallback, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Eye, Pencil, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header.jsx'
import Button from '../components/common/Button.jsx'
import SearchBar from '../components/common/SearchBar.jsx'
import Badge from '../components/common/Badge.jsx'
import DataTable from '../components/common/DataTable.jsx'
import Modal from '../components/common/Modal.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { LoadingState, ErrorState, EmptyDataState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import Toggle from '../components/common/Toggle.jsx'
import { formatCompactNumber } from '../utils/format.js'
import api from '../services/api.js'

const TABS = ['All', 'REST', 'GRAPHQL', 'SOAP']
const TAB_LABELS = { All: 'All', REST: 'REST', GRAPHQL: 'GraphQL', SOAP: 'SOAP' }
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
const EMPTY_FORM = {
  name: '', description: '', protocol: 'REST', base_url: '', status: 'Healthy',
  gateway_slug: '', gateway_enabled: false, allowed_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], timeout_ms: 10000,
  upstream_auth_mode: 'none', upstream_auth_header: '', upstream_credential: '', forward_headers: '',
  has_upstream_credential: false,
}

// Public address clients call. The gateway lives on the same server as the dashboard API, outside /api/v1.
function gatewayOrigin() {
  try {
    return new URL(api.defaults.baseURL).origin
  } catch {
    return window.location.origin
  }
}

function formFromApi(a) {
  return {
    name: a.name,
    description: a.description || '',
    protocol: a.protocol,
    base_url: a.base_url,
    status: a.status,
    gateway_slug: a.gateway_slug || '',
    gateway_enabled: !!a.gateway_enabled,
    allowed_methods: a.allowed_methods || EMPTY_FORM.allowed_methods,
    timeout_ms: a.timeout_ms || 10000,
    upstream_auth_mode: a.upstream_auth_mode || 'none',
    upstream_auth_header: a.upstream_auth_header || '',
    upstream_credential: '', // never sent back by the server
    forward_headers: (a.forward_headers || []).join(', '),
    has_upstream_credential: !!a.has_upstream_credential,
  }
}

function payloadFromForm(form) {
  const body = {
    name: form.name,
    description: form.description,
    protocol: form.protocol,
    base_url: form.base_url,
    status: form.status,
    gateway_slug: form.gateway_slug.trim() || null,
    gateway_enabled: form.gateway_enabled && !!form.gateway_slug.trim(),
    allowed_methods: form.allowed_methods,
    timeout_ms: Number(form.timeout_ms),
    upstream_auth_mode: form.upstream_auth_mode,
    upstream_auth_header: form.upstream_auth_mode === 'header' ? form.upstream_auth_header.trim() || null : null,
    forward_headers: form.forward_headers.split(',').map((h) => h.trim()).filter(Boolean),
  }
  // Only sent when the administrator typed a new value; leaving it blank keeps the stored credential.
  if (form.upstream_credential) body.upstream_credential = form.upstream_credential
  if (form.upstream_auth_mode === 'none') body.upstream_credential = null
  return body
}

function errorText(err, fallback) {
  const data = err.response?.data?.error
  if (data?.details?.length) return data.details.map((d) => `${d.field?.replace(/^\//, '')} ${d.message}`.trim()).join('; ')
  return data?.message || fallback
}

async function fetchApis() {
  const res = await api.get('/apis')
  return res.data.data
}

export default function APIsServices() {
  const { onMenuClick } = useOutletContext()
  const [tab, setTab] = useState('All')
  const [query, setQuery] = useState('')

  const fetcher = useCallback(fetchApis, [])
  const { data: apis, loading, error, refetch } = useApiData(fetcher)

  // modalMode: null | 'create' | 'edit' | 'view'
  const [modalMode, setModalMode] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [activeId, setActiveId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const idempotencyKey = useRef(null)

  const counts = useMemo(() => {
    const list = apis || []
    const c = { All: list.length }
    for (const t of TABS.slice(1)) c[t] = list.filter((a) => a.protocol === t).length
    return c
  }, [apis])

  const filtered = (apis || []).filter(
    (a) =>
      (tab === 'All' || a.protocol === tab) &&
      (a.name.toLowerCase().includes(query.toLowerCase()) || a.base_url.toLowerCase().includes(query.toLowerCase()))
  )

  function openCreate() {
    setForm(EMPTY_FORM)
    setFormError('')
    setActiveId(null)
    setModalMode('create')
  }

  function openEdit(apiItem) {
    setForm(formFromApi(apiItem))
    setFormError('')
    setActiveId(apiItem.id)
    setModalMode('edit')
  }

  function openView(apiItem) {
    setForm(formFromApi(apiItem))
    setActiveId(apiItem.id)
    setModalMode('view')
  }

  function closeModal() {
    setModalMode(null)
    setActiveId(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      const body = payloadFromForm(form)
      if (modalMode === 'create') {
        idempotencyKey.current ||= globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        await api.post('/apis', body, { headers: { 'Idempotency-Key': idempotencyKey.current } })
        idempotencyKey.current = null
      } else if (modalMode === 'edit') {
        await api.put(`/apis/${activeId}`, body)
      }
      closeModal()
      refetch()
    } catch (err) {
      if (err.response?.data?.error?.code === 'IDEMPOTENCY_KEY_REUSED') idempotencyKey.current = null
      setFormError(errorText(err, 'Unable to save this API. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const [togglingId, setTogglingId] = useState(null)
  const [pageError, setPageError] = useState('')

  async function toggleGateway(apiItem, enabled) {
    setTogglingId(apiItem.id)
    setPageError('')
    try {
      await api.put(`/apis/${apiItem.id}`, { gateway_enabled: enabled })
      refetch()
    } catch (err) {
      setPageError(errorText(err, 'Unable to change the gateway state.'))
    } finally {
      setTogglingId(null)
    }
  }

  function toggleMethod(m) {
    const has = form.allowed_methods.includes(m)
    setForm({ ...form, allowed_methods: has ? form.allowed_methods.filter((x) => x !== m) : [...form.allowed_methods, m] })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/apis/${deleteTarget.id}`)
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      setFormError(err.response?.data?.error?.message || 'Unable to delete this API.')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const isReadOnly = modalMode === 'view'

  return (
    <div>
      <Header
        title="APIs & Services"
        description="Manage and monitor all your APIs and services."
        onMenuClick={onMenuClick}
        right={<Button icon={Plus} onClick={openCreate}>Create API</Button>}
      />

      <main className="space-y-5 p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  tab === t ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {TAB_LABELS[t]} ({counts[t] ?? 0})
              </button>
            ))}
          </div>
          <SearchBar placeholder="Search APIs..." value={query} onChange={(e) => setQuery(e.target.value)} className="w-64" />
        </div>

        {pageError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{pageError}</p>}
        {loading && <LoadingState label="Loading APIs..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && filtered.length === 0 && <EmptyDataState label="No APIs found. Create one to get started." />}

        {!loading && !error && filtered.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
            <DataTable columns={['API Name', 'Protocol', 'Upstream / Endpoint', 'Gateway', 'Status', 'Requests', 'Actions']}>
              {filtered.map((apiItem) => (
                <tr key={apiItem.id} className="hover:bg-gray-50/60">
                  <td className="px-5 py-3.5 font-medium text-gray-800">{apiItem.name}</td>
                  <td className="px-5 py-3.5 text-gray-500">{TAB_LABELS[apiItem.protocol] || apiItem.protocol}</td>
                  <td className="px-5 py-3.5 font-mono-num text-xs text-gray-500">{apiItem.base_url}</td>
                  <td className="px-5 py-3.5">
                    {apiItem.gateway_slug ? (
                      <div className="flex items-center gap-2">
                        <Toggle checked={!!apiItem.gateway_enabled} onChange={(v) => !togglingId && toggleGateway(apiItem, v)} />
                        <span className="font-mono-num text-xs text-gray-500">/gateway/{apiItem.gateway_slug}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">No route</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge status={apiItem.status} />
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{formatCompactNumber(apiItem.request_count)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1 text-gray-400">
                      <button onClick={() => openView(apiItem)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-600" title="View">
                        <Eye className="h-4 w-4" />
                      </button>
                      <button onClick={() => openEdit(apiItem)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-600" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteTarget(apiItem)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-danger-600" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </main>

      <Modal
        open={!!modalMode}
        onClose={closeModal}
        title={modalMode === 'create' ? 'Create API' : modalMode === 'edit' ? 'Edit API' : 'API details'}
        description={
          modalMode === 'create'
            ? 'Register a new API in BridgeX.'
            : modalMode === 'edit'
            ? 'Update this API\u2019s details.'
            : undefined
        }
        footer={
          !isReadOnly && (
            <>
              <Button variant="secondary" onClick={closeModal}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Saving...' : modalMode === 'create' ? 'Create API' : 'Save changes'}
              </Button>
            </>
          )
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{formError}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
            <input
              required
              disabled={isReadOnly}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="e.g. Billing Service API"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Description</label>
            <input
              disabled={isReadOnly}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="What this API does"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Protocol</label>
              <select
                disabled={isReadOnly}
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="REST">REST</option>
                <option value="GRAPHQL">GraphQL</option>
                <option value="SOAP">SOAP</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
              <select
                disabled={isReadOnly}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="Healthy">Healthy</option>
                <option value="Degraded">Degraded</option>
                <option value="Error">Error</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Upstream base URL (https://… when used by the gateway)</label>
            <input
              required
              disabled={isReadOnly}
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono-num focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">Gateway route</p>
                <p className="text-xs text-gray-400">Lets API keys call this upstream through BridgeX.</p>
              </div>
              {isReadOnly ? (
                <span className="text-xs text-gray-500">{form.gateway_enabled ? 'Enabled' : 'Disabled'}</span>
              ) : (
                <Toggle checked={form.gateway_enabled} onChange={(v) => setForm({ ...form, gateway_enabled: v })} />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Route name (slug)</label>
              <input
                disabled={isReadOnly}
                value={form.gateway_slug}
                onChange={(e) => setForm({ ...form, gateway_slug: e.target.value.toLowerCase() })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono-num focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="orders"
              />
              {form.gateway_slug && (
                <p className="mt-1 break-all font-mono-num text-xs text-gray-400">{gatewayOrigin()}/gateway/{form.gateway_slug}/…</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Allowed methods</label>
              <div className="flex flex-wrap gap-2">
                {METHODS.map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" disabled={isReadOnly} checked={form.allowed_methods.includes(m)} onChange={() => toggleMethod(m)} />
                    {m}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Timeout (ms)</label>
                <input
                  type="number"
                  min="100"
                  max="30000"
                  disabled={isReadOnly}
                  value={form.timeout_ms}
                  onChange={(e) => setForm({ ...form, timeout_ms: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Upstream authentication</label>
                <select
                  disabled={isReadOnly}
                  value={form.upstream_auth_mode}
                  onChange={(e) => setForm({ ...form, upstream_auth_mode: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="header">Custom header</option>
                </select>
              </div>
            </div>
            {form.upstream_auth_mode === 'header' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Header name</label>
                <input
                  disabled={isReadOnly}
                  value={form.upstream_auth_header}
                  onChange={(e) => setForm({ ...form, upstream_auth_header: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono-num focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
                  placeholder="X-Upstream-Key"
                />
              </div>
            )}
            {form.upstream_auth_mode !== 'none' && !isReadOnly && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Upstream credential</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.upstream_credential}
                  onChange={(e) => setForm({ ...form, upstream_credential: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                  placeholder={form.has_upstream_credential ? 'Stored securely — leave blank to keep it' : 'Secret sent to the upstream'}
                />
                <p className="mt-1 text-xs text-gray-400">Stored encrypted and never shown again.</p>
              </div>
            )}
            {isReadOnly && form.upstream_auth_mode !== 'none' && (
              <p className="text-xs text-gray-500">Upstream credential: {form.has_upstream_credential ? 'set (hidden)' : 'not set'}</p>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Extra headers to forward (comma separated)</label>
              <input
                disabled={isReadOnly}
                value={form.forward_headers}
                onChange={(e) => setForm({ ...form, forward_headers: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono-num focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="x-tenant, x-region"
              />
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete API"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ''}
      />
    </div>
  )
}
