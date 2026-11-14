const STATUS_STYLES = {
  Healthy: 'bg-success-50 text-success-600',
  Connected: 'bg-success-50 text-success-600',
  Active: 'bg-success-50 text-success-600',
  Degraded: 'bg-warning-50 text-warning-600',
  Pending: 'bg-warning-50 text-warning-600',
  Unverified: 'bg-warning-50 text-warning-700',
  Inactive: 'bg-gray-100 text-gray-500',
  Revoked: 'bg-gray-100 text-gray-500',
  Error: 'bg-danger-50 text-danger-600',
}

const DOT_STYLES = {
  Healthy: 'bg-success-500',
  Connected: 'bg-success-500',
  Active: 'bg-success-500',
  Degraded: 'bg-warning-500',
  Pending: 'bg-warning-500',
  Unverified: 'bg-warning-500',
  Inactive: 'bg-gray-400',
  Revoked: 'bg-gray-400',
  Error: 'bg-danger-500',
}

export default function Badge({ status, withDot = true }) {
  const style = STATUS_STYLES[status] || 'bg-gray-100 text-gray-600'
  const dot = DOT_STYLES[status] || 'bg-gray-400'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>
      {withDot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {status}
    </span>
  )
}

export function MethodBadge({ method }) {
  const styles = {
    GET: 'bg-info-50 text-info-600',
    POST: 'bg-success-50 text-success-600',
    PUT: 'bg-warning-50 text-warning-600',
    PATCH: 'bg-primary-50 text-primary-700',
    DELETE: 'bg-danger-50 text-danger-600',
  }
  return (
    <span className={`inline-flex w-16 justify-center rounded-md px-2 py-1 text-[11px] font-bold tracking-wide ${styles[method] || 'bg-gray-100 text-gray-600'}`}>
      {method}
    </span>
  )
}

export function HttpStatusBadge({ status }) {
  const code = Number(status)
  let style = 'bg-gray-100 text-gray-600'
  if (code >= 200 && code < 300) style = 'bg-success-50 text-success-600'
  else if (code >= 400 && code < 500) style = 'bg-warning-50 text-warning-600'
  else if (code >= 500) style = 'bg-danger-50 text-danger-600'
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold font-mono-num ${style}`}>{code}</span>
}
