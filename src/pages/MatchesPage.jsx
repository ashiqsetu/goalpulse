import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, planError, isLive } from '../lib/api'
import MatchRow from '../components/MatchRow'
import ErrorBox from '../components/ErrorBox'

const LEAGUE_ORDER = [39, 140, 135, 78, 61, 94, 88] // EPL, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, NL

function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmtDayLabel(iso) {
  const today = new Date().toISOString().slice(0, 10)
  if (iso === today) return 'Today'
  const tomorrow = shiftDate(today, 1)
  const yesterday = shiftDate(today, -1)
  if (iso === tomorrow) return 'Tomorrow'
  if (iso === yesterday) return 'Yesterday'
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

export default function MatchesPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async (d) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet(`fixtures?date=${d}`)
      const err = planError(res)
      if (err) setError(err)
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(date) }, [date, load])

  // Auto-refresh live scores every 60s
  useEffect(() => {
    const t = setInterval(() => {
      if (date === new Date().toISOString().slice(0, 10)) load(date)
    }, 60000)
    return () => clearInterval(t)
  }, [date, load])

  const groups = useMemo(() => {
    const fixtures = data?.response || []
    const byLeague = new Map()
    for (const f of fixtures) {
      const lid = f.league.id
      if (!byLeague.has(lid)) byLeague.set(lid, { league: f.league, items: [] })
      byLeague.get(lid).items.push(f)
    }
    const arr = [...byLeague.values()]
    arr.sort((a, b) => {
      const ia = LEAGUE_ORDER.indexOf(a.league.id)
      const ib = LEAGUE_ORDER.indexOf(b.league.id)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.items.length === b.items.length
        ? a.league.name.localeCompare(b.league.name)
        : b.items.length - a.items.length
    })
    return arr
  }, [data])

  const liveCount = useMemo(
    () => (data?.response || []).filter(isLive).length,
    [data],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Matches</h1>
        {liveCount > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-live/15 px-3 py-1 text-xs font-semibold text-live">
            <span className="live-dot" /> {liveCount} live now
          </span>
        )}
      </div>

      {/* Date navigator: ← date → */}
      <div className="card flex items-center justify-between p-2">
        <button
          onClick={() => setDate((d) => shiftDate(d, -1))}
          className="rounded-lg px-4 py-2 text-lg hover:bg-white/5"
          aria-label="Previous day"
        >
          ◀
        </button>
        <div className="text-center">
          <div className="font-semibold">{fmtDayLabel(date)}</div>
          <div className="text-xs text-slate-400">{date}</div>
        </div>
        <button
          onClick={() => setDate((d) => shiftDate(d, 1))}
          className="rounded-lg px-4 py-2 text-lg hover:bg-white/5"
          aria-label="Next day"
        >
          ▶
        </button>
      </div>

      {error && <ErrorBox message={error} />}

      {loading && !data ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card h-20 animate-pulse opacity-50" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No matches on this day.</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.league.id} className="card overflow-hidden">
              <header className="flex items-center gap-2 border-b border-line px-3 py-2">
                <img src={g.league.logo} alt="" className="h-5 w-5" loading="lazy" />
                <span className="text-sm font-semibold">{g.league.name}</span>
                <img src={g.league.flag} alt="" className="h-3.5" loading="lazy" />
                <span className="text-xs text-slate-400">{g.league.country}</span>
                <span className="ml-auto text-xs text-slate-500">{g.items.length} matches</span>
              </header>
              <div className="divide-y divide-line/60">
                {g.items.map((f) => (
                  <MatchRow key={f.fixture.id} fixture={f} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
