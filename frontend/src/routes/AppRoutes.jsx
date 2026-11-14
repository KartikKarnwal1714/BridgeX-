import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '../components/layout/Layout.jsx'
import ProtectedRoute from './ProtectedRoute.jsx'
import Login from '../pages/Login.jsx'
import Dashboard from '../pages/Dashboard.jsx'
import APIsServices from '../pages/APIsServices.jsx'
import Integrations from '../pages/Integrations.jsx'
import Logs from '../pages/Logs.jsx'
import Analytics from '../pages/Analytics.jsx'
import Users from '../pages/Users.jsx'
import APIKeys from '../pages/APIKeys.jsx'
import Settings from '../pages/Settings.jsx'
import Documentation from '../pages/Documentation.jsx'
import SystemHealth from '../pages/SystemHealth.jsx'

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/apis" element={<APIsServices />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/users" element={<Users />} />
          <Route path="/api-keys" element={<APIKeys />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/documentation" element={<Documentation />} />
          <Route path="/system-health" element={<SystemHealth />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
