import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, Bell, Search, Calendar, SlidersHorizontal, ChevronDown } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'

function currentDateRangeLabel() {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 30)
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fmt(start)} - ${endLabel}`
}

export default function Header({ title, description, onMenuClick, showDateRange, showFilters, right }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  function handleSignOut() {
    logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/90 px-5 py-4 backdrop-blur sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <button onClick={onMenuClick} className="mt-0.5 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-gray-400">{description}</p>}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {right}

          {showDateRange && (
            <button className="hidden items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 sm:flex">
              <Calendar className="h-3.5 w-3.5" />
              {currentDateRangeLabel()}
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            </button>
          )}

          {showFilters && (
            <button className="hidden items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 sm:flex">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </button>
          )}

          <div className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              placeholder="Search anything..."
              className="w-56 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-600 placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>

          <div className="relative">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className="relative rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50"
            >
              <Bell className="h-4.5 w-4.5" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger-500" />
            </button>
            {notifOpen && (
              <div className="absolute right-0 z-40 mt-2 w-72 animate-fade-in rounded-xl border border-gray-100 bg-white p-2 shadow-xl">
                <p className="px-2 py-1.5 text-xs font-semibold text-gray-400">NOTIFICATIONS</p>
                {[
                  'SOAP Adapter response time is high',
                  'New integration connected: Analytics Service',
                  'API key "Mobile App Key" was used',
                ].map((n) => (
                  <div key={n} className="rounded-lg px-2 py-2 text-sm text-gray-600 hover:bg-gray-50">
                    {n}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={() => setProfileOpen((v) => !v)} className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-500 text-xs font-semibold text-white">
                {initials}
              </div>
            </button>
            {profileOpen && (
              <div className="absolute right-0 z-40 mt-2 w-48 animate-fade-in rounded-xl border border-gray-100 bg-white p-2 shadow-xl">
                <p className="px-2 py-1.5 text-sm font-medium text-gray-800">{user?.name || 'Guest'}</p>
                <p className="px-2 pb-2 text-xs text-gray-400">{user?.email}</p>
                <div className="border-t border-gray-100 pt-1">
                  <button className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50">
                    Profile settings
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-danger-600 hover:bg-gray-50"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
