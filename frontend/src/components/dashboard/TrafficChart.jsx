import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs font-semibold text-gray-500">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-xs" style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

export default function TrafficChart({ data = [] }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Traffic Overview</h3>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary-500" /> Requests
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary-200" /> Successful responses
          </span>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="py-24 text-center text-sm text-gray-400">
          No traffic recorded yet. This chart shows real requests from the last 7 days once the log store has data.
        </p>
      ) : (
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ left: -20, right: 10, top: 10 }}>
          <defs>
            <linearGradient id="reqGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7C5CFC" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#7C5CFC" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F5" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="requests"
            name="Requests"
            stroke="#7C5CFC"
            strokeWidth={2.5}
            fill="url(#reqGradient)"
          />
          <Area
            type="monotone"
            dataKey="responses"
            name="Responses"
            stroke="#C4B5FD"
            strokeWidth={1.5}
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
      )}
    </div>
  )
}
