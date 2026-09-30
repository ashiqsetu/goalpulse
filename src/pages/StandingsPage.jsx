import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, planError } from '../lib/api'
import ErrorBox from '../components/ErrorBox'

// Leagues with standings on the current data plan (football-data.org free
// tier). Cups without a table (World Cup, Euro, Libertadores) are not listed.
// IDs are the app's internal ids — the proxy maps them to the provider codes.
const LEAGUES = [
  { id: 39, name: 'Premier League', country: 'England' },
  { id: 140, name: 'La Liga', country: 'Spain' },
  { id: 135, name: 'Serie A', country: 'Italy' },
  { id: 78, name: 'Bundesliga', country: 'Germany' },
  { id: 61, name: 'Ligue 1', country: 'France' },
  { id: 88, name: 'Eredivisie', country: 'Netherlands' },
  { id: 94, name: 'Primeira Liga', country: 'Portugal' },
  { id: 40, name: 'Championship', country: 'England' },
  { id: 71, name: 'Brasileirão Série A', country: 'Brazil' },
]

export default function StandingsPage() {
  const [league, setLeague] = useState(LEAGUES[0])
  const [view, setView] = useState('all') // all | home | away
  const [data, setData] = useState(null)
  const [seasonUsed, setSeasonUsed] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setData(null)
    apiGet(`standings?league=${league.id}`)
      .then((res) => {
        if (!alive) return
        const perr = planError(res)
        if (perr) setError(perr)
        setData(res)
        setSeasonUsed(res?.response?.[0]?.league?.season || null)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(e.message)
        setLoading(false)
      })
    return () => { alive = false }
  }, [league])

  // Cup competitions with group stages return several group tables — render all.
  const tables = useMemo(() => {
    const groups = data?.response?.[0]?.league?.standings || []
    return groups.filter((g) => Array.isArray(g) && g.length > 0)
  }, [data])

  const seasonLabel =
    data?.response?.[0]?.league?._seasonLabel ||
    (seasonUsed ? `${seasonUsed}/${String(seasonUsed + 1).slice(2)}` : null)
  const isCurrent = (() => {
    const y = seasonUsed
    if (!y) return false
    const now = new Date()
    const cur = now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
    return y === cur
  })()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">League table</h1>
        <div className="flex rounded-lg border border-line p-0.5 text-xs">
          {['all', 'home', 'away'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 font-semibold capitalize transition ${
                view === v ? 'bg-grass text-pitch' : 'text-slate-300 hover:text-white'
              }`}
            >
              {v === 'all' ? 'Overall' : v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {LEAGUES.map((l) => (
          <button
            key={l.id}
            onClick={() => setLeague(l)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${
              league.id === l.id ? 'bg-card font-semibold text-grass' : 'text-slate-300 hover:bg-card'
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {seasonUsed && (
        <ErrorBox
          message={
            isCurrent
              ? `Current season — ${seasonLabel} standings, updated live.`
              : `Showing the ${seasonLabel} season standings.`
          }
        />
      )}

      {loading ? (
        <div className="card h-96 animate-pulse opacity-50" />
      ) : tables.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No standings data.</div>
      ) : (
        tables.map((rows, gi) => (
        <section key={gi} className="card mb-3 overflow-x-auto">
          {tables.length > 1 && (
            <div className="border-b border-line px-3 py-2 text-sm font-semibold text-slate-300">
              {rows[0]?.group?.replace(/^.*?\s-\s/, '') || `Group ${String.fromCharCode(65 + gi)}`}
            </div>
          )}
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase text-slate-400">
                <th className="px-3 py-2">#</th>
                <th className="px-2 py-2">Team</th>
                <th className="px-2 py-2 text-center">P</th>
                <th className="px-2 py-2 text-center">W</th>
                <th className="px-2 py-2 text-center">D</th>
                <th className="px-2 py-2 text-center">L</th>
                <th className="px-2 py-2 text-center">GF</th>
                <th className="px-2 py-2 text-center">GA</th>
                <th className="px-2 py-2 text-center">GD</th>
                <th className="px-2 py-2 text-center">Pts</th>
                <th className="px-3 py-2 text-center">Form</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const s = view === 'all' ? r.all : view === 'home' ? r.home : r.away
                const zone =
                  idx < 4 ? 'bg-grass' : idx < 6 ? 'bg-gold' : idx >= rows.length - 3 ? 'bg-live' : 'bg-transparent'
                return (
                  <tr key={r.team.id} className="border-b border-line/50">
                    <td className="px-3 py-2">
                      <span className={`mr-2 inline-block h-6 w-1 rounded align-middle ${zone}`} />
                      <span className="font-semibold">{r.rank}</span>
                    </td>
                    <td className="px-2 py-2">
                      <Link to={`/team/${r.team.id}`} className="flex items-center gap-2 hover:text-grass">
                        <img src={r.team.logo} alt="" className="h-5 w-5" loading="lazy" />
                        <span className="font-medium">{r.team.name}</span>
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-center">{s.played}</td>
                    <td className="px-2 py-2 text-center">{s.win}</td>
                    <td className="px-2 py-2 text-center">{s.draw}</td>
                    <td className="px-2 py-2 text-center">{s.lose}</td>
                    <td className="px-2 py-2 text-center">{s.goals.for}</td>
                    <td className="px-2 py-2 text-center">{s.goals.against}</td>
                    <td className="px-2 py-2 text-center">{r.goalsDiff}</td>
                    <td className="px-2 py-2 text-center font-bold">{r.points}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-0.5">
                        {(r.form || '').slice(-5).split('').map((c, i) => (
                          <span
                            key={i}
                            className={`h-1.5 w-1.5 rounded-full ${
                              c === 'W' ? 'bg-grass' : c === 'L' ? 'bg-live' : 'bg-white/30'
                            }`}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-line px-3 py-2 text-xs text-slate-500">
            <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-grass" />Champions League</span>
            <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-gold" />Europa</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-live" />Relegation</span>
          </div>
        </section>
        ))
      )}
    </div>
  )
}
