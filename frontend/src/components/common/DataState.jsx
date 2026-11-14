import { Loader2, AlertTriangle, Inbox } from 'lucide-react'

export function LoadingState({ label = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white py-16 text-sm text-gray-400 shadow-card">
      <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
      {label}
    </div>
  )
}

export function ErrorState({ message = 'Unable to load data. Please try again.', onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-gray-100 bg-white py-16 text-center shadow-card">
      <AlertTriangle className="h-6 w-6 text-danger-500" />
      <p className="max-w-sm text-sm text-gray-500">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyDataState({ label = 'Nothing here yet.' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white py-16 text-sm text-gray-400 shadow-card">
      <Inbox className="h-6 w-6 text-gray-300" />
      {label}
    </div>
  )
}
