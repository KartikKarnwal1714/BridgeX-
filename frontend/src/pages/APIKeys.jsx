import { useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Copy, Trash2, Ban, Check, SlidersHorizontal } from 'lucide-react'
import Header from '../components/layout/Header.jsx'
import Button from '../components/common/Button.jsx'
import Badge from '../components/common/Badge.jsx'
import DataTable from '../components/common/DataTable.jsx'
import Modal from '../components/common/Modal.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { LoadingState, ErrorState, EmptyDataState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import { useAuth } from '../context/AuthContext.jsx'
import api from '../services/api.js'

function formatDate(value) {
  if (!value) return 'Never'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Keys and the APIs they can be granted access to are loaded together.
async function fetchApiKeys() {
  const [keys, apis] = await Promise.all([api.get('/api-keys'), api.get('/apis')])
  return { keys: keys.data.data, apis: apis.data.data }
}

export default function APIKeys() {
  const { onMenuClick } = useOutletContext()
  const fetcher = useCallback(fetchApiKeys, [])
  const { data, loading, error, refetch } = useApiData(fetcher)
  const keys = data?.keys
  const routedApis = (data?.apis || []).filter((a) => a.gateway_slug)
  const { user } = useAuth()
  const isAdmin = user?.role === 'SUPER_ADMIN'

  // Gateway settings editor (rate limit, expiry, allowed APIs) — administrators only.
  const [cfgTarget, setCfgTarget] = useState(null)
  const [cfg, setCfg] = useState({ rateLimitPerMinute: 60, expiresAt: '', apiIds: [] })
  const [cfgSaving, setCfgSaving] = useState(false)
  const [cfgError, setCfgError] = useState('')

  function openConfig(k) {
    setCfgTarget(k)
    setCfgError('')
    setCfg({
      rateLimitPerMinute: k.rateLimitPerMinute,
      expiresAt: k.expiresAt ? new Date(k.expiresAt).toISOString().slice(0, 16) : '',
      apiIds: k.apiIds || [],
    })
  }

  async function saveConfig(e) {
    e.preventDefault()
    setCfgSaving(true)
    setCfgError('')
    try {
      await api.patch(`/api-keys/${cfgTarget.id}`, {
        rateLimitPerMinute: Number(cfg.rateLimitPerMinute),
        expiresAt: cfg.expiresAt ? new Date(cfg.expiresAt).toISOString() : null,
        apiIds: cfg.apiIds,
      })
      setCfgTarget(null)
      refetch()
    } catch (err) {
      const d = err.response?.data?.error
      setCfgError(d?.details?.length ? d.details.map((x) => `${x.field?.replace(/^\//, '')} ${x.message}`).join('; ') : d?.message || 'Unable to save these settings.')
    } finally {
      setCfgSaving(false)
    }
  }

  const apiName = (id) => (data?.apis || []).find((a) => a.id === id)?.name || `API #${id}`

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ name: '', environment: 'Live' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const [createdKey, setCreatedKey] = useState(null) // the one-time full raw key
  const [copied, setCopied] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  function openCreate() {
    setForm({ name: '', environment: 'Live' })
    setFormError('')
    setModalOpen(true)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      const res = await api.post('/api-keys', form)
      setModalOpen(false)
      setCreatedKey(res.data.data)
      refetch()
    } catch (err) {
      setFormError(err.response?.data?.error?.message || 'Unable to create this key. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    setActionLoading(true)
    try {
      await api.patch(`/api-keys/${revokeTarget.id}`, { status: 'revoked' })
      setRevokeTarget(null)
      refetch()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await api.delete(`/api-keys/${deleteTarget.id}`)
      setDeleteTarget(null)
      refetch()
    } finally {
      setActionLoading(false)
    }
  }

  function copyCreatedKey() {
    navigator.clipboard.writeText(createdKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <Header
        title="API Keys"
        description="Create and manage API keys for programmatic access."
        onMenuClick={onMenuClick}
        right={<Button icon={Plus} onClick={openCreate}>Create API Key</Button>}
      />

      <main className="space-y-5 p-5 sm:p-8">
        {loading && <LoadingState label="Loading API keys..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && (keys || []).length === 0 && (
          <EmptyDataState label="No API keys yet. Create one to get programmatic access to BridgeX." />
        )}

        {!loading && !error && (keys || []).length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
            <DataTable columns={['Name', 'Key', 'Owner', 'Rate limit', 'Allowed APIs', 'Last Used', 'Status', 'Actions']}>
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-gray-50/60">
                  <td className="px-5 py-3.5 font-medium text-gray-800">{k.name}</td>
                  <td className="px-5 py-3.5 font-mono-num text-xs text-gray-500">{k.preview}</td>
                  <td className="px-5 py-3.5 text-gray-500">{k.owner}</td>
                  <td className="px-5 py-3.5 text-gray-500">{k.rateLimitPerMinute}/min{k.expiresAt ? ` · expires ${formatDate(k.expiresAt)}` : ''}</td>
                  <td className="px-5 py-3.5 text-xs text-gray-500">
                    {(k.apiIds || []).length === 0 ? <span className="text-gray-300">None</span> : k.apiIds.map(apiName).join(', ')}
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{formatDate(k.lastUsed)}</td>
                  <td className="px-5 py-3.5">
                    <Badge status={k.status} />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1 text-gray-400">
                      {isAdmin && (
                        <button
                          onClick={() => openConfig(k)}
                          className="rounded-md p-1.5 hover:bg-gray-100 hover:text-primary-600"
                          title="Gateway settings"
                          aria-label={`Gateway settings for ${k.name}`}
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                        </button>
                      )}
                      {k.status === 'Active' && (
                        <button
                          onClick={() => setRevokeTarget(k)}
                          className="rounded-md p-1.5 hover:bg-gray-100 hover:text-warning-600"
                          title="Revoke"
                          aria-label={`Revoke ${k.name}`}
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTarget(k)}
                        className="rounded-md p-1.5 hover:bg-gray-100 hover:text-danger-600"
                        title="Delete"
                        aria-label={`Delete ${k.name}`}
                      >
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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create API Key"
        description="Generate a new key for accessing the BridgeX API."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting}>{submitting ? 'Generating...' : 'Generate Key'}</Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{formError}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Key name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              placeholder="e.g. Production Server Key"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Environment</label>
            <select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              <option>Live</option>
              <option>Test</option>
            </select>
          </div>
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-600">
            The full key is shown only once after creation. Store it somewhere safe.
          </p>
        </form>
      </Modal>

      <Modal
        open={!!createdKey}
        onClose={() => setCreatedKey(null)}
        title="API key created"
        description="Copy this key now — you won't be able to see it again."
        footer={<Button onClick={() => setCreatedKey(null)}>Done</Button>}
      >
        {createdKey && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <code className="flex-1 break-all font-mono-num text-xs text-gray-700">{createdKey.key}</code>
              <button
                onClick={copyCreatedKey}
                className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                title="Copy"
              >
                {copied ? <Check className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Call the gateway with <code className="font-mono-num">Authorization: Bearer &lt;key&gt;</code> (or <code className="font-mono-num">X-API-Key</code>).
              A new key can call nothing until an administrator grants it APIs.
            </p>
            <p className="text-xs text-gray-400">
              Name: <span className="font-medium text-gray-600">{createdKey.name}</span> · Environment:{' '}
              <span className="font-medium text-gray-600">{createdKey.environment}</span>
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={!!cfgTarget}
        onClose={() => setCfgTarget(null)}
        title="Gateway settings"
        description={cfgTarget ? `Rate limit, expiry and allowed APIs for "${cfgTarget.name}".` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCfgTarget(null)}>Cancel</Button>
            <Button onClick={saveConfig} disabled={cfgSaving}>{cfgSaving ? 'Saving...' : 'Save settings'}</Button>
          </>
        }
      >
        <form onSubmit={saveConfig} className="space-y-4">
          {cfgError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{cfgError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Requests per minute</label>
              <input
                type="number"
                min="1"
                max="10000"
                required
                value={cfg.rateLimitPerMinute}
                onChange={(e) => setCfg({ ...cfg, rateLimitPerMinute: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Expires (optional)</label>
              <input
                type="datetime-local"
                value={cfg.expiresAt}
                onChange={(e) => setCfg({ ...cfg, expiresAt: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">APIs this key may call through the gateway</label>
            {routedApis.length === 0 ? (
              <p className="text-xs text-gray-400">No API has a gateway route yet. Add one under APIs &amp; Services.</p>
            ) : (
              <div className="space-y-1.5">
                {routedApis.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={cfg.apiIds.includes(a.id)}
                      onChange={() =>
                        setCfg({ ...cfg, apiIds: cfg.apiIds.includes(a.id) ? cfg.apiIds.filter((x) => x !== a.id) : [...cfg.apiIds, a.id] })
                      }
                    />
                    {a.name} <span className="font-mono-num text-xs text-gray-400">/gateway/{a.gateway_slug}</span>
                    {!a.gateway_enabled && <span className="text-xs text-warning-600">(disabled)</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        loading={actionLoading}
        title="Revoke API Key"
        message={revokeTarget ? `Revoke "${revokeTarget.name}"? Any client using it will lose access immediately.` : ''}
        confirmLabel="Revoke"
        loadingLabel="Revoking..."
        variant="warning"
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={actionLoading}
        title="Delete API Key"
        message={deleteTarget ? `Permanently delete "${deleteTarget.name}"? This cannot be undone.` : ''}
      />
    </div>
  )
}
