import { ArrowUp, ArrowDown } from 'lucide-react'

export default function StatCard({ label, value, delta, trend }) {
  const isUp = trend === 'up'
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-card">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {delta && (
        <div className="mt-2 flex items-center gap-1 text-xs font-medium">
          <span className={`flex items-center gap-0.5 ${isUp ? 'text-success-600' : 'text-danger-600'}`}>
            {isUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {delta}
          </span>
          <span className="text-gray-400">this month</span>
        </div>
      )}
    </div>
  )
}
