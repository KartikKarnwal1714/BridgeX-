import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Zap, Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('kartik@example.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const from = location.state?.from?.pathname || '/dashboard'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      const message = err.response?.data?.error?.message || 'Unable to reach the server. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-500">
            <Zap className="h-6 w-6 fill-white text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">BridgeX</h1>
          <p className="text-sm text-gray-400">API Integration Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
          <h2 className="mb-1 text-lg font-semibold text-gray-800">Sign in</h2>
          <p className="mb-5 text-sm text-gray-400">Use your BridgeX account to continue.</p>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              placeholder="you@example.com"
            />
          </div>

          <div className="mb-6">
            <label className="mb-1 block text-xs font-medium text-gray-500">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="mt-4 text-center text-xs text-gray-400">
            Seeded admin: kartik@example.com / Password123!
          </p>
        </form>
      </div>
    </div>
  )
}
