import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('bridgex_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/sessions')
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('bridgex_token')
      localStorage.removeItem('bridgex_user')
      // Session expired or token rejected: send the user back to sign in.
      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }
    return Promise.reject(error)
  }
)

export default api
