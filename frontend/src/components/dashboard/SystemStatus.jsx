const DOT = { Healthy: 'bg-success-500', Degraded: 'bg-warning-500', Error: 'bg-danger-500' }
const TEXT = { Healthy: 'text-success-600', Degraded: 'text-warning-600', Error: 'text-danger-600' }

export default function SystemStatus({ data = [] }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-800">System Status</h3>
      </div>
      <div className="divide-y divide-gray-50">
        {data.map((s) => (
          <div key={s.name} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="text-gray-600">{s.name}</span>
            <span className={`flex items-center gap-1.5 font-medium ${TEXT[s.status]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.status]}`} />
              {s.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
