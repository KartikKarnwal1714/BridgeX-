export function formatCompactNumber(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return value
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`
  return `${num}`
}

export function formatPercent(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return value
  return `${num.toFixed(1)}%`
}

export function formatMs(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return value
  if (num >= 1000) return `${(num / 1000).toFixed(1)}s`
  return `${num}ms`
}
