export function fmtTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

export function fmtCost(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  if (cents < 100) return `${cents}¢`
  return `$${(cents / 100).toFixed(2)}`
}

export function fmtSeconds(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return '—'
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}m${String(sec).padStart(2, '0')}s`
}

export function fmtClock(ms: number | null): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(ms: number | null): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function timeAgo(ms: number | null): string {
  if (ms == null) return ''
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return fmtDate(ms)
}
