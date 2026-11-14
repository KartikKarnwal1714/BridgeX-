import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Header from '../components/layout/Header.jsx'
import Button from '../components/common/Button.jsx'
import Toggle from '../components/common/Toggle.jsx'
import { LoadingState, ErrorState } from '../components/common/DataState.jsx'
import { useApiData } from '../hooks/useApiData.js'
import { useAuth } from '../context/AuthContext.jsx'
import api from '../services/api.js'

function Section({ title, description, children }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {description && <p className="mt-1 text-xs text-gray-400">{description}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  )
}

function Field({ label, notEnforced, children }) {
  return (
    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-3 sm:gap-4">
      <label className="text-sm font-medium text-gray-600">
        {label}
        {notEnforced && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Saved only</span>}
      </label>
      <div className="sm:col-span-2">{children}</div>
    </div>
  )
}

const inputClass =
  'w-full max-w-sm rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-400'

function ToggleRow({ label, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {description && <p className="text-xs text-gray-400">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={disabled ? () => {} : onChange} />
    </div>
  )
}

async function fetchSettings() {
  const res = await api.get('/settings')
  return res.data.data
}

export default function Settings() {
  const { onMenuClick } = useOutletContext()
  const { user } = useAuth()
  const canEdit = user?.role === 'SUPER_ADMIN'

  const fetcher = useCallback(fetchSettings, [])
  const { data, loading, error, refetch } = useApiData(fetcher)

  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    setSaved(false)
    try {
      const { applicationName, timezone, dateFormat, jwtExpiry, sessionTimeout, passwordPolicy, emailNotifications, systemAlerts, apiFailureAlerts, theme } = form
      const res = await api.put('/settings', {
        applicationName, timezone, dateFormat, jwtExpiry, sessionTimeout, passwordPolicy,
        emailNotifications, systemAlerts, apiFailureAlerts, theme,
      })
      setForm(res.data.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err.response?.data?.error?.message || 'Unable to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="Settings"
        description="Configure your BridgeX platform preferences."
        onMenuClick={onMenuClick}
        right={
          canEdit && (
            <Button onClick={handleSave} disabled={saving || !form}>
              {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Changes'}
            </Button>
          )
        }
      />

      <main className="space-y-6 p-5 sm:p-8">
        {loading && <LoadingState label="Loading settings..." />}
        {!loading && error && <ErrorState message={error} onRetry={refetch} />}

        {!loading && !error && form && (
          <>
            {!canEdit && (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                You're viewing these settings in read-only mode. Only a Super Admin can change them.
              </p>
            )}
            {saveError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{saveError}</p>}
            <p className="rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-700">
              Settings are saved to the database and reload after refresh. Today the server enforces only <strong>JWT expiry</strong> (it applies to new logins).
              The other preferences are stored but don't change application behaviour yet.
            </p>

            <Section title="General" description="Basic application configuration.">
              <Field label="Application name">
                <input
                  disabled={!canEdit}
                  className={inputClass}
                  value={form.applicationName}
                  onChange={(e) => set('applicationName', e.target.value)}
                />
              </Field>
              <Field label="Timezone">
                <select disabled={!canEdit} className={inputClass} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  <option>(GMT+5:30) India Standard Time</option>
                  <option>(GMT+0:00) UTC</option>
                  <option>(GMT-5:00) Eastern Time</option>
                </select>
              </Field>
              <Field label="Date format">
                <select disabled={!canEdit} className={inputClass} value={form.dateFormat} onChange={(e) => set('dateFormat', e.target.value)}>
                  <option>DD/MM/YYYY</option>
                  <option>MM/DD/YYYY</option>
                  <option>YYYY-MM-DD</option>
                </select>
              </Field>
            </Section>

            <Section title="Security" description="Authentication and session controls.">
              <Field label="JWT expiry">
                <select disabled={!canEdit} className={inputClass} value={form.jwtExpiry} onChange={(e) => set('jwtExpiry', e.target.value)}>
                  <option>1 hour</option>
                  <option>12 hours</option>
                  <option>24 hours</option>
                </select>
              </Field>
              <Field label="Session timeout" notEnforced>
                <select disabled={!canEdit} className={inputClass} value={form.sessionTimeout} onChange={(e) => set('sessionTimeout', e.target.value)}>
                  <option>30 minutes</option>
                  <option>1 hour</option>
                  <option>4 hours</option>
                </select>
              </Field>
              <Field label="Password policy" notEnforced>
                <select disabled={!canEdit} className={inputClass} value={form.passwordPolicy} onChange={(e) => set('passwordPolicy', e.target.value)}>
                  <option>Strong (min. 12 characters)</option>
                  <option>Standard (min. 8 characters)</option>
                </select>
              </Field>
            </Section>

            <Section title="Notifications" description="Choose what you get notified about.">
              <ToggleRow
                label="Email notifications"
                description="Receive updates via email."
                checked={form.emailNotifications}
                onChange={(v) => set('emailNotifications', v)}
                disabled={!canEdit}
              />
              <ToggleRow
                label="System alerts"
                description="Notify on degraded or unhealthy services."
                checked={form.systemAlerts}
                onChange={(v) => set('systemAlerts', v)}
                disabled={!canEdit}
              />
              <ToggleRow
                label="API failure alerts"
                description="Notify when an API request fails."
                checked={form.apiFailureAlerts}
                onChange={(v) => set('apiFailureAlerts', v)}
                disabled={!canEdit}
              />
            </Section>

            <Section title="Appearance" description="Personalize how BridgeX looks.">
              <Field label="Theme preference">
                <div className="flex gap-2">
                  {['Light', 'Dark', 'System'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => set('theme', t)}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed ${
                        form.theme === t ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>
          </>
        )}
      </main>
    </div>
  )
}
