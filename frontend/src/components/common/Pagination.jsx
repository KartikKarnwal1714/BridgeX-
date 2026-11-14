import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'

export default function Pagination({ page = 1, totalPages = 1, onPageChange = () => {}, pageSize = 10 }) {
  // Show up to 5 page buttons, centred on the current page.
  const windowStart = Math.max(1, Math.min(page - 2, totalPages - 4))
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => windowStart + i)

  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
      <div className="flex items-center gap-1 text-sm text-gray-400">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="rounded-md p-1.5 hover:bg-gray-100 disabled:opacity-40"
          disabled={page === 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`h-7 w-7 rounded-md text-xs font-medium ${
              p === page ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="rounded-md p-1.5 hover:bg-gray-100 disabled:opacity-40"
          disabled={page === totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-1 text-xs text-gray-400">
        {pageSize} / page
        <ChevronDown className="h-3.5 w-3.5" />
      </div>
    </div>
  )
}
