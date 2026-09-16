import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiGet } from '../lib/api'
import ErrorBox from '../components/ErrorBox'

export default function PlayerPage() {
  const { playerId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setError(null)
    setData(null)
    apiGet(`players?id=${playerId}&season=2023`)
      .then((res) => { if (alive) setData(res) })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [playerId])

  if (error) return <ErrorBox message={error} />
  if (!data) return <div className="card h-40 animate-pulse opacity-50" />

  const entry = data.response?.[0]
  if (!entry) return <div className="card p-8 text-center text-slate-400">Player not found for the 2023 season.</div>

  const p = entry.player
  const st = entry.statistics?.[0]

  return (
    <div className="space-y-4">
      <section className="card flex items-center gap-4 p-4">
        <img src={p.photo} alt="" className="h-20 w-20 rounded-full bg-white/5" />
        <div>
          <h1 className="text-xl font-bold">{p.name}</h1>
          <p className="text-sm text-slate-400">
            {p.nationality} · Age {p.age} · {p.height} cm · {p.weight} kg
          </p>
          {st && (
            <p className="mt-1 text-sm">
              <Link to={`/team/${st.team.id}`} className="text-grass hover:underline">{st.team.name}</Link>
              {' · '}{st.games?.position || '—'}
              {st.games?.number ? ` · #${st.games.number}` : ''}
            </p>
          )}
        </div>
      </section>

      {st && (
        <section className="card p-4">
          <h3 className="mb-3 font-semibold">Season statistics <span className="text-xs font-normal text-slate-400">({st.league?.name} 2023)</span></h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Appearances', st.games?.appearences],
              ['Minutes', st.games?.minutes],
              ['Rating', st.games?.rating],
              ['Goals', st.goals?.total],
              ['Assists', st.goals?.assists],
              ['Shots (on target)', `${st.shots?.total ?? 0} (${st.shots?.on ?? 0})`],
              ['Pass accuracy', st.passes?.accuracy ? st.passes.accuracy + '%' : '—'],
              ['Dribbles', `${st.dribbles?.success ?? 0}/${st.dribbles?.attempts ?? 0}`],
              ['Yellow / Red', `${st.cards?.yellow ?? 0} / ${st.cards?.red ?? 0}`],
              ['Tackles / Interceptions', `${st.tackles?.total ?? 0} / ${st.tackles?.interceptions ?? 0}`],
              ['Duels won %', st.duels?.won && st.duels?.total ? Math.round((st.duels.won / st.duels.total) * 100) + '%' : '—'],
              ['Penalties scored', st.penalty?.scored],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line p-3">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-lg font-bold">{value ?? '—'}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
