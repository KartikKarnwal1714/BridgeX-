import Badge from '../common/Badge.jsx'
import { formatCompactNumber, formatPercent, formatMs } from '../../utils/format.js'

export default function TopAPIs({ apis = [] }) {
  const top = apis.slice(0, 5)
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-800">Top APIs</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <th className="px-5 py-2.5">API Name</th>
              <th className="px-5 py-2.5">Protocol</th>
              <th className="px-5 py-2.5">Requests</th>
              <th className="px-5 py-2.5">Success Rate</th>
              <th className="px-5 py-2.5">Avg Response Time</th>
              <th className="px-5 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {top.map((api) => (
              <tr key={api.id} className="hover:bg-gray-50/60">
                <td className="px-5 py-3 font-medium text-gray-800">{api.name}</td>
                <td className="px-5 py-3 text-gray-500">{api.protocol}</td>
                <td className="px-5 py-3 text-gray-500">{formatCompactNumber(api.requests)}</td>
                <td className="px-5 py-3 text-gray-500">{formatPercent(api.success_rate)}</td>
                <td className="px-5 py-3 text-gray-500">{formatMs(api.average_response_time)}</td>
                <td className="px-5 py-3">
                  <Badge status={api.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
