import { useCallback, useEffect, useState } from 'react'

/**
 * Fetches data from an async function (typically an api.js call) and
 * exposes { data, loading, error, refetch } so pages can render
 * loading / error / empty / success states consistently.
 */
export function useApiData(fetcher, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadIndex, setReloadIndex] = useState(0)

  const refetch = useCallback(() => setReloadIndex((i) => i + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetcher()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err.response?.data?.error?.message || 'Unable to load data. Please try again.'
          setError(message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadIndex, ...deps])

  return { data, loading, error, refetch }
}
