import { useEffect, useState } from 'react'

const STATUS_URL = '/api/fetch?ep=__status'
const REFRESH_MS = 5 * 60 * 1000

// Tiny header badge showing today's upstream API budget usage
// (fed by the free /api/fetch?ep=__status diagnostics endpoint).
// Hides itself entirely when the status endpoint is unavailable
// (e.g. plain `npm run dev` without the Netlify functions).
export default function QuotaBadge() {
  const [quota, setQuota] = useState(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(STATUS_URL)
        if (!res.ok) return
        const body = await res.json()
        if (alive && body?.quota) setQuota(body.quota)
      } catch { /* badge is optional */ }
    }
    load()
    const t = setInterval(load, REFRESH_MS)
    // Re-check when the user comes back to the tab
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  if (!quota || quota.used == null) return null

  const pct = quota.cap ? quota.used / quota.cap : 0
  const tone = pct >= 0.9
    ? 'border-live/40 bg-live/10 text-live'
    : pct >= 0.7
      ? 'border-gold/40 bg-gold/10 text-gold'
      : 'border-line text-slate-400'
  const dot = pct >= 0.9 ? 'bg-live' : pct >= 0.7 ? 'bg-gold' : 'bg-grass'

  return (
    <span
      title={`API budget today: ${quota.used} of ${quota.cap} upstream requests used${quota.persistent ? '' : ' · not persisted (Blobs unavailable)'}`}
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:flex ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {quota.used}/{quota.cap}
    </span>
  )
}
