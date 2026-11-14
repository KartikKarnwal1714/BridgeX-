import { Inbox } from 'lucide-react'

export default function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', description }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gray-100">
        <Icon className="h-5 w-5 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-gray-400">{description}</p>}
    </div>
  )
}
