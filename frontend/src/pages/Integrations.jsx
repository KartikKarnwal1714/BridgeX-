import { useCallback, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Eye, Pencil, Trash2, PlugZap, Loader2 } from 'lucide-react'
import Header from '../components/layout/Header.jsx'
import Button from '../components/common/Button.jsx'
import SearchBar from '../components/common/SearchBar.jsx'
import Badge from '../components/common/Badge.jsx'
import DataTable from '../components/common/DataTable.jsx'
import Modal from '../components/common/Modal.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { LoadingState, ErrorState, EmptyDataState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import { useAuth } from '../context/AuthContext.jsx'
import api from '../services/api.js'

const EMPTY_FORM = {
  name: '', type: '', protocol: 'REST', endpoint: '',
  authMode: 'none', authHeader: '', credential: '', timeoutMs: '',
  healthPath: '', wsdlUrl: '', soapVersion: '1.1',
}

const PROTOCOL_LABEL = { REST: 'REST', GRAPHQL: 'GraphQL', SOAP: 'SOAP' }
const ENDPOINT_HINT = {
  REST: 'https://api.example.com/v1',
  GRAPHQL: 'https://api.example.com/graphql',
  SOAP: 'https://example.com/soap/endpoint (the service address that receives SOAP calls)',
}
const INPUT = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500'

function timeAgo(value) {
  if (!value) return 'Never verified'
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  return new Date(value).toLocaleString()
}

function toForm(item) {
  const c = item.config || {}
  return {
    name: item.name, type: item.type, protocol: item.protocol, endpoint: item.endpoint,
    authMode: item.auth_mode || 'none', authHeader: item.auth_header || '', credential: '',
    timeoutMs: item.timeout_ms ? String(item.timeout_ms) : '',
    healthPath: c.healthPath || '', wsdlUrl: c.wsdlUrl || '', soapVersion: c.soapVersion || '1.1',
  }
}

// Builds the request body. The credential is write-only: it is sent only when the user typed a new one.
function toPayload(form, { editing }) {
  const config = {}
  if (form.protocol === 'REST' && form.healthPath.trim()) config.healthPath = form.healthPath.trim()
  if (form.protocol === 'SOAP') {
    if (form.wsdlUrl.trim()) config.wsdlUrl = form.wsdlUrl.trim()
    config.soapVersion = form.soapVersion
  }
  const body = {
    name: form.name.trim(), type: form.type.trim(), protocol: form.protocol, endpoint: form.endpoint.trim(),
    auth_mode: form.authMode, config,
    timeout_ms: form.timeoutMs ? Number(form.timeoutMs) : null,
  }
  body.auth_header = form.authMode === 'header' ? form.authHeader.trim() : null
  if (form.authMode === 'none') body.credential = null
  else if (form.credential) body.credential = form.credential
  else if (!editing) body.credential = form.credential
  return body
}

async function fetchIntegrations() {
  const res = await api.get('/integrations')
  return res.data.data
}

function VerificationPanel({ item, result, testing, onTest, canTest }) {
  const failed = item.status === 'Error' || (result && result.status !== 'Connected')
  const error = result?.error ? `${result.error.code}: ${result.error.message}` : item.last_verification_error
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-gray-500">Connection</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge status={item.status} />
            <span className="text-xs text-gray-400">Last verified: {timeAgo(item.last_verified_at)}</span>
            {item.last_verification_ms != null && item.last_verified_at && (
              <span className="font-mono-num text-xs text-gray-400">{item.last_verification_ms} ms</span>
            )}
          </div>
        </div>
        {canTest && (
          <Button variant="secondary" icon={testing ? Loader2 : PlugZap} onClick={onTest} disabled={testing}>
            {testing ? 'Testing...' : 'Test connection'}
          </Button>
        )}
      </div>
      {item.status === 'Unverified' && !result && (
        <p className="mt-2 text-xs text-gray-400">This integration has never been checked against the real service. Use Test connection to verify it.</p>
      )}
      {failed && error && <p className="mt-3 break-words rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}
      {result?.status === 'Connected' && result.details && (
        <p className="mt-3 rounded-lg bg-success-50 px-3 py-2 text-xs text-success-700">
          Connection verified
          {result.details.operations != null && ` — WSDL read, ${result.details.operations} operation(s)`}
          {result.details.rootType && ` — GraphQL root type ${result.details.rootType}`}
          {result.details.upstreamStatus && ` — HTTP ${result.details.upstreamStatus}`}.
        </p>
      )}
    </div>
  )
}

export default function Integrations() {
  const { onMenuClick } = useOutletContext()
  const { user } = useAuth()
  const canManage = ['SUPER_ADMIN', 'DEVELOPER'].includes(user?.role)
  const [query, setQuery] = useState('')

  const fetcher = useCallback(fetchIntegrations, [])
  const { data: integrations, loading, error, refetch } = useApiData(fetcher)

  const [modalMode, setModalMode] = useState(null) // null | 'create' | 'edit' | 'view'
  const [form, setForm] = useState(EMPTY_FORM)
  const [activeId, setActiveId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [results, setResults] = useState({}) // id -> latest verification response (this session)
  const [pageError, setPageError] = useState('')
  const idempotencyKey = useRef(null)

  const filtered = (integrations || []).filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
  const active = (integrations || []).find((i) => i.id === activeId)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  function openCreate() { setForm(EMPTY_FORM); setFormError(''); setActiveId(null); setModalMode('create') }
  function openEdit(item) { setForm(toForm(item)); setFormError(''); setActiveId(item.id); setModalMode('edit') }
  function openView(item) { setForm(toForm(item)); setFormError(''); setActiveId(item.id); setModalMode('view') }
  function closeModal() { setModalMode(null); setActiveId(null) }

  async function runTest(id) {
    setTestingId(id)
    setPageError('')
    try {
      const res = await api.post(`/integrations/${id}/verifications`, {})
      setResults((r) => ({ ...r, [id]: res.data.data }))
      refetch()
    } catch (err) {
      setPageError(err.response?.data?.error?.message || 'The connection test could not be run.')
    } finally {
      setTestingId(null)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (modalMode === 'view') return
    setFormError('')
    setSubmitting(true)
    try {
      const payload = toPayload(form, { editing: modalMode === 'edit' })
      if (modalMode === 'create') {
        idempotencyKey.current ||= globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        await api.post('/integrations', payload, { headers: { 'Idempotency-Key': idempotencyKey.current } })
        idempotencyKey.current = null
      } else {
        await api.patch(`/integrations/${activeId}`, payload)
      }
      closeModal()
      refetch()
    } catch (err) {
      if (err.response?.data?.error?.code === 'IDEMPOTENCY_KEY_REUSED') idempotencyKey.current = null
      const d = err.response?.data?.error
      const detail = d?.details?.length ? ` (${d.details.map((x) => `${x.field || ''} ${x.message}`.trim()).join('; ')})` : ''
      setFormError(d ? `${d.message}${detail}` : 'Unable to save this integration. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/integrations/${deleteTarget.id}`)
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      setPageError(err.response?.data?.error?.message || 'Unable to delete this integration.')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const isReadOnly = modalMode === 'view'

  return (
    <div>
      <Header
        title="Integrations"
        description="Connect REST, GraphQL and SOAP services, and verify each connection with a real request."
        onMenuClick={onMenuClick}
        right={canManage && <Button icon={Plus} onClick={openCreate}>New Integration</Button>}
      />

      <main className="space-y-5 p-5 sm:p-8">
        <SearchBar placeholder="Search integrations..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
        {pageError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">{pageError}</p>}

        {loading && <LoadingState label="Loading integrations..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && filtered.length === 0 && <EmptyDataState label="No integrations found. Create one to get started." />}

        {!loading && !error && filtered.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
            <DataTable columns={['Integration Name', 'Type', 'Protocol', 'Status', 'Last Verified', 'Actions']}>
              {filtered.map((i) => (
                <tr key={i.id} className="hover:bg-gray-50/60">
                  <td className="px-5 py-3.5 font-medium text-gray-800">{i.name}</td>
                  <td className="px-5 py-3.5 text-gray-500">{i.type}</td>
                  <td className="px-5 py-3.5 text-gray-500">{PROTOCOL_LABEL[i.protocol] || i.protocol}</td>
                  <td className="px-5 py-3.5">
                    <Badge status={i.status} />
                    {i.last_verification_error && i.status !== 'Connected' && (
                      <p className="mt-1 max-w-[16rem] truncate text-[11px] text-danger-600" title={i.last_verification_error}>{i.last_verification_error}</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{timeAgo(i.last_verified_at)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1 text-gray-400">
                      {canManage && (
                        <button onClick={() => runTest(i.id)} disabled={testingId === i.id} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-primary-600 disabled:opacity-50" title="Test connection">
                          {testingId === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                        </button>
                      )}
                      <button onClick={() => openView(i)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-600" title="View"><Eye className="h-4 w-4" /></button>
                      {canManage && (
                        <>
                          <button onClick={() => openEdit(i)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-600" title="Edit"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => setDeleteTarget(i)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-danger-600" title="Delete"><Trash2 className="h-4 w-4" /></button>
                        </>
                      )}
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
        title={modalMode === 'create' ? 'New Integration' : modalMode === 'edit' ? 'Edit Integration' : 'Integration details'}
        description={modalMode === 'create' ? 'Connect a REST, GraphQL or SOAP service. It is marked Connected only after a real test succeeds.' : undefined}
        footer={
          !isReadOnly && (
            <>
              <Button variant="secondary" onClick={closeModal}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Saving...' : modalMode === 'create' ? 'Create Integration' : 'Save changes'}
              </Button>
            </>
          )
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{formError}</p>}

          {modalMode !== 'create' && active && (
            <VerificationPanel item={active} result={results[active.id]} testing={testingId === active.id} onTest={() => runTest(active.id)} canTest={canManage} />
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
            <input required minLength={2} disabled={isReadOnly} value={form.name} onChange={(e) => set({ name: e.target.value })} className={INPUT} placeholder="e.g. CRM Sync" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
            <input required minLength={2} disabled={isReadOnly} value={form.type} onChange={(e) => set({ type: e.target.value })} className={INPUT} placeholder="e.g. Third Party, Internal Service, Legacy System" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Protocol</label>
              <select disabled={isReadOnly} value={form.protocol} onChange={(e) => set({ protocol: e.target.value })} className={INPUT}>
                <option value="REST">REST</option>
                <option value="GRAPHQL">GraphQL</option>
                <option value="SOAP">SOAP</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Timeout (ms)</label>
              <input type="number" min="100" step="100" disabled={isReadOnly} value={form.timeoutMs} onChange={(e) => set({ timeoutMs: e.target.value })} className={INPUT} placeholder="default" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Endpoint URL</label>
            <input required disabled={isReadOnly} value={form.endpoint} onChange={(e) => set({ endpoint: e.target.value })} className={`${INPUT} font-mono-num`} placeholder={ENDPOINT_HINT[form.protocol]} />
          </div>

          {form.protocol === 'REST' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Health check path (optional)</label>
              <input disabled={isReadOnly} value={form.healthPath} onChange={(e) => set({ healthPath: e.target.value })} className={`${INPUT} font-mono-num`} placeholder="/health" />
              <p className="mt-1 text-[11px] text-gray-400">Test connection sends GET to the endpoint plus this path.</p>
            </div>
          )}
          {form.protocol === 'GRAPHQL' && (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">Test connection sends the query <code className="font-mono-num">{'{ __typename }'}</code> to the endpoint and expects a GraphQL response.</p>
          )}
          {form.protocol === 'SOAP' && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-500">WSDL URL</label>
                <input required disabled={isReadOnly} value={form.wsdlUrl} onChange={(e) => set({ wsdlUrl: e.target.value })} className={`${INPUT} font-mono-num`} placeholder="https://example.com/service?wsdl" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">SOAP version</label>
                <select disabled={isReadOnly} value={form.soapVersion} onChange={(e) => set({ soapVersion: e.target.value })} className={INPUT}>
                  <option value="1.1">1.1</option>
                  <option value="1.2">1.2</option>
                </select>
              </div>
              <p className="col-span-3 -mt-1 text-[11px] text-gray-400">Test connection downloads and parses the WSDL. Calls use the endpoint URL above, not the address inside the WSDL.</p>
            </div>
          )}

          <fieldset className="space-y-3 rounded-xl border border-gray-100 p-3">
            <legend className="px-1 text-xs font-medium text-gray-500">Authentication to the upstream</legend>
            <div className="grid grid-cols-2 gap-3">
              <select disabled={isReadOnly} value={form.authMode} onChange={(e) => set({ authMode: e.target.value })} className={INPUT}>
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="header">Custom header</option>
              </select>
              {form.authMode === 'header' && (
                <input required disabled={isReadOnly} value={form.authHeader} onChange={(e) => set({ authHeader: e.target.value })} className={`${INPUT} font-mono-num`} placeholder="X-Api-Key" />
              )}
            </div>
            {form.authMode !== 'none' && (
              <div>
                <input
                  type="password" autoComplete="new-password" disabled={isReadOnly}
                  required={modalMode === 'create' || !active?.has_credential}
                  value={form.credential} onChange={(e) => set({ credential: e.target.value })}
                  className={`${INPUT} font-mono-num`}
                  placeholder={active?.has_credential ? '•••••••• (stored — type to replace)' : 'Secret / token'}
                />
                <p className="mt-1 text-[11px] text-gray-400">Stored encrypted and never shown again.</p>
              </div>
            )}
          </fieldset>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete Integration"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ''}
      />
    </div>
  )
}
