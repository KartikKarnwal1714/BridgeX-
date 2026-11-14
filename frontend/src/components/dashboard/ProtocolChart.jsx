import { PieChart, Pie, Cell, Tooltip } from 'recharts'

export default function ProtocolChart({ data = [] }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
      <h3 className="mb-4 text-sm font-semibold text-gray-800">Protocol Distribution</h3>
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <PieChart width={160} height={160}>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={72}
              paddingAngle={3}
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => `${value}%`} />
          </PieChart>
        </div>
        <div className="flex-1 space-y-3">
          {data.map((p) => (
            <div key={p.name} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-gray-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                {p.name}
              </span>
              <span className="font-medium text-gray-700">
                {p.value}% <span className="text-gray-400">({p.count})</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
