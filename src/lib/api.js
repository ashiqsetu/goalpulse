const BASE = '/api/fetch?ep='

export async function apiGet(endpoint) {
  const res = await fetch(BASE + encodeURIComponent(endpoint))
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
export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
