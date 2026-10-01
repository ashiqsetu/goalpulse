const BASE = '/api/fetch?ep='

export async function apiGet(endpoint) {
  let res = await fetch(BASE + encodeURIComponent(endpoint))
  // Upstream rate-limit windows are ~60s, but the limiter clears as calls
  // age out of the rolling minute — one patient retry recovers most hits.
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}))
    if (body?.retryable) {
      const after = Math.max(3, Math.min(8, Number(res.headers.get('Retry-After')) || 5))
      await new Promise((r) => setTimeout(r, after * 1000))
      res = await fetch(BASE + encodeURIComponent(endpoint))
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  return res.json()
}

export function planError(data) {
  return data?.errors && !Array.isArray(data.errors) && Object.keys(data.errors).length > 0
    ? Object.values(data.errors).join('; ')
    : null
}

export const fmtDate = (iso) => iso.slice(0, 10)
export const fmtTime = (iso) => {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return 'TBC'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
export function fmtStatus(f) {
  const s = f?.status?.short || ''
  if (s === '1H' || s === '2H' || s === 'HT' || s === 'ET' || s === 'BT' || s === 'P' || s === 'LIVE') {
    return `${f.status.elapsed ?? ''}'`
  }
  if (s === 'NS') return '—'
  return s
}
export const isLive = (f) => ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(f?.status?.short)
export const isFinished = (f) =>
  ['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO', 'SUSP', 'INT'].includes(f?.status?.short)

// The visitor's IANA timezone. Passing it to fixtures?date= makes the API group
// matches by the user's own day, so evening kick-offs don't leak into "tomorrow".
export const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
})()

// The visitor's local calendar date (YYYY-MM-DD). Using toISOString() instead
// would give the UTC date, which is wrong for anyone ahead of UTC in the
// evening — matches would appear a day early/late.
export const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
