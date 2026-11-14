import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api from '../services/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('bridgex_user')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('bridgex_token')
    if (!token) {
      setLoading(false)
      return
    }
    // Verify the stored token is still valid and refresh the user profile.
    api
      .get('/auth/sessions/current')
      .then((res) => {
        setUser(res.data.data)
        localStorage.setItem('bridgex_user', JSON.stringify(res.data.data))
      })
      .catch(() => {
        localStorage.removeItem('bridgex_token')
        localStorage.removeItem('bridgex_user')
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/sessions', { email, password })
    const { token, user: loggedInUser } = res.data.data
    localStorage.setItem('bridgex_token', token)
    localStorage.setItem('bridgex_user', JSON.stringify(loggedInUser))
    setUser(loggedInUser)
    return loggedInUser
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('bridgex_token')
    localStorage.removeItem('bridgex_user')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
