import { useCallback, useState } from 'react'
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
import { useAuth } from '../context/AuthContext.jsx'
import api from '../services/api.js'

const ROLE_STYLES = {
  SUPER_ADMIN: 'bg-primary-50 text-primary-700',
  DEVELOPER: 'bg-info-50 text-info-600',
  VIEWER: 'bg-gray-100 text-gray-600',
  SUPPORT: 'bg-warning-50 text-warning-600',
}

const EMPTY_CREATE_FORM = { name: '', email: '', password: '', role: 'VIEWER', status: 'Active' }

function initials(name) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

function formatLastActive(value) {
  if (!value) return 'Never'
  const diffMs = Date.now() - new Date(value).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} mins ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

async function fetchUsers() {
  const res = await api.get('/users')
  return res.data.data
}

export default function Users() {
  const { onMenuClick } = useOutletContext()
  const { user: currentUser } = useAuth()
  const [query, setQuery] = useState('')

  const fetcher = useCallback(fetchUsers, [])
  const { data: users, loading, error, refetch } = useApiData(fetcher)

  const [modalMode, setModalMode] = useState(null) // null | 'create' | 'edit' | 'view'
  const [form, setForm] = useState(EMPTY_CREATE_FORM)
  const [activeId, setActiveId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const filtered = (users || []).filter(
    (u) => u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase())
  )

  function openCreate() {
    setForm(EMPTY_CREATE_FORM)
    setFormError('')
    setActiveId(null)
    setModalMode('create')
  }

  function openEdit(u) {
    setForm({ name: u.name, email: u.email, role: u.role, status: u.status })
    setFormError('')
    setActiveId(u.id)
    setModalMode('edit')
  }

  function openView(u) {
    setForm({ name: u.name, email: u.email, role: u.role, status: u.status })
    setActiveId(u.id)
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
      if (modalMode === 'create') {
        await api.post('/users', form)
      } else if (modalMode === 'edit') {
        const { name, email, role, status } = form
        await api.put(`/users/${activeId}`, { name, email, role, status })
      }
      closeModal()
      refetch()
    } catch (err) {
      setFormError(err.response?.data?.error?.message || 'Unable to save this user. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/users/${deleteTarget.id}`)
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      setFormError(err.response?.data?.error?.message || 'Unable to delete this user.')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const isReadOnly = modalMode === 'view'
  const isCreate = modalMode === 'create'

  return (
    <div>
      <Header
        title="Users"
        description="Manage system users and permissions."
        onMenuClick={onMenuClick}
        right={<Button icon={Plus} onClick={openCreate}>Add User</Button>}
      />

      <main className="space-y-5 p-5 sm:p-8">
        <SearchBar placeholder="Search users..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />

        {loading && <LoadingState label="Loading users..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && filtered.length === 0 && <EmptyDataState label="No users found." />}

        {!loading && !error && filtered.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
            <DataTable columns={['User', 'Role', 'Email', 'Status', 'Last Active', 'Actions']}>
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50/60">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
                        {initials(u.name)}
                      </div>
                      <span className="font-medium text-gray-800">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_STYLES[u.role]}`}>
                      {u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{u.email}</td>
                  <td className="px-5 py-3.5">
                    <Badge status={u.status} />
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{formatLastActive(u.last_active)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1 text-gray-400">
                      <button onClick={() => openView(u)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-600" title="View">
                        <Eye className="h-4 w-4" />
                      </button>
                      <button onClick={() => openEdit(u)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-600" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
                        disabled={u.id === currentUser?.id}
                        title={u.id === currentUser?.id ? "You can't delete your own account" : 'Delete'}
                        className="rounded-md p-1.5 hover:bg-gray-100 hover:text-danger-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
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
        open={!!modalMode}
        onClose={closeModal}
        title={isCreate ? 'Add User' : modalMode === 'edit' ? 'Edit User' : 'User details'}
        description={
          isCreate ? 'Invite a new user to BridgeX.' : modalMode === 'edit' ? 'Update this user\u2019s details.' : undefined
        }
        footer={
          !isReadOnly && (
            <>
              <Button variant="secondary" onClick={closeModal}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Saving...' : isCreate ? 'Send Invite' : 'Save changes'}
              </Button>
            </>
          )
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{formError}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Full name</label>
            <input
              required
              disabled={isReadOnly}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="Jordan Smith"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Email address</label>
            <input
              type="email"
              required
              disabled={isReadOnly}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="jordan@example.com"
            />
          </div>
          {isCreate && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Temporary password</label>
              <input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                placeholder="At least 8 characters"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Role</label>
              <select
                disabled={isReadOnly}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="DEVELOPER">Developer</option>
                <option value="VIEWER">Viewer</option>
                <option value="SUPPORT">Support</option>
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
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete User"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ''}
      />
    </div>
  )
}
