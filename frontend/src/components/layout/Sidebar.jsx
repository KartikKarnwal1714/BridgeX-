import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Server,
  Plug,
  FileText,
  BarChart3,
  Users,
  KeyRound,
  Settings,
  BookOpen,
  Activity,
  ChevronsUpDown,
  LogOut,
  Zap,
  X,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/apis', label: 'APIs & Services', icon: Server },
  { to: '/integrations', label: 'Integrations', icon: Plug, roles: ['SUPER_ADMIN', 'DEVELOPER', 'SUPPORT'] },
  { to: '/logs', label: 'Logs', icon: FileText, roles: ['SUPER_ADMIN', 'DEVELOPER', 'SUPPORT'] },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/users', label: 'Users', icon: Users, roles: ['SUPER_ADMIN', 'SUPPORT'] },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/documentation', label: 'Documentation', icon: BookOpen },
  { to: '/system-health', label: 'System Health', icon: Activity, roles: ['SUPER_ADMIN', 'DEVELOPER', 'SUPPORT'] },
]

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'
  const roleLabel = user?.role ? user.role.replace('_', ' ') : ''

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <>
      {/* mobile backdrop */}
      {open && <div className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden" onClick={onClose} />}

      <aside
        className={`sidebar-scroll fixed z-50 flex h-full w-[248px] shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar transition-transform duration-200 lg:sticky lg:top-0 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 pb-5 pt-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500">
              <Zap className="h-4.5 w-4.5 text-white" fill="white" strokeWidth={0} />
            </div>
            <div>
              <p className="text-[15px] font-bold leading-tight text-white">BridgeX</p>
              <p className="text-[11px] leading-tight text-gray-400">API Integration Platform</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-sidebar-hover lg:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {/* Hiding is only a convenience; the API enforces these roles itself. */}
          {NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user?.role)).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'text-gray-400 hover:bg-sidebar-hover hover:text-gray-200'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="relative mt-4 border-t border-sidebar-border px-3 py-4">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-sidebar-hover"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{user?.name || 'Guest'}</p>
              <p className="truncate text-[11px] capitalize text-gray-400">{roleLabel.toLowerCase()}</p>
            </div>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          </button>

          {menuOpen && (
            <div className="absolute bottom-[calc(100%-4px)] left-3 right-3 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-hover shadow-lg">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-gray-200 hover:bg-sidebar-border"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
